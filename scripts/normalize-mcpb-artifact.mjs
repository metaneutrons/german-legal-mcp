#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { chmod, lstat, open, readFile, rename, rm } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import process from 'node:process';

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const ZIP64_SENTINEL_16 = 0xffff;
const ZIP64_SENTINEL_32 = 0xffffffff;
const MAX_ZIP_COMMENT_BYTES = 0xffff;
const MAX_ARTIFACT_BYTES = 512 * 1024 * 1024;
const FIXED_DOS_TIME = 0;
// 1980-01-01, the earliest date representable by the ZIP DOS timestamp.
const FIXED_DOS_DATE = 0x0021;
const TIMESTAMP_EXTRA_FIELDS = new Set([0x000a, 0x5455]);

const checkOnly = process.argv.includes('--check');
const positional = process.argv.slice(2).filter((argument) => argument !== '--check');
if (positional.length !== 1) {
  process.stderr.write(
    'Usage: node scripts/normalize-mcpb-artifact.mjs [--check] <bundle.mcpb>\n',
  );
  process.exit(2);
}
const artifact = resolve(positional[0]);

function assertRange(buffer, offset, length, label) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length)
      || offset < 0 || length < 0 || offset + length > buffer.length) {
    throw new Error(`Invalid ${label} range in MCPB ZIP.`);
  }
}

function findEndOfCentralDirectory(buffer) {
  const earliest = Math.max(0, buffer.length - 22 - MAX_ZIP_COMMENT_BYTES);
  for (let offset = buffer.length - 22; offset >= earliest; offset -= 1) {
    if (buffer.readUInt32LE(offset) !== END_OF_CENTRAL_DIRECTORY) continue;
    const commentLength = buffer.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength === buffer.length) return offset;
  }
  throw new Error('MCPB is not a supported ZIP: end-of-central-directory record is missing.');
}

function rejectTimestampExtraFields(buffer, offset, length, label) {
  assertRange(buffer, offset, length, `${label} extra field`);
  const end = offset + length;
  let cursor = offset;
  while (cursor < end) {
    assertRange(buffer, cursor, 4, `${label} extra-field header`);
    const id = buffer.readUInt16LE(cursor);
    const size = buffer.readUInt16LE(cursor + 2);
    assertRange(buffer, cursor + 4, size, `${label} extra-field payload`);
    if (TIMESTAMP_EXTRA_FIELDS.has(id)) {
      throw new Error(
        `${label} contains timestamp extra field 0x${id.toString(16).padStart(4, '0')}; `
        + 'refusing a partial reproducibility normalization.',
      );
    }
    cursor += 4 + size;
  }
  if (cursor !== end) throw new Error(`Malformed ${label} extra-field data.`);
}

function centralDirectoryLayout(buffer) {
  const eocd = findEndOfCentralDirectory(buffer);
  const disk = buffer.readUInt16LE(eocd + 4);
  const centralDisk = buffer.readUInt16LE(eocd + 6);
  const entriesOnDisk = buffer.readUInt16LE(eocd + 8);
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new Error('Multi-disk MCPB ZIP archives are not supported.');
  }
  if (
    entryCount === ZIP64_SENTINEL_16
    || centralSize === ZIP64_SENTINEL_32
    || centralOffset === ZIP64_SENTINEL_32
  ) {
    throw new Error('ZIP64 MCPB archives are not supported by the timestamp normalizer.');
  }
  assertRange(buffer, centralOffset, centralSize, 'central directory');
  if (centralOffset + centralSize !== eocd) {
    throw new Error('MCPB ZIP central-directory bounds are inconsistent.');
  }
  return { centralOffset, centralSize, entryCount };
}

function normalizeCentralDirectoryEntry(buffer, cursor, index) {
  assertRange(buffer, cursor, 46, `central-directory entry ${index}`);
  if (buffer.readUInt32LE(cursor) !== CENTRAL_DIRECTORY_ENTRY) {
    throw new Error(`Invalid central-directory entry ${index}.`);
  }
  const nameLength = buffer.readUInt16LE(cursor + 28);
  const extraLength = buffer.readUInt16LE(cursor + 30);
  const commentLength = buffer.readUInt16LE(cursor + 32);
  const localOffset = buffer.readUInt32LE(cursor + 42);
  if (localOffset === ZIP64_SENTINEL_32) {
    throw new Error('ZIP64 local-header offsets are not supported.');
  }
  assertRange(buffer, cursor + 46, nameLength + extraLength + commentLength,
    `central-directory entry ${index} body`);
  rejectTimestampExtraFields(
    buffer,
    cursor + 46 + nameLength,
    extraLength,
    `central-directory entry ${index}`,
  );

  assertRange(buffer, localOffset, 30, `local header ${index}`);
  if (buffer.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER) {
    throw new Error(`Invalid local file header for central-directory entry ${index}.`);
  }
  const localNameLength = buffer.readUInt16LE(localOffset + 26);
  const localExtraLength = buffer.readUInt16LE(localOffset + 28);
  assertRange(buffer, localOffset + 30, localNameLength + localExtraLength,
    `local header ${index} body`);
  rejectTimestampExtraFields(
    buffer,
    localOffset + 30 + localNameLength,
    localExtraLength,
    `local header ${index}`,
  );

  const changed = buffer.readUInt16LE(cursor + 12) !== FIXED_DOS_TIME
    || buffer.readUInt16LE(cursor + 14) !== FIXED_DOS_DATE
    || buffer.readUInt16LE(localOffset + 10) !== FIXED_DOS_TIME
    || buffer.readUInt16LE(localOffset + 12) !== FIXED_DOS_DATE;
  buffer.writeUInt16LE(FIXED_DOS_TIME, cursor + 12);
  buffer.writeUInt16LE(FIXED_DOS_DATE, cursor + 14);
  buffer.writeUInt16LE(FIXED_DOS_TIME, localOffset + 10);
  buffer.writeUInt16LE(FIXED_DOS_DATE, localOffset + 12);
  return {
    changed,
    nextCursor: cursor + 46 + nameLength + extraLength + commentLength,
  };
}

function normalizeZipTimestamps(buffer) {
  const { centralOffset, centralSize, entryCount } = centralDirectoryLayout(buffer);
  let cursor = centralOffset;
  let changed = false;
  for (let index = 0; index < entryCount; index += 1) {
    const entry = normalizeCentralDirectoryEntry(buffer, cursor, index);
    cursor = entry.nextCursor;
    changed ||= entry.changed;
  }
  if (cursor !== centralOffset + centralSize) {
    throw new Error('MCPB ZIP central-directory entry count does not match its size.');
  }
  return { changed, entryCount };
}

const artifactInfo = await lstat(artifact);
if (!artifactInfo.isFile() || artifactInfo.size === 0) {
  throw new Error(`MCPB artifact is not a non-empty regular file: ${artifact}`);
}
if (artifactInfo.size > MAX_ARTIFACT_BYTES) {
  throw new Error(`MCPB artifact exceeds the ${MAX_ARTIFACT_BYTES}-byte normalization limit.`);
}
const content = await readFile(artifact);
const { changed, entryCount } = normalizeZipTimestamps(content);
if (checkOnly) {
  if (changed) throw new Error('MCPB ZIP timestamps are not reproducibly normalized.');
} else if (changed) {
  const temporary = `${artifact}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, 'wx', artifactInfo.mode & 0o777);
    try {
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await chmod(temporary, artifactInfo.mode & 0o777);
    await rename(temporary, artifact);
  } finally {
    await rm(temporary, { force: true });
  }
}
process.stdout.write(
  `${checkOnly ? 'Verified' : 'Normalized'} reproducible ZIP timestamps in `
  + `${basename(artifact)} (${entryCount} entries).\n`,
);

#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, rename, unlink } from 'node:fs/promises';
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

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

async function readPinnedArtifact(handle, metadata) {
  const buffer = Buffer.allocUnsafe(metadata.size);
  let total = 0;
  while (total < buffer.byteLength) {
    const { bytesRead } = await handle.read(
      buffer,
      total,
      buffer.byteLength - total,
      total,
    );
    if (bytesRead === 0) break;
    total += bytesRead;
  }
  const sentinel = Buffer.allocUnsafe(1);
  const { bytesRead: extraBytes } = await handle.read(sentinel, 0, 1, metadata.size);
  const after = await handle.stat();
  if (
    total !== metadata.size
    || extraBytes !== 0
    || after.size !== metadata.size
    || after.mtimeMs !== metadata.mtimeMs
    || after.ctimeMs !== metadata.ctimeMs
  ) {
    throw new Error('MCPB artifact changed while it was being read.');
  }
  return buffer;
}

async function writeAtomicArtifact(content, sourceInfo) {
  const temporary = `${artifact}.${process.pid}.${randomUUID()}.tmp`;
  let temporaryHandle;
  try {
    temporaryHandle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
      sourceInfo.mode & 0o777,
    );
    let offset = 0;
    while (offset < content.byteLength) {
      const { bytesWritten } = await temporaryHandle.write(
        content,
        offset,
        content.byteLength - offset,
        offset,
      );
      if (bytesWritten === 0) throw new Error('MCPB artifact write made no progress.');
      offset += bytesWritten;
    }
    if (process.platform !== 'win32') {
      await temporaryHandle.chmod(sourceInfo.mode & 0o777);
    }
    await temporaryHandle.sync();

    const [written, selectedTemporary, selectedSource] = await Promise.all([
      temporaryHandle.stat(),
      lstat(temporary),
      lstat(artifact),
    ]);
    if (
      !written.isFile()
      || written.nlink !== 1
      || written.size !== content.byteLength
      || selectedTemporary.isSymbolicLink()
      || !sameIdentity(written, selectedTemporary)
    ) {
      throw new Error('MCPB normalization output changed before installation.');
    }
    if (selectedSource.isSymbolicLink() || !sameIdentity(sourceInfo, selectedSource)) {
      throw new Error('MCPB artifact path changed before normalization.');
    }

    await rename(temporary, artifact);
    const installed = await lstat(artifact);
    if (installed.isSymbolicLink() || !sameIdentity(written, installed)) {
      throw new Error('MCPB artifact path changed during atomic installation.');
    }
    return installed;
  } finally {
    await temporaryHandle?.close();
    await unlink(temporary).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
  }
}

const noFollow = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW;
let handle;
try {
  handle = await open(artifact, constants.O_RDONLY | noFollow);
} catch (error) {
  if (error?.code === 'ELOOP') {
    throw new Error(`MCPB artifact must not be a symbolic link: ${artifact}`, { cause: error });
  }
  throw error;
}
let entryCount;
let installedInfo;
try {
  const artifactInfo = await handle.stat();
  if (!artifactInfo.isFile() || artifactInfo.nlink !== 1 || artifactInfo.size === 0) {
    throw new Error(`MCPB artifact is not one non-empty regular file: ${artifact}`);
  }
  if (artifactInfo.size > MAX_ARTIFACT_BYTES) {
    throw new Error(`MCPB artifact exceeds the ${MAX_ARTIFACT_BYTES}-byte normalization limit.`);
  }
  const selectedBefore = await lstat(artifact);
  if (selectedBefore.isSymbolicLink() || !sameIdentity(artifactInfo, selectedBefore)) {
    throw new Error(`MCPB artifact path does not select the opened regular file: ${artifact}`);
  }
  const content = await readPinnedArtifact(handle, artifactInfo);
  const normalized = normalizeZipTimestamps(content);
  entryCount = normalized.entryCount;
  if (checkOnly) {
    if (normalized.changed) {
      throw new Error('MCPB ZIP timestamps are not reproducibly normalized.');
    }
  } else if (normalized.changed) {
    installedInfo = await writeAtomicArtifact(content, artifactInfo);
  }
  const [openedAfter, selectedAfter] = await Promise.all([
    installedInfo ?? handle.stat(),
    lstat(artifact),
  ]);
  if (
    selectedAfter.isSymbolicLink()
    || !openedAfter.isFile()
    || openedAfter.nlink !== 1
    || openedAfter.size !== artifactInfo.size
    || !sameIdentity(openedAfter, selectedAfter)
  ) {
    throw new Error('MCPB artifact path changed during normalization.');
  }
} finally {
  await handle.close();
}
process.stdout.write(
  `${checkOnly ? 'Verified' : 'Normalized'} reproducible ZIP timestamps in `
  + `${basename(artifact)} (${entryCount} entries).\n`,
);

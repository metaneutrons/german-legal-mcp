import { inflateRawSync } from 'node:zlib';

/**
 * Minimal reader for the single-entry archives the legal portals publish.
 *
 * RII distributes each decision as a ZIP holding one XML file, and GII does the
 * same for each law. Node has no ZIP reader, and pulling in a dependency to
 * open a one-file archive is a poor trade — `zlib` already provides the only
 * part that is hard.
 *
 * The central directory is parsed rather than the local file header, because
 * the local header is allowed to carry zeroed sizes and defer them to a data
 * descriptor after the payload (general-purpose bit 3). The central directory
 * is always authoritative, so reading it avoids a case that would otherwise
 * appear to work until the day a producer starts streaming.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_MIN_SIZE = 22;
/** ZIP comments are 16-bit-length, so the record starts within this window. */
const EOCD_SEARCH_LIMIT = 0xffff + EOCD_MIN_SIZE;
export const ZIP_MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
export const ZIP_MAX_ENTRY_BYTES = 64 * 1024 * 1024;

export interface ZipReadLimits {
  /** Tests may lower a limit; callers cannot raise the production ceiling. */
  readonly maxArchiveBytes?: number;
  readonly maxEntryBytes?: number;
}

export interface ZipEntry {
  readonly name: string;
  readonly data: Buffer;
}

interface CentralDirectoryEntry {
  readonly centralOffset: number;
  readonly method: number;
  readonly flags: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly name: string;
  readonly localOffset: number;
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const start = Math.max(0, buffer.length - EOCD_SEARCH_LIMIT);
  for (let offset = buffer.length - EOCD_MIN_SIZE; offset >= start; offset--) {
    if (buffer.readUInt32LE(offset) !== EOCD_SIGNATURE) continue;
    const commentLength = buffer.readUInt16LE(offset + 20);
    if (offset + EOCD_MIN_SIZE + commentLength === buffer.length) return offset;
  }
  throw new Error('Not a ZIP archive: no end-of-central-directory record.');
}

/**
 * Read the first entry of a ZIP archive.
 *
 * Only stored (0) and deflated (8) entries are supported, which is everything
 * these publishers emit; anything else fails loudly rather than returning
 * plausible rubbish.
 */
export function readFirstZipEntry(buffer: Buffer, limits: ZipReadLimits = {}): ZipEntry {
  const maxArchiveBytes = boundedLimit(
    limits.maxArchiveBytes,
    ZIP_MAX_ARCHIVE_BYTES,
    'archive',
  );
  const maxEntryBytes = boundedLimit(limits.maxEntryBytes, ZIP_MAX_ENTRY_BYTES, 'entry');
  if (buffer.length > maxArchiveBytes) {
    throw new Error(`ZIP archive exceeds the ${maxArchiveBytes}-byte limit.`);
  }
  const centralEntry = readSingleCentralDirectoryEntry(buffer, maxArchiveBytes, maxEntryBytes);
  const payload = readCentralEntryPayload(buffer, centralEntry);
  return decodeZipEntry(centralEntry, payload, maxEntryBytes);
}

function readSingleCentralDirectoryEntry(
  buffer: Buffer,
  maxArchiveBytes: number,
  maxEntryBytes: number,
): CentralDirectoryEntry {
  const eocd = findEndOfCentralDirectory(buffer);
  assertRange(buffer, eocd, EOCD_MIN_SIZE, 'end-of-central-directory record');
  const diskNumber = buffer.readUInt16LE(eocd + 4);
  const centralDisk = buffer.readUInt16LE(eocd + 6);
  const entriesOnDisk = buffer.readUInt16LE(eocd + 8);
  const entryCount = buffer.readUInt16LE(eocd + 10);
  if (entryCount === 0) throw new Error('ZIP archive is empty.');
  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new Error('Unsupported multi-disk ZIP archive.');
  }
  if (entryCount !== 1) throw new Error(`ZIP archive must contain exactly one entry, found ${entryCount}.`);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  assertRange(buffer, centralOffset, centralSize, 'central directory');
  if (centralOffset + centralSize > eocd) {
    throw new Error('Malformed ZIP: central directory overlaps its end record.');
  }
  return readCentralDirectoryEntry(buffer, centralOffset, centralSize, maxArchiveBytes, maxEntryBytes);
}

function readCentralDirectoryEntry(
  buffer: Buffer,
  centralOffset: number,
  centralSize: number,
  maxArchiveBytes: number,
  maxEntryBytes: number,
): CentralDirectoryEntry {
  assertRange(buffer, centralOffset, 46, 'central directory entry');
  if (buffer.readUInt32LE(centralOffset) !== CENTRAL_SIGNATURE) {
    throw new Error('Malformed ZIP: central directory signature missing.');
  }
  const method = buffer.readUInt16LE(centralOffset + 10);
  const flags = buffer.readUInt16LE(centralOffset + 8);
  const compressedSize = buffer.readUInt32LE(centralOffset + 20);
  const uncompressedSize = buffer.readUInt32LE(centralOffset + 24);
  const nameLength = buffer.readUInt16LE(centralOffset + 28);
  const extraLength = buffer.readUInt16LE(centralOffset + 30);
  const commentLength = buffer.readUInt16LE(centralOffset + 32);
  const localOffset = buffer.readUInt32LE(centralOffset + 42);
  const centralEntrySize = 46 + nameLength + extraLength + commentLength;
  assertRange(buffer, centralOffset, centralEntrySize, 'central directory entry');
  if (centralEntrySize > centralSize) {
    throw new Error('Malformed ZIP: central entry exceeds the declared central directory.');
  }
  if ((flags & 0x0001) !== 0) throw new Error('Encrypted ZIP entries are not supported.');
  if (compressedSize > maxArchiveBytes) {
    throw new Error(`ZIP compressed entry exceeds the ${maxArchiveBytes}-byte limit.`);
  }
  if (uncompressedSize > maxEntryBytes) {
    throw new Error(`ZIP entry exceeds the ${maxEntryBytes}-byte uncompressed limit.`);
  }
  if (nameLength === 0 || nameLength > 4_096) {
    throw new Error('Malformed ZIP: invalid entry-name length.');
  }
  const name = buffer.toString('utf8', centralOffset + 46, centralOffset + 46 + nameLength);
  if (name.includes('\0')) throw new Error('Malformed ZIP: entry name contains NUL.');
  return {
    centralOffset,
    method,
    flags,
    compressedSize,
    uncompressedSize,
    name,
    localOffset,
  };
}

function readCentralEntryPayload(buffer: Buffer, entry: CentralDirectoryEntry): Buffer {
  assertRange(buffer, entry.localOffset, 30, 'local file header');
  if (buffer.readUInt32LE(entry.localOffset) !== LOCAL_SIGNATURE) {
    throw new Error(`Malformed ZIP: local header missing for "${entry.name}".`);
  }
  const localFlags = buffer.readUInt16LE(entry.localOffset + 6);
  const localMethod = buffer.readUInt16LE(entry.localOffset + 8);
  if ((localFlags & 0x0001) !== 0) throw new Error('Encrypted ZIP entries are not supported.');
  if (localMethod !== entry.method) throw new Error('Malformed ZIP: compression methods disagree.');
  const dataStart = entry.localOffset + 30
    + buffer.readUInt16LE(entry.localOffset + 26)
    + buffer.readUInt16LE(entry.localOffset + 28);
  assertRange(buffer, dataStart, entry.compressedSize, 'compressed entry payload');
  if (dataStart + entry.compressedSize > entry.centralOffset) {
    throw new Error('Malformed ZIP: entry payload overlaps the central directory.');
  }
  return buffer.subarray(dataStart, dataStart + entry.compressedSize);
}

function decodeZipEntry(
  entry: CentralDirectoryEntry,
  payload: Buffer,
  maxEntryBytes: number,
): ZipEntry {
  if (entry.method === 0) {
    if (payload.length > maxEntryBytes || payload.length !== entry.uncompressedSize) {
      throw new Error(`Malformed stored ZIP entry "${entry.name}": size mismatch or limit exceeded.`);
    }
    return { name: entry.name, data: Buffer.from(payload) };
  }
  if (entry.method !== 8) {
    throw new Error(`Unsupported ZIP compression method ${entry.method} for "${entry.name}".`);
  }
  const data = inflateRawSync(payload, { maxOutputLength: maxEntryBytes });
  if (entry.uncompressedSize !== 0 && data.length !== entry.uncompressedSize) {
    throw new Error(
      `ZIP entry "${entry.name}" inflated to ${data.length} bytes, expected ${entry.uncompressedSize}.`,
    );
  }
  return { name: entry.name, data };
}

function boundedLimit(value: number | undefined, ceiling: number, label: string): number {
  if (value === undefined) return ceiling;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`ZIP ${label} limit must be a positive safe integer.`);
  }
  return Math.min(value, ceiling);
}

function assertRange(buffer: Buffer, offset: number, length: number, label: string): void {
  if (
    !Number.isSafeInteger(offset)
    || !Number.isSafeInteger(length)
    || offset < 0
    || length < 0
    || offset > buffer.length
    || length > buffer.length - offset
  ) {
    throw new Error(`Malformed ZIP: ${label} is outside the archive.`);
  }
}

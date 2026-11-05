export interface ArchiveFile {
  name: string;
  content: string;
}

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP_VERSION = 20;
const UTF8_FLAG = 0x0800;
const MAX_UINT32 = 0xffffffff;

interface EncodedArchiveFile {
  name: Uint8Array;
  content: Uint8Array;
  crc32: number;
  offset: number;
}

function writeUint16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function writeUint32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value, true);
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function toDosDateTime(date: Date): { date: number; time: number } {
  const year = Math.min(Math.max(date.getUTCFullYear(), 1980), 2107);
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const seconds = Math.floor(date.getUTCSeconds() / 2);

  return {
    date: ((year - 1980) << 9) | (month << 5) | day,
    time: (hours << 11) | (minutes << 5) | seconds,
  };
}

export function calculateCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createLocalHeader(file: EncodedArchiveFile, modified: { date: number; time: number }): Uint8Array {
  const header = new Uint8Array(30 + file.name.byteLength);
  const view = new DataView(header.buffer);

  writeUint32(view, 0, LOCAL_FILE_HEADER_SIGNATURE);
  writeUint16(view, 4, ZIP_VERSION);
  writeUint16(view, 6, UTF8_FLAG);
  writeUint16(view, 8, 0); // Stored without compression.
  writeUint16(view, 10, modified.time);
  writeUint16(view, 12, modified.date);
  writeUint32(view, 14, file.crc32);
  writeUint32(view, 18, file.content.byteLength);
  writeUint32(view, 22, file.content.byteLength);
  writeUint16(view, 26, file.name.byteLength);
  writeUint16(view, 28, 0);
  header.set(file.name, 30);

  return header;
}

function createCentralDirectoryHeader(file: EncodedArchiveFile, modified: { date: number; time: number }): Uint8Array {
  const header = new Uint8Array(46 + file.name.byteLength);
  const view = new DataView(header.buffer);

  writeUint32(view, 0, CENTRAL_DIRECTORY_HEADER_SIGNATURE);
  writeUint16(view, 4, ZIP_VERSION);
  writeUint16(view, 6, ZIP_VERSION);
  writeUint16(view, 8, UTF8_FLAG);
  writeUint16(view, 10, 0);
  writeUint16(view, 12, modified.time);
  writeUint16(view, 14, modified.date);
  writeUint32(view, 16, file.crc32);
  writeUint32(view, 20, file.content.byteLength);
  writeUint32(view, 24, file.content.byteLength);
  writeUint16(view, 28, file.name.byteLength);
  writeUint16(view, 30, 0);
  writeUint16(view, 32, 0);
  writeUint16(view, 34, 0);
  writeUint16(view, 36, 0);
  writeUint32(view, 38, 0);
  writeUint32(view, 42, file.offset);
  header.set(file.name, 46);

  return header;
}

function createEndOfCentralDirectory(fileCount: number, directorySize: number, directoryOffset: number): Uint8Array {
  const footer = new Uint8Array(22);
  const view = new DataView(footer.buffer);

  writeUint32(view, 0, END_OF_CENTRAL_DIRECTORY_SIGNATURE);
  writeUint16(view, 4, 0);
  writeUint16(view, 6, 0);
  writeUint16(view, 8, fileCount);
  writeUint16(view, 10, fileCount);
  writeUint32(view, 12, directorySize);
  writeUint32(view, 16, directoryOffset);
  writeUint16(view, 20, 0);

  return footer;
}

/**
 * Create a standards-compliant, uncompressed ZIP archive without a Node-only dependency.
 * CSV compresses well, but storing it directly keeps the export action available in Convex's
 * default runtime and avoids pulling a large archive library into the backend bundle.
 */
export function createZipArchive(files: readonly ArchiveFile[], modifiedAt = new Date()): Uint8Array {
  if (files.length === 0) {
    throw new Error('Cannot create an empty export archive');
  }
  if (files.length > 0xffff) {
    throw new Error('Export archive contains too many files');
  }

  const encoder = new TextEncoder();
  const modified = toDosDateTime(modifiedAt);
  const localChunks: Uint8Array[] = [];
  const encodedFiles: EncodedArchiveFile[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const content = encoder.encode(file.content);
    if (content.byteLength > MAX_UINT32 || offset > MAX_UINT32) {
      throw new Error('Export archive exceeds the ZIP32 size limit');
    }

    const encodedFile: EncodedArchiveFile = {
      name,
      content,
      crc32: calculateCrc32(content),
      offset,
    };
    const header = createLocalHeader(encodedFile, modified);
    localChunks.push(header, content);
    encodedFiles.push(encodedFile);
    offset += header.byteLength + content.byteLength;
  }

  const centralDirectoryOffset = offset;
  const centralChunks = encodedFiles.map((file) => createCentralDirectoryHeader(file, modified));
  const centralDirectorySize = centralChunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const footer = createEndOfCentralDirectory(files.length, centralDirectorySize, centralDirectoryOffset);

  return concatBytes([...localChunks, ...centralChunks, footer]);
}

// NOTE: Hotfix — TS types for shared flags + FE v1 flip + staged loader + prefer-v1 legacy; aligns with Phase-1/2/3 specs. Additive, non-breaking.
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
const { execFile } = require('child_process');
const zlib = require('zlib');

function execFileAsync(cmd, args, options = {}) {
  const finalOptions = { encoding: 'buffer', maxBuffer: 1024 * 1024 * 200, ...options };
  return new Promise((resolve, reject) => {
    execFile(cmd, args, finalOptions, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        err.stdout = stdout;
        return reject(err);
      }
      resolve({ stdout, stderr });
    });
  });
}

async function enumerateZipBuffers(buffer, predicate) {
  try {
    return await enumerateWithSystemUnzip(buffer, predicate);
  } catch (error) {
    console.warn('System unzip unavailable, using JS fallback', error?.message || error);
    try {
      return enumerateWithJsFallback(buffer, predicate);
    } catch (fallbackError) {
      fallbackError.cause = error;
      throw fallbackError;
    }
  }
}

async function enumerateWithSystemUnzip(buffer, predicate) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-zip-'));
  const zipPath = path.join(tmpDir, `${randomUUID()}.zip`);
  try {
    await fs.writeFile(zipPath, buffer);
    const { stdout: listStdout } = await execFileAsync('unzip', ['-Z1', zipPath]);
    const listText = Buffer.isBuffer(listStdout) ? listStdout.toString('utf8') : String(listStdout || '');
    const entries = listText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((entry) => !entry.endsWith('/'));

    const files = [];
    for (const entry of entries) {
      if (predicate && !predicate({ fileName: entry })) continue;
      const { stdout } = await execFileAsync('unzip', ['-p', zipPath, entry]);
      files.push({ fileName: entry, buffer: Buffer.from(stdout) });
    }
    return files;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

function readUInt32LE(buffer, offset) {
  return buffer.readUInt32LE(offset);
}

function readUInt16LE(buffer, offset) {
  return buffer.readUInt16LE(offset);
}

function findEndOfCentralDirectory(buffer) {
  const signature = 0x06054b50;
  const maxCommentLength = 0xffff;
  const start = Math.max(0, buffer.length - (22 + maxCommentLength));
  for (let i = buffer.length - 22; i >= start; i -= 1) {
    if (readUInt32LE(buffer, i) === signature) {
      return i;
    }
  }
  return -1;
}

function enumerateCentralDirectory(buffer, callback) {
  const centralDirSignature = 0x02014b50;
  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset < 0) throw new Error('ZIP end of central directory not found');
  const entryCount = readUInt16LE(buffer, eocdOffset + 10);
  let offset = readUInt32LE(buffer, eocdOffset + 16);
  for (let index = 0; index < entryCount; index += 1) {
    if (readUInt32LE(buffer, offset) !== centralDirSignature) break;
    const compression = readUInt16LE(buffer, offset + 10);
    const compressedSize = readUInt32LE(buffer, offset + 20);
    const uncompressedSize = readUInt32LE(buffer, offset + 24);
    const fileNameLength = readUInt16LE(buffer, offset + 28);
    const extraLength = readUInt16LE(buffer, offset + 30);
    const commentLength = readUInt16LE(buffer, offset + 32);
    const localHeaderOffset = readUInt32LE(buffer, offset + 42);
    const fileName = buffer.slice(offset + 46, offset + 46 + fileNameLength).toString('utf8');
    const nextOffset = offset + 46 + fileNameLength + extraLength + commentLength;
    callback({
      fileName,
      compression,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    offset = nextOffset;
  }
}

function extractFile(buffer, entry) {
  const localHeaderSignature = 0x04034b50;
  const { localHeaderOffset } = entry;
  if (readUInt32LE(buffer, localHeaderOffset) !== localHeaderSignature) {
    throw new Error('Invalid ZIP local header');
  }
  const fileNameLength = readUInt16LE(buffer, localHeaderOffset + 26);
  const extraLength = readUInt16LE(buffer, localHeaderOffset + 28);
  const dataOffset = localHeaderOffset + 30 + fileNameLength + extraLength;
  const data = buffer.slice(dataOffset, dataOffset + entry.compressedSize);
  switch (entry.compression) {
    case 0:
      return Buffer.from(data);
    case 8:
      return zlib.inflateRawSync(data);
    default:
      throw new Error(`Unsupported ZIP compression method ${entry.compression}`);
  }
}

function enumerateWithJsFallback(buffer, predicate) {
  const files = [];
  enumerateCentralDirectory(buffer, (entry) => {
    if (!entry.fileName || entry.fileName.endsWith('/')) return;
    if (predicate && !predicate({ fileName: entry.fileName })) return;
    const fileBuffer = extractFile(buffer, entry);
    files.push({ fileName: entry.fileName, buffer: fileBuffer });
  });
  return files;
}

module.exports = { enumerateZipBuffers };

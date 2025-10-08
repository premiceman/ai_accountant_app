const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
const { execFile } = require('child_process');

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
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-zip-'));
  const zipPath = path.join(tmpDir, `${randomUUID()}.zip`);
  try {
    await fs.writeFile(zipPath, buffer);
    const { stdout: listStdout } = await execFileAsync('unzip', ['-Z1', zipPath]);
    const entries = listStdout
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

module.exports = { enumerateZipBuffers };

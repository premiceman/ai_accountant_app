#!/usr/bin/env node
/**
 * Copy the monorepo-level `shared` directory into a package-local folder.
 * Ensures deployment targets (e.g. Render) that install packages in isolation
 * still receive the runtime extraction helpers.
 */
const fs = require('fs');
const path = require('path');

function usage() {
  console.error('Usage: node copy-shared.js <target-directory>');
  process.exit(1);
}

const targetArg = process.argv[2];
if (!targetArg) usage();

const sourceDir = path.resolve(__dirname, '..', 'shared');
const targetDir = path.resolve(process.cwd(), targetArg);

if (!fs.existsSync(sourceDir)) {
  console.error(`copy-shared: source directory not found at ${sourceDir}`);
  process.exit(1);
}

async function copyRecursive(src, dest) {
  const entries = await fs.promises.readdir(src, { withFileTypes: true });
  await fs.promises.mkdir(dest, { recursive: true });
  await Promise.all(
    entries.map(async (entry) => {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        await copyRecursive(srcPath, destPath);
      } else if (entry.isSymbolicLink()) {
        const link = await fs.promises.readlink(srcPath);
        await fs.promises.symlink(link, destPath);
      } else {
        await fs.promises.copyFile(srcPath, destPath);
      }
    })
  );
}

(async () => {
  try {
    await fs.promises.rm(targetDir, { recursive: true, force: true });
    await copyRecursive(sourceDir, targetDir);
    console.log(`copy-shared: copied ${sourceDir} -> ${targetDir}`);
  } catch (err) {
    console.error('copy-shared: failed to copy shared directory', err);
    process.exitCode = 1;
  }
})();

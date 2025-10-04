// backend/src/store/jsondb.js
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const ROOT = path.join(__dirname, '../../..');
const DATA_DIR = path.join(ROOT, 'data');
const UPLOADS_DIR = path.join(ROOT, 'uploads');

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
ensureDir(DATA_DIR);
ensureDir(UPLOADS_DIR);

async function readJsonSafe(file, fallback) {
  try {
    const raw = await fsp.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJsonSafe(file, data) {
  const tmp = file + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fsp.rename(tmp, file);
}

module.exports = {
  paths: {
    dataDir: DATA_DIR,
    uploadsDir: UPLOADS_DIR,
    accounts: path.join(DATA_DIR, 'accounts.json'),
    transactions: path.join(DATA_DIR, 'transactions.json'),
    holdings: path.join(DATA_DIR, 'holdings.json'),
    prices: path.join(DATA_DIR, 'prices.json'),
    pricesHistory: path.join(DATA_DIR, 'prices_history.json'),
    docsIndex: path.join(UPLOADS_DIR, 'index.json'),
  },
  readJsonSafe,
  writeJsonSafe,
};

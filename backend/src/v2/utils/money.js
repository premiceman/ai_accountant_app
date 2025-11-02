function toPence(value) {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  if (!str) return null;
  if (/^-?\d+$/.test(str)) {
    return Number(str);
  }
  if (/^-?\d+\.\d{1,2}$/.test(str)) {
    const [whole, fraction = ''] = str.split('.');
    const padded = `${fraction}${'0'.repeat(2 - fraction.length)}`;
    return Number(whole) * 100 + Number(padded);
  }
  throw new Error(`Invalid money value '${value}'`);
}

function assertPence(value, label) {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be integer pence`);
  }
}

module.exports = { toPence, assertPence };

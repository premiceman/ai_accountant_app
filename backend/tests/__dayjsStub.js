function dayjs() {
  return {
    format(pattern) {
      if (pattern === 'YYYY/MM/DD') return '2024/01/31';
      if (pattern === 'YYYY-MM') return '2024-01';
      if (pattern === 'YYYY-MM-DD') return '2024-01-31';
      return '20240131';
    },
    isValid() {
      return true;
    },
  };
}

dayjs.tz = () => dayjs();

dayjs.utc = () => dayjs();

module.exports = dayjs;

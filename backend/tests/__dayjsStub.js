function dayjs() {
  return {
    format() {
      return '20240101';
    },
  };
}

dayjs.tz = () => dayjs();

dayjs.utc = () => dayjs();

module.exports = dayjs;

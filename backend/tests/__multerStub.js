function multer() {
  return {
    single() {
      return (_req, _res, next) => next();
    },
  };
}

multer.memoryStorage = () => ({ storage: 'memory' });

module.exports = multer;

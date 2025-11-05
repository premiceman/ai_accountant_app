function createRouter() {
  const stack = [];
  return {
    stack,
    use(handler) {
      stack.push({ route: null, handle: handler });
      return this;
    },
    all(path, handler) {
      stack.push({ route: { path, stack: [{ handle: handler }] } });
      return this;
    },
    get(path, handler) {
      stack.push({ route: { path, stack: [{ handle: handler }] } });
      return this;
    },
    post(path, ...handlers) {
      stack.push({ route: { path, stack: handlers.map((handle) => ({ handle })) } });
      return this;
    },
  };
}

function express() {
  return express;
}

express.Router = createRouter;

module.exports = express;

const { performance } = require('node:perf_hooks');

function createLogger(scope) {
  const prefix = scope ? `[${scope}]` : '';
  function log(level, message, meta = {}) {
    const time = new Date().toISOString();
    const payload = { time, level, scope, message, ...meta };
    if (level === 'error') {
      console.error(prefix, message, meta);
    } else if (level === 'warn') {
      console.warn(prefix, message, meta);
    } else {
      console.log(prefix, message, meta);
    }
    return payload;
  }

  return {
    debug: (message, meta) => log('debug', message, meta),
    info: (message, meta) => log('info', message, meta),
    warn: (message, meta) => log('warn', message, meta),
    error: (message, meta) => log('error', message, meta),
    time(label) {
      const start = performance.now();
      return {
        end(resultMeta = {}) {
          const durationMs = Math.round(performance.now() - start);
          log('info', `${label} completed`, { ...resultMeta, durationMs });
        },
      };
    },
  };
}

module.exports = { createLogger };

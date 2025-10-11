'use strict';

const LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

function createConsoleLogger(options = {}) {
  const name = options.name || 'app';
  const prefix = `[${name}]`;
  const logger = {};
  LEVELS.forEach((level) => {
    const consoleMethod = console[level] ? console[level].bind(console) : console.log.bind(console);
    logger[level] = (...args) => consoleMethod(prefix, ...args);
  });
  logger.child = () => logger;
  return logger;
}

let factory = createConsoleLogger;
try {
  // Optional dependency: prefer pino when available.
  const pino = require('pino');
  factory = (options = {}) => pino(options);
} catch (error) {
  console.warn('⚠️  pino logger unavailable, using console fallback', error?.message || error);
}

function createLogger(options = {}) {
  return factory(options);
}

module.exports = { createLogger };

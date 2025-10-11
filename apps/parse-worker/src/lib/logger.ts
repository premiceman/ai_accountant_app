import pino from 'pino';

const level = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

function resolveTransport() {
  if (process.env.NODE_ENV === 'production') return undefined;
  try {
    require.resolve('pino-pretty');
    return { target: 'pino-pretty', options: { translateTime: 'SYS:standard' } } as const;
  } catch {
    return undefined;
  }
}

export const logger = pino({
  level,
  base: undefined,
  transport: resolveTransport(),
});

export default logger;

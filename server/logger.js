import pino from 'pino';

/**
 * Structured JSON logger. Tokens and auth headers are redacted.
 * @param {{ logLevel: string }} config
 */
export function createLogger({ logLevel }) {
  return pino({
    level: logLevel,
    base: { service: 'realtime-chat' },
    redact: ['req.headers.authorization', 'token', '*.token'],
  });
}

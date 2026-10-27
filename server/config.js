/**
 * @fileoverview Loads and validates runtime configuration from environment
 * variables. Invalid configuration fails fast at boot with a clear message.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export class ConfigError extends Error {
  /** @param {string[]} problems */
  constructor(problems) {
    super(`Invalid configuration:\n - ${problems.join('\n - ')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

/**
 * @typedef {Object} Config
 * @property {'development'|'production'|'test'} nodeEnv
 * @property {string} host
 * @property {number} port
 * @property {string} logLevel
 * @property {string|null} dbPath  Absolute path of the SQLite file, or null for in-memory only.
 * @property {number} persistIntervalMs
 * @property {string} sessionSecret
 * @property {number} sessionTtlSeconds
 * @property {string[]} allowedOrigins  Empty = same-origin only.
 * @property {boolean} trustProxy
 * @property {number} wsMaxPayloadBytes
 * @property {number} wsMaxBufferedBytes
 * @property {number} wsAuthTimeoutMs
 * @property {number} wsHeartbeatMs
 * @property {number} wsRateLimitBurst
 * @property {number} wsRateLimitPerSec
 * @property {number} wsMaxChannelsPerConnection
 * @property {number} messageMaxLength
 * @property {number} httpWriteRateLimitPerMin
 * @property {number} shutdownTimeoutMs
 */

/**
 * @param {Record<string, string|undefined>} env
 * @param {string[]} problems
 */
function intReader(env, problems) {
  /**
   * @param {string} name
   * @param {number} fallback
   * @param {{min?: number, max?: number}} [range]
   */
  return (name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
    const raw = env[name];
    if (raw === undefined || raw === '') return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) {
      problems.push(`${name} must be an integer between ${min} and ${max} (got "${raw}")`);
      return fallback;
    }
    return value;
  };
}

/**
 * Resolves the session secret. Production requires SESSION_SECRET; in
 * development a random secret is generated once and kept next to the
 * database so sessions survive restarts.
 * @param {Record<string, string|undefined>} env
 * @param {string} nodeEnv
 * @param {string|null} dataDir
 * @param {string[]} problems
 */
function resolveSessionSecret(env, nodeEnv, dataDir, problems) {
  const secret = env.SESSION_SECRET;
  if (secret) {
    if (secret.length < 32) problems.push('SESSION_SECRET must have at least 32 characters');
    return secret;
  }
  if (nodeEnv === 'production') {
    problems.push('SESSION_SECRET is required in production (use at least 32 random characters)');
    return '';
  }
  if (!dataDir) return crypto.randomBytes(32).toString('hex');
  const secretFile = path.join(dataDir, '.session-secret');
  try {
    return fs.readFileSync(secretFile, 'utf8').trim();
  } catch {
    const generated = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(secretFile, generated, { mode: 0o600 });
    return generated;
  }
}

/**
 * @param {Record<string, string|undefined>} [env]
 * @returns {Config}
 */
export function loadConfig(env = process.env) {
  /** @type {string[]} */
  const problems = [];
  const int = intReader(env, problems);

  const nodeEnv = /** @type {Config['nodeEnv']} */ (env.NODE_ENV || 'development');
  if (!['development', 'production', 'test'].includes(nodeEnv)) {
    problems.push(`NODE_ENV must be development, production or test (got "${nodeEnv}")`);
  }

  // DB_PATH=":memory:" keeps everything in RAM (tests, demos).
  const rawDbPath = env.DB_PATH ?? path.join(ROOT_DIR, 'data', 'chat.db');
  const dbPath = rawDbPath === ':memory:' ? null : path.resolve(rawDbPath);
  const dataDir = dbPath ? path.dirname(dbPath) : null;

  const allowedOrigins = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  for (const origin of allowedOrigins) {
    try {
      new URL(origin);
    } catch {
      problems.push(`ALLOWED_ORIGINS contains an invalid origin: "${origin}"`);
    }
  }

  const logLevel = env.LOG_LEVEL || (nodeEnv === 'test' ? 'silent' : 'info');
  if (!['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'].includes(logLevel)) {
    problems.push(`LOG_LEVEL is invalid (got "${logLevel}")`);
  }

  const config = {
    nodeEnv,
    host: env.HOST || '0.0.0.0',
    port: int('PORT', 3003, { min: 0, max: 65535 }),
    logLevel,
    dbPath,
    persistIntervalMs: int('PERSIST_INTERVAL_MS', 1000, { min: 50, max: 60_000 }),
    sessionSecret: '',
    sessionTtlSeconds: int('SESSION_TTL_SECONDS', 30 * 24 * 3600, { min: 60 }),
    allowedOrigins,
    trustProxy: env.TRUST_PROXY === 'true' || env.TRUST_PROXY === '1',
    wsMaxPayloadBytes: int('WS_MAX_PAYLOAD_BYTES', 16 * 1024, { min: 1024, max: 1024 * 1024 }),
    wsMaxBufferedBytes: int('WS_MAX_BUFFERED_BYTES', 1024 * 1024, { min: 64 * 1024 }),
    wsAuthTimeoutMs: int('WS_AUTH_TIMEOUT_MS', 5000, { min: 100 }),
    wsHeartbeatMs: int('WS_HEARTBEAT_MS', 30_000, { min: 100 }),
    wsRateLimitBurst: int('WS_RATE_LIMIT_BURST', 20, { min: 1 }),
    wsRateLimitPerSec: int('WS_RATE_LIMIT_PER_SEC', 5, { min: 1 }),
    wsMaxChannelsPerConnection: int('WS_MAX_CHANNELS_PER_CONNECTION', 50, { min: 1 }),
    messageMaxLength: int('MESSAGE_MAX_LENGTH', 2000, { min: 1, max: 10_000 }),
    httpWriteRateLimitPerMin: int('HTTP_WRITE_RATE_LIMIT_PER_MIN', 20, { min: 1 }),
    shutdownTimeoutMs: int('SHUTDOWN_TIMEOUT_MS', 10_000, { min: 100 }),
  };

  if (problems.length === 0) {
    config.sessionSecret = resolveSessionSecret(env, nodeEnv, dataDir, problems);
  }
  if (problems.length) throw new ConfigError(problems);
  return Object.freeze(config);
}

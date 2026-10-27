import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ConfigError, loadConfig } from '../../server/config.js';

describe('loadConfig', () => {
  it('requires a strong SESSION_SECRET in production', () => {
    assert.throws(() => loadConfig({ NODE_ENV: 'production', DB_PATH: ':memory:' }), ConfigError);
    assert.throws(() => loadConfig({ NODE_ENV: 'production', DB_PATH: ':memory:', SESSION_SECRET: 'short' }), /32/);
    const config = loadConfig({ NODE_ENV: 'production', DB_PATH: ':memory:', SESSION_SECRET: 'x'.repeat(32) });
    assert.equal(config.nodeEnv, 'production');
  });
  it('validates numbers and origins', () => {
    assert.throws(() => loadConfig({ NODE_ENV: 'test', DB_PATH: ':memory:', PORT: 'abc' }), /PORT/);
    assert.throws(
      () => loadConfig({ NODE_ENV: 'test', DB_PATH: ':memory:', ALLOWED_ORIGINS: 'nope' }),
      /ALLOWED_ORIGINS/,
    );
  });
  it('applies defaults', () => {
    const config = loadConfig({ NODE_ENV: 'test', DB_PATH: ':memory:' });
    assert.equal(config.port, 3003);
    assert.equal(config.dbPath, null);
    assert.equal(config.messageMaxLength, 2000);
    assert.ok(config.sessionSecret.length >= 32);
  });
});

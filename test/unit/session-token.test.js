import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createSessionToken, verifySessionToken } from '../../server/domain/session-token.js';

const SECRET = 'a'.repeat(32);

describe('session tokens', () => {
  it('round-trips a valid token', () => {
    const token = createSessionToken(SECRET, 'user-1', 60, 1_000_000);
    assert.deepEqual(verifySessionToken(SECRET, token, 1_000_000), { userId: 'user-1', expiresAt: 1_060_000 });
  });
  it('rejects expired tokens', () => {
    const token = createSessionToken(SECRET, 'user-1', 60, 1_000_000);
    assert.equal(verifySessionToken(SECRET, token, 1_060_000), null);
  });
  it('rejects tokens signed with another secret', () => {
    const token = createSessionToken('b'.repeat(32), 'user-1', 60);
    assert.equal(verifySessionToken(SECRET, token), null);
  });
  it('rejects tampered payloads', () => {
    const token = createSessionToken(SECRET, 'user-1', 60);
    const [, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'admin', iat: 0, exp: 9e9 })).toString('base64url');
    assert.equal(verifySessionToken(SECRET, `${forged}.${sig}`), null);
  });
  it('rejects malformed input', () => {
    for (const bad of [undefined, '', 'abc', 'a.b.c', 42, 'x'.repeat(2000)]) {
      assert.equal(verifySessionToken(SECRET, bad), null);
    }
  });
});

/**
 * @fileoverview Stateless, HMAC-signed session tokens.
 *
 * Format: `<base64url(JSON payload)>.<base64url(HMAC-SHA256)>`, payload
 * `{ sub: userId, iat, exp }` (seconds). The server is the only party that
 * can mint tokens, so a client can no longer pick another user's id.
 */

import crypto from 'node:crypto';

/**
 * @param {string} secret
 * @param {string} data
 */
const sign = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('base64url');

/**
 * @param {string} secret
 * @param {string} userId
 * @param {number} ttlSeconds
 * @param {number} [nowMs]
 */
export function createSessionToken(secret, userId, ttlSeconds, nowMs = Date.now()) {
  const iat = Math.floor(nowMs / 1000);
  const body = Buffer.from(JSON.stringify({ sub: userId, iat, exp: iat + ttlSeconds })).toString('base64url');
  return `${body}.${sign(secret, body)}`;
}

/**
 * @param {string} secret
 * @param {unknown} token
 * @param {number} [nowMs]
 * @returns {{ userId: string, expiresAt: number } | null}
 */
export function verifySessionToken(secret, token, nowMs = Date.now()) {
  if (typeof token !== 'string' || token.length > 1024) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, signature] = parts;

  const expected = Buffer.from(sign(secret, body));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof payload?.sub !== 'string' || typeof payload?.exp !== 'number') return null;
    if (payload.exp * 1000 <= nowMs) return null;
    return { userId: payload.sub, expiresAt: payload.exp * 1000 };
  } catch {
    return null;
  }
}

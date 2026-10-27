import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { startServer } from '../helpers.js';

describe('HTTP API', () => {
  /** @type {Awaited<ReturnType<typeof startServer>>} */
  let srv;
  before(async () => {
    srv = await startServer({ HTTP_WRITE_RATE_LIMIT_PER_MIN: '1000' });
  });
  after(() => srv.close());

  it('exposes liveness and readiness probes', async () => {
    assert.equal((await srv.request('/healthz')).status, 200);
    assert.deepEqual((await srv.request('/readyz')).body, { status: 'ready' });
  });

  it('serves the client with security headers', async () => {
    const res = await srv.request('/');
    assert.equal(res.status, 200);
    const csp = res.headers.get('content-security-policy') ?? '';
    assert.match(csp, /script-src 'self'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-powered-by'), null);
  });

  it('creates sessions with validated usernames', async () => {
    const ok = await srv.request('/api/session', { method: 'POST', json: { username: '  Ana  ' } });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.user.username, 'Ana');
    assert.equal(typeof ok.body.token, 'string');

    const bad = await srv.request('/api/session', { method: 'POST', json: { username: '' } });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, 'bad_request');

    const invalidJson = await srv.request('/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{nope',
    });
    assert.equal(invalidJson.status, 400);

    const huge = await srv.request('/api/session', { method: 'POST', json: { username: 'x'.repeat(10_000) } });
    assert.equal(huge.status, 413);
  });

  it('rejects cross-origin session creation', async () => {
    const res = await srv.request('/api/session', {
      method: 'POST',
      json: { username: 'Mallory' },
      headers: { origin: 'https://evil.example' },
    });
    assert.equal(res.status, 403);
  });

  it('requires a valid bearer token on API reads', async () => {
    for (const path of ['/api/users', '/api/channels', '/api/messages/general', '/api/me']) {
      assert.equal((await srv.request(path)).status, 401, path);
      assert.equal((await srv.request(path, { token: 'forged.token' })).status, 401, path);
    }
  });

  it('lists channels, users and paginated history', async () => {
    const { token, user } = await srv.createSession('Reader');
    const channels = await srv.request('/api/channels', { token });
    assert.equal(channels.body[0].id, 'general');

    const users = await srv.request('/api/users', { token });
    assert.ok(users.body.some((u) => u.id === user.id));

    const me = await srv.request('/api/me', { token });
    assert.deepEqual(me.body, { id: user.id, username: 'Reader' });

    const history = await srv.request('/api/channels/general/messages?limit=5', { token });
    assert.equal(history.status, 200);
    assert.ok(Array.isArray(history.body));

    assert.equal((await srv.request('/api/channels/general/messages?limit=-1', { token })).status, 400);
    assert.equal((await srv.request('/api/channels/general/messages?before=1&after=1', { token })).status, 400);
    assert.equal((await srv.request('/api/channels/missing/messages', { token })).status, 404);
    assert.equal((await srv.request('/api/channels/Bad%20Id/messages', { token })).status, 400);
  });

  it('creates channels and rejects duplicates', async () => {
    const { token } = await srv.createSession('Creator');
    const created = await srv.request('/api/channels', { method: 'POST', token, json: { name: 'Random Talk' } });
    assert.equal(created.status, 201);
    assert.equal(created.body.id, 'random-talk');
    const dup = await srv.request('/api/channels', { method: 'POST', token, json: { name: 'random talk' } });
    assert.equal(dup.status, 409);
  });

  it('returns JSON 404 for unknown API routes without leaking internals', async () => {
    const res = await srv.request('/api/nope');
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'not_found');
  });
});

describe('HTTP write rate limit', () => {
  it('limits session creation per client', async () => {
    const srv = await startServer({ HTTP_WRITE_RATE_LIMIT_PER_MIN: '2' });
    try {
      const statuses = [];
      for (let i = 0; i < 3; i++) {
        statuses.push((await srv.request('/api/session', { method: 'POST', json: { username: `u${i}` } })).status);
      }
      assert.deepEqual(statuses, [201, 201, 429]);
    } finally {
      await srv.close();
    }
  });
});

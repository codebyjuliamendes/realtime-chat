import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, describe, it } from 'node:test';
import pino from 'pino';
import { openDatabase } from '../../server/db/database.js';
import { createRepositories } from '../../server/db/repositories.js';
import { createChatService } from '../../server/domain/chat-service.js';
import { AppError } from '../../server/domain/errors.js';

const config = { sessionSecret: 'k'.repeat(32), sessionTtlSeconds: 3600 };

describe('ChatService', () => {
  /** @type {ReturnType<typeof createChatService>} */
  let service;
  before(async () => {
    const handle = await openDatabase({ dbPath: null, persistIntervalMs: 1000, logger: pino({ level: 'silent' }) });
    let clock = 1000;
    service = createChatService({ repos: createRepositories(handle), config, now: () => clock });
    // freeze time to prove timestamps are still strictly increasing
    clock = 5000;
  });

  it('issues server-side identities; duplicate display names are allowed', () => {
    const a = service.createSession('Ana');
    const b = service.createSession('Ana');
    assert.notEqual(a.user.id, b.user.id);
    assert.equal(service.authenticate(a.token).id, a.user.id);
    assert.throws(
      () => service.authenticate('forged'),
      (e) => e instanceof AppError && e.status === 401,
    );
  });

  it('rejects invalid usernames', () => {
    assert.throws(
      () => service.createSession(''),
      (e) => e instanceof AppError && e.status === 400,
    );
  });

  it('posts messages idempotently and rejects id reuse by others', () => {
    const ana = service.createSession('Ana').user;
    const bob = service.createSession('Bob').user;
    const id = randomUUID();
    const first = service.postMessage(ana.id, { id, channelId: 'general', content: 'hi' });
    const retry = service.postMessage(ana.id, { id, channelId: 'general', content: 'hi' });
    assert.equal(first.duplicate, false);
    assert.equal(retry.duplicate, true);
    assert.throws(
      () => service.postMessage(bob.id, { id, channelId: 'general', content: 'hijack' }),
      (e) => e instanceof AppError && e.status === 409,
    );
  });

  it('assigns strictly increasing timestamps even with a frozen clock', () => {
    const user = service.createSession('Clock').user;
    const t1 = service.postMessage(user.id, { id: randomUUID(), channelId: 'general', content: '1' }).message.timestamp;
    const t2 = service.postMessage(user.id, { id: randomUUID(), channelId: 'general', content: '2' }).message.timestamp;
    assert.ok(t2 > t1);
  });

  it('rejects unknown channels', () => {
    const user = service.createSession('X').user;
    assert.throws(
      () => service.postMessage(user.id, { id: randomUUID(), channelId: 'nope', content: 'x' }),
      (e) => e instanceof AppError && e.status === 404,
    );
  });

  it('returns the newest page of history in chronological order', () => {
    const user = service.createSession('Hist').user;
    service.createChannel(user.id, 'History');
    for (let i = 0; i < 5; i++) {
      service.postMessage(user.id, { id: randomUUID(), channelId: 'history', content: `m${i}` });
    }
    const page = service.getHistory(user.id, 'history', { limit: 2 });
    assert.deepEqual(
      page.map((m) => m.content),
      ['m3', 'm4'],
    );
    const older = service.getHistory(user.id, 'history', { limit: 2, before: page[0].timestamp });
    assert.deepEqual(
      older.map((m) => m.content),
      ['m1', 'm2'],
    );
    const newer = service.getHistory(user.id, 'history', { after: older[1].timestamp });
    assert.deepEqual(
      newer.map((m) => m.content),
      ['m3', 'm4'],
    );
  });

  it('only lets other users mark a message as read, once', () => {
    const ana = service.createSession('Ana').user;
    const bob = service.createSession('Bob').user;
    const id = randomUUID();
    service.postMessage(ana.id, { id, channelId: 'general', content: 'read me' });
    assert.equal(service.markRead(ana.id, { id, channelId: 'general' }), false);
    assert.equal(service.markRead(bob.id, { id, channelId: 'general' }), true);
    assert.equal(service.markRead(bob.id, { id, channelId: 'general' }), false);
    assert.throws(() => service.markRead(bob.id, { id: randomUUID(), channelId: 'general' }), /not found/);
  });

  it('creates channels with unique slugs', () => {
    const user = service.createSession('Creator').user;
    const channel = service.createChannel(user.id, 'Dev Team');
    assert.equal(channel.id, 'dev-team');
    assert.throws(
      () => service.createChannel(user.id, 'dev  team'),
      (e) => e instanceof AppError && e.status === 409,
    );
    assert.throws(
      () => service.createChannel(user.id, '🔥'),
      (e) => e instanceof AppError && e.status === 400,
    );
  });
});

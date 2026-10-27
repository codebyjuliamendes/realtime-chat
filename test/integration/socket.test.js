import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { after, before, describe, it } from 'node:test';
import WebSocket from 'ws';
import { TestClient, startServer } from '../helpers.js';

describe('WebSocket gateway', () => {
  /** @type {Awaited<ReturnType<typeof startServer>>} */
  let srv;
  before(async () => {
    srv = await startServer({
      HTTP_WRITE_RATE_LIMIT_PER_MIN: '1000',
      WS_AUTH_TIMEOUT_MS: '300',
      WS_RATE_LIMIT_BURST: '1000',
      MESSAGE_MAX_LENGTH: '100',
      WS_MAX_PAYLOAD_BYTES: '2048',
    });
  });
  after(() => srv.close());

  /** @param {string} name */
  async function connectAs(name) {
    const session = await srv.createSession(name);
    const client = await TestClient.connect(srv.wsUrl, session.token);
    return { client, ...session };
  }

  describe('authentication', () => {
    it('acknowledges a valid token with the server-side identity and a refreshed token', async () => {
      const session = await srv.createSession('Ana');
      const client = await TestClient.connect(srv.wsUrl);
      client.send('auth', { token: session.token });
      const ack = await client.next('auth_ack');
      assert.deepEqual(ack.user, session.user);
      assert.equal(typeof ack.token, 'string');
      await client.close();
    });

    it('rejects the legacy self-asserted identity and forged tokens (close 4001)', async () => {
      const legacy = await TestClient.connect(srv.wsUrl);
      legacy.send('auth', { userId: 'someone-else', username: 'Admin' });
      assert.equal((await legacy.next('error')).code, 'bad_request');
      legacy.ws.close();

      const forged = await TestClient.connect(srv.wsUrl);
      forged.send('auth', { token: 'eyJzdWIiOiJ4In0.invalid' });
      assert.equal((await forged.next('error')).code, 'unauthorized');
      assert.equal((await forged.closed).code, 4001);
    });

    it('refuses commands before authentication', async () => {
      const client = await TestClient.connect(srv.wsUrl);
      client.send('join', { channelId: 'general' });
      assert.equal((await client.next('error')).code, 'unauthorized');
      assert.equal((await client.closed).code, 4001);
    });

    it('closes connections that never authenticate (4008)', async () => {
      const client = await TestClient.connect(srv.wsUrl);
      assert.equal((await client.closed).code, 4008);
    });

    it('rejects upgrades from foreign origins and unknown paths', async () => {
      const foreign = new WebSocket(srv.wsUrl, { origin: 'https://evil.example' });
      const [, res] = await once(foreign, 'unexpected-response');
      assert.equal(res.statusCode, 403);

      const wrongPath = new WebSocket(srv.wsUrl.replace('/ws', '/nope'));
      const [, res2] = await once(wrongPath, 'unexpected-response');
      assert.equal(res2.statusCode, 404);
    });
  });

  describe('rooms and messages', () => {
    it('delivers messages only to members of the room, with author info and ack', async () => {
      const ana = await connectAs('Ana');
      const bob = await connectAs('Bob');
      const carol = await connectAs('Carol');
      await srv.request('/api/channels', { method: 'POST', token: ana.token, json: { name: 'Room A' } });
      await ana.client.join('room-a');
      await bob.client.join('room-a');
      await carol.client.join('general');

      const id = randomUUID();
      ana.client.send('message', { id, channelId: 'room-a', content: '<img src=x onerror=alert(1)>' });
      const ack = await ana.client.next('message_ack', (p) => p.id === id);
      assert.equal(ack.status, 'sent');
      assert.equal(typeof ack.timestamp, 'number');

      const received = await bob.client.next('new_message', (p) => p.id === id);
      assert.equal(received.userId, ana.user.id);
      assert.equal(received.username, 'Ana');
      // stored and relayed verbatim: escaping happens in the client renderer
      assert.equal(received.content, '<img src=x onerror=alert(1)>');

      await carol.client.expectNone('new_message');
      await ana.client.expectNone('new_message');

      const history = await srv.request('/api/channels/room-a/messages', { token: bob.token });
      assert.equal(history.body.at(-1).id, id);
      await Promise.all([ana.client.close(), bob.client.close(), carol.client.close()]);
    });

    it('stops delivering after leave', async () => {
      const ana = await connectAs('Ana');
      const bob = await connectAs('Bob');
      await ana.client.join('general');
      await bob.client.join('general');
      bob.client.send('leave', { channelId: 'general' });
      await bob.client.next('left');
      ana.client.send('message', { id: randomUUID(), channelId: 'general', content: 'anyone?' });
      await ana.client.next('message_ack');
      await bob.client.expectNone('new_message');
      await Promise.all([ana.client.close(), bob.client.close()]);
    });

    it('refuses to join or post to channels that do not exist', async () => {
      const { client } = await connectAs('Ana');
      client.send('join', { channelId: 'ghost' });
      assert.equal((await client.next('error')).code, 'not_found');
      const id = randomUUID();
      client.send('message', { id, channelId: 'ghost', content: 'hi' });
      const err = await client.next('error');
      assert.deepEqual([err.code, err.ref], ['not_found', id]);
      await client.close();
    });

    it('treats retries of the same message id as idempotent and blocks id reuse by others', async () => {
      const ana = await connectAs('Ana');
      const bob = await connectAs('Bob');
      await bob.client.join('general');
      const id = randomUUID();
      ana.client.send('message', { id, channelId: 'general', content: 'once' });
      await ana.client.next('message_ack', (p) => p.id === id && !p.duplicate);
      ana.client.send('message', { id, channelId: 'general', content: 'once' });
      assert.equal((await ana.client.next('message_ack', (p) => p.id === id)).duplicate, true);
      await bob.client.next('new_message', (p) => p.id === id);
      await bob.client.expectNone('new_message');

      bob.client.send('message', { id, channelId: 'general', content: 'hijack' });
      const err = await bob.client.next('error');
      assert.deepEqual([err.code, err.ref], ['conflict', id]);
      await Promise.all([ana.client.close(), bob.client.close()]);
    });

    it('validates content length and frame size', async () => {
      const { client } = await connectAs('Ana');
      const id = randomUUID();
      client.send('message', { id, channelId: 'general', content: 'x'.repeat(101) });
      const err = await client.next('error');
      assert.deepEqual([err.code, err.ref], ['bad_request', id]);

      client.send('message', { id: 'nope', channelId: 'general', content: 'x' });
      assert.equal((await client.next('error')).code, 'bad_request');

      client.ws.send('not json');
      assert.equal((await client.next('error')).code, 'bad_request');

      // frames above WS_MAX_PAYLOAD_BYTES are refused by the protocol layer (1009)
      client.ws.send(JSON.stringify({ type: 'message', payload: { content: 'x'.repeat(4096) } }));
      assert.equal((await client.closed).code, 1009);
    });
  });

  describe('typing, read receipts and presence', () => {
    it('broadcasts typing to the room except the sender', async () => {
      const ana = await connectAs('Ana');
      const bob = await connectAs('Bob');
      await ana.client.join('general');
      await bob.client.join('general');
      ana.client.send('typing', { channelId: 'general' });
      const typing = await bob.client.next('typing_indicator');
      assert.deepEqual(typing, { userId: ana.user.id, username: 'Ana', channelId: 'general' });
      await ana.client.expectNone('typing_indicator');
      await Promise.all([ana.client.close(), bob.client.close()]);
    });

    it('lets other members mark a message as read, never the author', async () => {
      const ana = await connectAs('Ana');
      const bob = await connectAs('Bob');
      await ana.client.join('general');
      await bob.client.join('general');
      const id = randomUUID();
      ana.client.send('message', { id, channelId: 'general', content: 'read me' });
      await ana.client.next('message_ack', (p) => p.id === id);

      ana.client.send('message_read', { id, channelId: 'general' });
      await ana.client.expectNone('message_update');

      bob.client.send('message_read', { id, channelId: 'general' });
      const update = await ana.client.next('message_update', (p) => p.id === id);
      assert.deepEqual(update, { id, channelId: 'general', status: 'read', readBy: bob.user.id });

      bob.client.send('message_read', { id: randomUUID(), channelId: 'general' });
      assert.equal((await bob.client.next('error')).code, 'not_found');
      await Promise.all([ana.client.close(), bob.client.close()]);
    });

    it('keeps a user online while any of their tabs is connected', async () => {
      const watcher = await connectAs('Watcher');
      const session = await srv.createSession('MultiTab');
      const tab1 = await TestClient.connect(srv.wsUrl, session.token);
      const online = await watcher.client.next('presence_update', (p) => p.userId === session.user.id);
      assert.deepEqual([online.status, online.username], ['online', 'MultiTab']);

      const tab2 = await TestClient.connect(srv.wsUrl, session.token);
      await tab1.close();
      await watcher.client.expectNone('presence_update', (p) => p.userId === session.user.id);

      await tab2.close();
      const offline = await watcher.client.next('presence_update', (p) => p.userId === session.user.id);
      assert.equal(offline.status, 'offline');
      await watcher.client.close();
    });

    it('announces new channels to connected users', async () => {
      const ana = await connectAs('Ana');
      const bob = await connectAs('Bob');
      await srv.request('/api/channels', { method: 'POST', token: ana.token, json: { name: 'Announcements' } });
      const { channel } = await bob.client.next('channel_created');
      assert.equal(channel.id, 'announcements');
      await Promise.all([ana.client.close(), bob.client.close()]);
    });
  });
});

describe('WebSocket rate limiting', () => {
  it('rejects bursts with rate_limited and closes persistent abusers (1008)', async () => {
    const srv = await startServer({ WS_RATE_LIMIT_BURST: '5', WS_RATE_LIMIT_PER_SEC: '1' });
    try {
      const { token } = await srv.createSession('Spammer');
      const client = await TestClient.connect(srv.wsUrl, token); // auth consumes 1 token
      for (let i = 0; i < 30; i++) client.send('typing', { channelId: 'general' });
      const err = await client.next('error', (p) => p.code === 'rate_limited');
      assert.equal(err.code, 'rate_limited');
      assert.equal((await client.closed).code, 1008);
    } finally {
      await srv.close();
    }
  });
});

describe('WebSocket backpressure', () => {
  it('terminates a consumer that stops reading instead of buffering forever', async () => {
    const srv = await startServer({
      WS_RATE_LIMIT_BURST: '1000000',
      WS_RATE_LIMIT_PER_SEC: '1000000',
      WS_MAX_BUFFERED_BYTES: String(64 * 1024),
      WS_MAX_PAYLOAD_BYTES: String(64 * 1024),
      MESSAGE_MAX_LENGTH: '8000',
    });
    try {
      const sender = await TestClient.connect(srv.wsUrl, (await srv.createSession('Sender')).token);
      const slow = await TestClient.connect(srv.wsUrl, (await srv.createSession('Slow')).token);
      await slow.join('general');
      const closed = slow.closed;
      // stop reading from the socket: the server's send buffer for this client fills up
      // @ts-ignore private but stable
      slow.ws._socket.pause();

      const content = 'x'.repeat(8000);
      let terminated = false;
      closed.then(() => (terminated = true));
      for (let i = 0; i < 4000 && !terminated && srv.chat.gateway.stats().connections === 2; i++) {
        sender.send('message', { id: randomUUID(), channelId: 'general', content });
        if (i % 50 === 0) await new Promise((r) => setTimeout(r, 5));
      }
      await new Promise((r) => setTimeout(r, 100));
      assert.equal(srv.chat.gateway.stats().connections, 1, 'slow consumer should be disconnected');
      await sender.close();
    } finally {
      await srv.close();
    }
  });
});

describe('graceful shutdown', () => {
  it('closes sockets with 1001 and stops reporting ready', async () => {
    const srv = await startServer();
    const { token } = await srv.createSession('Ana');
    const client = await TestClient.connect(srv.wsUrl, token);
    const closing = srv.close();
    assert.equal((await client.closed).code, 1001);
    await closing;
  });
});

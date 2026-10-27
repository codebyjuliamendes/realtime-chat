import { once } from 'node:events';
import WebSocket from 'ws';
import { loadConfig } from '../server/config.js';
import { createLogger } from '../server/logger.js';
import { createChatServer } from '../server/server.js';

export const TEST_SECRET = 'test-secret-test-secret-test-secret-0123456789';

/** @param {Record<string, string>} [env] */
export function testConfig(env = {}) {
  return loadConfig({
    NODE_ENV: 'test',
    DB_PATH: ':memory:',
    SESSION_SECRET: TEST_SECRET,
    LOG_LEVEL: 'silent',
    ...env,
  });
}

/**
 * Boots an isolated server on a random port.
 * @param {Record<string, string>} [env]
 */
export async function startServer(env = {}) {
  const config = testConfig(env);
  const chat = await createChatServer({ config, logger: createLogger(config) });
  const { port } = await chat.listen(0, '127.0.0.1');
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    chat,
    config,
    baseUrl,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
    /** @param {string} path @param {RequestInit & { token?: string, json?: unknown }} [init] */
    async request(path, { token, json, headers, ...init } = {}) {
      const res = await fetch(baseUrl + path, {
        ...init,
        headers: {
          ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...headers,
        },
        body: json !== undefined ? JSON.stringify(json) : init.body,
      });
      const text = await res.text();
      let body = text;
      try {
        body = JSON.parse(text);
      } catch {
        /* not JSON */
      }
      return { status: res.status, headers: res.headers, body };
    },
    /** @param {string} username */
    async createSession(username) {
      const res = await this.request('/api/session', { method: 'POST', json: { username } });
      if (res.status !== 201) throw new Error(`session failed: ${res.status} ${JSON.stringify(res.body)}`);
      return /** @type {{ token: string, user: { id: string, username: string } }} */ (res.body);
    },
    close: () => chat.close(),
  };
}

/**
 * Test WebSocket client that records every event and lets tests await them.
 */
export class TestClient {
  /** @param {string} url @param {import('ws').ClientOptions} [options] */
  constructor(url, options) {
    this.ws = new WebSocket(url, options);
    /** @type {{ type: string, payload: any }[]} */
    this.events = [];
    /** @type {Set<() => void>} */
    this.waiters = new Set();
    this.closed = new Promise((resolve) => {
      this.ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() }));
    });
    this.ws.on('message', (data) => {
      this.events.push(JSON.parse(data.toString()));
      for (const w of this.waiters) w();
    });
    this.ws.on('error', () => {});
  }

  /** @param {string} url @param {string} [token] */
  static async connect(url, token) {
    const client = new TestClient(url);
    await once(client.ws, 'open');
    if (token) {
      client.send('auth', { token });
      await client.next('auth_ack');
    }
    return client;
  }

  /** @param {string} type @param {unknown} payload */
  send(type, payload) {
    this.ws.send(JSON.stringify({ type, payload }));
  }

  /**
   * Resolves with the first event (not yet consumed) matching type/predicate.
   * @param {string} type
   * @param {(payload: any) => boolean} [predicate]
   * @param {number} [timeoutMs]
   */
  next(type, predicate = () => true, timeoutMs = 2000) {
    return new Promise((resolve, reject) => {
      const check = () => {
        const index = this.events.findIndex((e) => e.type === type && predicate(e.payload));
        if (index === -1) return false;
        const [event] = this.events.splice(index, 1);
        this.waiters.delete(check);
        clearTimeout(timer);
        resolve(event.payload);
        return true;
      };
      const timer = setTimeout(() => {
        this.waiters.delete(check);
        reject(new Error(`timed out waiting for "${type}"; got: ${JSON.stringify(this.events.map((e) => e.type))}`));
      }, timeoutMs);
      if (!check()) this.waiters.add(check);
    });
  }

  /**
   * Asserts no (matching) event of `type` arrives within `ms`.
   * @param {string} type
   * @param {(payload: any) => boolean} [predicate]
   */
  async expectNone(type, predicate = () => true, ms = 150) {
    await new Promise((r) => setTimeout(r, ms));
    const found = this.events.find((e) => e.type === type && predicate(e.payload));
    if (found) throw new Error(`unexpected "${type}" event: ${JSON.stringify(found.payload)}`);
  }

  /** @param {string} channelId */
  async join(channelId) {
    this.send('join', { channelId });
    return this.next('joined', (p) => p.channelId === channelId);
  }

  close() {
    this.ws.close();
    return this.closed;
  }
}

import { backoffDelay } from './backoff.js';

/** Close codes after which reconnecting cannot help. */
const FATAL_CLOSE_CODES = new Set([4001]);

/**
 * Resilient WebSocket client:
 * - authenticates with the session token on every (re)connection;
 * - reconnects forever with jittered exponential backoff (and immediately
 *   when the browser comes back online / the tab becomes visible);
 * - keeps an outbox of unacknowledged chat messages and re-sends them after
 *   reconnecting (the server de-duplicates by message id).
 *
 * Events (via `on`): status(state), ready(authAck), event({type, payload}), fatal(code).
 */
export class ChatSocket {
  /** @param {{ url: string, getToken: () => string|null }} opts */
  constructor({ url, getToken }) {
    this.url = url;
    this.getToken = getToken;
    /** @type {WebSocket|null} */
    this.ws = null;
    this.attempt = 0;
    this.authenticated = false;
    this.stopped = false;
    /** @type {ReturnType<typeof setTimeout>|null} */
    this.retryTimer = null;
    /** @type {ReturnType<typeof setTimeout>|null} */
    this.flushTimer = null;
    /** @type {Map<string, object>} id -> frame payload awaiting message_ack */
    this.outbox = new Map();
    /** @type {Record<string, Set<Function>>} */
    this.listeners = {};

    this.reconnectNow = () => {
      if (this.stopped || (this.ws && this.ws.readyState <= WebSocket.OPEN)) return;
      this.attempt = 0;
      this.connect();
    };
    window.addEventListener('online', this.reconnectNow);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.reconnectNow();
    });
  }

  /** @param {string} name @param {Function} fn */
  on(name, fn) {
    (this.listeners[name] ??= new Set()).add(fn);
    return this;
  }

  /** @param {string} name @param {unknown} [arg] */
  emit(name, arg) {
    for (const fn of this.listeners[name] ?? []) fn(arg);
  }

  connect() {
    if (this.stopped) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.authenticated = false;
    this.emit('status', this.attempt === 0 ? 'connecting' : 'reconnecting');

    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'auth', payload: { token: this.getToken() } }));
    };
    ws.onmessage = (event) => {
      let frame;
      try {
        frame = JSON.parse(event.data);
      } catch {
        return;
      }
      if (frame.type === 'auth_ack') {
        this.attempt = 0;
        this.authenticated = true;
        this.emit('status', 'online');
        this.emit('ready', frame.payload);
        for (const payload of this.outbox.values()) this.rawSend('message', payload);
        return;
      }
      if (frame.type === 'message_ack') this.outbox.delete(frame.payload.id);
      if (frame.type === 'error' && frame.payload?.code === 'rate_limited') this.scheduleRetry();
      if (frame.type === 'error' && frame.payload?.ref && frame.payload.code !== 'rate_limited') {
        // The server rejected this message permanently (validation, conflict...).
        this.outbox.delete(frame.payload.ref);
      }
      this.emit('event', frame);
    };
    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      this.authenticated = false;
      this.ws = null;
      if (FATAL_CLOSE_CODES.has(event.code)) {
        this.stop();
        this.emit('fatal', event.code);
        return;
      }
      if (this.stopped) return;
      this.emit('status', 'offline');
      const delay = backoffDelay(this.attempt++);
      this.retryTimer = setTimeout(() => this.connect(), delay);
    };
  }

  /**
   * A rate-limited frame may have been a chat message: re-send the outbox a
   * bit later (already stored messages are just acknowledged again).
   */
  scheduleRetry() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      for (const payload of this.outbox.values()) this.rawSend('message', payload);
    }, 2000);
  }

  /** @param {string} type @param {object} payload */
  rawSend(type, payload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.authenticated) {
      this.ws.send(JSON.stringify({ type, payload }));
      return true;
    }
    return false;
  }

  /** Fire-and-forget frames (typing, read receipts, join): dropped while offline. */
  send(type, payload) {
    return this.rawSend(type, payload);
  }

  /** Chat messages are queued until acknowledged. */
  sendMessage(payload) {
    this.outbox.set(payload.id, payload);
    this.rawSend('message', payload);
  }

  get isOnline() {
    return this.authenticated;
  }

  stop() {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    window.removeEventListener('online', this.reconnectNow);
    const ws = this.ws;
    this.ws = null;
    ws?.close(1000, 'bye');
  }
}

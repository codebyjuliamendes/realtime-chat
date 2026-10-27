/**
 * @fileoverview WebSocket gateway: authentication, rooms, rate limiting,
 * backpressure, presence and heartbeat. Business rules live in ChatService.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { AppError } from '../domain/errors.js';
import { CloseCodes, ErrorCodes, encodeEvent, parseClientFrame } from '../domain/protocol.js';
import { TokenBucket } from '../domain/rate-limiter.js';

const LOW_BANDWIDTH_RTT_MS = 500;
const WS_PATHS = new Set(['/', '/ws']);

/**
 * @typedef {Object} ConnectionState
 * @property {string} id
 * @property {import('../db/repositories.js').User|null} user
 * @property {Set<string>} channels
 * @property {TokenBucket} bucket       frames allowed per connection
 * @property {TokenBucket} violations   how many rejected frames we tolerate before closing
 * @property {boolean} isAlive
 * @property {number} pingSentAt
 * @property {NodeJS.Timeout|null} authTimer
 */

/**
 * @param {{
 *   server: import('node:http').Server,
 *   service: import('../domain/chat-service.js').ChatService,
 *   config: import('../config.js').Config,
 *   logger: import('pino').Logger,
 *   isOriginAllowed: (origin: string|undefined, host: string|undefined) => boolean,
 * }} deps
 */
export function createGateway({ server, service, config, logger, isOriginAllowed }) {
  const log = logger.child({ component: 'ws' });
  const wss = new WebSocketServer({ noServer: true, maxPayload: config.wsMaxPayloadBytes });

  /** @type {Map<WebSocket, ConnectionState>} */
  const connections = new Map();
  /** @type {Map<string, Set<WebSocket>>} channelId -> sockets */
  const rooms = new Map();
  /** @type {Map<string, Set<WebSocket>>} userId -> sockets (a user may have several tabs) */
  const userSockets = new Map();
  /** @type {Set<string>} */
  const lowBandwidthUsers = new Set();
  let nextConnectionId = 1;
  let accepting = true;

  /** @param {import('node:http').IncomingMessage} req @param {import('node:stream').Duplex} socket @param {Buffer} head */
  function onUpgrade(req, socket, head) {
    let pathname = '';
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    } catch {
      /* malformed request target: rejected below */
    }
    const reject = (/** @type {number} */ status, /** @type {string} */ reason) => {
      socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      socket.destroy();
    };
    if (!WS_PATHS.has(pathname)) return reject(404, 'Not Found');
    if (!accepting) return reject(503, 'Service Unavailable');
    if (!isOriginAllowed(req.headers.origin, req.headers.host)) {
      log.warn({ origin: req.headers.origin }, 'websocket upgrade rejected: origin not allowed');
      return reject(403, 'Forbidden');
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  }
  server.on('upgrade', onUpgrade);

  // ---- sending with backpressure ---------------------------------------

  /**
   * @param {WebSocket} ws
   * @param {string} data  pre-encoded frame
   * @param {{ droppable?: boolean }} [opts]  droppable frames (typing, presence)
   *   are skipped for slow clients; anything else disconnects them.
   */
  function send(ws, data, { droppable = false } = {}) {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > config.wsMaxBufferedBytes) {
      if (droppable) return;
      log.warn({ conn: connections.get(ws)?.id }, 'terminating slow consumer (send buffer full)');
      ws.terminate();
      return;
    }
    ws.send(data, (err) => {
      if (err) log.debug({ err }, 'websocket send failed');
    });
  }

  /**
   * @param {string} channelId
   * @param {string} data
   * @param {{ except?: WebSocket, droppable?: boolean }} [opts]
   */
  function broadcastToRoom(channelId, data, { except, droppable } = {}) {
    for (const client of rooms.get(channelId) ?? []) {
      if (client !== except) send(client, data, { droppable });
    }
  }

  /** @param {string} data @param {{ droppable?: boolean }} [opts] */
  function broadcastToAuthenticated(data, opts) {
    for (const [client, state] of connections) {
      if (state.user) send(client, data, opts);
    }
  }

  /**
   * @param {WebSocket} ws
   * @param {string} code
   * @param {string} message
   * @param {string} [ref]
   */
  const sendError = (ws, code, message, ref) =>
    send(ws, encodeEvent('error', { code, message, ...(ref ? { ref } : {}) }), { droppable: true });

  /** @param {import('../db/repositories.js').User} user @param {'online'|'offline'} status */
  function announcePresence(user, status) {
    const lastSeen = service.setPresence(user.id, status);
    broadcastToAuthenticated(
      encodeEvent('presence_update', { userId: user.id, username: user.username, status, lastSeen }),
      { droppable: true },
    );
  }

  // ---- connection lifecycle --------------------------------------------

  wss.on('connection', (ws, req) => {
    /** @type {ConnectionState} */
    const state = {
      id: String(nextConnectionId++),
      user: null,
      channels: new Set(),
      bucket: new TokenBucket({ capacity: config.wsRateLimitBurst, refillPerSec: config.wsRateLimitPerSec }),
      violations: new TokenBucket({ capacity: 10, refillPerSec: 1 }),
      isAlive: true,
      pingSentAt: 0,
      authTimer: null,
    };
    connections.set(ws, state);
    const connLog = log.child({ conn: state.id });
    connLog.debug({ ip: req.socket.remoteAddress }, 'connection opened');

    state.authTimer = setTimeout(() => {
      if (!state.user) ws.close(CloseCodes.AUTH_TIMEOUT, 'authentication timeout');
    }, config.wsAuthTimeoutMs);

    ws.on('pong', () => {
      state.isAlive = true;
      if (state.user && state.pingSentAt > 0) {
        const rtt = Date.now() - state.pingSentAt;
        if (rtt > LOW_BANDWIDTH_RTT_MS) lowBandwidthUsers.add(state.user.id);
        else lowBandwidthUsers.delete(state.user.id);
      }
    });

    ws.on('message', (data, isBinary) => {
      if (!state.bucket.tryRemove()) {
        if (!state.violations.tryRemove()) {
          connLog.warn({ userId: state.user?.id }, 'closing connection: rate limit repeatedly exceeded');
          ws.close(CloseCodes.POLICY_VIOLATION, 'rate limit exceeded');
          return;
        }
        sendError(ws, ErrorCodes.RATE_LIMITED, 'too many messages, slow down');
        return;
      }
      if (isBinary) {
        sendError(ws, ErrorCodes.BAD_REQUEST, 'binary frames are not supported');
        return;
      }
      const parsed = parseClientFrame(data.toString('utf8'), { messageMaxLength: config.messageMaxLength });
      if (!parsed.ok) {
        sendError(ws, parsed.code, parsed.error, parsed.ref);
        return;
      }
      try {
        handleCommand(ws, state, parsed.command);
      } catch (error) {
        const ref = 'id' in parsed.command ? parsed.command.id : undefined;
        if (error instanceof AppError) {
          sendError(ws, error.code, error.message, ref);
          if (error.code === ErrorCodes.UNAUTHORIZED) ws.close(CloseCodes.UNAUTHORIZED, 'unauthorized');
        } else {
          connLog.error({ err: error, type: parsed.command.type }, 'failed to handle websocket frame');
          sendError(ws, ErrorCodes.INTERNAL, 'internal error', ref);
        }
      }
    });

    ws.on('error', (err) => connLog.debug({ err }, 'websocket error'));

    ws.on('close', (code) => {
      if (state.authTimer) clearTimeout(state.authTimer);
      connections.delete(ws);
      for (const channelId of state.channels) leaveRoom(ws, channelId);
      connLog.debug({ code, userId: state.user?.id }, 'connection closed');
      const user = state.user;
      if (!user) return;
      const sockets = userSockets.get(user.id);
      sockets?.delete(ws);
      if (sockets && sockets.size === 0) {
        userSockets.delete(user.id);
        lowBandwidthUsers.delete(user.id);
        try {
          announcePresence(user, 'offline');
        } catch (err) {
          connLog.error({ err }, 'failed to record offline presence');
        }
      }
    });
  });

  /** @param {WebSocket} ws @param {string} channelId */
  function leaveRoom(ws, channelId) {
    const room = rooms.get(channelId);
    room?.delete(ws);
    if (room && room.size === 0) rooms.delete(channelId);
  }

  /**
   * @param {WebSocket} ws
   * @param {ConnectionState} state
   * @param {import('../domain/protocol.js').Command} command
   */
  function handleCommand(ws, state, command) {
    if (command.type === 'auth') {
      if (state.user) throw new AppError(ErrorCodes.BAD_REQUEST, 'already authenticated');
      const user = service.authenticate(command.token);
      state.user = user;
      if (state.authTimer) clearTimeout(state.authTimer);
      state.authTimer = null;

      let sockets = userSockets.get(user.id);
      const firstConnection = !sockets;
      if (!sockets) userSockets.set(user.id, (sockets = new Set()));
      sockets.add(ws);
      // Sliding session: every successful connection hands out a fresh token.
      send(
        ws,
        encodeEvent('auth_ack', { user: { id: user.id, username: user.username }, token: service.issueToken(user.id) }),
      );
      if (firstConnection) announcePresence(user, 'online');
      return;
    }

    const user = state.user;
    if (!user) throw new AppError(ErrorCodes.UNAUTHORIZED, 'authenticate first');

    switch (command.type) {
      case 'join': {
        service.authorizeChannel(user.id, command.channelId);
        if (!state.channels.has(command.channelId) && state.channels.size >= config.wsMaxChannelsPerConnection) {
          throw new AppError(ErrorCodes.BAD_REQUEST, 'too many channels joined on this connection');
        }
        state.channels.add(command.channelId);
        let room = rooms.get(command.channelId);
        if (!room) rooms.set(command.channelId, (room = new Set()));
        room.add(ws);
        send(ws, encodeEvent('joined', { channelId: command.channelId }));
        return;
      }
      case 'leave':
        state.channels.delete(command.channelId);
        leaveRoom(ws, command.channelId);
        send(ws, encodeEvent('left', { channelId: command.channelId }));
        return;

      case 'message': {
        const { message, duplicate } = service.postMessage(user.id, command);
        send(
          ws,
          encodeEvent('message_ack', {
            id: message.id,
            channelId: message.channel_id,
            status: message.status,
            timestamp: message.timestamp,
            duplicate,
          }),
        );
        if (!duplicate) {
          broadcastToRoom(
            message.channel_id,
            encodeEvent('new_message', {
              id: message.id,
              channelId: message.channel_id,
              userId: user.id,
              username: user.username,
              content: message.content,
              timestamp: message.timestamp,
              status: message.status,
            }),
            { except: ws },
          );
        }
        return;
      }

      case 'typing':
        service.authorizeChannel(user.id, command.channelId);
        broadcastToRoom(
          command.channelId,
          encodeEvent('typing_indicator', { userId: user.id, username: user.username, channelId: command.channelId }),
          { except: ws, droppable: true },
        );
        return;

      case 'message_read':
        if (service.markRead(user.id, command)) {
          broadcastToRoom(
            command.channelId,
            encodeEvent('message_update', {
              id: command.id,
              channelId: command.channelId,
              status: 'read',
              readBy: user.id,
            }),
          );
        }
        return;
    }
  }

  // ---- heartbeat ----------------------------------------------------------

  const heartbeat = setInterval(() => {
    for (const [ws, state] of connections) {
      if (!state.isAlive) {
        log.debug({ conn: state.id }, 'terminating unresponsive client');
        ws.terminate();
        continue;
      }
      state.isAlive = false;
      state.pingSentAt = Date.now();
      ws.ping();
    }
  }, config.wsHeartbeatMs);
  heartbeat.unref();

  return {
    /** @param {string} userId */
    isLowBandwidth: (userId) => lowBandwidthUsers.has(userId),

    /** @param {import('../db/repositories.js').Channel} channel */
    announceChannel(channel) {
      broadcastToAuthenticated(encodeEvent('channel_created', { channel }));
    },

    stats: () => ({ connections: connections.size, users: userSockets.size, rooms: rooms.size }),

    /**
     * Stops accepting connections and closes existing ones with 1001 so
     * clients reconnect (to another instance or after the restart).
     * @param {number} timeoutMs
     */
    async close(timeoutMs) {
      accepting = false;
      clearInterval(heartbeat);
      server.off('upgrade', onUpgrade);
      const pending = [...connections.keys()].map(
        (ws) =>
          new Promise((resolve) => {
            ws.once('close', resolve);
            ws.close(CloseCodes.GOING_AWAY, 'server shutting down');
          }),
      );
      const timeout = new Promise((resolve) => setTimeout(resolve, timeoutMs).unref());
      await Promise.race([Promise.all(pending), timeout]);
      for (const ws of connections.keys()) ws.terminate();
      await new Promise((resolve) => wss.close(() => resolve(undefined)));
    },
  };
}

/** @typedef {ReturnType<typeof createGateway>} Gateway */

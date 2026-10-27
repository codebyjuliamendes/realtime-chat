/**
 * @fileoverview Chat business rules, independent of HTTP and WebSocket.
 */

import crypto from 'node:crypto';
import { AppError } from './errors.js';
import { ErrorCodes } from './protocol.js';
import { createSessionToken, verifySessionToken } from './session-token.js';
import { slugifyChannelName, validateChannelName, validateUsername } from './validation.js';

export const HISTORY_DEFAULT_LIMIT = 50;
export const HISTORY_MAX_LIMIT = 200;

/**
 * @param {{
 *   repos: import('../db/repositories.js').Repositories,
 *   config: Pick<import('../config.js').Config, 'sessionSecret'|'sessionTtlSeconds'>,
 *   now?: () => number,
 * }} deps
 */
export function createChatService({ repos, config, now = Date.now }) {
  let lastTimestamp = 0;
  /** Strictly increasing server timestamps keep history ordering and cursors unambiguous. */
  const nextTimestamp = () => {
    lastTimestamp = Math.max(now(), lastTimestamp + 1);
    return lastTimestamp;
  };

  /** @param {string} userId */
  const issueToken = (userId) => createSessionToken(config.sessionSecret, userId, config.sessionTtlSeconds, now());

  /** @param {string} channelId */
  function requireChannel(channelId) {
    const channel = repos.channels.findById(channelId);
    if (!channel) throw new AppError(ErrorCodes.NOT_FOUND, 'channel not found');
    return channel;
  }

  return {
    /**
     * Registers a new identity. The id is generated server-side; the returned
     * token is the only proof of that identity.
     * @param {unknown} rawUsername
     */
    createSession(rawUsername) {
      const username = validateUsername(rawUsername);
      if (!username.ok) throw new AppError(ErrorCodes.BAD_REQUEST, username.error);
      const user = repos.users.create({ id: crypto.randomUUID(), username: username.value, now: now() });
      return { user, token: issueToken(user.id) };
    },

    /**
     * @param {unknown} token
     * @returns {import('../db/repositories.js').User}
     */
    authenticate(token) {
      const session = verifySessionToken(config.sessionSecret, token, now());
      const user = session && repos.users.findById(session.userId);
      if (!user) throw new AppError(ErrorCodes.UNAUTHORIZED, 'invalid or expired session');
      return user;
    },

    issueToken,

    listUsers: () => repos.users.list(),
    listChannels: () => repos.channels.list(),

    /**
     * Group channels are public: any authenticated user may read and post.
     * This is the single place to extend when private channels are added.
     * @param {string} _userId
     * @param {string} channelId
     */
    authorizeChannel(_userId, channelId) {
      return requireChannel(channelId);
    },

    /**
     * @param {string} userId
     * @param {unknown} rawName
     */
    createChannel(userId, rawName) {
      const name = validateChannelName(rawName);
      if (!name.ok) throw new AppError(ErrorCodes.BAD_REQUEST, name.error);
      const id = slugifyChannelName(name.value);
      if (!id) throw new AppError(ErrorCodes.BAD_REQUEST, 'name must contain letters or digits');
      const channel = repos.channels.create({ id, name: name.value, createdBy: userId, now: now() });
      if (!channel) throw new AppError(ErrorCodes.CONFLICT, 'a channel with this name already exists');
      return channel;
    },

    /**
     * @param {string} userId
     * @param {string} channelId
     * @param {{ limit?: number, before?: number, after?: number }} [range]
     */
    getHistory(userId, channelId, { limit = HISTORY_DEFAULT_LIMIT, before, after } = {}) {
      this.authorizeChannel(userId, channelId);
      const safeLimit = Math.min(Math.max(1, limit), HISTORY_MAX_LIMIT);
      return repos.messages.listByChannel({ channelId, limit: safeLimit, before, after });
    },

    /**
     * Stores a message. Retrying with the same id is idempotent for the same
     * author; reusing someone else's id is rejected.
     * @param {string} userId
     * @param {{ id: string, channelId: string, content: string }} input
     * @returns {{ message: import('../db/repositories.js').Message, duplicate: boolean }}
     */
    postMessage(userId, { id, channelId, content }) {
      this.authorizeChannel(userId, channelId);
      const existing = repos.messages.findById(id);
      if (existing) {
        if (existing.user_id !== userId || existing.channel_id !== channelId) {
          throw new AppError(ErrorCodes.CONFLICT, 'message id already in use');
        }
        return { message: existing, duplicate: true };
      }
      const message = {
        id,
        channel_id: channelId,
        user_id: userId,
        content,
        status: 'sent',
        timestamp: nextTimestamp(),
      };
      repos.messages.insert(message);
      return { message, duplicate: false };
    },

    /**
     * Marks a message as read by someone other than its author.
     * @param {string} userId
     * @param {{ id: string, channelId: string }} input
     * @returns {boolean} true when the status changed (and should be broadcast)
     */
    markRead(userId, { id, channelId }) {
      this.authorizeChannel(userId, channelId);
      const message = repos.messages.findById(id);
      if (!message || message.channel_id !== channelId) {
        throw new AppError(ErrorCodes.NOT_FOUND, 'message not found');
      }
      if (message.user_id === userId) return false;
      return repos.messages.markRead(id);
    },

    /** @param {string} userId @param {'online'|'offline'} status */
    setPresence(userId, status) {
      const at = now();
      repos.users.setStatus(userId, status, at);
      return at;
    },
  };
}

/** @typedef {ReturnType<typeof createChatService>} ChatService */

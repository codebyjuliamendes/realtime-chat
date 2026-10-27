/**
 * @fileoverview WebSocket protocol: parsing and validation of client frames.
 *
 * Client -> server frames are JSON objects `{ type, payload }`:
 *   auth          { token }
 *   join          { channelId }
 *   leave         { channelId }
 *   message       { id (UUID), channelId, content }
 *   typing        { channelId }
 *   message_read  { id, channelId }
 */

import { isChannelId, isMessageId, validateMessageContent } from './validation.js';

export const ErrorCodes = Object.freeze({
  BAD_REQUEST: 'bad_request',
  UNAUTHORIZED: 'unauthorized',
  FORBIDDEN: 'forbidden',
  NOT_FOUND: 'not_found',
  CONFLICT: 'conflict',
  RATE_LIMITED: 'rate_limited',
  INTERNAL: 'internal_error',
});

/** Application close codes (4000-4999 are reserved for applications). */
export const CloseCodes = Object.freeze({
  UNAUTHORIZED: 4001,
  AUTH_TIMEOUT: 4008,
  POLICY_VIOLATION: 1008,
  GOING_AWAY: 1001,
  TRY_AGAIN_LATER: 1013,
});

/**
 * @typedef {{ type: 'auth', token: string }
 *   | { type: 'join', channelId: string }
 *   | { type: 'leave', channelId: string }
 *   | { type: 'message', id: string, channelId: string, content: string }
 *   | { type: 'typing', channelId: string }
 *   | { type: 'message_read', id: string, channelId: string }} Command
 */

/**
 * @param {string} message
 * @param {string} [ref]
 * @returns {{ ok: false, code: string, error: string, ref?: string }}
 */
const fail = (message, ref) => ({ ok: false, code: ErrorCodes.BAD_REQUEST, error: message, ref });

/**
 * Parses one raw frame.
 * @param {string} raw
 * @param {{ messageMaxLength: number }} limits
 * @returns {{ ok: true, command: Command } | { ok: false, code: string, error: string, ref?: string }}
 */
export function parseClientFrame(raw, { messageMaxLength }) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail('frame is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return fail('frame must be a JSON object');
  }
  const { type, payload } = parsed;
  if (typeof type !== 'string') return fail('frame.type must be a string');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return fail('frame.payload must be an object');
  }

  switch (type) {
    case 'auth':
      if (typeof payload.token !== 'string' || !payload.token) return fail('auth requires a token');
      return { ok: true, command: { type, token: payload.token } };

    case 'join':
    case 'leave':
    case 'typing':
      if (!isChannelId(payload.channelId)) return fail(`${type} requires a valid channelId`);
      return { ok: true, command: { type, channelId: payload.channelId } };

    case 'message': {
      const ref = typeof payload.id === 'string' ? payload.id.slice(0, 64) : undefined;
      if (!isMessageId(payload.id)) return fail('message.id must be a UUID', ref);
      if (!isChannelId(payload.channelId)) return fail('message requires a valid channelId', ref);
      const content = validateMessageContent(payload.content, messageMaxLength);
      if (!content.ok) return fail(content.error, ref);
      return {
        ok: true,
        command: { type, id: payload.id.toLowerCase(), channelId: payload.channelId, content: content.value },
      };
    }

    case 'message_read':
      if (!isMessageId(payload.id)) return fail('message_read.id must be a UUID');
      if (!isChannelId(payload.channelId)) return fail('message_read requires a valid channelId');
      return {
        ok: true,
        command: { type, id: payload.id.toLowerCase(), channelId: payload.channelId },
      };

    default:
      return fail(`unknown frame type "${type.slice(0, 32)}"`);
  }
}

/**
 * Serializes a server -> client event.
 * @param {string} type
 * @param {unknown} payload
 */
export const encodeEvent = (type, payload) => JSON.stringify({ type, payload });

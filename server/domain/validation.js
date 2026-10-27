/**
 * @fileoverview Pure validation rules for user-provided data.
 * Every function returns either `{ ok: true, value }` with a normalized value
 * or `{ ok: false, error }` with a human readable reason.
 */

/** @template T @typedef {{ ok: true, value: T } | { ok: false, error: string }} Result */

// C0/C1 control characters except tab/newline, plus bidi overrides that can
// be used to spoof how text is displayed.
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F‪-‮⁦-⁩]/;
// eslint-disable-next-line no-control-regex
const NAME_FORBIDDEN_CHARS = /[\u0000-\u001F\u007F-\u009F‪-‮⁦-⁩]/;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHANNEL_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

export const USERNAME_MAX_LENGTH = 32;
export const CHANNEL_NAME_MAX_LENGTH = 40;

/**
 * Counts user-perceived length in code points (so emoji count as one).
 * @param {string} s
 */
const codePointLength = (s) => [...s].length;

/**
 * @param {unknown} input
 * @returns {Result<string>}
 */
export function validateUsername(input) {
  if (typeof input !== 'string') return { ok: false, error: 'username must be a string' };
  const value = input.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (!value) return { ok: false, error: 'username is required' };
  if (codePointLength(value) > USERNAME_MAX_LENGTH) {
    return { ok: false, error: `username must have at most ${USERNAME_MAX_LENGTH} characters` };
  }
  if (NAME_FORBIDDEN_CHARS.test(value)) {
    return { ok: false, error: 'username contains forbidden characters' };
  }
  return { ok: true, value };
}

/**
 * @param {unknown} input
 * @param {number} maxLength
 * @returns {Result<string>}
 */
export function validateMessageContent(input, maxLength) {
  if (typeof input !== 'string') return { ok: false, error: 'content must be a string' };
  const value = input.normalize('NFC').trim();
  if (!value) return { ok: false, error: 'content must not be empty' };
  if (codePointLength(value) > maxLength) {
    return { ok: false, error: `content must have at most ${maxLength} characters` };
  }
  if (FORBIDDEN_CHARS.test(value)) {
    return { ok: false, error: 'content contains forbidden characters' };
  }
  return { ok: true, value };
}

/**
 * @param {unknown} input
 * @returns {Result<string>}
 */
export function validateChannelName(input) {
  if (typeof input !== 'string') return { ok: false, error: 'name must be a string' };
  const value = input.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (!value) return { ok: false, error: 'name is required' };
  if (codePointLength(value) > CHANNEL_NAME_MAX_LENGTH) {
    return { ok: false, error: `name must have at most ${CHANNEL_NAME_MAX_LENGTH} characters` };
  }
  if (NAME_FORBIDDEN_CHARS.test(value)) {
    return { ok: false, error: 'name contains forbidden characters' };
  }
  return { ok: true, value };
}

/**
 * Builds a URL-safe channel id ("slug") from a display name.
 * Returns null when nothing usable is left (e.g. a name made only of emoji).
 * @param {string} name
 */
export function slugifyChannelName(name) {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug || null;
}

/** @param {unknown} id */
export const isChannelId = (id) => typeof id === 'string' && CHANNEL_ID_RE.test(id);

/** @param {unknown} id */
export const isMessageId = (id) => typeof id === 'string' && UUID_RE.test(id);

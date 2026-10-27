/**
 * REST client. Errors carry the server's `{ error: { code, message } }`.
 */

export class ApiError extends Error {
  /** @param {number} status @param {string} code @param {string} message */
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * @param {string} path
 * @param {{ token?: string|null, method?: string, body?: unknown, signal?: AbortSignal }} [opts]
 */
export async function apiRequest(path, { token, method = 'GET', body, signal } = {}) {
  /** @type {Record<string, string>} */
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal });
  } catch {
    throw new ApiError(0, 'network_error', 'Network error. Check your connection.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(
      res.status,
      data?.error?.code ?? 'error',
      data?.error?.message ?? `Request failed (${res.status})`,
    );
  }
  return data;
}

const SESSION_KEY = 'chat_session';

/** @returns {{ token: string, user: { id: string, username: string } } | null} */
export function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    const session = raw ? JSON.parse(raw) : null;
    if (typeof session?.token === 'string' && typeof session?.user?.id === 'string') return session;
  } catch {
    /* storage unavailable or corrupted */
  }
  return null;
}

/** @param {{ token: string, user: { id: string, username: string } }} session */
export function saveSession(session) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    // Identities used to be chosen by the browser; those keys are obsolete.
    localStorage.removeItem('chat_userId');
  } catch {
    /* ignore */
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/** Username saved by the previous version of the app, used to prefill the login form. */
export function legacyUsername() {
  try {
    return localStorage.getItem('chat_username') ?? '';
  } catch {
    return '';
  }
}

/**
 * @fileoverview Data access for users, channels and messages.
 * All SQL lives here; callers receive plain objects.
 */

import { LRUCache } from '../domain/lru-cache.js';

/** @typedef {import('sql.js').Database} SqlDatabase */
/** @typedef {import('sql.js').BindParams} BindParams */

/**
 * @typedef {{ id: string, username: string, status: string, last_seen: number|null }} User
 * @typedef {{ id: string, name: string, type: string, created_by: string|null, created_at: number|null }} Channel
 * @typedef {{ id: string, channel_id: string, user_id: string, content: string, status: string, timestamp: number }} Message
 */

/**
 * @param {SqlDatabase} db
 * @param {string} sql
 * @param {BindParams} [params]
 * @returns {any[]}
 */
function queryAll(db, sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally {
    stmt.free();
  }
}

/**
 * @param {SqlDatabase} db
 * @param {string} sql
 * @param {BindParams} [params]
 */
const queryOne = (db, sql, params = []) => queryAll(db, sql, params)[0] ?? null;

/**
 * @param {import('./database.js').DatabaseHandle} handle
 */
export function createRepositories(handle) {
  const { db } = handle;

  /**
   * @param {string} sql
   * @param {BindParams} params
   */
  const write = (sql, params) => {
    db.run(sql, params);
    const changes = db.getRowsModified();
    if (changes > 0) handle.markDirty();
    return changes;
  };

  /** Channels are read on every incoming message; cache the lookups. */
  const channelCache = new LRUCache(500);

  const users = {
    /**
     * @param {{ id: string, username: string, now: number }} input
     * @returns {User}
     */
    create({ id, username, now }) {
      write('INSERT INTO users (id, username, status, last_seen, created_at) VALUES (?, ?, ?, ?, ?)', [
        id,
        username,
        'offline',
        now,
        now,
      ]);
      return { id, username, status: 'offline', last_seen: now };
    },
    /** @param {string} id @returns {User|null} */
    findById(id) {
      return queryOne(db, 'SELECT id, username, status, last_seen FROM users WHERE id = ?', [id]);
    },
    /** @returns {User[]} */
    list() {
      return queryAll(db, 'SELECT id, username, status, last_seen FROM users ORDER BY username');
    },
    /** @param {string} id @param {'online'|'offline'} status @param {number} now */
    setStatus(id, status, now) {
      write('UPDATE users SET status = ?, last_seen = ? WHERE id = ?', [status, now, id]);
    },
    /** Marks everybody offline (used at boot: no socket survives a restart). */
    resetPresence() {
      write("UPDATE users SET status = 'offline' WHERE status <> 'offline'", []);
    },
  };

  const channels = {
    /** @returns {Channel[]} */
    list() {
      return queryAll(
        db,
        "SELECT id, name, type, created_by, created_at FROM channels ORDER BY CASE id WHEN 'general' THEN 0 ELSE 1 END, name",
      );
    },
    /** @param {string} id @returns {Channel|null} */
    findById(id) {
      const cached = channelCache.get(id);
      if (cached) return cached;
      const row = queryOne(db, 'SELECT id, name, type, created_by, created_at FROM channels WHERE id = ?', [id]);
      if (row) channelCache.set(id, row);
      return row;
    },
    /**
     * @param {{ id: string, name: string, createdBy: string, now: number }} input
     * @returns {Channel|null} null when the id is already taken
     */
    create({ id, name, createdBy, now }) {
      const changes = write(
        "INSERT OR IGNORE INTO channels (id, name, type, created_by, created_at) VALUES (?, ?, 'group', ?, ?)",
        [id, name, createdBy, now],
      );
      if (changes === 0) return null;
      return { id, name, type: 'group', created_by: createdBy, created_at: now };
    },
  };

  const messages = {
    /** @param {Message} m */
    insert(m) {
      write('INSERT INTO messages (id, channel_id, user_id, content, status, timestamp) VALUES (?, ?, ?, ?, ?, ?)', [
        m.id,
        m.channel_id,
        m.user_id,
        m.content,
        m.status,
        m.timestamp,
      ]);
    },
    /** @param {string} id @returns {Message|null} */
    findById(id) {
      return queryOne(db, 'SELECT id, channel_id, user_id, content, status, timestamp FROM messages WHERE id = ?', [
        id,
      ]);
    },
    /**
     * Returns messages in chronological order.
     * - default / `before`: the newest `limit` messages (older than `before`)
     * - `after`: the oldest `limit` messages newer than `after` (catch-up after reconnect)
     * @param {{ channelId: string, limit: number, before?: number, after?: number }} q
     * @returns {Message[]}
     */
    listByChannel({ channelId, limit, before, after }) {
      const cols = 'id, channel_id, user_id, content, status, timestamp';
      if (after !== undefined) {
        return queryAll(
          db,
          `SELECT ${cols} FROM messages WHERE channel_id = ? AND timestamp > ? ORDER BY timestamp ASC, rowid ASC LIMIT ?`,
          [channelId, after, limit],
        );
      }
      const rows = queryAll(
        db,
        `SELECT ${cols} FROM messages WHERE channel_id = ? AND timestamp < ? ORDER BY timestamp DESC, rowid DESC LIMIT ?`,
        [channelId, before ?? Number.MAX_SAFE_INTEGER, limit],
      );
      return rows.reverse();
    },
    /** @param {string} id @returns {boolean} whether the status changed */
    markRead(id) {
      return write("UPDATE messages SET status = 'read' WHERE id = ? AND status <> 'read'", [id]) > 0;
    },
  };

  return { users, channels, messages };
}

/** @typedef {ReturnType<typeof createRepositories>} Repositories */

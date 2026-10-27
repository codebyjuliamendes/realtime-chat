/**
 * @fileoverview SQLite (sql.js / WebAssembly) database lifecycle:
 * open, versioned migrations and debounced, atomic persistence to disk.
 *
 * sql.js keeps the whole database in memory. Instead of rewriting the file
 * synchronously on every write (which blocked the event loop on each chat
 * message), writes mark the database as dirty and a timer flushes it at most
 * once per `persistIntervalMs`, writing to a temp file and renaming it so a
 * crash never leaves a half-written file behind.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import initSqlJs from 'sql.js';

/** @typedef {import('sql.js').Database} SqlDatabase */

/**
 * Ordered list of migrations. `user_version` stores how many were applied.
 * Never edit an existing entry; append a new one instead.
 * @type {Array<(db: SqlDatabase) => void>}
 */
const MIGRATIONS = [
  // 1 - baseline (same shape as the original schema, so legacy files upgrade cleanly)
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        status TEXT DEFAULT 'offline',
        last_seen INTEGER
      );
      CREATE TABLE IF NOT EXISTS channels (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT DEFAULT 'group'
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT DEFAULT 'sent',
        timestamp INTEGER NOT NULL,
        FOREIGN KEY(channel_id) REFERENCES channels(id),
        FOREIGN KEY(user_id) REFERENCES users(id)
      );
    `);
  },
  // 2 - display names are no longer unique (two people may both be "Ana");
  //     identity is the server-issued id. Channels gain authorship metadata.
  (db) => {
    db.exec(`
      CREATE TABLE users_v2 (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'offline',
        last_seen INTEGER,
        created_at INTEGER
      );
      INSERT INTO users_v2 (id, username, status, last_seen, created_at)
        SELECT id, username, 'offline', last_seen, last_seen FROM users;
      DROP TABLE users;
      ALTER TABLE users_v2 RENAME TO users;

      ALTER TABLE channels ADD COLUMN created_by TEXT;
      ALTER TABLE channels ADD COLUMN created_at INTEGER;

      DROP INDEX IF EXISTS idx_messages_channel;
      DROP INDEX IF EXISTS idx_messages_timestamp;
      CREATE INDEX IF NOT EXISTS idx_messages_channel_ts ON messages(channel_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id);

      INSERT OR IGNORE INTO channels (id, name, type, created_at) VALUES ('general', 'General', 'group', 0);
    `);
  },
];

/** @param {SqlDatabase} db */
function migrate(db) {
  const current = Number(db.exec('PRAGMA user_version')[0]?.values[0][0] ?? 0);
  for (let version = current; version < MIGRATIONS.length; version++) {
    db.exec('BEGIN');
    try {
      MIGRATIONS[version](db);
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(`Database migration ${version + 1} failed: ${/** @type {Error} */ (error).message}`, {
        cause: error,
      });
    }
  }
  return { from: current, to: MIGRATIONS.length };
}

/**
 * @param {{ dbPath: string|null, persistIntervalMs: number, logger: import('pino').Logger }} options
 */
export async function openDatabase({ dbPath, persistIntervalMs, logger }) {
  const SQL = await initSqlJs();
  /** @type {SqlDatabase} */
  let db;
  if (dbPath && fs.existsSync(dbPath)) {
    db = new SQL.Database(fs.readFileSync(dbPath));
  } else {
    db = new SQL.Database();
  }
  // Table rebuilds in migrations require foreign keys off (SQLite docs, "ALTER TABLE").
  db.exec('PRAGMA foreign_keys = OFF');
  const { from, to } = migrate(db);
  db.exec('PRAGMA foreign_keys = ON');
  if (from !== to) logger.info({ from, to }, 'database migrated');

  let dirty = from !== to || Boolean(dbPath && !fs.existsSync(dbPath));
  let flushing = Promise.resolve();
  let closed = false;

  const exportBytes = () => {
    const bytes = db.export();
    // export() re-opens the underlying connection, resetting pragmas.
    db.exec('PRAGMA foreign_keys = ON');
    return bytes;
  };

  async function flush() {
    if (!dirty || !dbPath) return;
    dirty = false;
    const bytes = exportBytes();
    const tmp = `${dbPath}.${process.pid}.tmp`;
    try {
      await fsp.mkdir(path.dirname(dbPath), { recursive: true });
      await fsp.writeFile(tmp, bytes);
      await fsp.rename(tmp, dbPath);
    } catch (error) {
      dirty = true;
      logger.error({ err: error }, 'failed to persist database');
    }
  }

  const timer = setInterval(() => {
    flushing = flushing.then(flush);
  }, persistIntervalMs);
  timer.unref();

  return {
    db,
    markDirty() {
      dirty = true;
    },
    /** Persists pending changes now (awaits any in-flight write first). */
    async flush() {
      flushing = flushing.then(flush);
      await flushing;
    },
    async close() {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      await this.flush();
      db.close();
    },
  };
}

/** @typedef {Awaited<ReturnType<typeof openDatabase>>} DatabaseHandle */

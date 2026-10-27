import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import pino from 'pino';
import initSqlJs from 'sql.js';
import { openDatabase } from '../../server/db/database.js';
import { createRepositories } from '../../server/db/repositories.js';

const logger = pino({ level: 'silent' });
const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'chat-db-')), 'chat.db');

describe('database', () => {
  it('persists changes to disk and reloads them', async () => {
    const dbPath = tmpFile();
    const first = await openDatabase({ dbPath, persistIntervalMs: 50, logger });
    createRepositories(first).users.create({ id: 'u1', username: 'Ana', now: 1 });
    await first.close();
    assert.ok(fs.existsSync(dbPath));

    const second = await openDatabase({ dbPath, persistIntervalMs: 50, logger });
    assert.equal(createRepositories(second).users.findById('u1')?.username, 'Ana');
    await second.close();
  });

  it('migrates a database created by the original schema (unique usernames)', async () => {
    const dbPath = tmpFile();
    const SQL = await initSqlJs();
    const legacy = new SQL.Database();
    legacy.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, status TEXT DEFAULT 'offline', last_seen INTEGER);
      CREATE TABLE channels (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT DEFAULT 'group');
      CREATE TABLE messages (id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, user_id TEXT NOT NULL, content TEXT NOT NULL,
        status TEXT DEFAULT 'sent', timestamp INTEGER NOT NULL);
      CREATE INDEX idx_messages_channel ON messages(channel_id);
      INSERT INTO users VALUES ('u1', 'Ana', 'online', 10);
      INSERT INTO channels VALUES ('general', 'General', 'group');
      INSERT INTO messages VALUES ('m1', 'general', 'u1', 'old message', 'sent', 10);
    `);
    fs.writeFileSync(dbPath, legacy.export());

    const handle = await openDatabase({ dbPath, persistIntervalMs: 50, logger });
    const repos = createRepositories(handle);
    assert.equal(repos.messages.findById('m1')?.content, 'old message');
    assert.equal(repos.users.findById('u1')?.status, 'offline');
    // usernames are no longer unique
    repos.users.create({ id: 'u2', username: 'Ana', now: 20 });
    assert.equal(repos.users.list().length, 2);
    assert.equal(Number(handle.db.exec('PRAGMA user_version')[0].values[0][0]), 2);
    await handle.close();
  });
});

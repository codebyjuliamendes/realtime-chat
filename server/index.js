import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeWebSocket } from './socket.js';
import { db, initDB } from './db.js';
import { queryAll } from './db-helper.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const server = createServer(app);

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.json());

// API Routes for initial data load
app.get('/api/channels', (req, res) => {
  const channels = queryAll(db, 'SELECT * FROM channels');
  res.json(channels);
});

app.get('/api/messages/:channelId', (req, res) => {
  const { channelId } = req.params;
  const messages = queryAll(db, 'SELECT * FROM messages WHERE channel_id = ? ORDER BY timestamp ASC LIMIT 100', [channelId]);
  res.json(messages);
});

app.get('/api/users', (req, res) => {
  const users = queryAll(db, 'SELECT * FROM users');
  res.json(users);
});

const PORT = process.env.PORT || 3000;

(async () => {
  await initDB();
  initializeWebSocket(server);
  server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
})();

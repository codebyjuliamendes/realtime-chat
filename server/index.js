/**
 * @fileoverview Express Server for Real-Time Chat.
 * Implements clean architecture, routing structures, global error handlers,
 * and robust JSDoc definitions.
 */

import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import { Worker, isMainThread, parentPort } from 'worker_threads';
import { initializeWebSocket, bandwidthCache } from './socket.js';
import { db, initDB } from './db.js';
import { queryAll } from './db-helper.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const server = createServer(app);

try {
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors());
  app.use(compression());
} catch (error) {
  console.error("Middleware error:", error);
}

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.json());

/**
 * @typedef {Object} Channel
 * @property {string} id - Unique channel identifier
 * @property {string} name - User-friendly name
 * @property {string} type - Channel type (e.g. group, direct)
 */

/**
 * @typedef {Object} Message
 * @property {string} id - UUID message identifier
 * @property {string} channel_id - ID of target channel
 * @property {string} user_id - Author user ID
 * @property {string} content - Message text content
 * @property {string} status - Message status (sending, sent, read)
 * @property {number} timestamp - Unix epoch ms
 */

/**
 * Controller class for Chat Resource Endpoints
 */
class ChatController {
  /**
   * Fetch all channels
   * @param {express.Request} req 
   * @param {express.Response} res 
   * @param {express.NextFunction} next
   */
  static getChannels(req, res, next) {
    try {
      const channels = queryAll(db, 'SELECT * FROM channels');
      res.json(channels);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Fetch messages for a specific channel
   * @param {express.Request} req 
   * @param {express.Response} res 
   * @param {express.NextFunction} next
   */
  static getMessages(req, res, next) {
    try {
      const { channelId } = req.params;
      if (!channelId) {
        return res.status(400).json({ error: 'Missing channelId parameter' });
      }
      const messages = queryAll(
        db,
        'SELECT * FROM messages WHERE channel_id = ? ORDER BY timestamp ASC LIMIT 100',
        [channelId]
      );
      res.json(messages);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Fetch registered users
   * @param {express.Request} req 
   * @param {express.Response} res 
   * @param {express.NextFunction} next
   */
  static getUsers(req, res, next) {
    try {
      const users = queryAll(db, 'SELECT * FROM users');
      res.json(users);
    } catch (error) {
      next(error);
    }
  }
}

// REST API Endpoints
app.get('/api/channels', ChatController.getChannels);
app.get('/api/messages/:channelId', ChatController.getMessages);
app.get('/api/users', ChatController.getUsers);

/**
 * Global API Error Handling Middleware
 */
app.use((err, req, res, next) => {
  console.error('[Global Error Middleware]', err.stack || err);
  res.status(500).json({
    status: 'error',
    message: err.message || 'Internal Server Error'
  });
});

app.use((req, res, next) => {
  // Apply X-Low-Bandwidth header if user is flagged
  const userId = req.headers['x-user-id'] || req.query.userId;
  if (userId && bandwidthCache.get(userId)) {
    res.setHeader('X-Low-Bandwidth', 'true');
    // Simulated media skip logic can happen here
  }
  next();
});

const PORT = process.env.PORT || 3003;

if (isMainThread) {
  // worker_threads multithreading cluster simulator
  console.log('[Cluster] Main thread is running');
  for (let i = 0; i < 2; i++) {
    const worker = new Worker(fileURLToPath(import.meta.url));
    worker.on('message', (msg) => console.log(`[Worker] ${msg}`));
  }

  (async () => {
    try {
      await initDB();
      initializeWebSocket(server);
      server.listen(PORT, () => {
        console.log(`[Server] Real-time chat listening on port ${PORT}`);
      });
    } catch (err) {
      console.error('Fatal Server Boot Error:', err);
      process.exit(1);
    }
  })();
} else {
  // Worker Thread simulator logic
  parentPort.postMessage(`Worker thread started with ID: ${process.pid}`);
  setInterval(() => {
    // Simulating background clustering tasks
  }, 60000);
}

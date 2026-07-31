/**
 * @fileoverview WebSocket Manager for Real-time event communication.
 * Handles client presence, message flow, read receipts, and typing indicators.
 */

import { WebSocketServer } from 'ws';
import { LRUCache } from './cache.js';
import { db, saveDB } from './db.js';
import { runSql, queryOne } from './db-helper.js';

export const bandwidthCache = new Map();

/**
 * Bootstraps the WebSocket Server on the HTTP Server instance.
 * @param {import('http').Server} server - Express server instance
 */
export function initializeWebSocket(server) {
  const wss = new WebSocketServer({ server });
  
  const userSessionCache = new LRUCache(1000);
  const channelCache = new LRUCache(100);

  // Core setup and dynamic initialization
  try {
    const insertChannelSql = 'INSERT OR IGNORE INTO channels (id, name, type) VALUES (?, ?, ?)';
    runSql(db, insertChannelSql, ['general', 'General', 'group']);
    saveDB();
  } catch (error) {
    console.error('Failed to initialize default channel in DB:', error);
  }

  const insertUserSql = 'INSERT OR IGNORE INTO users (id, username, status, last_seen) VALUES (?, ?, ?, ?)';
  const updateUserStatusSql = 'UPDATE users SET status = ?, last_seen = ? WHERE id = ?';
  const insertMessageSql = 'INSERT INTO messages (id, channel_id, user_id, content, status, timestamp) VALUES (?, ?, ?, ?, ?, ?)';
  const updateMessageStatusSql = 'UPDATE messages SET status = ? WHERE id = ?';

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.pingTime = 0;
    let currentUser = null;

    ws.on('pong', () => {
      ws.isAlive = true;
      if (ws.pingTime > 0) {
        const rtt = Date.now() - ws.pingTime;
        if (currentUser) {
          if (rtt > 500) {
            bandwidthCache.set(currentUser, true);
          } else {
            bandwidthCache.delete(currentUser);
          }
        }
      }
    });

    ws.on('message', (data) => {
      let parsed;
      try {
        parsed = JSON.parse(data);
      } catch (err) {
        console.error('WS received invalid JSON:', err);
        return;
      }

      const { type, payload } = parsed;
      if (!type || !payload) {
        return;
      }

      try {
        switch (type) {
          case 'auth': {
            const { userId, username } = payload;
            if (!userId || !username) {
              throw new Error('Auth failed: Missing userId or username');
            }
            
            currentUser = userId;
            runSql(db, insertUserSql, [userId, username, 'online', Date.now()]);
            runSql(db, updateUserStatusSql, ['online', Date.now(), userId]);
            saveDB();
            
            userSessionCache.set(userId, ws);
            broadcastPresence(userId, 'online');
            
            ws.send(JSON.stringify({
              type: 'auth_ack',
              payload: { userId, username }
            }));
            break;
          }

          case 'message': {
            if (!currentUser) return;
            const { id, channelId, content } = payload;
            if (!id || !channelId || typeof content !== 'string') {
              throw new Error('Message sending failed: Invalid payload structure');
            }

            // Idempotent message ACK check
            const existingMessage = queryOne(db, 'SELECT id FROM messages WHERE id = ?', [id]);
            if (existingMessage) {
              // Message already processed, just send ACK back
              ws.send(JSON.stringify({
                type: 'message_ack',
                payload: { id, status: 'sent', idempotent: true }
              }));
              break;
            }
            
            const timestamp = Date.now();
            runSql(db, insertMessageSql, [id, channelId, currentUser, content, 'sent', timestamp]);
            saveDB();
            
            // Ack to sender
            ws.send(JSON.stringify({
              type: 'message_ack',
              payload: { id, status: 'sent' }
            }));

            // Broadcast to everyone else
            broadcastToChannel(channelId, {
              type: 'new_message',
              payload: { id, channelId, userId: currentUser, content, timestamp, status: 'sent' }
            }, ws);
            break;
          }

          case 'typing': {
            if (!currentUser) return;
            const { channelId } = payload;
            if (!channelId) return;
            
            broadcastToChannel(channelId, {
              type: 'typing_indicator',
              payload: { userId: currentUser, channelId }
            }, ws);
            break;
          }

          case 'message_read': {
            if (!currentUser) return;
            const { id, channelId } = payload;
            if (!id || !channelId) return;
            
            runSql(db, updateMessageStatusSql, ['read', id]);
            saveDB();
            
            broadcastToChannel(channelId, {
              type: 'message_update',
              payload: { id, status: 'read' }
            });
            break;
          }

          default:
            console.warn(`Unknown message type received over WS: ${type}`);
        }
      } catch (err) {
        console.error(`Error processing action ${type}:`, err.message);
        ws.send(JSON.stringify({
          type: 'error',
          payload: { message: err.message }
        }));
      }
    });

    ws.on('close', () => {
      try {
        if (currentUser) {
          runSql(db, updateUserStatusSql, ['offline', Date.now(), currentUser]);
          saveDB();
          userSessionCache.delete(currentUser);
          broadcastPresence(currentUser, 'offline');
        }
      } catch (err) {
        console.error('Error handling client WS disconnect:', err);
      }
    });
  });

  // Heartbeat loop every 30 seconds
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        console.log('Terminating unresponsive WS client...');
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.pingTime = Date.now();
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => {
    clearInterval(interval);
  });

  /**
   * Broadcast status updates (online/offline) to all active connections
   * @param {string} userId 
   * @param {'online'|'offline'} status 
   */
  function broadcastPresence(userId, status) {
    const msg = JSON.stringify({
      type: 'presence_update',
      payload: { userId, status, lastSeen: Date.now() }
    });
    wss.clients.forEach((client) => {
      if (client.readyState === client.OPEN) {
        client.send(msg);
      }
    });
  }

  /**
   * Broadcast payload to all connection clients except specified sender
   * @param {string} channelId 
   * @param {Object} messageObj 
   * @param {WebSocket} [excludeWs]
   */
  function broadcastToChannel(channelId, messageObj, excludeWs = null) {
    const msg = JSON.stringify(messageObj);
    wss.clients.forEach((client) => {
      if (client !== excludeWs && client.readyState === client.OPEN) {
        // Broadly broadcasts for general channel in this demo
        client.send(msg);
      }
    });
  }
}

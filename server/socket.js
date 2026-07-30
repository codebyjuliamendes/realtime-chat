import { WebSocketServer } from 'ws';
import { LRUCache } from './cache.js';
import { db, saveDB } from './db.js';
import { runSql } from './db-helper.js';

export function initializeWebSocket(server) {
  const wss = new WebSocketServer({ server });
  
  const userSessionCache = new LRUCache(1000);
  const channelCache = new LRUCache(100);

  // Default channel if none exists
  const insertChannelSql = 'INSERT OR IGNORE INTO channels (id, name, type) VALUES (?, ?, ?)';
  runSql(db, insertChannelSql, ['general', 'General', 'group']);
  saveDB();

  const insertUserSql = 'INSERT OR IGNORE INTO users (id, username, status, last_seen) VALUES (?, ?, ?, ?)';
  const updateUserStatusSql = 'UPDATE users SET status = ?, last_seen = ? WHERE id = ?';
  const insertMessageSql = 'INSERT INTO messages (id, channel_id, user_id, content, status, timestamp) VALUES (?, ?, ?, ?, ?, ?)';
  const updateMessageStatusSql = 'UPDATE messages SET status = ? WHERE id = ?';

  wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    let currentUser = null;

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (data) => {
      let parsed;
      try {
        parsed = JSON.parse(data);
      } catch (err) {
        return;
      }

      const { type, payload } = parsed;

      switch (type) {
        case 'auth': {
          const { userId, username } = payload;
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
          broadcastToChannel(payload.channelId, {
            type: 'typing_indicator',
            payload: { userId: currentUser, channelId: payload.channelId }
          }, ws);
          break;
        }

        case 'message_read': {
          if (!currentUser) return;
          const { id, channelId } = payload;
          runSql(db, updateMessageStatusSql, ['read', id]);
          saveDB();
          broadcastToChannel(channelId, {
            type: 'message_update',
            payload: { id, status: 'read' }
          });
          break;
        }
      }
    });

    ws.on('close', () => {
      if (currentUser) {
        runSql(db, updateUserStatusSql, ['offline', Date.now(), currentUser]);
        saveDB();
        userSessionCache.delete(currentUser);
        broadcastPresence(currentUser, 'offline');
      }
    });
  });

  // Heartbeat interval
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => {
    clearInterval(interval);
  });

  function broadcastPresence(userId, status) {
    const msg = JSON.stringify({
      type: 'presence_update',
      payload: { userId, status, lastSeen: Date.now() }
    });
    wss.clients.forEach(client => {
      if (client.readyState === client.OPEN) {
        client.send(msg);
      }
    });
  }

  function broadcastToChannel(channelId, messageObj, excludeWs = null) {
    const msg = JSON.stringify(messageObj);
    wss.clients.forEach(client => {
      if (client !== excludeWs && client.readyState === client.OPEN) {
        // Simple global broadcast for now, in a real scale app you'd check channel subscriptions
        client.send(msg);
      }
    });
  }
}

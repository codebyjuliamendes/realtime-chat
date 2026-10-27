/**
 * @fileoverview Composition root: wires config, database, domain, HTTP and
 * WebSocket layers. Exported as a factory so tests can boot isolated servers.
 */

import http from 'node:http';
import { openDatabase } from './db/database.js';
import { createRepositories } from './db/repositories.js';
import { createChatService } from './domain/chat-service.js';
import { createApp } from './http/app.js';
import { createGateway } from './ws/gateway.js';

/**
 * @param {{ config: import('./config.js').Config, logger: import('pino').Logger }} deps
 */
export async function createChatServer({ config, logger }) {
  const database = await openDatabase({
    dbPath: config.dbPath,
    persistIntervalMs: config.persistIntervalMs,
    logger,
  });
  const repos = createRepositories(database);
  repos.users.resetPresence();
  const service = createChatService({ repos, config });

  let ready = false;
  /** HTTP -> WebSocket hooks; bound once the gateway exists (it needs the HTTP server). */
  const hooks = {
    /** @param {import('./db/repositories.js').Channel} _channel */
    onChannelCreated: (_channel) => {},
    /** @param {string} _userId */
    isLowBandwidth: (_userId) => false,
  };

  const { app, isOriginAllowed } = createApp({ config, service, logger, health: { isReady: () => ready }, hooks });

  const server = http.createServer(app);
  // Keep-alive must outlive typical load balancer idle timeouts.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  const ws = createGateway({ server, service, config, logger, isOriginAllowed });
  hooks.onChannelCreated = (channel) => ws.announceChannel(channel);
  hooks.isLowBandwidth = (userId) => ws.isLowBandwidth(userId);

  let closing = /** @type {Promise<void>|null} */ (null);

  return {
    server,
    service,
    gateway: ws,
    /** @param {number} [port] @param {string} [host] @returns {Promise<import('node:net').AddressInfo>} */
    listen(port = config.port, host = config.host) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          ready = true;
          resolve(/** @type {import('node:net').AddressInfo} */ (server.address()));
        });
      });
    },
    /** Graceful shutdown: stop readiness, close sockets, drain HTTP, flush DB. */
    close() {
      closing ??= (async () => {
        ready = false;
        const httpClosed = new Promise((resolve) => server.close(() => resolve(undefined)));
        await ws.close(config.shutdownTimeoutMs);
        server.closeIdleConnections();
        const timeout = new Promise((resolve) => setTimeout(resolve, config.shutdownTimeoutMs).unref());
        await Promise.race([httpClosed, timeout]);
        server.closeAllConnections();
        await database.close();
      })();
      return closing;
    },
  };
}

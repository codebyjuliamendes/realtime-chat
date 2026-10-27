/**
 * @fileoverview Process entry point: boot, signal handling and graceful shutdown.
 */

import { ConfigError, loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createChatServer } from './server.js';

let config;
try {
  config = loadConfig();
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}

const logger = createLogger(config);

try {
  const chat = await createChatServer({ config, logger });
  const address = await chat.listen();
  logger.info({ port: address.port, host: address.address, env: config.nodeEnv }, 'realtime chat listening');

  /** @param {string} signal */
  const shutdown = async (signal) => {
    logger.info({ signal }, 'shutting down');
    try {
      await chat.close();
      logger.info('shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
} catch (err) {
  logger.fatal({ err }, 'failed to start server');
  process.exit(1);
}

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'unhandled promise rejection');
});

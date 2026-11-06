import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { app } from './app.js';
import { closeDatabase } from './db/client.js';
import { closeRedis } from './db/redis.js';

const server = app.listen(env.API_PORT, env.API_HOST, () => {
  logger.info({ host: env.API_HOST, port: env.API_PORT }, 'ShipPulse API listening');
});

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down ShipPulse API');

  server.close(async (error) => {
    await Promise.allSettled([closeDatabase(), closeRedis()]);
    process.exit(error ? 1 : 0);
  });

  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

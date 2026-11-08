import { createServer } from 'node:http';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { app } from './app.js';
import { closeDatabase } from './db/client.js';
import { closeRedis } from './db/redis.js';
import { createRealtimeServer } from './realtime/socket-server.js';
import { startExceptionScanner } from './modules/exceptions/exception-service.js';
import { closeNotificationQueue } from './modules/notifications/notification-queue.js';
import { startNotificationRealtime } from './modules/notifications/notification-realtime.js';

const server = createServer(app);
const io = createRealtimeServer(server);
app.set('io', io);
const stopExceptionScanner = startExceptionScanner(io);
const stopNotificationRealtime = startNotificationRealtime(io);

server.listen(env.API_PORT, env.API_HOST, () => {
  logger.info({ host: env.API_HOST, port: env.API_PORT }, 'ShipPulse API listening');
});

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down ShipPulse API');
  stopExceptionScanner();

  io.close(async () => {
    await Promise.allSettled([closeDatabase(), closeRedis(), stopNotificationRealtime(), closeNotificationQueue()]);
    process.exit(0);
  });

  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

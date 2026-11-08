import Redis from 'ioredis';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { publishUserRealtime } from '../../realtime/socket-server.js';
import { notificationChannel } from './notification-constants.js';

export function startNotificationRealtime(io) {
  const subscriber = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, retryStrategy: (attempt) => Math.min(attempt * 500, 5000) });
  subscriber.on('error', (error) => logger.warn({ err: error }, 'Notification realtime subscriber connection error'));
  subscriber.on('message', (_channel, message) => {
    try {
      const payload = JSON.parse(message);
      if (payload.userId && payload.notification) publishUserRealtime(io, payload.userId, 'notification:created', payload.notification);
    } catch (error) {
      logger.warn({ err: error }, 'Ignoring invalid notification realtime message');
    }
  });
  subscriber.subscribe(notificationChannel).catch((error) => logger.error({ err: error }, 'Could not subscribe to notification events'));
  return async () => { if (subscriber.status === 'ready') await subscriber.quit(); else subscriber.disconnect(); };
}

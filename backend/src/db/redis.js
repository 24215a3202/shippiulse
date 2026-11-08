import Redis from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  retryStrategy: (attempt) => Math.min(attempt * 250, 2_000),
});
redis.on('error', (error) => logger.warn({ err: error }, 'Redis connection error'));

export async function checkRedis() {
  if (redis.status === 'wait') await redis.connect();
  const result = await redis.ping();
  if (result !== 'PONG') throw new Error('Unexpected Redis health response');
}

export async function closeRedis() {
  if (redis.status === 'ready') await redis.quit();
  else redis.disconnect();
}

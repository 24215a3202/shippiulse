import Redis from 'ioredis';
import { env } from '../config/env.js';

export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  retryStrategy: (attempt) => Math.min(attempt * 250, 2_000),
});

export async function checkRedis() {
  if (redis.status === 'wait') await redis.connect();
  const result = await redis.ping();
  if (result !== 'PONG') throw new Error('Unexpected Redis health response');
}

export async function closeRedis() {
  if (redis.status === 'ready') await redis.quit();
  else redis.disconnect();
}

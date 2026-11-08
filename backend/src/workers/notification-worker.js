import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { closeDatabase, pool } from '../db/client.js';
import { notificationChannel, notificationQueueName } from '../modules/notifications/notification-constants.js';

const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, retryStrategy: (attempt) => Math.min(attempt * 500, 20_000) });
const publisher = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1, retryStrategy: (attempt) => Math.min(attempt * 250, 2000) });

async function persistNotification(job) {
  const { organizationId, shipmentId, recipientIds, type, title, message, idempotencyKey, metadata } = job.data;
  const client = await pool.connect();
  const created = [];
  try {
    await client.query('BEGIN');
    for (const userId of [...new Set(recipientIds)]) {
      const result = await client.query(`INSERT INTO notifications
        (organization_id,user_id,shipment_id,type,title,message,idempotency_key,metadata)
        SELECT $1,$2,$3,$4,$5,$6,$7||'-'||$2::text,$8
        WHERE EXISTS (SELECT 1 FROM users WHERE id=$2 AND organization_id=$1 AND status='ACTIVE')
        ON CONFLICT (organization_id,user_id,idempotency_key) DO NOTHING
        RETURNING id,organization_id AS "organizationId",user_id AS "userId",shipment_id AS "shipmentId",
          type,title,message,metadata,read_at AS "readAt",created_at AS "createdAt"`,
      [organizationId, userId, shipmentId, type, title, message, idempotencyKey, metadata]);
      if (result.rowCount) created.push(result.rows[0]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }

  for (const notification of created) {
    await publisher.publish(notificationChannel, JSON.stringify({ userId: notification.userId, notification }));
  }
  return { persisted: created.length };
}

const worker = new Worker(notificationQueueName, persistNotification, { connection, concurrency: 8 });
worker.on('ready', () => logger.info('ShipPulse notification worker is ready'));
worker.on('completed', (job, result) => logger.debug({ jobId: job.id, ...result }, 'Notification job completed'));
worker.on('failed', (job, error) => logger.error({ jobId: job?.id, err: error }, 'Notification job failed'));
worker.on('error', (error) => logger.error({ err: error }, 'Notification worker error'));

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'Stopping notification worker');
  await worker.close();
  await Promise.allSettled([connection.quit(), publisher.quit(), closeDatabase()]);
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

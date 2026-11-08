import { createHash } from 'node:crypto';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { db } from '../../db/client.js';
import { users } from '../../db/schema.js';
import { and, eq, inArray } from 'drizzle-orm';
import { notificationQueueName } from './notification-constants.js';

let queue;

function getQueue() {
  if (!queue) {
    const connection = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false });
    queue = new Queue(notificationQueueName, {
      connection,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { count: 2000 },
        removeOnFail: { count: 5000 },
      },
    });
    queue.on('error', (error) => logger.warn({ err: error }, 'Notification queue connection error'));
  }
  return queue;
}

function safeMetadata(type, payload) {
  const metadata = { shipmentId: payload.shipmentId };
  if (payload.trackingNumber) metadata.trackingNumber = payload.trackingNumber;
  if (payload.status) metadata.status = payload.status;
  if (payload.name) metadata.locationOrStopName = payload.name;
  if (payload.transition) metadata.transition = payload.transition;
  if (payload.source) metadata.source = payload.source;
  if (type === 'EXCEPTION_CREATED') metadata.exceptionType = payload.type;
  return metadata;
}

async function addJob({ organizationId, shipmentId, recipientIds, type, title, message, payload }) {
  if (!recipientIds.length || !shipmentId) return;
  const sourceKey = createHash('sha256').update(JSON.stringify([organizationId, shipmentId, type, payload, Date.now()])).digest('hex');
  const data = {
    organizationId, shipmentId, recipientIds, type, title, message,
    idempotencyKey: sourceKey,
    metadata: safeMetadata(type, payload),
  };
  await getQueue().add('persist-in-app-notification', data, { jobId: sourceKey });
}

async function operatorRecipients(organizationId) {
  const rows = await db.select({ id: users.id }).from(users).where(and(
    eq(users.organizationId, organizationId), eq(users.status, 'ACTIVE'), inArray(users.role, ['ORG_ADMIN', 'DISPATCHER']),
  ));
  return rows.map(({ id }) => id);
}

export async function enqueueRealtimeNotification(organizationId, shipmentId, event, payload) {
  try {
    if (event === 'shipment:created') {
      await addJob({ organizationId, shipmentId, recipientIds: await operatorRecipients(organizationId), type: 'SHIPMENT_CREATED', title: 'Shipment created', message: `Shipment ${payload.trackingNumber} was created.`, payload });
    } else if (event === 'geofence:transition') {
      const entry = payload.transition === 'ENTRY';
      const action = entry ? 'entered' : 'exited';
      await addJob({ organizationId, shipmentId, recipientIds: await operatorRecipients(organizationId), type: entry ? 'GEOFENCE_ENTRY' : 'GEOFENCE_EXIT', title: `Shipment ${action} a geofence`, message: `${payload.trackingNumber ?? 'Shipment'} ${action} ${payload.name}${payload.source === 'SIMULATOR' ? ' (simulated GPS)' : ''}.`, payload });
    } else if (event === 'stop:updated') {
      const arrived = payload.status === 'ARRIVED';
      await addJob({ organizationId, shipmentId, recipientIds: await operatorRecipients(organizationId), type: arrived ? 'STOP_ARRIVED' : 'STOP_DEPARTED', title: arrived ? 'Shipment arrived at a stop' : 'Shipment departed a stop', message: `${payload.trackingNumber ?? 'Shipment'} ${arrived ? 'arrived at' : 'departed'} ${payload.name}${payload.source === 'SIMULATOR' ? ' (simulated GPS)' : ''}.`, payload });
    } else if (event === 'exception:created') {
      await addJob({ organizationId, shipmentId, recipientIds: await operatorRecipients(organizationId), type: 'EXCEPTION_CREATED', title: `Shipment exception: ${payload.type.replaceAll('_', ' ').toLowerCase()}`, message: payload.description, payload });
    } else if (event === 'exception:escalated') {
      await addJob({ organizationId, shipmentId, recipientIds: await operatorRecipients(organizationId), type: 'EXCEPTION_ESCALATED', title: 'Unresolved shipment exception escalated', message: payload.description, payload });
    }
  } catch (error) {
    logger.error({ err: error, event, shipmentId }, 'Could not enqueue in-app notification');
  }
}

export async function enqueueUserNotification(userId, organizationId, shipmentId, event, payload) {
  try {
    if (event !== 'shipment:assigned') return;
    await addJob({ organizationId, shipmentId, recipientIds: [userId], type: 'SHIPMENT_ASSIGNED', title: 'Shipment assigned to you', message: `Shipment ${payload.trackingNumber} has been assigned to you.`, payload });
  } catch (error) {
    logger.error({ err: error, event, shipmentId }, 'Could not enqueue in-app notification');
  }
}

export async function closeNotificationQueue() {
  if (!queue) return;
  await queue.close();
  queue = undefined;
}


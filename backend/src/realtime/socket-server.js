import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { db } from '../db/client.js';
import { shipments } from '../db/schema.js';
import { requireAuth } from '../modules/auth/auth-middleware.js';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { enqueueRealtimeNotification, enqueueUserNotification } from '../modules/notifications/notification-queue.js';

const trackedStatuses = ['ASSIGNED', 'PICKED_UP', 'IN_TRANSIT', 'DELAYED', 'OUT_FOR_DELIVERY'];

function roomForOrganization(organizationId) { return `organization:${organizationId}`; }
function roomForShipment(shipmentId) { return `shipment:${shipmentId}`; }
function roomForUser(userId) { return `user:${userId}`; }

function authenticateSocket(socket, next) {
  requireAuth(socket.request, null, (error) => {
    if (error) {
      const failure = new Error('Authentication required');
      failure.data = { code: 'UNAUTHORIZED' };
      return next(failure);
    }
    socket.data.auth = socket.request.auth;
    next();
  });
}

function acknowledge(callback, result) {
  if (typeof callback === 'function') callback(result);
}

function sendFailure(callback, message = 'You do not have permission for this subscription') {
  acknowledge(callback, { ok: false, error: message });
}

function isAllowedOrigin(origin) {
  if (!origin) return env.NODE_ENV !== 'production';
  if (origin === env.WEB_ORIGIN) return true;
  if (env.NODE_ENV === 'production') return false;
  return /^http:\/\/(localhost|127\.0\.0\.1):51[0-9][0-9]$/.test(origin);
}

export function createRealtimeServer(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: (origin, callback) => callback(null, isAllowedOrigin(origin)), credentials: true },
    allowRequest: (request, callback) => {
      const origin = request.headers.origin;
      callback(null, isAllowedOrigin(origin));
    },
  });

  io.use(authenticateSocket);
  io.on('connection', (socket) => {
    const auth = socket.data.auth;
    socket.join(roomForUser(auth.userId));
    socket.on('tracking:subscribe', async (payload = {}, callback) => {
      try {
        if (payload.scope === 'organization') {
          if (auth.role === 'DRIVER') return sendFailure(callback, 'Drivers can subscribe only to assigned shipments');
          await socket.join(roomForOrganization(auth.organizationId));
          return acknowledge(callback, { ok: true, scope: 'organization' });
        }
        if (payload.scope === 'assigned' && auth.role === 'DRIVER') {
          const assigned = await db.select({ id: shipments.id }).from(shipments).where(and(
            eq(shipments.organizationId, auth.organizationId), eq(shipments.driverId, auth.userId), inArray(shipments.status, trackedStatuses),
          )).limit(200);
          await Promise.all(assigned.map(({ id }) => socket.join(roomForShipment(id))));
          return acknowledge(callback, { ok: true, scope: 'assigned', count: assigned.length });
        }
        return sendFailure(callback);
      } catch {
        return sendFailure(callback, 'Could not subscribe to tracking updates');
      }
    });

    socket.on('shipment:subscribe', async (payload = {}, callback) => {
      if (!z.uuid().safeParse(payload.shipmentId).success) return sendFailure(callback, 'Invalid shipment');
      try {
        const conditions = [eq(shipments.id, payload.shipmentId), eq(shipments.organizationId, auth.organizationId)];
        if (auth.role === 'DRIVER') conditions.push(eq(shipments.driverId, auth.userId));
        const [shipment] = await db.select({ id: shipments.id }).from(shipments).where(and(...conditions)).limit(1);
        if (!shipment) return sendFailure(callback, 'Shipment not found');
        await socket.join(roomForShipment(shipment.id));
        return acknowledge(callback, { ok: true, shipmentId: shipment.id });
      } catch {
        return sendFailure(callback, 'Could not subscribe to shipment updates');
      }
    });

    socket.on('shipment:unsubscribe', async (payload = {}, callback) => {
      if (!z.uuid().safeParse(payload.shipmentId).success) return sendFailure(callback, 'Invalid shipment');
      await socket.leave(roomForShipment(payload.shipmentId));
      acknowledge(callback, { ok: true });
    });

    const authTimer = setInterval(() => {
      requireAuth(socket.request, null, (error) => {
        if (error || socket.request.auth.role !== socket.data.auth.role || socket.request.auth.organizationId !== socket.data.auth.organizationId) {
          socket.disconnect(true);
        }
      });
    }, 60_000);
    authTimer.unref?.();
    socket.on('disconnect', () => clearInterval(authTimer));
  });

  return io;
}

export function publishRealtime(io, organizationId, shipmentId, event, payload) {
  void enqueueRealtimeNotification(organizationId, shipmentId, event, payload);
  if (!io) return;
  io.to(roomForOrganization(organizationId)).to(roomForShipment(shipmentId)).emit(event, payload);
}

export function publishUserRealtime(io, userId, event, payload, organizationId = payload.organizationId) {
  if (organizationId && payload.shipmentId) void enqueueUserNotification(userId, organizationId, payload.shipmentId, event, payload);
  if (!io || !userId) return;
  io.to(roomForUser(userId)).emit(event, payload);
}

export async function revokeShipmentSubscription(io, userId, shipmentId) {
  if (!io || !userId || !shipmentId) return;
  const sockets = await io.in(roomForUser(userId)).fetchSockets();
  await Promise.all(sockets.map((socket) => socket.leave(roomForShipment(shipmentId))));
  publishUserRealtime(io, userId, 'shipment:unassigned', { shipmentId });
}

export async function disconnectUserSockets(io, userId) {
  if (!io || !userId) return;
  const sockets = await io.in(roomForUser(userId)).fetchSockets();
  for (const socket of sockets) socket.disconnect(true);
}

import { randomBytes } from 'node:crypto';
import { and, asc, count, desc, eq, ilike, inArray, ne, or } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { driverProfiles, shipmentEvents, shipmentStops, shipments, users, vehicles } from '../../db/schema.js';
import { HttpError } from '../auth/auth-errors.js';
import { requireAuth, requireCsrf, requireRole } from '../auth/auth-middleware.js';
import { publishRealtime, publishUserRealtime, revokeShipmentSubscription } from '../../realtime/socket-server.js';

const router = Router();
const statuses = ['CREATED', 'ASSIGNED', 'PICKED_UP', 'IN_TRANSIT', 'DELAYED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED', 'CANCELLED'];
const activeAssignmentStatuses = ['ASSIGNED', 'PICKED_UP', 'IN_TRANSIT', 'DELAYED', 'OUT_FOR_DELIVERY'];
const transitions = {
  CREATED: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['PICKED_UP', 'CANCELLED'],
  PICKED_UP: ['IN_TRANSIT', 'FAILED'],
  IN_TRANSIT: ['DELAYED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED'],
  DELAYED: ['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'FAILED'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'FAILED'],
  DELIVERED: [], FAILED: [], CANCELLED: [],
};

const stopSchema = z.object({ name: z.string().trim().min(2).max(120), address: z.string().trim().min(5).max(500) });
const shipmentFields = {
  referenceNumber: z.string().trim().max(80).optional().nullable(),
  description: z.string().trim().min(3).max(240),
  recipientName: z.string().trim().min(2).max(120),
  recipientPhone: z.string().trim().max(32).optional().nullable(),
  pickupAddress: z.string().trim().min(5).max(500),
  deliveryAddress: z.string().trim().min(5).max(500),
  estimatedDeliveryAt: z.iso.datetime({ offset: true }).optional().nullable(),
  stops: z.array(stopSchema).max(20).optional(),
};
const createSchema = z.object(shipmentFields);
const updateSchema = z.object(shipmentFields).partial().refine((value) => Object.keys(value).length > 0);
const assignmentSchema = z.object({ driverId: z.uuid().nullable(), vehicleId: z.uuid().nullable() })
  .refine((value) => Boolean(value.driverId) === Boolean(value.vehicleId), 'Choose both a driver and vehicle, or clear both');
const statusSchema = z.object({ status: z.enum(statuses), reason: z.string().trim().max(300).optional() });
const listSchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(statuses).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

function validationError(response, error) {
  return response.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Check the submitted fields and try again', fields: error.flatten?.().fieldErrors ?? {} } });
}

function databaseCode(error) {
  let current = error;
  while (current) { if (current.code) return current.code; current = current.cause; }
  return undefined;
}

function tenantShipmentWhere(request, shipmentId) {
  if (!z.uuid().safeParse(shipmentId).success) throw new HttpError(404, 'SHIPMENT_NOT_FOUND', 'Shipment not found');
  return and(eq(shipments.id, shipmentId), eq(shipments.organizationId, request.auth.organizationId));
}

function createTrackingNumber() {
  return `SP-${randomBytes(6).toString('hex').toUpperCase()}`;
}

function canReadAll(role) { return role !== 'DRIVER'; }

router.use(requireAuth);

router.get('/', async (request, response) => {
  const parsed = listSchema.safeParse(request.query);
  if (!parsed.success) return validationError(response, parsed.error);
  const { q, status, page, limit } = parsed.data;
  const conditions = [eq(shipments.organizationId, request.auth.organizationId)];
  if (!canReadAll(request.auth.role)) conditions.push(eq(shipments.driverId, request.auth.userId));
  if (status) conditions.push(eq(shipments.status, status));
  if (q) {
    const safeTerm = q.replace(/[\\%_]/g, '\\$&');
    const term = `%${safeTerm}%`;
    conditions.push(or(
      ilike(shipments.trackingNumber, term),
      ilike(shipments.referenceNumber, term),
      ilike(shipments.recipientName, term),
      ilike(shipments.description, term),
    ));
  }
  const where = and(...conditions);
  const [{ total }] = await db.select({ total: count() }).from(shipments).where(where);
  const rows = await db.select({ shipment: shipments, driver: users, vehicle: vehicles }).from(shipments)
    .leftJoin(users, and(eq(users.id, shipments.driverId), eq(users.organizationId, request.auth.organizationId)))
    .leftJoin(vehicles, and(eq(vehicles.id, shipments.vehicleId), eq(vehicles.organizationId, request.auth.organizationId)))
    .where(where)
    .orderBy(desc(shipments.createdAt))
    .limit(limit)
    .offset((page - 1) * limit);
  response.json({
    shipments: rows.map(({ shipment, driver, vehicle }) => ({ ...shipment,
      driver: driver ? { id: driver.id, name: driver.name } : null,
      vehicle: vehicle ? { id: vehicle.id, registrationNumber: vehicle.registrationNumber } : null,
    })),
    pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) },
  });
});

router.post('/', requireRole('ORG_ADMIN', 'DISPATCHER', 'SUPER_ADMIN'), requireCsrf, async (request, response) => {
  const parsed = createSchema.safeParse(request.body);
  if (!parsed.success) return validationError(response, parsed.error);
  const { stops = [], estimatedDeliveryAt, ...input } = parsed.data;
  try {
    const shipment = await db.transaction(async (transaction) => {
      const [created] = await transaction.insert(shipments).values({
        organizationId: request.auth.organizationId,
        trackingNumber: createTrackingNumber(),
        ...input,
        estimatedDeliveryAt: estimatedDeliveryAt ? new Date(estimatedDeliveryAt) : null,
        createdBy: request.auth.userId,
      }).returning();
      if (stops.length) await transaction.insert(shipmentStops).values(stops.map((stop, index) => ({
        organizationId: request.auth.organizationId, shipmentId: created.id, sequence: index + 1, ...stop,
      })));
      await transaction.insert(shipmentEvents).values({
        organizationId: request.auth.organizationId, shipmentId: created.id, actorId: request.auth.userId,
        type: 'SHIPMENT_CREATED', toStatus: 'CREATED', description: 'Shipment created',
      });
      return created;
    });
    publishRealtime(request.app.get('io'), request.auth.organizationId, shipment.id, 'shipment:created', {
      shipmentId: shipment.id, trackingNumber: shipment.trackingNumber, status: shipment.status,
    });
    response.status(201).json({ shipment });
  } catch (error) {
    if (databaseCode(error) === '23505') throw new HttpError(409, 'SHIPMENT_REFERENCE_IN_USE', 'That reference number is already used in this organization');
    throw error;
  }
});

router.get('/:shipmentId', async (request, response) => {
  if (!z.uuid().safeParse(request.params.shipmentId).success) throw new HttpError(404, 'SHIPMENT_NOT_FOUND', 'Shipment not found');
  const conditions = [eq(shipments.id, request.params.shipmentId), eq(shipments.organizationId, request.auth.organizationId)];
  if (request.auth.role === 'DRIVER') conditions.push(eq(shipments.driverId, request.auth.userId));
  const [row] = await db.select({ shipment: shipments, driver: users, vehicle: vehicles }).from(shipments)
    .leftJoin(users, and(eq(users.id, shipments.driverId), eq(users.organizationId, request.auth.organizationId)))
    .leftJoin(vehicles, and(eq(vehicles.id, shipments.vehicleId), eq(vehicles.organizationId, request.auth.organizationId)))
    .where(and(...conditions)).limit(1);
  if (!row) throw new HttpError(404, 'SHIPMENT_NOT_FOUND', 'Shipment not found');
  const [stops, events] = await Promise.all([
    db.select().from(shipmentStops).where(and(eq(shipmentStops.shipmentId, row.shipment.id), eq(shipmentStops.organizationId, request.auth.organizationId))).orderBy(asc(shipmentStops.sequence)),
    db.select({ event: shipmentEvents, actor: users }).from(shipmentEvents)
      .leftJoin(users, and(eq(users.id, shipmentEvents.actorId), eq(users.organizationId, request.auth.organizationId)))
      .where(and(eq(shipmentEvents.shipmentId, row.shipment.id), eq(shipmentEvents.organizationId, request.auth.organizationId)))
      .orderBy(desc(shipmentEvents.createdAt)),
  ]);
  response.json({ shipment: {
    ...row.shipment,
    driver: row.driver ? { id: row.driver.id, name: row.driver.name, email: row.driver.email } : null,
    vehicle: row.vehicle ? { id: row.vehicle.id, registrationNumber: row.vehicle.registrationNumber, make: row.vehicle.make, model: row.vehicle.model } : null,
    stops,
    events: events.map(({ event, actor }) => ({ ...event, actorName: actor?.name ?? 'System' })),
    allowedTransitions: transitions[row.shipment.status],
  } });
});

router.patch('/:shipmentId', requireRole('ORG_ADMIN', 'DISPATCHER', 'SUPER_ADMIN'), requireCsrf, async (request, response) => {
  const parsed = updateSchema.safeParse(request.body);
  if (!parsed.success) return validationError(response, parsed.error);
  const { stops, estimatedDeliveryAt, ...input } = parsed.data;
  try {
    const shipment = await db.transaction(async (transaction) => {
      const [current] = await transaction.select().from(shipments).where(tenantShipmentWhere(request, request.params.shipmentId)).for('update').limit(1);
      if (!current) throw new HttpError(404, 'SHIPMENT_NOT_FOUND', 'Shipment not found');
      if (!['CREATED', 'ASSIGNED'].includes(current.status)) throw new HttpError(409, 'SHIPMENT_ALREADY_MOVING', 'Shipment details can no longer be edited after pickup');
      const [updated] = await transaction.update(shipments).set({
        ...input,
        ...(estimatedDeliveryAt !== undefined ? { estimatedDeliveryAt: estimatedDeliveryAt ? new Date(estimatedDeliveryAt) : null } : {}),
        updatedAt: new Date(),
      }).where(tenantShipmentWhere(request, current.id)).returning();
      if (stops !== undefined) {
        await transaction.delete(shipmentStops).where(and(eq(shipmentStops.shipmentId, current.id), eq(shipmentStops.organizationId, request.auth.organizationId)));
        if (stops.length) await transaction.insert(shipmentStops).values(stops.map((stop, index) => ({
          organizationId: request.auth.organizationId, shipmentId: current.id, sequence: index + 1, ...stop,
        })));
      }
      await transaction.insert(shipmentEvents).values({
        organizationId: request.auth.organizationId, shipmentId: current.id, actorId: request.auth.userId,
        type: 'SHIPMENT_UPDATED', description: 'Shipment details updated',
      });
      return updated;
    });
    publishRealtime(request.app.get('io'), request.auth.organizationId, shipment.id, 'shipment:updated', {
      shipmentId: shipment.id, trackingNumber: shipment.trackingNumber, status: shipment.status, updatedAt: shipment.updatedAt,
    });
    response.json({ shipment });
  } catch (error) {
    if (databaseCode(error) === '23505') throw new HttpError(409, 'SHIPMENT_REFERENCE_IN_USE', 'That reference number is already used in this organization');
    throw error;
  }
});

router.patch('/:shipmentId/assignment', requireRole('ORG_ADMIN', 'DISPATCHER', 'SUPER_ADMIN'), requireCsrf, async (request, response) => {
  const parsed = assignmentSchema.safeParse(request.body);
  if (!parsed.success) return validationError(response, parsed.error);
  const { driverId, vehicleId } = parsed.data;
  let updated;
  let previousDriverId;
  try {
    updated = await db.transaction(async (transaction) => {
      const [current] = await transaction.select().from(shipments).where(tenantShipmentWhere(request, request.params.shipmentId)).for('update').limit(1);
      if (!current) throw new HttpError(404, 'SHIPMENT_NOT_FOUND', 'Shipment not found');
      if (!['CREATED', 'ASSIGNED'].includes(current.status)) throw new HttpError(409, 'SHIPMENT_ALREADY_MOVING', 'Shipment assignment is locked after pickup');
      previousDriverId = current.driverId;
      if (driverId) {
        const [driver] = await transaction.select({ id: users.id }).from(users)
          .innerJoin(driverProfiles, and(eq(driverProfiles.userId, users.id), eq(driverProfiles.organizationId, request.auth.organizationId)))
          .where(and(eq(users.id, driverId), eq(users.organizationId, request.auth.organizationId), eq(users.role, 'DRIVER'), eq(users.status, 'ACTIVE')))
          .limit(1);
        if (!driver) throw new HttpError(400, 'INVALID_DRIVER', 'Choose an active driver from your organization');
        const [driverBusy] = await transaction.select({ id: shipments.id }).from(shipments).where(and(
          eq(shipments.organizationId, request.auth.organizationId), eq(shipments.driverId, driverId),
          inArray(shipments.status, activeAssignmentStatuses), ne(shipments.id, current.id),
        )).limit(1);
        if (driverBusy) throw new HttpError(409, 'DRIVER_BUSY', 'That driver already has an active shipment');
      }
      if (vehicleId) {
        const [vehicle] = await transaction.select().from(vehicles).where(and(
          eq(vehicles.id, vehicleId), eq(vehicles.organizationId, request.auth.organizationId), eq(vehicles.status, 'ACTIVE'),
        )).limit(1);
        if (!vehicle) throw new HttpError(400, 'INVALID_VEHICLE', 'Choose an active vehicle from your organization');
        if (vehicle.assignedDriverId && driverId && vehicle.assignedDriverId !== driverId) {
          throw new HttpError(409, 'VEHICLE_DRIVER_MISMATCH', 'Choose the driver currently assigned to this vehicle');
        }
        if (driverId) {
          const [driverVehicle] = await transaction.select({ id: vehicles.id }).from(vehicles).where(and(
            eq(vehicles.organizationId, request.auth.organizationId), eq(vehicles.assignedDriverId, driverId),
          )).limit(1);
          if (driverVehicle && driverVehicle.id !== vehicle.id) {
            throw new HttpError(409, 'VEHICLE_DRIVER_MISMATCH', 'Choose the vehicle assigned to this driver');
          }
        }
        const [vehicleBusy] = await transaction.select({ id: shipments.id }).from(shipments).where(and(
          eq(shipments.organizationId, request.auth.organizationId), eq(shipments.vehicleId, vehicleId),
          inArray(shipments.status, activeAssignmentStatuses), ne(shipments.id, current.id),
        )).limit(1);
        if (vehicleBusy) throw new HttpError(409, 'VEHICLE_BUSY', 'That vehicle already has an active shipment');
      }
      const nextStatus = driverId ? 'ASSIGNED' : 'CREATED';
      const [shipment] = await transaction.update(shipments).set({ driverId, vehicleId, status: nextStatus, updatedAt: new Date() })
        .where(tenantShipmentWhere(request, current.id)).returning();
      if (current.status !== nextStatus || current.driverId !== driverId || current.vehicleId !== vehicleId) {
        await transaction.insert(shipmentEvents).values({
          organizationId: request.auth.organizationId, shipmentId: current.id, actorId: request.auth.userId,
          type: driverId ? 'SHIPMENT_ASSIGNED' : 'ASSIGNMENT_CLEARED',
          fromStatus: current.status, toStatus: nextStatus,
          description: driverId ? 'Driver and vehicle assigned' : 'Shipment assignment cleared',
        });
      }
      return shipment;
    });
  } catch (error) {
    if (databaseCode(error) === '23505') throw new HttpError(409, 'RESOURCE_ALREADY_DISPATCHED', 'That driver or vehicle already has an active shipment');
    throw error;
  }
  publishRealtime(request.app.get('io'), request.auth.organizationId, updated.id, 'shipment:updated', {
    shipmentId: updated.id, trackingNumber: updated.trackingNumber, status: updated.status,
    driverId: updated.driverId, vehicleId: updated.vehicleId, updatedAt: updated.updatedAt,
  });
  if (previousDriverId && previousDriverId !== updated.driverId) {
    await revokeShipmentSubscription(request.app.get('io'), previousDriverId, updated.id);
  }
  if (updated.driverId) publishUserRealtime(request.app.get('io'), updated.driverId, 'shipment:assigned', {
    shipmentId: updated.id, trackingNumber: updated.trackingNumber,
  }, request.auth.organizationId);
  response.json({ shipment: updated });
});

router.post('/:shipmentId/status', requireRole('ORG_ADMIN', 'DISPATCHER', 'SUPER_ADMIN'), requireCsrf, async (request, response) => {
  const parsed = statusSchema.safeParse(request.body);
  if (!parsed.success) return validationError(response, parsed.error);
  const shipment = await db.transaction(async (transaction) => {
    const [current] = await transaction.select().from(shipments).where(tenantShipmentWhere(request, request.params.shipmentId)).for('update').limit(1);
    if (!current) throw new HttpError(404, 'SHIPMENT_NOT_FOUND', 'Shipment not found');
    if (!transitions[current.status].includes(parsed.data.status)) {
      throw new HttpError(409, 'INVALID_STATUS_TRANSITION', `A shipment cannot move from ${current.status} to ${parsed.data.status}`);
    }
    if (parsed.data.status === 'ASSIGNED' && (!current.driverId || !current.vehicleId)) {
      throw new HttpError(409, 'ASSIGNMENT_REQUIRED', 'Assign a driver and vehicle before setting the shipment to assigned');
    }
    const [updated] = await transaction.update(shipments).set({ status: parsed.data.status, updatedAt: new Date() })
      .where(tenantShipmentWhere(request, current.id)).returning();
    await transaction.insert(shipmentEvents).values({
      organizationId: request.auth.organizationId, shipmentId: current.id, actorId: request.auth.userId,
      type: parsed.data.status === 'CANCELLED' ? 'SHIPMENT_CANCELLED' : 'STATUS_CHANGED',
      fromStatus: current.status, toStatus: parsed.data.status,
      description: parsed.data.reason ? `${current.status} → ${parsed.data.status}: ${parsed.data.reason}` : `${current.status} → ${parsed.data.status}`,
    });
    return updated;
  });
  publishRealtime(request.app.get('io'), request.auth.organizationId, shipment.id, 'shipment:updated', {
    shipmentId: shipment.id, trackingNumber: shipment.trackingNumber, status: shipment.status, updatedAt: shipment.updatedAt,
  });
  response.json({ shipment });
});

export const shipmentsRouter = router;

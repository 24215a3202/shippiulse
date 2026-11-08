import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { db } from '../../db/client.js';
import { shipmentLocations, shipments, users, vehicles } from '../../db/schema.js';
import { HttpError } from '../auth/auth-errors.js';
import { requireAuth, requireCsrf, requireRole } from '../auth/auth-middleware.js';
import { publishRealtime } from '../../realtime/socket-server.js';
import { processSpatialLocation } from '../geospatial/geospatial-service.js';

const router = Router();
const activeStatuses = ['ASSIGNED', 'PICKED_UP', 'IN_TRANSIT', 'DELAYED', 'OUT_FOR_DELIVERY'];
const isoDateTime = z.iso.datetime({ offset: true });
const locationSchema = z.object({
  sourceEventId: z.uuid(),
  shipmentId: z.uuid(),
  vehicleId: z.uuid(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyMeters: z.number().min(0).max(100000).optional(),
  speedKph: z.number().min(0).max(500).optional(),
  headingDegrees: z.number().int().min(0).max(359).optional(),
  recordedAt: isoDateTime,
});
const simulatorSchema = z.object({
  start: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }),
  end: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }),
  points: z.number().int().min(2).max(20).default(6),
  durationMinutes: z.number().int().min(1).max(120).default(15),
});
const historySchema = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) });

function validationError(response, error) {
  return response.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Check the submitted fields and try again', fields: error.flatten().fieldErrors } });
}

function freshness(recordedAt) {
  if (!recordedAt) return 'NO_SIGNAL';
  const ageMs = Date.now() - new Date(recordedAt).getTime();
  if (ageMs <= 2 * 60_000) return 'LIVE';
  if (ageMs <= 5 * 60_000) return 'DELAYED';
  return 'STALE';
}

function presentLocation(location) {
  return location ? { ...location, freshness: freshness(location.recordedAt) } : null;
}

function ensureShipmentId(shipmentId) {
  if (!z.uuid().safeParse(shipmentId).success) throw new HttpError(404, 'SHIPMENT_NOT_FOUND', 'Shipment not found');
}

router.use(requireAuth);

router.get('/', async (request, response) => {
  const conditions = [eq(shipments.organizationId, request.auth.organizationId), inArray(shipments.status, activeStatuses)];
  if (request.auth.role === 'DRIVER') conditions.push(eq(shipments.driverId, request.auth.userId));
  const rows = await db.select({ shipment: shipments, driver: users, vehicle: vehicles }).from(shipments)
    .leftJoin(users, and(eq(users.id, shipments.driverId), eq(users.organizationId, request.auth.organizationId)))
    .leftJoin(vehicles, and(eq(vehicles.id, shipments.vehicleId), eq(vehicles.organizationId, request.auth.organizationId)))
    .where(and(...conditions))
    .orderBy(desc(shipments.updatedAt))
    .limit(200);
  const latestLocations = rows.length ? await db.selectDistinctOn([shipmentLocations.shipmentId]).from(shipmentLocations)
    .where(and(eq(shipmentLocations.organizationId, request.auth.organizationId), inArray(shipmentLocations.shipmentId, rows.map(({ shipment }) => shipment.id))))
    .orderBy(shipmentLocations.shipmentId, desc(shipmentLocations.recordedAt)) : [];
  const latestByShipment = new Map(latestLocations.map((location) => [location.shipmentId, location]));
  response.json({ shipments: rows.map(({ shipment, driver, vehicle }) => {
    const latestLocation = presentLocation(latestByShipment.get(shipment.id));
    return {
      id: shipment.id,
      trackingNumber: shipment.trackingNumber,
      description: shipment.description,
      status: shipment.status,
      pickupAddress: shipment.pickupAddress,
      deliveryAddress: shipment.deliveryAddress,
      driver: driver ? { id: driver.id, name: driver.name } : null,
      vehicle: vehicle ? { id: vehicle.id, registrationNumber: vehicle.registrationNumber } : null,
      latestLocation,
      freshness: latestLocation?.freshness ?? 'NO_SIGNAL',
    };
  }) });
});

router.get('/:shipmentId/history', async (request, response) => {
  ensureShipmentId(request.params.shipmentId);
  const parsed = historySchema.safeParse(request.query);
  if (!parsed.success) return validationError(response, parsed.error);
  const conditions = [eq(shipments.id, request.params.shipmentId), eq(shipments.organizationId, request.auth.organizationId)];
  if (request.auth.role === 'DRIVER') conditions.push(eq(shipments.driverId, request.auth.userId));
  const [shipment] = await db.select({ id: shipments.id }).from(shipments).where(and(...conditions)).limit(1);
  if (!shipment) throw new HttpError(404, 'SHIPMENT_NOT_FOUND', 'Shipment not found');
  const locations = await db.select().from(shipmentLocations)
    .where(and(eq(shipmentLocations.organizationId, request.auth.organizationId), eq(shipmentLocations.shipmentId, shipment.id)))
    .orderBy(desc(shipmentLocations.recordedAt))
    .limit(parsed.data.limit);
  const chronological = locations.reverse().map(presentLocation);
  response.json({ shipmentId: shipment.id, locations: chronological, latestLocation: chronological.at(-1) ?? null });
});

router.post('/locations', requireRole('DRIVER'), requireCsrf, async (request, response) => {
  const parsed = locationSchema.safeParse(request.body);
  if (!parsed.success) return validationError(response, parsed.error);
  const input = parsed.data;
  const recordedAt = new Date(input.recordedAt);
  const now = Date.now();
  if (recordedAt.getTime() > now + 5 * 60_000) throw new HttpError(400, 'LOCATION_FROM_FUTURE', 'Location time cannot be more than five minutes ahead');
  if (recordedAt.getTime() < now - 24 * 60 * 60_000) throw new HttpError(400, 'STALE_LOCATION', 'Location update is older than 24 hours');

  const result = await db.transaction(async (transaction) => {
    const [shipment] = await transaction.select().from(shipments).where(and(
      eq(shipments.id, input.shipmentId), eq(shipments.organizationId, request.auth.organizationId),
    )).for('update').limit(1);
    if (!shipment || shipment.driverId !== request.auth.userId || shipment.vehicleId !== input.vehicleId || !activeStatuses.includes(shipment.status)) {
      throw new HttpError(403, 'TRACKING_NOT_ASSIGNED', 'You are not assigned to actively track this shipment and vehicle');
    }
    const [vehicle] = await transaction.select({ id: vehicles.id }).from(vehicles).where(and(
      eq(vehicles.id, input.vehicleId), eq(vehicles.organizationId, request.auth.organizationId), eq(vehicles.status, 'ACTIVE'),
    )).limit(1);
    if (!vehicle) throw new HttpError(403, 'TRACKING_VEHICLE_INACTIVE', 'The assigned vehicle is not active');

    const [latest] = await transaction.select({ id: shipmentLocations.id, recordedAt: shipmentLocations.recordedAt }).from(shipmentLocations)
      .where(and(eq(shipmentLocations.organizationId, request.auth.organizationId), eq(shipmentLocations.shipmentId, shipment.id)))
      .orderBy(desc(shipmentLocations.recordedAt)).limit(1);
    const [inserted] = await transaction.insert(shipmentLocations).values({
      organizationId: request.auth.organizationId,
      shipmentId: shipment.id,
      vehicleId: input.vehicleId,
      driverId: request.auth.userId,
      sourceEventId: input.sourceEventId,
      source: 'DEVICE',
      latitude: input.latitude,
      longitude: input.longitude,
      accuracyMeters: input.accuracyMeters,
      speedKph: input.speedKph,
      headingDegrees: input.headingDegrees,
      recordedAt,
    }).onConflictDoNothing().returning();
    if (!inserted) return { duplicate: true };
    const outOfOrder = Boolean(latest && recordedAt < latest.recordedAt);
    const spatialEvents = outOfOrder ? [] : await processSpatialLocation(transaction, {
      organizationId: request.auth.organizationId,
      shipmentId: shipment.id,
      vehicleId: input.vehicleId,
      location: inserted,
      source: 'DEVICE',
    });
    return {
      duplicate: false,
      outOfOrder,
      spatialEvents,
      trackingNumber: shipment.trackingNumber,
      status: shipment.status,
      location: presentLocation(inserted),
    };
  });
  if (!result.duplicate) publishRealtime(request.app.get('io'), request.auth.organizationId, input.shipmentId, 'tracking:location', {
    shipmentId: input.shipmentId, trackingNumber: result.trackingNumber, status: result.status, location: result.location,
  });
  for (const event of result.spatialEvents ?? []) publishRealtime(request.app.get('io'), request.auth.organizationId, input.shipmentId, event.type, { shipmentId: input.shipmentId, ...event });
  response.status(result.duplicate ? 200 : 201).json({ accepted: true, source: 'DEVICE', ...result });
});

router.post('/simulate/:shipmentId', requireRole('ORG_ADMIN', 'DISPATCHER', 'SUPER_ADMIN'), requireCsrf, async (request, response) => {
  if (env.NODE_ENV === 'production') throw new HttpError(404, 'NOT_FOUND', 'Route not found');
  ensureShipmentId(request.params.shipmentId);
  const parsed = simulatorSchema.safeParse(request.body);
  if (!parsed.success) return validationError(response, parsed.error);
  const input = parsed.data;
  const created = await db.transaction(async (transaction) => {
    const [shipment] = await transaction.select().from(shipments).where(and(
      eq(shipments.id, request.params.shipmentId), eq(shipments.organizationId, request.auth.organizationId),
    )).for('update').limit(1);
    if (!shipment) throw new HttpError(404, 'SHIPMENT_NOT_FOUND', 'Shipment not found');
    if (!activeStatuses.includes(shipment.status) || !shipment.vehicleId) {
      throw new HttpError(409, 'SHIPMENT_NOT_DISPATCHED', 'Assign this shipment and vehicle before simulating GPS');
    }
    const [vehicle] = await transaction.select({ id: vehicles.id }).from(vehicles).where(and(
      eq(vehicles.id, shipment.vehicleId), eq(vehicles.organizationId, request.auth.organizationId), eq(vehicles.status, 'ACTIVE'),
    )).limit(1);
    if (!vehicle) throw new HttpError(409, 'VEHICLE_UNAVAILABLE', 'The shipment vehicle is not active');
    const now = Date.now();
    const locations = Array.from({ length: input.points }, (_value, index) => {
      const progress = index / (input.points - 1);
      return {
        organizationId: request.auth.organizationId,
        shipmentId: shipment.id,
        vehicleId: shipment.vehicleId,
        driverId: shipment.driverId,
        sourceEventId: randomUUID(),
        source: 'SIMULATOR',
        latitude: input.start.latitude + (input.end.latitude - input.start.latitude) * progress,
        longitude: input.start.longitude + (input.end.longitude - input.start.longitude) * progress,
        speedKph: index === input.points - 1 ? 0 : 42,
        headingDegrees: 0,
        recordedAt: new Date(now - input.durationMinutes * 60_000 * (1 - progress)),
      };
    });
    const inserted = await transaction.insert(shipmentLocations).values(locations).returning();
    const spatialEvents = [];
    for (const location of inserted) spatialEvents.push(...await processSpatialLocation(transaction, {
      organizationId: request.auth.organizationId,
      shipmentId: shipment.id,
      vehicleId: shipment.vehicleId,
      location,
      source: 'SIMULATOR',
    }));
    return { trackingNumber: shipment.trackingNumber, status: shipment.status, locations: inserted.map(presentLocation), spatialEvents };
  });
  for (const location of created.locations) publishRealtime(request.app.get('io'), request.auth.organizationId, request.params.shipmentId, 'tracking:location', {
    shipmentId: request.params.shipmentId, trackingNumber: created.trackingNumber, status: created.status, location,
  });
  for (const event of created.spatialEvents) publishRealtime(request.app.get('io'), request.auth.organizationId, request.params.shipmentId, event.type, { shipmentId: request.params.shipmentId, ...event });
  response.status(201).json({ simulated: true, source: 'SIMULATOR', message: 'These are simulated GPS points for demonstration only.', locationsAdded: created.locations.length, latestLocation: created.locations.at(-1) });
});

export const trackingRouter = router;

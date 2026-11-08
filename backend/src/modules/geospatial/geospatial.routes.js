import { Router } from 'express';
import { z } from 'zod';
import { db, pool } from '../../db/client.js';
import { shipments } from '../../db/schema.js';
import { and, eq } from 'drizzle-orm';
import { HttpError } from '../auth/auth-errors.js';
import { requireAuth, requireCsrf, requireRole } from '../auth/auth-middleware.js';

const router = Router();
const pointSchema = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) });
const waypointSchema = z.object({ kind: z.enum(['PICKUP', 'STOP', 'DELIVERY']), name: z.string().trim().min(2).max(120), address: z.string().trim().min(3).max(500), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), radiusMeters: z.number().int().min(25).max(5000).default(150), shipmentStopId: z.uuid().optional() });
const routeSchema = z.object({ name: z.string().trim().min(2).max(120), waypoints: z.array(waypointSchema).min(2).max(100) });
const geofenceSchema = z.discriminatedUnion('shape', [
  z.object({ name: z.string().trim().min(2).max(120), kind: z.enum(['WAREHOUSE', 'DELIVERY', 'CUSTOM']).default('CUSTOM'), shape: z.literal('CIRCLE'), center: pointSchema, radiusMeters: z.number().int().min(25).max(50000) }),
  z.object({ name: z.string().trim().min(2).max(120), kind: z.enum(['WAREHOUSE', 'DELIVERY', 'CUSTOM']).default('CUSTOM'), shape: z.literal('POLYGON'), coordinates: z.array(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])).min(4).max(500) }),
]);

function validationError(response, error) {
  return response.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Check the submitted fields and try again', fields: error.flatten().fieldErrors } });
}
function validUuid(id) {
  if (!z.uuid().safeParse(id).success) throw new HttpError(404, 'NOT_FOUND', 'The requested resource was not found');
}

router.use(requireAuth);

router.get('/geofences', async (request, response) => {
  const { rows } = await pool.query(
    `SELECT id, name, kind, shape, radius_meters AS "radiusMeters", active, created_at AS "createdAt", ST_AsGeoJSON(boundary)::json AS geometry
     FROM geofences WHERE organization_id = $1 ${request.query.includeInactive === 'true' ? '' : 'AND active = true'} ORDER BY name`,
    [request.auth.organizationId],
  );
  response.json({ geofences: rows });
});

router.post('/geofences', requireRole('ORG_ADMIN', 'DISPATCHER', 'SUPER_ADMIN'), requireCsrf, async (request, response) => {
  const parsed = geofenceSchema.safeParse(request.body);
  if (!parsed.success) return validationError(response, parsed.error);
  const input = parsed.data;
  let result;
  if (input.shape === 'CIRCLE') {
    result = await pool.query(`INSERT INTO geofences (organization_id,name,kind,shape,center,radius_meters,boundary,created_by)
      VALUES ($1,$2,$3,'CIRCLE',ST_SetSRID(ST_MakePoint($4,$5),4326),$6,
        ST_Buffer(ST_SetSRID(ST_MakePoint($4,$5),4326)::geography,$6)::geometry::geometry(Polygon,4326),$7)
      RETURNING id,name,kind,shape,radius_meters AS "radiusMeters",active,ST_AsGeoJSON(boundary)::json AS geometry`,
    [request.auth.organizationId, input.name, input.kind, input.center.longitude, input.center.latitude, input.radiusMeters, request.auth.userId]);
  } else {
    const coordinates = input.coordinates;
    const first = coordinates[0]; const last = coordinates.at(-1);
    if (first[0] !== last[0] || first[1] !== last[1]) return response.status(400).json({ error: { code: 'INVALID_POLYGON', message: 'The polygon boundary must end at its starting coordinate' } });
    result = await pool.query(`INSERT INTO geofences (organization_id,name,kind,shape,boundary,created_by)
      VALUES ($1,$2,$3,'POLYGON',ST_SetSRID(ST_GeomFromGeoJSON($4),4326)::geometry(Polygon,4326),$5)
      RETURNING id,name,kind,shape,radius_meters AS "radiusMeters",active,ST_AsGeoJSON(boundary)::json AS geometry`,
    [request.auth.organizationId, input.name, input.kind, JSON.stringify({ type: 'Polygon', coordinates: [coordinates] }), request.auth.userId]);
  }
  response.status(201).json({ geofence: result.rows[0] });
});

router.patch('/geofences/:geofenceId', requireRole('ORG_ADMIN', 'DISPATCHER', 'SUPER_ADMIN'), requireCsrf, async (request, response) => {
  validUuid(request.params.geofenceId);
  const parsed = z.object({ active: z.boolean().optional(), name: z.string().trim().min(2).max(120).optional() }).refine((value) => Object.keys(value).length > 0).safeParse(request.body);
  if (!parsed.success) return validationError(response, parsed.error);
  const values = parsed.data;
  const result = await pool.query(`UPDATE geofences SET name=COALESCE($3,name), active=COALESCE($4,active), updated_at=now()
    WHERE id=$1 AND organization_id=$2 RETURNING id,name,kind,shape,active,ST_AsGeoJSON(boundary)::json AS geometry`,
  [request.params.geofenceId, request.auth.organizationId, values.name ?? null, values.active ?? null]);
  if (!result.rowCount) throw new HttpError(404, 'NOT_FOUND', 'The requested resource was not found');
  response.json({ geofence: result.rows[0] });
});

router.get('/geofences/events', async (request, response) => {
  const shipmentId = request.query.shipmentId;
  const params = [request.auth.organizationId];
  let shipmentClause = '';
  if (shipmentId) {
    validUuid(shipmentId);
    params.push(shipmentId);
    shipmentClause = `AND e.shipment_id=$2`;
  }
  let driverClause = '';
  if (request.auth.role === 'DRIVER') {
    params.push(request.auth.userId);
    driverClause = `AND EXISTS (SELECT 1 FROM shipments s WHERE s.id=e.shipment_id AND s.driver_id=$${params.length})`;
  }
  const { rows } = await pool.query(`SELECT e.id,e.shipment_id AS "shipmentId",e.geofence_id AS "geofenceId",g.name,e.transition,e.source,e.occurred_at AS "occurredAt"
    FROM geofence_events e JOIN geofences g ON g.id=e.geofence_id
    WHERE e.organization_id=$1 ${shipmentClause} ${driverClause} ORDER BY e.occurred_at DESC LIMIT 200`, params);
  response.json({ events: rows });
});

router.post('/routes/:shipmentId', requireRole('ORG_ADMIN', 'DISPATCHER', 'SUPER_ADMIN'), requireCsrf, async (request, response) => {
  validUuid(request.params.shipmentId);
  const parsed = routeSchema.safeParse(request.body);
  if (!parsed.success) return validationError(response, parsed.error);
  const [shipment] = await db.select({ id: shipments.id, status: shipments.status }).from(shipments).where(and(eq(shipments.id, request.params.shipmentId), eq(shipments.organizationId, request.auth.organizationId))).limit(1);
  if (!shipment) throw new HttpError(404, 'SHIPMENT_NOT_FOUND', 'Shipment not found');
  if (['DELIVERED', 'FAILED', 'CANCELLED'].includes(shipment.status)) throw new HttpError(409, 'SHIPMENT_TERMINAL', 'A completed or cancelled shipment cannot receive a new route');
  const client = await pool.connect();
  let created;
  try {
    await client.query('BEGIN');
    let route = await client.query('SELECT id FROM shipment_routes WHERE organization_id=$1 AND shipment_id=$2 FOR UPDATE', [request.auth.organizationId, shipment.id]);
    if (!route.rowCount) route = await client.query('INSERT INTO shipment_routes (organization_id,shipment_id,name,created_by) VALUES ($1,$2,$3,$4) RETURNING id', [request.auth.organizationId, shipment.id, parsed.data.name, request.auth.userId]);
    else await client.query('UPDATE shipment_routes SET name=$2,updated_at=now() WHERE id=$1', [route.rows[0].id, parsed.data.name]);
    const routeId = route.rows[0].id;
    const previous = await client.query('SELECT COALESCE(max(version),0) AS version FROM route_versions WHERE route_id=$1', [routeId]);
    const version = Number(previous.rows[0].version) + 1;
    const coords = parsed.data.waypoints.map(({ longitude, latitude }) => [longitude, latitude]);
    const line = JSON.stringify({ type: 'LineString', coordinates: coords });
    const routeVersion = await client.query(`INSERT INTO route_versions (organization_id,route_id,version,path,planned_distance_meters,created_by)
      VALUES ($1,$2,$3,ST_SetSRID(ST_GeomFromGeoJSON($4),4326)::geometry(LineString,4326),
        ST_Length(ST_SetSRID(ST_GeomFromGeoJSON($4),4326)::geography),$5) RETURNING id,planned_distance_meters AS "plannedDistanceMeters",actual_distance_meters AS "actualDistanceMeters",created_at AS "createdAt"`,
    [request.auth.organizationId, routeId, version, line, request.auth.userId]);
    for (let index = 0; index < parsed.data.waypoints.length; index += 1) {
      const point = parsed.data.waypoints[index];
      if (point.shipmentStopId) {
        const stopCheck = await client.query('SELECT id FROM shipment_stops WHERE id=$1 AND shipment_id=$2 AND organization_id=$3', [point.shipmentStopId, shipment.id, request.auth.organizationId]);
        if (!stopCheck.rowCount) throw new HttpError(400, 'INVALID_STOP', 'A route stop does not belong to this shipment');
      }
      await client.query(`INSERT INTO route_waypoints (organization_id,route_version_id,shipment_stop_id,sequence,kind,name,address,location,radius_meters)
        VALUES ($1,$2,$3,$4,$5,$6,$7,ST_SetSRID(ST_MakePoint($8,$9),4326),$10)`,
      [request.auth.organizationId, routeVersion.rows[0].id, point.shipmentStopId ?? null, index + 1, point.kind, point.name, point.address, point.longitude, point.latitude, point.radiusMeters]);
    }
    const waypoints = await client.query(`SELECT id,sequence,kind,name,address,status,radius_meters AS "radiusMeters",ST_X(location) AS longitude,ST_Y(location) AS latitude
      FROM route_waypoints WHERE route_version_id=$1 ORDER BY sequence`, [routeVersion.rows[0].id]);
    await client.query('COMMIT');
    created = { id: routeId, shipmentId: shipment.id, version, ...routeVersion.rows[0], waypoints: waypoints.rows, plannedRouting: 'Ordered straight-line segments; no traffic or road-network optimization is applied.' };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
  response.status(201).json({ route: created });
});

router.get('/routes/:shipmentId', async (request, response) => {
  validUuid(request.params.shipmentId);
  const params = [request.auth.organizationId, request.params.shipmentId];
  let driverClause = '';
  if (request.auth.role === 'DRIVER') { params.push(request.auth.userId); driverClause = `AND s.driver_id=$3`; }
  const versions = await pool.query(`SELECT rv.id,rv.version,rv.planned_distance_meters AS "plannedDistanceMeters",rv.actual_distance_meters AS "actualDistanceMeters",rv.created_at AS "createdAt",ST_AsGeoJSON(rv.path)::json AS geometry
    FROM route_versions rv JOIN shipment_routes sr ON sr.id=rv.route_id JOIN shipments s ON s.id=sr.shipment_id
    WHERE sr.organization_id=$1 AND sr.shipment_id=$2 ${driverClause} ORDER BY rv.version DESC`, params);
  if (!versions.rowCount && request.auth.role === 'DRIVER') {
    const [shipment] = await db.select({ id: shipments.id }).from(shipments).where(and(eq(shipments.id, request.params.shipmentId), eq(shipments.organizationId, request.auth.organizationId), eq(shipments.driverId, request.auth.userId))).limit(1);
    if (!shipment) throw new HttpError(404, 'SHIPMENT_NOT_FOUND', 'Shipment not found');
  }
  const withWaypoints = await Promise.all(versions.rows.map(async (version) => {
    const { rows } = await pool.query(`SELECT id,sequence,kind,name,address,status,radius_meters AS "radiusMeters",arrived_at AS "arrivedAt",departed_at AS "departedAt",ST_X(location) AS longitude,ST_Y(location) AS latitude FROM route_waypoints WHERE route_version_id=$1 ORDER BY sequence`, [version.id]);
    return { ...version, waypoints: rows };
  }));
  response.json({ shipmentId: request.params.shipmentId, routes: withWaypoints, current: withWaypoints[0] ?? null });
});

router.get('/routes/:shipmentId/history', async (request, response) => {
  validUuid(request.params.shipmentId);
  const result = await pool.query(`SELECT ge.id,ge.type,ge.description,ge.created_at AS "createdAt" FROM shipment_events ge JOIN shipments s ON s.id=ge.shipment_id
    WHERE ge.organization_id=$1 AND ge.shipment_id=$2 AND ge.type IN ('STOP_ARRIVAL','STOP_DEPARTURE','GEOFENCE_ENTRY','GEOFENCE_EXIT')
      AND ($3::uuid IS NULL OR s.driver_id=$3) ORDER BY ge.created_at DESC LIMIT 200`,
  [request.auth.organizationId, request.params.shipmentId, request.auth.role === 'DRIVER' ? request.auth.userId : null]);
  response.json({ shipmentId: request.params.shipmentId, events: result.rows });
});

export const geospatialRouter = router;

import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/client.js';
import { HttpError } from '../auth/auth-errors.js';
import { requireAuth } from '../auth/auth-middleware.js';

const router = Router();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
});
const filterSchema = z.object({
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  driverId: z.uuid().optional(),
  vehicleId: z.uuid().optional(),
  status: z.enum(['CREATED', 'ASSIGNED', 'PICKED_UP', 'IN_TRANSIT', 'DELAYED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED', 'CANCELLED']).optional(),
}).refine((value) => !value.from || !value.to || value.from <= value.to, { path: ['to'], message: 'End date must not precede start date' });

function parseFilters(request) {
  const parsed = filterSchema.safeParse(request.query);
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Check the analytics filters and try again');
  if (request.auth.role === 'DRIVER' && parsed.data.driverId && parsed.data.driverId !== request.auth.userId) {
    throw new HttpError(403, 'FORBIDDEN', 'You can view analytics only for your own deliveries');
  }
  const filters = { ...parsed.data };
  if (request.auth.role === 'DRIVER') filters.driverId = request.auth.userId;
  const values = [request.auth.organizationId];
  const clauses = ['s.organization_id=$1'];
  if (filters.from) { values.push(filters.from); clauses.push(`s.created_at >= $${values.length}::date`); }
  else clauses.push("s.created_at >= current_date - interval '29 days'");
  if (filters.to) { values.push(filters.to); clauses.push(`s.created_at < ($${values.length}::date + interval '1 day')`); }
  if (filters.driverId) { values.push(filters.driverId); clauses.push(`s.driver_id=$${values.length}`); }
  if (filters.vehicleId) { values.push(filters.vehicleId); clauses.push(`s.vehicle_id=$${values.length}`); }
  if (filters.status) { values.push(filters.status); clauses.push(`s.status=$${values.length}`); }
  return { values, where: clauses.join(' AND '), filters };
}

router.use(requireAuth);

router.get('/overview', async (request, response) => {
  const { values, where } = parseFilters(request);
  const [summary] = (await pool.query(`SELECT
      count(*)::int AS "totalShipments",
      count(*) FILTER (WHERE s.status IN ('ASSIGNED','PICKED_UP','IN_TRANSIT','DELAYED','OUT_FOR_DELIVERY'))::int AS "activeShipments",
      count(*) FILTER (WHERE s.status='DELIVERED')::int AS "deliveredShipments",
      count(*) FILTER (WHERE s.status='DELAYED')::int AS "delayedShipments",
      count(*) FILTER (WHERE s.status='FAILED')::int AS "failedShipments",
      count(*) FILTER (WHERE s.status='DELIVERED' AND delivered.delivered_at IS NOT NULL AND s.estimated_delivery_at IS NOT NULL AND delivered.delivered_at <= s.estimated_delivery_at)::int AS "onTimeDeliveries",
      count(*) FILTER (WHERE s.status='DELIVERED' AND s.estimated_delivery_at IS NOT NULL)::int AS "deliveredWithEta",
      round((avg(EXTRACT(EPOCH FROM (delivered.delivered_at-s.created_at))/3600)
        FILTER (WHERE s.status='DELIVERED' AND delivered.delivered_at IS NOT NULL))::numeric, 1) AS "averageDeliveryHours",
      count(DISTINCT s.vehicle_id) FILTER (WHERE s.status IN ('ASSIGNED','PICKED_UP','IN_TRANSIT','DELAYED','OUT_FOR_DELIVERY'))::int AS "activeVehiclesUsed"
    FROM shipments s
    LEFT JOIN LATERAL (SELECT min(e.created_at) AS delivered_at FROM shipment_events e
      WHERE e.organization_id=s.organization_id AND e.shipment_id=s.id AND e.to_status='DELIVERED') delivered ON true
    WHERE ${where}`, values)).rows;
  const [fleet] = (await pool.query(`SELECT count(*)::int AS "activeFleetVehicles" FROM vehicles
    WHERE organization_id=$1 AND status='ACTIVE' ${request.query.vehicleId ? 'AND id=$2' : ''}`,
  request.query.vehicleId ? [values[0], request.query.vehicleId] : [values[0]])).rows;
  const trend = await pool.query(`SELECT to_char(date_trunc('day',s.created_at),'YYYY-MM-DD') AS date,
      count(*)::int AS shipments,
      count(*) FILTER (WHERE s.status='DELIVERED')::int AS delivered,
      count(*) FILTER (WHERE s.status IN ('DELAYED','FAILED'))::int AS exceptions
    FROM shipments s WHERE ${where} GROUP BY date_trunc('day',s.created_at) ORDER BY date_trunc('day',s.created_at)`, values);
  const deliveredWithEta = Number(summary.deliveredWithEta);
  response.json({
    filters: { ...parseFilters(request).filters, period: request.query.from || request.query.to ? 'CUSTOM' : 'LAST_30_DAYS' },
    metrics: {
      ...summary,
      onTimePercentage: deliveredWithEta ? Number((Number(summary.onTimeDeliveries) * 100 / deliveredWithEta).toFixed(1)) : null,
      activeFleetVehicles: fleet.activeFleetVehicles,
      vehicleUtilizationPercentage: fleet.activeFleetVehicles ? Number((Number(summary.activeVehiclesUsed) * 100 / fleet.activeFleetVehicles).toFixed(1)) : 0,
    },
    trend: trend.rows,
  });
});

router.get('/performance', async (request, response) => {
  const { values, where } = parseFilters(request);
  const [drivers, vehicles] = await Promise.all([
    pool.query(`SELECT u.id AS "driverId",u.name AS "driverName",count(*)::int AS "totalShipments",
        count(*) FILTER (WHERE s.status='DELIVERED')::int AS "deliveredShipments",
        count(*) FILTER (WHERE s.status='FAILED')::int AS "failedShipments",
        count(*) FILTER (WHERE s.status='DELIVERED' AND s.estimated_delivery_at IS NOT NULL AND delivered.delivered_at <= s.estimated_delivery_at)::int AS "onTimeDeliveries",
        count(*) FILTER (WHERE s.status='DELIVERED' AND s.estimated_delivery_at IS NOT NULL)::int AS "deliveredWithEta",
        round((avg(EXTRACT(EPOCH FROM (delivered.delivered_at-s.created_at))/3600)
          FILTER (WHERE s.status='DELIVERED' AND delivered.delivered_at IS NOT NULL))::numeric,1) AS "averageDeliveryHours"
      FROM shipments s JOIN users u ON u.id=s.driver_id AND u.organization_id=s.organization_id
      LEFT JOIN LATERAL (SELECT min(e.created_at) AS delivered_at FROM shipment_events e WHERE e.shipment_id=s.id AND e.organization_id=s.organization_id AND e.to_status='DELIVERED') delivered ON true
      WHERE ${where} GROUP BY u.id,u.name ORDER BY "deliveredShipments" DESC,"totalShipments" DESC LIMIT 20`, values),
    pool.query(`SELECT v.id AS "vehicleId",v.registration_number AS "registrationNumber",v.vehicle_type AS "vehicleType",count(*)::int AS "totalShipments",
        count(*) FILTER (WHERE s.status='DELIVERED')::int AS "deliveredShipments",
        count(*) FILTER (WHERE s.status IN ('ASSIGNED','PICKED_UP','IN_TRANSIT','DELAYED','OUT_FOR_DELIVERY'))::int AS "activeShipments"
      FROM shipments s JOIN vehicles v ON v.id=s.vehicle_id AND v.organization_id=s.organization_id
      WHERE ${where} GROUP BY v.id,v.registration_number,v.vehicle_type ORDER BY "activeShipments" DESC,"totalShipments" DESC LIMIT 20`, values),
  ]);
  response.json({ drivers: drivers.rows.map((driver) => ({ ...driver, onTimePercentage: Number(driver.deliveredWithEta) ? Number((Number(driver.onTimeDeliveries) * 100 / Number(driver.deliveredWithEta)).toFixed(1)) : null })), vehicles: vehicles.rows });
});

export const analyticsRouter = router;

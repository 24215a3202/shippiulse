import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { pool } from '../../db/client.js';
import { publishRealtime } from '../../realtime/socket-server.js';

const activeStatuses = "'ASSIGNED','PICKED_UP','IN_TRANSIT','DELAYED','OUT_FOR_DELIVERY'";
let missingMigrationReported = false;

const candidateSql = `
WITH active AS (
  SELECT s.id AS shipment_id, s.organization_id, s.tracking_number, s.status, s.updated_at,
    s.estimated_delivery_at, s.vehicle_id, v.status AS vehicle_status,
    loc.recorded_at AS latest_device_at, loc.latitude, loc.longitude,
    rv.path AS planned_path, rv.id AS route_version_id, rv.created_at AS route_created_at
  FROM shipments s
  LEFT JOIN vehicles v ON v.id = s.vehicle_id AND v.organization_id = s.organization_id
  LEFT JOIN LATERAL (
    SELECT recorded_at, latitude, longitude FROM shipment_locations l
    WHERE l.shipment_id = s.id AND l.organization_id = s.organization_id AND l.source = 'DEVICE'
    ORDER BY recorded_at DESC LIMIT 1
  ) loc ON true
  LEFT JOIN LATERAL (
    SELECT version.id, version.path, version.created_at
    FROM shipment_routes r JOIN route_versions version ON version.route_id = r.id
    WHERE r.shipment_id = s.id AND r.organization_id = s.organization_id
    ORDER BY version.version DESC LIMIT 1
  ) rv ON true
  WHERE s.status IN (${activeStatuses})
), candidates AS (
  SELECT organization_id, shipment_id, 'OVERDUE_DELIVERY'::shipment_exception_type AS type, 'HIGH'::shipment_exception_severity AS severity,
    'shipment'::varchar AS condition_key, 'Estimated delivery time has passed.'::text AS description,
    jsonb_build_object('estimatedDeliveryAt', estimated_delivery_at) AS metadata
  FROM active WHERE estimated_delivery_at IS NOT NULL AND estimated_delivery_at < now() - make_interval(mins => $1::int)

  UNION ALL
  SELECT organization_id, shipment_id, 'DELAYED_PICKUP', 'MEDIUM', 'shipment',
    'Shipment is assigned but pickup has not started within the configured window.', jsonb_build_object('assignedAt', updated_at)
  FROM active WHERE status = 'ASSIGNED' AND updated_at < now() - make_interval(mins => $2::int)

  UNION ALL
  SELECT organization_id, shipment_id, 'MISSING_GPS', 'HIGH', 'shipment',
    'No device GPS update has been received within the configured window.', jsonb_build_object('lastDeviceLocationAt', latest_device_at)
  FROM active WHERE latest_device_at IS NULL OR latest_device_at < now() - make_interval(mins => $3::int)

  UNION ALL
  SELECT organization_id, shipment_id, 'VEHICLE_INACTIVE', 'CRITICAL', 'shipment',
    CASE WHEN vehicle_status IS DISTINCT FROM 'ACTIVE' THEN 'The assigned vehicle is not active.' ELSE 'The assigned vehicle has not sent device GPS within the inactivity window.' END,
    jsonb_build_object('vehicleStatus', vehicle_status, 'lastDeviceLocationAt', latest_device_at)
  FROM active WHERE vehicle_id IS NOT NULL AND (vehicle_status IS DISTINCT FROM 'ACTIVE'
    OR latest_device_at IS NULL OR latest_device_at < now() - make_interval(mins => ($3::int * 2)))

  UNION ALL
  SELECT organization_id, shipment_id, 'ROUTE_DEVIATION', 'HIGH', 'shipment',
    'Latest device position is outside the configured distance from the planned route.',
    jsonb_build_object('distanceMeters', round(ST_Distance(ST_SetSRID(ST_MakePoint(longitude, latitude),4326)::geography, planned_path::geography)::numeric, 1), 'thresholdMeters', $4::int)
  FROM active WHERE latest_device_at IS NOT NULL AND planned_path IS NOT NULL
    AND ST_Distance(ST_SetSRID(ST_MakePoint(longitude, latitude),4326)::geography, planned_path::geography) > $4::int

  UNION ALL
  SELECT a.organization_id, a.shipment_id, 'MISSED_STOP', 'MEDIUM', 'STOP:' || w.id::text,
    'A planned route stop remains pending beyond the configured stop window.',
    jsonb_build_object('waypointId', w.id, 'sequence', w.sequence, 'stopName', w.name, 'routeVersionId', a.route_version_id)
  FROM active a JOIN route_waypoints w ON w.route_version_id = a.route_version_id AND w.status = 'PENDING'
  WHERE a.status = 'OUT_FOR_DELIVERY' AND a.route_created_at < now() - make_interval(mins => $5::int)
)
SELECT * FROM candidates`;

export async function scanForExceptions(io = null) {
  const client = await pool.connect();
  let changes = [];
  let acquired = false;
  try {
    const lock = await client.query("SELECT pg_try_advisory_lock(hashtext('shippulse.exception-scan.v1')) AS acquired");
    acquired = lock.rows[0].acquired;
    if (!acquired) return { skipped: true, detected: 0, resolved: 0 };

    await client.query('BEGIN');
    const result = await client.query(candidateSql, [
      env.EXCEPTION_DELIVERY_GRACE_MINUTES,
      env.EXCEPTION_PICKUP_DELAY_MINUTES,
      env.EXCEPTION_MISSING_GPS_MINUTES,
      env.EXCEPTION_ROUTE_DEVIATION_METERS,
      env.EXCEPTION_STOP_DELAY_MINUTES,
    ]);
    const activeKeys = new Set();
    for (const candidate of result.rows) {
      const key = `${candidate.organization_id}:${candidate.shipment_id}:${candidate.type}:${candidate.condition_key}`;
      activeKeys.add(key);
      const existing = await client.query(`SELECT id FROM shipment_exceptions
        WHERE organization_id=$1 AND shipment_id=$2 AND type=$3 AND condition_key=$4 AND status IN ('OPEN','ACKNOWLEDGED','DISMISSED') FOR UPDATE`,
      [candidate.organization_id, candidate.shipment_id, candidate.type, candidate.condition_key]);
      if (existing.rowCount) {
        const updated = await client.query(`UPDATE shipment_exceptions SET severity=$2,description=$3,metadata=$4,last_seen_at=now(),updated_at=now()
          WHERE id=$1 RETURNING id`, [existing.rows[0].id, candidate.severity, candidate.description, candidate.metadata]);
        continue;
      }
      const inserted = await client.query(`INSERT INTO shipment_exceptions
        (organization_id,shipment_id,type,severity,condition_key,description,metadata)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (organization_id,shipment_id,type,condition_key)
        WHERE status IN ('OPEN','ACKNOWLEDGED') DO NOTHING
        RETURNING id,organization_id,shipment_id,type,severity,status,description,detected_at AS "detectedAt",metadata`,
      [candidate.organization_id, candidate.shipment_id, candidate.type, candidate.severity, candidate.condition_key, candidate.description, candidate.metadata]);
      if (inserted.rowCount) changes.push({ event: 'exception:created', data: inserted.rows[0] });
    }

    const open = await client.query(`SELECT id,organization_id,shipment_id,type,condition_key,status FROM shipment_exceptions WHERE status IN ('OPEN','ACKNOWLEDGED','DISMISSED')`);
    const staleIds = open.rows.filter((item) => !activeKeys.has(`${item.organization_id}:${item.shipment_id}:${item.type}:${item.condition_key}`)).map((item) => item.id);
    if (staleIds.length) {
      const resolved = await client.query(`UPDATE shipment_exceptions SET status='RESOLVED',resolved_at=now(),updated_at=now(),
        resolution_notes=COALESCE(resolution_notes,'Condition cleared automatically by the exception scan.')
        WHERE id=ANY($1::uuid[]) AND status IN ('OPEN','ACKNOWLEDGED')
        RETURNING id,organization_id,shipment_id,type,severity,status,description,resolved_at AS "resolvedAt"`, [staleIds]);
      changes.push(...resolved.rows.map((data) => ({ event: 'exception:updated', data })));
      await client.query(`UPDATE shipment_exceptions SET condition_key=left(condition_key,120)||':cleared:'||left(id::text,8),updated_at=now()
        WHERE id=ANY($1::uuid[]) AND status='DISMISSED'`, [staleIds]);
    }
    const escalated = await client.query(`UPDATE shipment_exceptions SET escalated_at=now(),updated_at=now()
      WHERE status IN ('OPEN','ACKNOWLEDGED') AND severity IN ('HIGH','CRITICAL') AND escalated_at IS NULL
        AND detected_at <= now() - make_interval(mins => $1::int)
      RETURNING id,organization_id,shipment_id,type,severity,status,description,detected_at AS "detectedAt",escalated_at AS "escalatedAt"`,
    [env.EXCEPTION_ESCALATION_MINUTES]);
    changes.push(...escalated.rows.map((data) => ({ event: 'exception:escalated', data })));
    await client.query('COMMIT');
    for (const change of changes) publishRealtime(io, change.data.organization_id ?? change.data.organizationId, change.data.shipment_id ?? change.data.shipmentId, change.event, change.data);
    return {
      skipped: false,
      detected: changes.filter(({ event }) => event === 'exception:created').length,
      resolved: staleIds.length,
      escalated: escalated.rowCount,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if ((error.code === '42P01' || error.code === '42704') && !missingMigrationReported) {
      missingMigrationReported = true;
      logger.warn({ code: error.code }, 'Exception scan is waiting for the Phase 8 database migration and PostGIS prerequisite');
    } else if (error.code !== '42P01' && error.code !== '42704') {
      logger.error({ err: error }, 'Exception scan failed');
    }
    throw error;
  } finally {
    if (acquired) await client.query("SELECT pg_advisory_unlock(hashtext('shippulse.exception-scan.v1'))").catch(() => {});
    client.release();
  }
}

export function startExceptionScanner(io) {
  let stopped = false;
  let running = false;
  const run = async () => {
    if (stopped || running) return;
    running = true;
    try { await scanForExceptions(io); } catch { /* Scanner logs actionable failures. */ }
    finally { running = false; }
  };
  const initial = setTimeout(run, 10_000);
  const interval = setInterval(run, env.EXCEPTION_SCAN_INTERVAL_SECONDS * 1000);
  initial.unref();
  interval.unref();
  return () => { stopped = true; clearTimeout(initial); clearInterval(interval); };
}

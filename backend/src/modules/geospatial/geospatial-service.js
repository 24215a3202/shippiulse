import { sql } from 'drizzle-orm';
import { shipmentEvents } from '../../db/schema.js';

// Called inside the GPS write transaction, so the location, transition records,
// shipment timeline, and route progress commit or roll back together.
export async function processSpatialLocation(transaction, { organizationId, shipmentId, vehicleId, location, source }) {
  const point = sql`ST_SetSRID(ST_MakePoint(${location.longitude}, ${location.latitude}), 4326)`;
  const occurredAt = location.recordedAt;
  const events = [];
  const fencesResult = await transaction.execute(sql`
    SELECT g.id, g.name, ST_Covers(g.boundary, ${point}) AS inside
    FROM geofences g
    LEFT JOIN geofence_states gs ON gs.geofence_id = g.id AND gs.shipment_id = ${shipmentId}
    WHERE g.organization_id = ${organizationId} AND g.active = true
      AND (g.boundary && ${point} OR gs.is_inside = true)
  `);
  for (const fence of fencesResult.rows) {
    const [state] = (await transaction.execute(sql`
      SELECT is_inside FROM geofence_states
      WHERE organization_id = ${organizationId} AND geofence_id = ${fence.id} AND shipment_id = ${shipmentId}
      FOR UPDATE
    `)).rows;
    const wasInside = state?.is_inside ?? false;
    const isInside = fence.inside;
    if (wasInside !== isInside) {
      const transition = isInside ? 'ENTRY' : 'EXIT';
      await transaction.execute(sql`
        INSERT INTO geofence_states (organization_id, geofence_id, shipment_id, vehicle_id, is_inside, last_location_id, last_transition_at)
        VALUES (${organizationId}, ${fence.id}, ${shipmentId}, ${vehicleId}, ${isInside}, ${location.id}, ${occurredAt})
        ON CONFLICT (organization_id, geofence_id, shipment_id) DO UPDATE SET
          vehicle_id = EXCLUDED.vehicle_id, is_inside = EXCLUDED.is_inside,
          last_location_id = EXCLUDED.last_location_id, last_transition_at = EXCLUDED.last_transition_at
      `);
      await transaction.execute(sql`
        INSERT INTO geofence_events (organization_id, geofence_id, shipment_id, vehicle_id, location_id, transition, source, occurred_at)
        VALUES (${organizationId}, ${fence.id}, ${shipmentId}, ${vehicleId}, ${location.id}, ${transition}, ${source}, ${occurredAt})
        ON CONFLICT DO NOTHING
      `);
      const description = `${isInside ? 'Entered' : 'Exited'} geofence: ${fence.name}`;
      await transaction.insert(shipmentEvents).values({ organizationId, shipmentId, type: `GEOFENCE_${transition}`, description, createdAt: occurredAt });
      events.push({ type: 'geofence:transition', geofenceId: fence.id, name: fence.name, transition, source, occurredAt });
    } else if (state) {
      await transaction.execute(sql`UPDATE geofence_states SET vehicle_id = ${vehicleId}, last_location_id = ${location.id} WHERE organization_id = ${organizationId} AND geofence_id = ${fence.id} AND shipment_id = ${shipmentId}`);
    } else {
      await transaction.execute(sql`INSERT INTO geofence_states (organization_id, geofence_id, shipment_id, vehicle_id, is_inside, last_location_id, last_transition_at) VALUES (${organizationId}, ${fence.id}, ${shipmentId}, ${vehicleId}, false, ${location.id}, ${occurredAt}) ON CONFLICT DO NOTHING`);
    }
  }

  const routes = (await transaction.execute(sql`
    SELECT rv.id AS version_id FROM shipment_routes sr
    JOIN LATERAL (SELECT id FROM route_versions WHERE route_id = sr.id ORDER BY version DESC LIMIT 1) rv ON true
    WHERE sr.organization_id = ${organizationId} AND sr.shipment_id = ${shipmentId}
  `)).rows;
  for (const route of routes) {
    const waypoints = (await transaction.execute(sql`
      SELECT id, name, kind, status, radius_meters,
        ST_Distance(location::geography, ${point}::geography) AS distance_meters
      FROM route_waypoints WHERE route_version_id = ${route.version_id} AND status <> 'COMPLETED'
      ORDER BY sequence
    `)).rows;
    for (const waypoint of waypoints) {
      const arrived = waypoint.status === 'PENDING' && Number(waypoint.distance_meters) <= waypoint.radius_meters;
      const departed = waypoint.status === 'ARRIVED' && Number(waypoint.distance_meters) > waypoint.radius_meters;
      if (!arrived && !departed) continue;
      const status = arrived ? 'ARRIVED' : 'COMPLETED';
      const column = arrived ? 'arrived_at' : 'departed_at';
      await transaction.execute(sql`UPDATE route_waypoints SET status = ${status}, ${sql.raw(column)} = ${occurredAt} WHERE id = ${waypoint.id}`);
      const [stop] = (await transaction.execute(sql`SELECT shipment_stop_id FROM route_waypoints WHERE id = ${waypoint.id}`)).rows;
      if (stop?.shipment_stop_id) {
        await transaction.execute(arrived
          ? sql`UPDATE shipment_stops SET status = 'ARRIVED', arrived_at = ${occurredAt} WHERE id = ${stop.shipment_stop_id}`
          : sql`UPDATE shipment_stops SET status = 'COMPLETED', departed_at = ${occurredAt} WHERE id = ${stop.shipment_stop_id}`);
      }
      const type = arrived ? 'STOP_ARRIVAL' : 'STOP_DEPARTURE';
      const description = `${arrived ? 'Arrived at' : 'Departed'} ${waypoint.kind.toLowerCase()} stop: ${waypoint.name}`;
      await transaction.insert(shipmentEvents).values({ organizationId, shipmentId, type, description, createdAt: occurredAt });
      events.push({ type: 'stop:updated', waypointId: waypoint.id, name: waypoint.name, status, source, occurredAt });
    }
  }

  if (source === 'DEVICE') {
    const previous = (await transaction.execute(sql`
      SELECT latitude, longitude FROM shipment_locations
      WHERE organization_id = ${organizationId} AND shipment_id = ${shipmentId} AND id <> ${location.id}
      ORDER BY recorded_at DESC LIMIT 1
    `)).rows[0];
    if (previous) await transaction.execute(sql`
      UPDATE route_versions rv SET actual_distance_meters = actual_distance_meters + ST_Distance(
        ST_SetSRID(ST_MakePoint(${previous.longitude}, ${previous.latitude}), 4326)::geography,
        ${point}::geography
      ) FROM shipment_routes sr
      WHERE rv.route_id = sr.id AND sr.organization_id = ${organizationId} AND sr.shipment_id = ${shipmentId}
        AND rv.version = (SELECT max(v.version) FROM route_versions v WHERE v.route_id = sr.id)
    `);
  }
  return events;
}

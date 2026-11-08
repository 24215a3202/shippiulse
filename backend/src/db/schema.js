import { boolean, customType, date, doublePrecision, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid, varchar, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const organizationStatus = pgEnum('organization_status', ['ACTIVE', 'SUSPENDED']);
export const userRole = pgEnum('user_role', ['SUPER_ADMIN', 'ORG_ADMIN', 'DISPATCHER', 'DRIVER', 'VIEWER']);
export const shipmentStatus = pgEnum('shipment_status', ['CREATED', 'ASSIGNED', 'PICKED_UP', 'IN_TRANSIT', 'DELAYED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED', 'CANCELLED']);
export const locationSource = pgEnum('location_source', ['DEVICE', 'SIMULATOR']);
export const geofenceTransition = pgEnum('geofence_transition', ['ENTRY', 'EXIT']);
export const shipmentExceptionType = pgEnum('shipment_exception_type', ['OVERDUE_DELIVERY', 'MISSING_GPS', 'ROUTE_DEVIATION', 'DELAYED_PICKUP', 'MISSED_STOP', 'VEHICLE_INACTIVE']);
export const shipmentExceptionSeverity = pgEnum('shipment_exception_severity', ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export const shipmentExceptionStatus = pgEnum('shipment_exception_status', ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED']);
export const notificationType = pgEnum('notification_type', ['SHIPMENT_CREATED', 'SHIPMENT_ASSIGNED', 'GEOFENCE_ENTRY', 'GEOFENCE_EXIT', 'STOP_ARRIVED', 'STOP_DEPARTED', 'EXCEPTION_CREATED', 'EXCEPTION_ESCALATED']);

const pointGeometry = customType({ dataType: () => 'geometry(Point,4326)' });
const polygonGeometry = customType({ dataType: () => 'geometry(Polygon,4326)' });
const lineGeometry = customType({ dataType: () => 'geometry(LineString,4326)' });

export const organizations = pgTable('organizations', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 160 }).notNull(),
  slug: varchar('slug', { length: 80 }).notNull().unique(),
  status: organizationStatus('status').notNull().default('ACTIVE'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 120 }).notNull().default(''),
  email: varchar('email', { length: 320 }).notNull(),
  passwordHash: text('password_hash').notNull(),
  role: userRole('role').notNull().default('VIEWER'),
  status: varchar('status', { length: 16 }).notNull().default('ACTIVE'),
  sessionVersion: integer('session_version').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('users_org_email_unique').on(table.organizationId, table.email),
]);

export const refreshSessions = pgTable('refresh_sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  familyId: uuid('family_id').notNull(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('refresh_sessions_family_idx').on(table.familyId),
  index('refresh_sessions_user_idx').on(table.userId),
]);

export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('password_reset_tokens_user_idx').on(table.userId),
]);

export const driverProfiles = pgTable('driver_profiles', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
  phone: varchar('phone', { length: 32 }),
  licenseNumber: varchar('license_number', { length: 64 }).notNull(),
  licenseExpiresOn: date('license_expires_on'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('driver_profiles_org_license_unique').on(table.organizationId, table.licenseNumber),
  index('driver_profiles_org_idx').on(table.organizationId),
]);

export const vehicles = pgTable('vehicles', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  registrationNumber: varchar('registration_number', { length: 32 }).notNull(),
  make: varchar('make', { length: 80 }).notNull(),
  model: varchar('model', { length: 80 }).notNull(),
  vehicleType: varchar('vehicle_type', { length: 32 }).notNull(),
  capacityKg: integer('capacity_kg'),
  status: varchar('status', { length: 16 }).notNull().default('ACTIVE'),
  assignedDriverId: uuid('assigned_driver_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('vehicles_org_registration_unique').on(table.organizationId, table.registrationNumber),
  uniqueIndex('vehicles_driver_unique').on(table.assignedDriverId),
  index('vehicles_org_idx').on(table.organizationId),
]);

export const shipments = pgTable('shipments', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  trackingNumber: varchar('tracking_number', { length: 24 }).notNull().unique(),
  referenceNumber: varchar('reference_number', { length: 80 }),
  description: varchar('description', { length: 240 }).notNull(),
  recipientName: varchar('recipient_name', { length: 120 }).notNull(),
  recipientPhone: varchar('recipient_phone', { length: 32 }),
  pickupAddress: text('pickup_address').notNull(),
  deliveryAddress: text('delivery_address').notNull(),
  estimatedDeliveryAt: timestamp('estimated_delivery_at', { withTimezone: true }),
  status: shipmentStatus('status').notNull().default('CREATED'),
  driverId: uuid('driver_id').references(() => users.id, { onDelete: 'set null' }),
  vehicleId: uuid('vehicle_id').references(() => vehicles.id, { onDelete: 'set null' }),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('shipments_org_reference_unique').on(table.organizationId, table.referenceNumber),
  index('shipments_org_status_created_idx').on(table.organizationId, table.status, table.createdAt),
  index('shipments_driver_idx').on(table.driverId),
  uniqueIndex('shipments_active_driver_unique').on(table.driverId).where(sql`${table.status} in ('ASSIGNED', 'PICKED_UP', 'IN_TRANSIT', 'DELAYED', 'OUT_FOR_DELIVERY')`),
  uniqueIndex('shipments_active_vehicle_unique').on(table.vehicleId).where(sql`${table.status} in ('ASSIGNED', 'PICKED_UP', 'IN_TRANSIT', 'DELAYED', 'OUT_FOR_DELIVERY')`),
]);

export const shipmentStops = pgTable('shipment_stops', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  shipmentId: uuid('shipment_id').notNull().references(() => shipments.id, { onDelete: 'cascade' }),
  sequence: integer('sequence').notNull(),
  name: varchar('name', { length: 120 }).notNull(),
  address: text('address').notNull(),
  location: pointGeometry('location'),
  status: varchar('status', { length: 16 }).notNull().default('PENDING'),
  arrivedAt: timestamp('arrived_at', { withTimezone: true }),
  departedAt: timestamp('departed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('shipment_stops_sequence_unique').on(table.shipmentId, table.sequence),
  index('shipment_stops_org_shipment_idx').on(table.organizationId, table.shipmentId),
]);

export const shipmentEvents = pgTable('shipment_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  shipmentId: uuid('shipment_id').notNull().references(() => shipments.id, { onDelete: 'cascade' }),
  actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
  type: varchar('type', { length: 40 }).notNull(),
  fromStatus: shipmentStatus('from_status'),
  toStatus: shipmentStatus('to_status'),
  description: text('description').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('shipment_events_org_shipment_created_idx').on(table.organizationId, table.shipmentId, table.createdAt),
]);

export const shipmentLocations = pgTable('shipment_locations', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  shipmentId: uuid('shipment_id').notNull().references(() => shipments.id, { onDelete: 'cascade' }),
  vehicleId: uuid('vehicle_id').notNull().references(() => vehicles.id, { onDelete: 'cascade' }),
  driverId: uuid('driver_id').references(() => users.id, { onDelete: 'set null' }),
  sourceEventId: uuid('source_event_id').notNull(),
  source: locationSource('source').notNull(),
  latitude: doublePrecision('latitude').notNull(),
  longitude: doublePrecision('longitude').notNull(),
  accuracyMeters: doublePrecision('accuracy_meters'),
  speedKph: doublePrecision('speed_kph'),
  headingDegrees: integer('heading_degrees'),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('shipment_locations_org_event_unique').on(table.organizationId, table.sourceEventId),
  index('shipment_locations_org_shipment_recorded_idx').on(table.organizationId, table.shipmentId, table.recordedAt),
  index('shipment_locations_vehicle_recorded_idx').on(table.vehicleId, table.recordedAt),
]);

export const geofences = pgTable('geofences', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 120 }).notNull(),
  kind: varchar('kind', { length: 24 }).notNull().default('CUSTOM'),
  shape: varchar('shape', { length: 16 }).notNull(),
  center: pointGeometry('center'),
  radiusMeters: integer('radius_meters'),
  boundary: polygonGeometry('boundary').notNull(),
  active: boolean('active').notNull().default(true),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('geofences_org_idx').on(table.organizationId),
]);

export const geofenceStates = pgTable('geofence_states', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  geofenceId: uuid('geofence_id').notNull().references(() => geofences.id, { onDelete: 'cascade' }),
  shipmentId: uuid('shipment_id').notNull().references(() => shipments.id, { onDelete: 'cascade' }),
  vehicleId: uuid('vehicle_id').notNull().references(() => vehicles.id, { onDelete: 'cascade' }),
  isInside: boolean('is_inside').notNull().default(false),
  lastLocationId: uuid('last_location_id').references(() => shipmentLocations.id, { onDelete: 'set null' }),
  lastTransitionAt: timestamp('last_transition_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('geofence_states_org_fence_shipment_unique').on(table.organizationId, table.geofenceId, table.shipmentId),
  index('geofence_states_active_idx').on(table.organizationId, table.shipmentId, table.isInside),
]);

export const geofenceEvents = pgTable('geofence_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  geofenceId: uuid('geofence_id').notNull().references(() => geofences.id, { onDelete: 'cascade' }),
  shipmentId: uuid('shipment_id').notNull().references(() => shipments.id, { onDelete: 'cascade' }),
  vehicleId: uuid('vehicle_id').notNull().references(() => vehicles.id, { onDelete: 'cascade' }),
  locationId: uuid('location_id').notNull().references(() => shipmentLocations.id, { onDelete: 'cascade' }),
  transition: geofenceTransition('transition').notNull(),
  source: locationSource('source').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('geofence_events_location_transition_unique').on(table.geofenceId, table.shipmentId, table.locationId, table.transition),
  index('geofence_events_org_created_idx').on(table.organizationId, table.createdAt),
]);

export const shipmentRoutes = pgTable('shipment_routes', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  shipmentId: uuid('shipment_id').notNull().unique().references(() => shipments.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 120 }).notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index('shipment_routes_org_idx').on(table.organizationId)]);

export const routeVersions = pgTable('route_versions', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  routeId: uuid('route_id').notNull().references(() => shipmentRoutes.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  path: lineGeometry('path').notNull(),
  plannedDistanceMeters: doublePrecision('planned_distance_meters').notNull(),
  actualDistanceMeters: doublePrecision('actual_distance_meters').notNull().default(0),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('route_versions_route_version_unique').on(table.routeId, table.version),
  index('route_versions_org_created_idx').on(table.organizationId, table.createdAt),
]);

export const routeWaypoints = pgTable('route_waypoints', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  routeVersionId: uuid('route_version_id').notNull().references(() => routeVersions.id, { onDelete: 'cascade' }),
  shipmentStopId: uuid('shipment_stop_id').references(() => shipmentStops.id, { onDelete: 'set null' }),
  sequence: integer('sequence').notNull(),
  kind: varchar('kind', { length: 16 }).notNull(),
  name: varchar('name', { length: 120 }).notNull(),
  address: text('address').notNull(),
  location: pointGeometry('location').notNull(),
  radiusMeters: integer('radius_meters').notNull().default(150),
  status: varchar('status', { length: 16 }).notNull().default('PENDING'),
  arrivedAt: timestamp('arrived_at', { withTimezone: true }),
  departedAt: timestamp('departed_at', { withTimezone: true }),
}, (table) => [
  uniqueIndex('route_waypoints_version_sequence_unique').on(table.routeVersionId, table.sequence),
  index('route_waypoints_org_version_idx').on(table.organizationId, table.routeVersionId),
]);

export const shipmentExceptions = pgTable('shipment_exceptions', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  shipmentId: uuid('shipment_id').notNull().references(() => shipments.id, { onDelete: 'cascade' }),
  type: shipmentExceptionType('type').notNull(),
  severity: shipmentExceptionSeverity('severity').notNull(),
  status: shipmentExceptionStatus('status').notNull().default('OPEN'),
  conditionKey: varchar('condition_key', { length: 160 }).notNull().default('shipment'),
  description: text('description').notNull(),
  metadata: jsonb('metadata').notNull().default({}),
  detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  escalatedAt: timestamp('escalated_at', { withTimezone: true }),
  assignedTo: uuid('assigned_to').references(() => users.id, { onDelete: 'set null' }),
  resolutionNotes: text('resolution_notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('shipment_exceptions_org_status_created_idx').on(table.organizationId, table.status, table.createdAt),
  index('shipment_exceptions_org_shipment_idx').on(table.organizationId, table.shipmentId),
  uniqueIndex('shipment_exceptions_open_condition_unique').on(table.organizationId, table.shipmentId, table.type, table.conditionKey).where(sql`${table.status} in ('OPEN', 'ACKNOWLEDGED')`),
]);

export const notifications = pgTable('notifications', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  shipmentId: uuid('shipment_id').references(() => shipments.id, { onDelete: 'set null' }),
  type: notificationType('type').notNull(),
  title: varchar('title', { length: 160 }).notNull(),
  message: text('message').notNull(),
  idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull(),
  metadata: jsonb('metadata').notNull().default({}),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('notifications_user_idempotency_unique').on(table.organizationId, table.userId, table.idempotencyKey),
  index('notifications_user_unread_created_idx').on(table.organizationId, table.userId, table.readAt, table.createdAt),
]);

-- Phase 7 spatial tracking. The PostgreSQL server must have the PostGIS package
-- installed before this migration runs; the migration role must be able to create extensions.
CREATE EXTENSION IF NOT EXISTS postgis;

ALTER TABLE "shipment_stops"
  ADD COLUMN "location" geometry(Point,4326),
  ADD COLUMN "status" varchar(16) NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "arrived_at" timestamptz,
  ADD COLUMN "departed_at" timestamptz;

CREATE INDEX "shipment_stops_location_gix" ON "shipment_stops" USING GIST ("location");

CREATE TABLE "geofences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "name" varchar(120) NOT NULL,
  "kind" varchar(24) NOT NULL DEFAULT 'CUSTOM' CHECK ("kind" IN ('WAREHOUSE','DELIVERY','CUSTOM')),
  "shape" varchar(16) NOT NULL CHECK ("shape" IN ('CIRCLE','POLYGON')),
  "center" geometry(Point,4326),
  "radius_meters" integer,
  "boundary" geometry(Polygon,4326) NOT NULL,
  "active" boolean NOT NULL DEFAULT true,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CHECK (("shape" = 'CIRCLE' AND "center" IS NOT NULL AND "radius_meters" BETWEEN 25 AND 50000)
      OR ("shape" = 'POLYGON' AND "center" IS NULL AND "radius_meters" IS NULL)),
  CHECK (ST_IsValid("boundary"))
);
CREATE INDEX "geofences_org_idx" ON "geofences" ("organization_id");
CREATE INDEX "geofences_boundary_gix" ON "geofences" USING GIST ("boundary");

CREATE TABLE "geofence_states" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "geofence_id" uuid NOT NULL REFERENCES "geofences"("id") ON DELETE CASCADE,
  "shipment_id" uuid NOT NULL REFERENCES "shipments"("id") ON DELETE CASCADE,
  "vehicle_id" uuid NOT NULL REFERENCES "vehicles"("id") ON DELETE CASCADE,
  "is_inside" boolean NOT NULL DEFAULT false,
  "last_location_id" uuid REFERENCES "shipment_locations"("id") ON DELETE SET NULL,
  "last_transition_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("organization_id", "geofence_id", "shipment_id")
);
CREATE INDEX "geofence_states_active_idx" ON "geofence_states" ("organization_id", "shipment_id", "is_inside");

CREATE TYPE "geofence_transition" AS ENUM ('ENTRY','EXIT');
CREATE TABLE "geofence_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "geofence_id" uuid NOT NULL REFERENCES "geofences"("id") ON DELETE CASCADE,
  "shipment_id" uuid NOT NULL REFERENCES "shipments"("id") ON DELETE CASCADE,
  "vehicle_id" uuid NOT NULL REFERENCES "vehicles"("id") ON DELETE CASCADE,
  "location_id" uuid NOT NULL REFERENCES "shipment_locations"("id") ON DELETE CASCADE,
  "transition" "geofence_transition" NOT NULL,
  "source" "location_source" NOT NULL,
  "occurred_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("geofence_id", "shipment_id", "location_id", "transition")
);
CREATE INDEX "geofence_events_org_created_idx" ON "geofence_events" ("organization_id", "created_at");

CREATE TABLE "shipment_routes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "shipment_id" uuid NOT NULL UNIQUE REFERENCES "shipments"("id") ON DELETE CASCADE,
  "name" varchar(120) NOT NULL,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "shipment_routes_org_idx" ON "shipment_routes" ("organization_id");

CREATE TABLE "route_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "route_id" uuid NOT NULL REFERENCES "shipment_routes"("id") ON DELETE CASCADE,
  "version" integer NOT NULL CHECK ("version" > 0),
  "path" geometry(LineString,4326) NOT NULL,
  "planned_distance_meters" double precision NOT NULL CHECK ("planned_distance_meters" >= 0),
  "actual_distance_meters" double precision NOT NULL DEFAULT 0 CHECK ("actual_distance_meters" >= 0),
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("route_id", "version")
);
CREATE INDEX "route_versions_org_created_idx" ON "route_versions" ("organization_id", "created_at");
CREATE INDEX "route_versions_path_gix" ON "route_versions" USING GIST ("path");

CREATE TABLE "route_waypoints" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "route_version_id" uuid NOT NULL REFERENCES "route_versions"("id") ON DELETE CASCADE,
  "shipment_stop_id" uuid REFERENCES "shipment_stops"("id") ON DELETE SET NULL,
  "sequence" integer NOT NULL CHECK ("sequence" > 0),
  "kind" varchar(16) NOT NULL CHECK ("kind" IN ('PICKUP','STOP','DELIVERY')),
  "name" varchar(120) NOT NULL,
  "address" text NOT NULL,
  "location" geometry(Point,4326) NOT NULL,
  "radius_meters" integer NOT NULL DEFAULT 150 CHECK ("radius_meters" BETWEEN 25 AND 5000),
  "status" varchar(16) NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING','ARRIVED','COMPLETED')),
  "arrived_at" timestamptz,
  "departed_at" timestamptz,
  UNIQUE ("route_version_id", "sequence")
);
CREATE INDEX "route_waypoints_org_version_idx" ON "route_waypoints" ("organization_id", "route_version_id");
CREATE INDEX "route_waypoints_location_gix" ON "route_waypoints" USING GIST ("location");

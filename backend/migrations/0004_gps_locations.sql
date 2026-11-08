CREATE TYPE "location_source" AS ENUM ('DEVICE', 'SIMULATOR');

CREATE TABLE "shipment_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
	"shipment_id" uuid NOT NULL REFERENCES "shipments"("id") ON DELETE CASCADE,
	"vehicle_id" uuid NOT NULL REFERENCES "vehicles"("id") ON DELETE CASCADE,
	"driver_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"source_event_id" uuid NOT NULL,
	"source" "location_source" NOT NULL,
	"latitude" double precision NOT NULL CHECK ("latitude" >= -90 AND "latitude" <= 90),
	"longitude" double precision NOT NULL CHECK ("longitude" >= -180 AND "longitude" <= 180),
	"accuracy_meters" double precision CHECK ("accuracy_meters" IS NULL OR "accuracy_meters" >= 0),
	"speed_kph" double precision CHECK ("speed_kph" IS NULL OR "speed_kph" >= 0),
	"heading_degrees" integer CHECK ("heading_degrees" IS NULL OR ("heading_degrees" >= 0 AND "heading_degrees" <= 359)),
	"recorded_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "shipment_locations_org_event_unique" ON "shipment_locations" ("organization_id", "source_event_id");
CREATE INDEX "shipment_locations_org_shipment_recorded_idx" ON "shipment_locations" ("organization_id", "shipment_id", "recorded_at");
CREATE INDEX "shipment_locations_vehicle_recorded_idx" ON "shipment_locations" ("vehicle_id", "recorded_at");

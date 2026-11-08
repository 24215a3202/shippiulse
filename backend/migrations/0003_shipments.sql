CREATE TYPE "shipment_status" AS ENUM ('CREATED', 'ASSIGNED', 'PICKED_UP', 'IN_TRANSIT', 'DELAYED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED', 'CANCELLED');

CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
	"tracking_number" varchar(24) NOT NULL UNIQUE,
	"reference_number" varchar(80),
	"description" varchar(240) NOT NULL,
	"recipient_name" varchar(120) NOT NULL,
	"recipient_phone" varchar(32),
	"pickup_address" text NOT NULL,
	"delivery_address" text NOT NULL,
	"estimated_delivery_at" timestamp with time zone,
	"status" "shipment_status" DEFAULT 'CREATED' NOT NULL,
	"driver_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"vehicle_id" uuid REFERENCES "vehicles"("id") ON DELETE SET NULL,
	"created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "shipments_org_reference_unique" ON "shipments" ("organization_id", "reference_number");
CREATE INDEX "shipments_org_status_created_idx" ON "shipments" ("organization_id", "status", "created_at");
CREATE INDEX "shipments_driver_idx" ON "shipments" ("driver_id");
CREATE UNIQUE INDEX "shipments_active_driver_unique" ON "shipments" ("driver_id") WHERE "status" IN ('ASSIGNED', 'PICKED_UP', 'IN_TRANSIT', 'DELAYED', 'OUT_FOR_DELIVERY');
CREATE UNIQUE INDEX "shipments_active_vehicle_unique" ON "shipments" ("vehicle_id") WHERE "status" IN ('ASSIGNED', 'PICKED_UP', 'IN_TRANSIT', 'DELAYED', 'OUT_FOR_DELIVERY');

CREATE TABLE "shipment_stops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
	"shipment_id" uuid NOT NULL REFERENCES "shipments"("id") ON DELETE CASCADE,
	"sequence" integer NOT NULL,
	"name" varchar(120) NOT NULL,
	"address" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "shipment_stops_sequence_unique" ON "shipment_stops" ("shipment_id", "sequence");
CREATE INDEX "shipment_stops_org_shipment_idx" ON "shipment_stops" ("organization_id", "shipment_id");

CREATE TABLE "shipment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
	"shipment_id" uuid NOT NULL REFERENCES "shipments"("id") ON DELETE CASCADE,
	"actor_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"type" varchar(40) NOT NULL,
	"from_status" "shipment_status",
	"to_status" "shipment_status",
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "shipment_events_org_shipment_created_idx" ON "shipment_events" ("organization_id", "shipment_id", "created_at");

CREATE FUNCTION reject_shipment_event_mutation() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'Shipment event history is immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER shipment_events_immutable
BEFORE UPDATE OR DELETE ON "shipment_events"
FOR EACH ROW EXECUTE FUNCTION reject_shipment_event_mutation();

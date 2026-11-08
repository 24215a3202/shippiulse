CREATE TYPE "shipment_exception_type" AS ENUM (
  'OVERDUE_DELIVERY', 'MISSING_GPS', 'ROUTE_DEVIATION', 'DELAYED_PICKUP', 'MISSED_STOP', 'VEHICLE_INACTIVE'
);
CREATE TYPE "shipment_exception_severity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "shipment_exception_status" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED');

CREATE TABLE "shipment_exceptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "shipment_id" uuid NOT NULL REFERENCES "shipments"("id") ON DELETE CASCADE,
  "type" "shipment_exception_type" NOT NULL,
  "severity" "shipment_exception_severity" NOT NULL,
  "status" "shipment_exception_status" NOT NULL DEFAULT 'OPEN',
  "condition_key" varchar(160) NOT NULL DEFAULT 'shipment',
  "description" text NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "detected_at" timestamptz NOT NULL DEFAULT now(),
  "last_seen_at" timestamptz NOT NULL DEFAULT now(),
  "resolved_at" timestamptz,
  "assigned_to" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "resolution_notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CHECK ("condition_key" <> '')
);

CREATE INDEX "shipment_exceptions_org_status_created_idx"
  ON "shipment_exceptions" ("organization_id", "status", "created_at" DESC);
CREATE INDEX "shipment_exceptions_org_shipment_idx"
  ON "shipment_exceptions" ("organization_id", "shipment_id");
CREATE UNIQUE INDEX "shipment_exceptions_open_condition_unique"
  ON "shipment_exceptions" ("organization_id", "shipment_id", "type", "condition_key")
  WHERE "status" IN ('OPEN', 'ACKNOWLEDGED');

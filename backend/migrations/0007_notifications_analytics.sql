CREATE TYPE "notification_type" AS ENUM (
  'SHIPMENT_CREATED', 'SHIPMENT_ASSIGNED', 'GEOFENCE_ENTRY', 'GEOFENCE_EXIT',
  'STOP_ARRIVED', 'STOP_DEPARTED', 'EXCEPTION_CREATED', 'EXCEPTION_ESCALATED'
);

ALTER TABLE "shipment_exceptions" ADD COLUMN "escalated_at" timestamptz;

CREATE TABLE "notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "shipment_id" uuid REFERENCES "shipments"("id") ON DELETE SET NULL,
  "type" "notification_type" NOT NULL,
  "title" varchar(160) NOT NULL,
  "message" text NOT NULL,
  "idempotency_key" varchar(128) NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "read_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "notifications_user_idempotency_unique"
  ON "notifications" ("organization_id", "user_id", "idempotency_key");
CREATE INDEX "notifications_user_unread_created_idx"
  ON "notifications" ("organization_id", "user_id", "read_at", "created_at" DESC);

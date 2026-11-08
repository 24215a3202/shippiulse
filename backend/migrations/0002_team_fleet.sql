CREATE TABLE "driver_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
	"user_id" uuid NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
	"phone" varchar(32),
	"license_number" varchar(64) NOT NULL,
	"license_expires_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "driver_profiles_org_license_unique" ON "driver_profiles" ("organization_id", "license_number");
CREATE INDEX "driver_profiles_org_idx" ON "driver_profiles" ("organization_id");

CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
	"registration_number" varchar(32) NOT NULL,
	"make" varchar(80) NOT NULL,
	"model" varchar(80) NOT NULL,
	"vehicle_type" varchar(32) NOT NULL,
	"capacity_kg" integer,
	"status" varchar(16) DEFAULT 'ACTIVE' NOT NULL,
	"assigned_driver_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "vehicles_org_registration_unique" ON "vehicles" ("organization_id", "registration_number");
CREATE UNIQUE INDEX "vehicles_driver_unique" ON "vehicles" ("assigned_driver_id");
CREATE INDEX "vehicles_org_idx" ON "vehicles" ("organization_id");

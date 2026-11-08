# Database setup

ShipPulse uses PostgreSQL and Drizzle ORM. Migrations create organization and user tables, authentication sessions and reset tokens, driver profiles, organization-scoped vehicles, shipments, intermediate stops, immutable shipment events, GPS location history, geofences, and route history. Phase 7 uses PostGIS geometry columns and GiST spatial indexes for geofences, stops, and route shapes. Driver profiles extend driver accounts with license and contact details; vehicle records enforce unique registrations per organization and a single vehicle assignment per driver. Partial indexes limit each driver and vehicle to one active shipment. GPS coordinates have database range checks and idempotency keys are unique within an organization. SQL migrations are versioned in `backend/migrations` and applied by Drizzle's PostgreSQL migrator.

1. Install PostgreSQL for Windows. For Phase 7, also install the PostGIS server extension built for the same PostgreSQL major version. Having PostGIS client libraries or a GUI add-in alone is not sufficient.
2. Create a local database and a dedicated application role. Keep the password private.
3. Copy `.env.example` to `.env` and set `DATABASE_URL` to that database and role.
4. From the project root, run `npm run db:migrate`.

Before applying migration `0005_geospatial.sql`, connect to the target database as an administrator and enable PostGIS (`CREATE EXTENSION postgis;`). The migration also contains this statement, but the application database role may not have permission to create extensions. After the server extension is installed and enabled, run `npm run db:migrate` as usual. The API uses GeoJSON for spatial input and output; circles are buffered in meters using geography coordinates.

Migration `0006_exceptions.sql` creates tenant-owned shipment exceptions with status, severity, operator assignment, timestamps, resolution notes, and condition metadata. A partial unique index prevents duplicate unresolved records for the same condition while retaining historical resolved and dismissed records. It follows the Phase 7 migration because route deviation and missed-stop detection use the PostGIS route tables.

Migration `0007_notifications_analytics.sql` adds user-scoped in-app notification records and an idempotency index for BullMQ retries. Analytics read the existing shipment, shipment-event, vehicle, and user tables and do not rely on stored or hardcoded metric totals.

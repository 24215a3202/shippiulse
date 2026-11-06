# Database setup

ShipPulse uses PostgreSQL and Drizzle ORM. The foundation migration creates organization and user tables, enums, a foreign key, and an organization-scoped email index. PostGIS is enabled in the geospatial phase, when route and geofence tables are introduced. SQL migrations are versioned in `backend/migrations` and applied by Drizzle's PostgreSQL migrator.

1. Install PostgreSQL for Windows.
2. Create a local database and a dedicated application role. Keep the password private.
3. Copy `.env.example` to `.env` and set `DATABASE_URL` to that database and role.
4. From the project root, run `npm run db:migrate`.

When the geospatial phase begins, install PostGIS for the same PostgreSQL major version. Have an administrator enable the extension in the database before applying that phase's migration, then grant the application role only the permissions it needs.

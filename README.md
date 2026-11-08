# ShipPulse

ShipPulse is a JavaScript logistics operations platform. The monorepo includes the service foundation, organization authentication, team and fleet management, shipment operations, GPS tracking, live tracking, geofences, and versioned shipment routes.

## Requirements

- Node.js 22.12 or newer (developed with Node.js 24.19.0 and npm 11.17.0)
- PostgreSQL 18 with the PostGIS server extension installed for Phase 7
- Redis 6 or newer

Docker is not required.

## Local setup (PowerShell)

```powershell
npm install
Copy-Item .env.example .env
```

Edit `.env` with the credentials for a PostgreSQL database and user you control. Then apply the database migration and start the web app and API:

```powershell
npm run db:migrate
npm run dev
```

Open <http://localhost:5173>. The API runs at <http://127.0.0.1:3001>; `GET /health` checks PostgreSQL and Redis.

## Useful commands

```powershell
npm run check
npm run build
npm run db:migrate
```

See [architecture](docs/architecture.md), [database setup](docs/database.md), [security](docs/security.md), and the [production deployment guide](docs/deployment.md).

## Current scope

Phase 1 provides the JavaScript workspaces, React/Vite shell, Express API, validated configuration, PostgreSQL/Drizzle schema and migration, Redis connection, and dependency-aware health endpoint. Phase 2 adds organization registration, login, rotating sessions, CSRF checks, password reset, tenant-scoped identity checks, and role-aware middleware. Phase 3 adds team accounts, driver profiles, fleet records, and driver-to-vehicle assignment. Phase 4 adds shipment creation, search, pagination, details, stops, dispatch assignment, a constrained status workflow, and immutable event history. Phase 5 adds authenticated GPS updates, de-duplication, stale and out-of-order handling, location history and latest positions, plus a development-only simulator marked as simulated data. Phase 6 adds authenticated Socket.IO subscriptions and a live MapLibre tracking view. Phase 7 adds PostGIS-backed circle and polygon geofences, entry and exit events, ordered route versions, stop arrival and departure tracking, and planned and device-recorded distance. Phase 8 adds scheduled delay, GPS inactivity, route deviation, missed stop, and inactive vehicle checks with an operator exception queue. Phases 7 and 8 require PostGIS and their database migrations before runtime verification. See [API documentation](docs/api.md), [database setup](docs/database.md), and [project progress](docs/project-progress.md).

Phase 9 adds BullMQ-backed in-app notifications, realtime notification delivery, and database-derived shipment, driver, and vehicle analytics. Run `npm run dev` to start the API, frontend, and notification worker together. Phases 7 through 9 depend on the ordered database migrations; geospatial detection requires PostGIS.

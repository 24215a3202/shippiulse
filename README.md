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

## What ShipPulse covers

ShipPulse gives logistics teams one operational view of their shipments, vehicles, drivers, and delivery exceptions. The platform combines:

- Organization-aware authentication with rotating sessions, CSRF protection, password reset flows, and role-based access.
- Team and fleet administration, including driver profiles, vehicles, and driver-to-vehicle assignments.
- Shipment workflows with stops, dispatch assignment, pagination, constrained status transitions, and immutable event history.
- Live GPS tracking with authenticated updates, stale-location handling, location history, and realtime MapLibre visualization.
- PostGIS-powered geofences, route versions, stop arrival and departure tracking, and route-distance comparisons.
- Automated exception detection for delays, GPS inactivity, route deviation, missed stops, and inactive vehicles.
- In-app notifications, realtime delivery, and database-derived shipment, driver, and vehicle analytics.

Run `npm run dev` to start the API, frontend, and notification worker together. PostGIS is required for geospatial detection, and the database migrations must be applied before runtime verification. See the [API documentation](docs/api.md), [database setup](docs/database.md), and [project progress](docs/project-progress.md) for implementation details.

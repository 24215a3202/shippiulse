# ShipPulse

ShipPulse is a JavaScript logistics operations platform. The monorepo now includes the service foundation and Phase 2 organization authentication; shipment workflows and operational screens follow in later phases.

## Requirements

- Node.js 22.12 or newer (developed with Node.js 24.19.0 and npm 11.17.0)
- PostgreSQL 18 (PostGIS is installed in the geospatial phase)
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

See [architecture](docs/architecture.md), [database setup](docs/database.md), and [security](docs/security.md).

## Current scope

Phase 1 provides the JavaScript workspaces, React/Vite shell, Express API, validated configuration, PostgreSQL/Drizzle schema and migration, Redis connection, and dependency-aware health endpoint. Phase 2 adds organization registration, login, rotating sessions, CSRF checks, password reset, tenant-scoped identity checks, and role-aware middleware. See [authentication API](docs/api.md). The login and registration screens are still pending.

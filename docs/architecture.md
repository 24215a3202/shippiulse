# ShipPulse architecture

## Phase 1 foundation

ShipPulse is a JavaScript npm-workspaces monorepo. The React/Vite web app runs separately from the Express API during local development. The API owns all data access; PostgreSQL is the system of record, Drizzle defines the schema and runs SQL migrations, and Redis is the shared store for later background work. PostGIS is added with the geospatial phase. No service is containerized.

```text
Browser (React + Vite :5173)
        │ HTTP / JSON
Express API (:3001) ─── PostgreSQL 18 (:5432)
        └────────────── Redis (:6379)
```

The API health endpoint checks PostgreSQL and Redis and returns HTTP 503 with per-service status if either dependency is unavailable. The web interface is still a foundation screen; authentication UI wiring is pending.

## Tenant data foundation

Organizations and users are tenant-owned tables. User rows carry a required organization foreign key and a unique `(organization_id, email)` index. Registration creates an organization and its first administrator in one transaction. Authentication resolves membership from PostgreSQL on each protected request and checks the stored user and organization status; the organization ID in a signed token must match the user's stored membership. Refresh-token families and password-reset tokens are stored only as SHA-256 digests. The Vite `/api` proxy keeps local cookie authentication on the same site.

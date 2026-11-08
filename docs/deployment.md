# Production deployment

ShipPulse runs as three deployable parts: a static React frontend, the Express API, and a separate notification worker. PostgreSQL with PostGIS and Redis are managed services shared by the API and worker. This repository does not include provider-specific deployment files, so use the commands below in the hosting provider's build and start settings.

## Services

| Service | Build command | Start command |
| --- | --- | --- |
| Frontend static site | `npm ci && npm run build` | Serve `frontend/dist` |
| API web service | `npm ci` | `npm run dev:backend` is for development; use `npm --workspace backend run start` in production |
| Notification worker | `npm ci` | `npm run dev:worker` is for development; use `npm --workspace backend run worker` in production |

The API reads the hosting platform's `PORT` when `API_PORT` is not set. In production it binds to `0.0.0.0` by default. A custom `API_HOST` or `API_PORT` can override these defaults.

## Required production settings

Set these values in the API service's secret/environment settings. Set the same `DATABASE_URL` and `REDIS_URL` for the worker.

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `WEB_ORIGIN` | Exact public frontend origin, including `https://` and no trailing path |
| `DATABASE_URL` | Private connection URL for PostgreSQL with PostGIS enabled |
| `DATABASE_SSL` | `true` when the provider requires TLS; install/configure its CA if certificate verification needs it |
| `REDIS_URL` | Private Redis connection URL; use `rediss://` for TLS providers |
| `ACCESS_TOKEN_SECRET` | Independently generated secret with at least 32 characters |
| `REFRESH_TOKEN_SECRET` | A different independently generated secret with at least 32 characters |
| `SMTP_URL` | Authenticated SMTP connection URL for password reset messages |
| `SMTP_FROM` | Verified sender, for example `ShipPulse <no-reply@example.com>` |

Keep secrets in the hosting provider's secret store. Do not commit `.env`, production URLs, database credentials, SMTP credentials, or token secrets.

## Release sequence

1. Create the managed PostgreSQL database and application role. Enable the PostGIS server extension in the `shippulse` database as its database administrator.
2. Create managed Redis with TLS where supported. Restrict database and Redis network access to the API and worker services.
3. Configure the API and worker environment values above. Use distinct API and worker processes; the worker does not serve HTTP.
4. Before switching traffic to a release, run `npm run db:migrate` once against the target database. Do not run migrations concurrently from every API instance.
5. Build and publish the frontend static output. Route `/api/*` and `/socket.io/*` through the frontend site's same-origin proxy to the API, or use a single-origin reverse proxy. The browser app uses relative API paths and cookie-based sessions.
6. Deploy the API and worker. Configure the platform health check as `GET /health`; it returns `200` only when PostgreSQL and Redis respond.
7. Confirm the frontend loads, sign-in and password reset email work, and a shipment can be created and tracked before directing users to the release.

## Operations

- Back up PostgreSQL with the managed provider's automated backups and confirm restore procedures. The database contains organizations, user accounts, shipment histories, and location records.
- Monitor API and worker logs, `/health`, Redis queue failures, SMTP delivery, and database storage/connection usage.
- Keep at least one API instance available while the worker runs. BullMQ retries transient notification failures; inspect and reprocess persistent failures through the queue operations provided by your Redis host or a future admin tool.
- Keep PostGIS enabled during database upgrades. Apply migrations in order and take a backup before schema changes.
- Set exception thresholds through the `EXCEPTION_*` environment variables documented in `.env.example` when operating at a different scale.

See [security](security.md), [database setup](database.md), and [API behavior](api.md) for additional details.

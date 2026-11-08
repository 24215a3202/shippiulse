# Authentication API

All routes are served under `/api/auth`. Request bodies are JSON. Email addresses and organization slugs are normalized to lowercase.

| Method and path | Purpose | Authentication |
| --- | --- | --- |
| `POST /register` | Create an organization and its first organization administrator; starts a session | Public, rate limited |
| `POST /login` | Sign in with organization slug, email, and password | Public, rate limited |
| `POST /refresh` | Rotate the refresh token and issue a new access token | Refresh cookie and CSRF header |
| `POST /logout` | Revoke the current refresh-token family and clear cookies | CSRF header |
| `GET /me` | Return the authenticated user and their organization | Access cookie |
| `POST /password/forgot` | Prepare a password reset; production sends an email | Public, rate limited |
| `POST /password/reset` | Consume a one-time reset token, update the password, and revoke sessions | One-time reset token |

The tenant-scoped organization profile is available at `GET /api/organizations/me`. Organization name or slug can be changed with `PATCH /api/organizations/me`; the endpoint requires an authenticated organization administrator (or super administrator), a CSRF header, and only updates the organization in the signed-in session.

## Team and fleet API

All team routes use `/api/team`; all vehicle routes use `/api/fleet`. Writes require the CSRF header. Team management writes require an organization administrator. Vehicle management and driver/vehicle reads are available to organization administrators and dispatchers.

| Method and path | Purpose | Access |
| --- | --- | --- |
| `GET /api/team/users` | List up to 200 organization members, including driver profile details when present | Organization administrator |
| `POST /api/team/users` | Create an organization admin, dispatcher, or viewer account | Organization administrator |
| `PATCH /api/team/users/:userId` | Change a member's role or activate/deactivate the account | Organization administrator; cannot edit own account or a super admin |
| `GET /api/team/drivers` | List driver accounts and license details | Organization admin or dispatcher |
| `POST /api/team/drivers` | Create a driver account and profile together | Organization administrator |
| `GET /api/fleet/vehicles` | List organization vehicles with current driver assignment | Organization admin or dispatcher |
| `POST /api/fleet/vehicles` | Register a vehicle | Organization admin or dispatcher |
| `PATCH /api/fleet/vehicles/:vehicleId` | Assign/unassign an active organization driver or change vehicle status | Organization admin or dispatcher |

New team accounts require a temporary password of at least 12 characters; administrators should share it through a secure channel. Users can set their own password through the password-recovery flow. Driver license numbers and vehicle registration numbers are unique within the organization. A driver can be assigned to only one vehicle at a time. Deactivating a driver releases their vehicle. Data reads and writes are constrained to the signed-in organization.

## Shipment API

All shipment routes use `/api/shipments` and are organization-scoped. Organization admins, dispatchers, and super admins can create and dispatch shipments. Other authenticated users can read shipment records; drivers only see shipments assigned to their account.

| Method and path | Purpose |
| --- | --- |
| `GET /api/shipments?q=&status=&page=&limit=` | Search and filter shipments with pagination |
| `POST /api/shipments` | Create a shipment and optional intermediate stops; the API generates the tracking number |
| `GET /api/shipments/:shipmentId` | View shipment details, stops, allowed next statuses, and event history |
| `PATCH /api/shipments/:shipmentId` | Edit details and intermediate stops before pickup |
| `PATCH /api/shipments/:shipmentId/assignment` | Assign an active organization driver and vehicle, or clear both before pickup |
| `POST /api/shipments/:shipmentId/status` | Apply a permitted status transition with an optional history note |

Status transitions are enforced on the server. Creation begins at `CREATED`; dispatch moves it to `ASSIGNED`. The allowed progression is `ASSIGNED` → `PICKED_UP` → `IN_TRANSIT`, followed by `DELAYED`, `OUT_FOR_DELIVERY`, `DELIVERED`, or `FAILED` as appropriate. Created or assigned shipments may be cancelled. Event rows are append-only and protected against database updates and deletes. A driver or vehicle cannot be attached to more than one active shipment.

Organization registration requires an organization name and slug, a user name, an email, and a password of at least 12 characters and no more than 72 UTF-8 bytes. Registration grants the initial account the organization administrator role; public registration cannot choose its role. Duplicate organization slugs return a conflict response.

The API sets an HttpOnly access cookie and an HttpOnly refresh cookie. A separate readable CSRF cookie is paired with the `X-CSRF-Token` header on refresh and logout requests. Refresh tokens rotate on use; replaying a revoked token revokes its whole session family. Password reset tokens are stored as SHA-256 digests and expire after 30 minutes.

In local development, when SMTP is not configured, a successful password-reset request includes `developmentToken` in its response so the flow can be exercised. Production requires SMTP configuration and never returns that token. The forgot-password message is otherwise the same whether or not the account exists.

The API returns errors as `{ "error": { "code": "...", "message": "..." } }`. Validation errors can also include a `fields` object. Cookie authentication depends on serving the web UI and API on the same site; the Vite development proxy handles this locally.

## GPS tracking API

All routes use `/api/tracking` and require an authenticated session. Drivers may submit device GPS updates for shipments and vehicles currently assigned to them. Organization admins and dispatchers can view tracking positions and history. The simulator endpoint is available only outside production.

| Method and path | Purpose | Access |
| --- | --- | --- |
| `GET /api/tracking` | List active assigned shipments and their latest known positions and signal freshness | Authenticated user; drivers see only their assigned shipments |
| `GET /api/tracking/:shipmentId/history?limit=` | Read chronological location history, up to 500 points | Authenticated user; drivers see only their assigned shipments |
| `POST /api/tracking/locations` | Submit an authenticated device location update | Assigned driver, CSRF header required |
| `POST /api/tracking/simulate/:shipmentId` | Generate clearly labeled route points between provided coordinates | Organization admin or dispatcher, development only |

Device updates include a unique `sourceEventId`, shipment and vehicle IDs, latitude, longitude, and ISO timestamp. The API rejects out-of-range coordinates, timestamps more than five minutes in the future, updates older than 24 hours, inactive vehicles, and submissions from a driver who is not assigned to that active shipment. Repeated event IDs are acknowledged as duplicates. Out-of-order points are retained in history, while the latest position is selected by recorded time. Signal labels are `LIVE` (within two minutes), `DELAYED` (within five minutes), `STALE` (older), or `NO_SIGNAL`.

The simulator accepts start/end coordinates and generates interpolated points marked `SIMULATOR`. These are demonstration data and must not be interpreted as vehicle telemetry.

## Geofences and route API (Phase 7)

These endpoints require the Phase 7 migration and the PostGIS server extension. Reads are organization-scoped; drivers can read only routes and events for shipments assigned to them.

| Method and path | Purpose | Access |
| --- | --- | --- |
| `GET /api/geofences?includeInactive=true` | List organization geofences with GeoJSON boundaries | Authenticated user |
| `POST /api/geofences` | Create a circle (`center`, `radiusMeters`) or polygon (`coordinates` as `[longitude, latitude]` pairs) | Admin or dispatcher; CSRF header |
| `PATCH /api/geofences/:geofenceId` | Change a geofence name or active state | Admin or dispatcher; CSRF header |
| `GET /api/geofences/events?shipmentId=` | Read geofence entry/exit history | Authenticated user |
| `POST /api/routes/:shipmentId` | Save a new ordered route version with at least two waypoints | Admin or dispatcher; CSRF header |
| `GET /api/routes/:shipmentId` | Read route versions, planned/actual distances, and waypoint progress | Authenticated user |
| `GET /api/routes/:shipmentId/history` | Read stop and geofence events from the shipment timeline | Authenticated user |

Route waypoints use `PICKUP`, `STOP`, or `DELIVERY` and may link to an existing shipment stop. Planned distance sums straight-line segments in meters; it does not use road networks, traffic, or an optimization engine. Actual distance accumulates only from ordered device GPS points, not simulator points. GPS ingestion records geofence entry/exit and stop arrival/departure transitions transactionally and publishes `geofence:transition` and `stop:updated` realtime events. Circle radii use meter-based PostGIS geography buffers; polygon boundaries must be closed and valid.

## Exception engine (Phase 8)

All routes use `/api/exceptions`. The scheduled scanner runs at the configured interval and takes a PostgreSQL advisory lock so only one scanner instance evaluates conditions at a time. One active record is maintained for each continuing condition. Exceptions are automatically resolved after a scan confirms the condition has cleared.

| Method and path | Purpose | Access |
| --- | --- | --- |
| `GET /api/exceptions?status=&type=&severity=&shipmentId=&limit=` | List exceptions, defaulting to open and acknowledged records | Authenticated user; drivers see assigned shipments only |
| `POST /api/exceptions/scan` | Run a scan immediately | Admin or dispatcher; CSRF header |
| `PATCH /api/exceptions/:exceptionId` | Assign to an organization operator, acknowledge, resolve, or dismiss with resolution notes | Admin or dispatcher; CSRF header |

The scanner checks overdue delivery estimates, assignment-to-pickup delay, missing device GPS, inactive assigned vehicles, route distance deviation, and pending stops on active delivery routes. High and critical conditions are escalated once if still open after `EXCEPTION_ESCALATION_MINUTES`. It ignores simulated GPS when checking device signal and route deviation. Threshold defaults are configurable using `EXCEPTION_SCAN_INTERVAL_SECONDS`, `EXCEPTION_DELIVERY_GRACE_MINUTES`, `EXCEPTION_PICKUP_DELAY_MINUTES`, `EXCEPTION_MISSING_GPS_MINUTES`, `EXCEPTION_ROUTE_DEVIATION_METERS`, `EXCEPTION_STOP_DELAY_MINUTES`, and `EXCEPTION_ESCALATION_MINUTES` in `.env`. Route deviation checks need the Phase 7 PostGIS schema.

New and changed records publish `exception:created` and `exception:updated` after their database transaction commits. Exception records preserve severity, detection and last-seen times, assignment, condition metadata, status, and operator resolution notes.

## Realtime Socket.IO events

The Socket.IO server is available at `/socket.io` on the API origin. The local Vite server proxies both API requests and Socket.IO upgrades. Connections authenticate with the existing HttpOnly access cookie; unauthenticated, expired, or revoked sessions are disconnected. The server rechecks sessions and disconnects sockets after account role or organization changes.

Clients request read-only subscriptions with `tracking:subscribe` and `{ "scope": "organization" }` or `{ "scope": "assigned" }`. Organization scope is available to non-driver users and is limited to that organization. Drivers may request assigned scope only; the server joins only their active shipment rooms. `shipment:subscribe` accepts a shipment ID and checks organization and driver assignment before joining. Clients cannot publish server event names.

The server broadcasts `shipment:created`, `shipment:updated`, `shipment:assigned`, and `tracking:location` after the corresponding database write commits. Dispatchers and viewers receive organization updates; drivers receive only their assigned shipment updates. The live map uses the OpenStreetMap standard raster tiles with visible attribution. Follow the [OpenStreetMap tile usage policy](https://operations.osmfoundation.org/policies/tiles/) and use an appropriate hosted tile provider for larger production traffic.

## Notifications and analytics (Phase 9)

Notification events are queued through BullMQ and persisted by the separate `npm run worker` process. The worker retries transient failures with exponential backoff. The API publishes newly persisted in-app notifications to the recipient's authenticated Socket.IO user room. An unresolved high or critical exception emits one escalation notification after its configured threshold.

| Method and path | Purpose | Access |
| --- | --- | --- |
| `GET /api/notifications?unreadOnly=&limit=` | Read the signed-in user's notification feed and unread count | Authenticated user |
| `PATCH /api/notifications/:notificationId/read` | Mark one notification as read | Owner only; CSRF header |
| `POST /api/notifications/read-all` | Mark all of the current user's notifications as read | Owner only; CSRF header |
| `GET /api/analytics/overview?from=&to=&driverId=&vehicleId=&status=` | Shipment KPIs and daily volume trend | Authenticated user; drivers limited to their shipments |
| `GET /api/analytics/performance?from=&to=&driverId=&vehicleId=&status=` | Driver and vehicle outcome breakdown | Authenticated user; drivers limited to their shipments |

Analytics use organization-scoped shipment, vehicle, driver, and shipment-event records. The default period is the last 30 days. On-time rate uses delivered shipments with an estimated delivery time; delivery duration uses the recorded delivery event. Redis must be available and `npm run worker` must run for queued notifications to be persisted. Migration `0007_notifications_analytics.sql` follows the Phase 7 and 8 database migrations.

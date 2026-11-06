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

Registration requires an organization name and slug, a user name, an email, and a password of at least 12 characters and no more than 72 UTF-8 bytes. Organization administrators are created only by registration; the browser cannot choose its role. Duplicate organization slugs return a conflict response.

The API sets an HttpOnly access cookie and an HttpOnly refresh cookie. A separate readable CSRF cookie is paired with the `X-CSRF-Token` header on refresh and logout requests. Refresh tokens rotate on use; replaying a revoked token revokes its whole session family. Password reset tokens are stored as SHA-256 digests and expire after 30 minutes.

In local development, when SMTP is not configured, a successful password-reset request includes `developmentToken` in its response so the flow can be exercised. Production requires SMTP configuration and never returns that token. The forgot-password message is otherwise the same whether or not the account exists.

The API returns errors as `{ "error": { "code": "...", "message": "..." } }`. Validation errors can also include a `fields` object. Cookie authentication depends on serving the web UI and API on the same site; the Vite development proxy handles this locally.

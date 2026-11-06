# Security foundation

- Runtime settings are validated before the API starts; secrets come from environment variables and `.env` is ignored by Git.
- HTTP security headers are enabled with Helmet, JSON request bodies are size-limited, and logs redact authorization and cookie headers.
- CORS is restricted to the configured web origin.
- Health responses reveal dependency status only; they do not return connection details or credentials.
- Passwords are represented only by a `password_hash` field in the schema. Password hashing and authentication are implemented in Phase 2 before account flows are exposed.
- Tenant isolation is a required authorization rule for all future data access; the initial foreign key is only a schema invariant.
- Passwords use bcrypt hashing. Access and rotating refresh tokens are signed with independent secrets; only a SHA-256 digest of each refresh or reset token is stored.
- Authentication cookies are HttpOnly, SameSite=Strict, and Secure in production. State-changing session operations require a matching CSRF cookie and request header.
- Account creation, login, refresh, and password reset requests are rate limited. Password reset responses do not disclose account existence in production; local development exposes a one-time reset token when no SMTP server is configured.
- Production startup requires separate access and refresh secrets plus SMTP settings for password reset email.

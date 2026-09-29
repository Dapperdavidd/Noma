# Architecture decisions

## Modular monolith

One stateless Actix process owns business rules and PostgreSQL transactions. React consumes versioned REST endpoints. Keep domain boundaries within this deployment until independent scaling or team ownership warrants a split. SQLx uses parameter-bound SQL and a bounded connection pool; no ORM-generated query surprises or unbounded catalog downloads.

The frontend separates route screens, shared presentation components, authentication state and the API client. Screens are not a source of authorization. The backend verifies ownership on every write and resolves role from the database for every authenticated request.

## Data integrity

UUID identifiers are opaque. User and agent authentication are shared; agent profiles are separate. Prices use integer naira with bounds safe for JSON clients. Rental period is explicit, avoiding ambiguity between daily, monthly and annual amounts. Foreign keys enforce state/city/area consistency. Image order and one cover per property are unique database constraints. Images live outside PostgreSQL.

Agent verification and listing verification are independent. Editing listing details clears property verification. Publishing does not confer verification. Listings become drafts, active, sold, rented, expired or suspended rather than disappearing. Only admins can suspend or unsuspend.

## Search

Public queries always require active status. PostgreSQL applies location/type/bedroom/price filters and full-text search. Cards return a small projection with a single cover image. Detail pages load gallery, description, amenities and public agent information. User email and password hashes are excluded from public responses.

Cursors use `(created_at, id)` or `(price, id)` with matching sort direction, so ties do not lose listings. Limits are capped at 50 and the query retrieves one extra row to detect another page. Search indexes begin with active-only newest and location/price paths plus a full-text GIN index. Add others only after measuring representative `EXPLAIN (ANALYZE, BUFFERS)` plans. No Redis or external search engine is needed for the initial scope.

## Sessions and browser security

Passwords are hashed with Argon2id off the async worker. Random 256-bit opaque session tokens are sent only in HttpOnly, SameSite=Strict cookies; only SHA-256 token hashes are stored. Sessions expire in seven days and logout revokes the server record. Secure cookies default on; explicitly disable only for local HTTP development.

Cookie-authenticated mutations require an exact configured Origin. CORS only permits the configured frontend origin with credentials. Request bodies are capped. Database failures are logged internally and return safe messages. Never trust client-provided user IDs, role escalation, forwarded IP headers or verification fields.

Serve frontend and API behind one HTTPS origin in production. Set proxy timeouts, body limits and abuse controls. Use a restricted database runtime role, audited migration deployment, connection budget, backups and alerts. The development database credentials are not production credentials.

## Operational gaps

This is the initial product foundation. Signed file uploads need a storage account. Email verification and password recovery need an email provider. Production moderation, complete location coverage, cursor pagination for large agent dashboards, session cleanup scheduling and observability require follow-up before public launch. Current dashboard and saved-card endpoints are capped at 100 rows. Property view analytics are intentionally deferred until privacy and retention requirements are defined.

# Architecture decisions

## Modular monolith

One stateless Actix process owns business rules and PostgreSQL transactions. React consumes versioned REST endpoints. Keep domain boundaries within this deployment until independent scaling or team ownership warrants a split. SQLx uses parameter-bound SQL and a bounded connection pool; no ORM-generated query surprises or unbounded catalog downloads.

The frontend separates route screens, shared presentation components, authentication state and the API client. Screens are not a source of authorization. The backend verifies ownership on every write and resolves role from the database for every authenticated request.

## Data integrity

UUID identifiers are opaque. User and agent authentication are shared; agent profiles are separate. Prices use integer naira with bounds safe for JSON clients. Rental period is explicit, avoiding ambiguity between daily, monthly and annual amounts. Foreign keys enforce state/city/area consistency. Image order and one cover per property are unique database constraints. Images live outside PostgreSQL.

Agent verification and listing verification are independent. Editing listing details clears property verification. Publishing does not confer verification. Listings become drafts, active, sold, rented, expired or suspended rather than disappearing. Only admins can suspend or unsuspend.

Signed-in users can report active listings they do not own using a constrained category and written evidence. A partial unique index permits only one open report per user and property. Administrators resolve or dismiss reports with a required reason; the report stores its reviewer and resolution time, and the decision is also appended to the moderation event trail.

## Search

Public queries always require active status. PostgreSQL applies location/type/bedroom/price filters and full-text search. Cards return a small projection with a single cover image. Detail pages load gallery, description, amenities and public agent information. User email and password hashes are excluded from public responses.

Cursors use `(created_at, id)` or `(price, id)` with matching sort direction, so ties do not lose listings. Limits are capped at 50 and the query retrieves one extra row to detect another page. Search indexes begin with active-only newest and location/price paths plus a full-text GIN index. Add others only after measuring representative `EXPLAIN (ANALYZE, BUFFERS)` plans. No Redis or external search engine is needed for the initial scope.

## Sessions and browser security

Passwords are hashed with Argon2id off the async worker. Random 256-bit opaque session tokens are sent only in HttpOnly, SameSite=Strict cookies; only SHA-256 token hashes are stored. Sessions expire in seven days and logout revokes the server record. Secure cookies default on; explicitly disable only for local HTTP development.

Users can update their names and optional phone number without changing account identity. Password changes require the current password, hash the replacement off the async worker, and revoke every session for that user in the same database transaction. Email changes remain disabled until email ownership verification is connected.

Cookie-authenticated mutations require an exact configured Origin. CORS only permits the configured frontend origin with credentials. Request bodies are capped. Database failures are logged internally and return safe messages. Never trust client-provided user IDs, role escalation, forwarded IP headers or verification fields.

Serve frontend and API behind one HTTPS origin in production. `/health` reports process liveness and `/ready` verifies database access for load-balancer admission. Every response carries a generated `X-Request-Id`, and completion logs include that ID, route, status and elapsed time. Set proxy timeouts, body limits and abuse controls. Use a restricted database runtime role, audited migration deployment, connection budget, backups and alerts. The development database credentials are not production credentials.

The production image split keeps the public Nginx process and private API process separate while preserving a single browser origin. Nginx serves immutable frontend assets, handles SPA route fallback and proxies only `/api`, `/health` and `/ready`. Both containers run without root privileges at runtime. Deployment configuration supplies secrets at runtime; they are excluded from the build context and images.

## Operational gaps

This is the initial product foundation. Signed Cloudinary uploads are implemented and live-provider verified. Email verification and password recovery are deferred with Google authentication. The initial audited moderation queue is implemented. Agent properties, inquiries and saved homes use stable cursor pagination, with separate aggregate counts for the agent dashboard. Expired sessions are removed hourly in bounded batches. Every state and the FCT have a primary market; detailed city and area coverage remains curated. External log retention, metrics and alert routing require production-provider configuration. Property view analytics are intentionally deferred until privacy and retention requirements are defined.

## Module boundaries

Property HTTP handlers translate authentication and request data; DTOs validate listing inputs; the repository owns parameterized search, detail projections and transactional writes. Separate modules own authentication, agent profiles, moderation and signed upload issuance. Shared community endpoints cover the small location, favorites and inquiry features. Expand these into their own repositories when their behavior grows; avoid speculative generic service frameworks.

A bounded in-process request limiter protects authentication and mutations. It is a single-instance guardrail, not a substitute for distributed edge protection. Only socket peer addresses are trusted, so a reverse proxy must apply its own user/IP-aware limits. Moderation decisions have an append-only application audit path. Listing edits invalidate listing verification; agent profile edits reset agent verification to pending.

## Managed image lifecycle

The API creates an owned upload intent before signing a direct Cloudinary upload. The browser never receives the Cloudinary secret. After upload, the API queries Cloudinary using server credentials and records the provider's canonical secure URL before marking the intent uploaded. Property writes accept an uploaded intent only from its owner, or an already attached intent on the same property. A unique database reference prevents one upload from appearing twice.

Removing a managed photo commits the listing change first, marks the image for deletion, then removes the remote asset. Provider failures leave an explicit `pending_delete` record for retry rather than rolling back an otherwise valid listing update. Unattached uploads older than 24 hours are cleaned in bounded batches when new signatures are requested. A dedicated worker can take over this retry query when traffic and operational requirements justify it.

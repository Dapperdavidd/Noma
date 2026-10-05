# NOMA

A Nigerian real estate marketplace built with React, TypeScript, Rust/Actix Web, SQLx and PostgreSQL. This repository is an early working product foundation, not yet a public launch release.

## Run locally

Requirements: Node.js 22+, stable Rust, PostgreSQL 16+ (or Docker).

```sh
npm ci
cp .env.example .env
docker compose up -d db
cargo run -p noma-api
# In a second terminal:
npm run dev
```

Open http://localhost:5173. The API listens on http://127.0.0.1:8080. Vite proxies `/api` to the API. SQL migrations run at API startup. Configure `DATABASE_URL` for your own PostgreSQL installation if not using Docker. Never commit `.env`.

The location catalog includes all 36 states and the Federal Capital Territory, with one primary city in each and selected launch areas in Lagos, Abuja, and Port Harcourt. No fake accounts or live properties are seeded. The homepage displays clearly labeled illustrative cards until real listings exist. Any signed-in user can create and publish a property draft; the marketplace search supports sale, rent and short-let listings under one top-level Rent destination.

## Structure

- `apps/web/src/pages`: route-level screens and feature state.
- `apps/web/src/components.tsx`: shared navigation, search and property cards.
- `apps/web/src/api.ts`: typed client and centralized response handling.
- `apps/api/src`: domain modules for authentication, properties and community features.
- `apps/api/migrations`: versioned PostgreSQL schema and location data.
- `docs/architecture.md`: data, security and scaling decisions.

## Checks

```sh
npm run build
cargo fmt --all --check
cargo clippy --all-targets -- -D warnings
cargo test
# Create a dedicated noma_test PostgreSQL database first:
TEST_DATABASE_URL=postgres://noma:noma@localhost:5432/noma_test npm test
```

## Working flows

Account registration and sign-in; Google identity linking; email verification and single-use password recovery; contact profiles and secure password rotation; server-side ownership checks; sale, rent and short-let draft creation and editing; publish/archive/status management; full-text search; normalized state/city/area filters; budget, bedroom, media and multi-amenity filters; featured and verified discovery; stable cursor pagination; photo galleries; uploaded video and YouTube walkthroughs; saved properties; WhatsApp-first contact; inquiries and a property dashboard. Agent accounts have public professional profiles, owner-authorization declarations, inspection requests and customer ratings that can only be submitted after a completed inspection. Signed-in users can report suspicious listings, and administrators see marketplace metrics and resolve reports through an auditable review queue. Media accepts externally hosted HTTPS URLs and signed direct Cloudinary uploads when configured. Managed uploads are confirmed server-side, tied to their owner and listing, and cleaned up when discarded or removed. No media binaries are stored in PostgreSQL.

## Before public launch

Connect a production database and hosting, verify a transactional-email sending domain, configure the production Google origin, and review the location catalog. Configure HTTPS and `COOKIE_SECURE=true`. Add production monitoring, backups/restore verification, an edge abuse-control policy, legal documents and operational verification procedures. No payment or automated verification claims are made.

## Account providers

Set `GOOGLE_CLIENT_ID` to a Google Identity Services web client ID. The API publishes that public ID to the frontend at runtime and verifies Google ID-token signatures against Google's rotating JWKS; no Google client secret is used. Configure `RESEND_API_KEY`, `EMAIL_FROM`, and `PUBLIC_APP_URL` for verification and password-recovery links. Password-reset requests always return the same response, tokens are stored only as SHA-256 hashes, links expire and are single-use, and successful resets revoke every active session.

## Production container

`Dockerfile` contains separate `api` and `web` targets. The web image serves the compiled React application through unprivileged Nginx, routes `/api` to the Rust service, and falls back to `index.html` for browser routes. The API image runs as an unprivileged user and reports database-aware health through `/ready`.

For a single-host deployment, set `DATABASE_URL`, `WEB_ORIGINS` (a comma-separated allowlist containing the exact public HTTPS origin), and the Cloudinary variables in a private environment file, then run `docker compose -f compose.production.yaml up --build -d`. `WEB_ORIGIN` remains supported for a single origin. The production compose file intentionally does not create a database; use a backed-up managed PostgreSQL service or a separately operated database. No provider account is required to build or run the images locally.

## Media uploads

Set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, and `CLOUDINARY_UPLOAD_PRESET` in the API environment. Create a **signed** preset that permits the intended image formats (JPEG/PNG/WebP/AVIF) and video formats (MP4/WebM/MOV), with limits matching the application’s 10 MB photo and 100 MB video limits. Secrets never belong in `VITE_*` variables. The API signs a unique per-user public ID, disables overwrites, and the browser uploads directly to Cloudinary. Without credentials, HTTPS image/video links and YouTube links remain usable while direct uploads return an explicit unavailable response. Upload signatures follow [Cloudinary's official signing specification](https://cloudinary.com/documentation/authentication_signatures).

Each signed upload creates a short-lived database intent. After the browser upload, the API independently verifies the public ID with Cloudinary before it can be attached to a listing. Upload IDs cannot be reused by another account or attached twice. The form discards unused uploads when possible; stale and failed deletions are retried in bounded batches when another upload begins.

## Administration

The `/admin` operations dashboard is available only to database-provisioned administrators. It reports user, session, property, daily media and moderation counts and includes the review queues. Public registration cannot create administrators. Provision the initial trusted account with an audited database operation after it has registered; no default admin password exists. Property and agent verification are separate, featured placement is time-limited, and every review action records an actor and reason. Agents can edit their professional profiles at `/dashboard/profile`; public agent profiles expose reputation without revealing private account details. Every user can manage listings, inquiries, inspections and eligible reviews in the property dashboard.

## Test database and benchmarks

Integration tests create disposable accounts/listings only in `noma_test`, never in `noma_dev`. They start an API on port 18081 and frontend on 5174. Locally, the test runner derives the `noma_test` connection from the private `DATABASE_URL` when it points to `noma_dev`; `TEST_DATABASE_URL` can override it. Install the test browser with `npx playwright install chromium`. CI provisions its own PostgreSQL service and runs these tests automatically. Test fixture data remains in the isolated test database between runs.

`psql "$TEST_DATABASE_URL" -f scripts/search-benchmark.sql` measures the actual card query with 50,000 synthetic properties and images inside a rolled-back transaction. See `docs/validation.md` for measured results and limits.

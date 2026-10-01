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

The location catalog includes all 36 states and the Federal Capital Territory, with one primary city in each and selected launch areas in Lagos, Abuja, and Port Harcourt. No fake accounts or live properties are seeded. The homepage displays clearly labeled illustrative cards until real listings exist. Register an agent account to create a draft, then publish from the dashboard.

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

Account registration and sign-in; personal detail updates and secure password rotation; property seeker and agent roles; server-side ownership checks; draft creation and editing; publish/archive/status management; full-text search; normalized state/city/area filters; budget, bedroom and multi-amenity filters; price sorting with stable cursor pagination; property details and galleries; saved properties; inquiries and an agent dashboard. Signed-in buyers can report suspicious listings, and administrators resolve those reports through an auditable review queue. Images accept externally hosted HTTPS URLs and signed direct Cloudinary uploads when configured. Managed uploads are confirmed server-side, tied to their owner and listing, and cleaned up when discarded or removed. No image binaries are stored in PostgreSQL.

## Before public launch

Connect Cloudinary credentials and a signed upload preset, a production database and hosting, transactional email for verification/recovery, and a reviewed location catalog. Configure HTTPS and `COOKIE_SECURE=true`. Add production monitoring, backups/restore verification, an edge abuse-control policy, legal documents and operational verification procedures. No payment or automated verification claims are made.

## Production container

`Dockerfile` contains separate `api` and `web` targets. The web image serves the compiled React application through unprivileged Nginx, routes `/api` to the Rust service, and falls back to `index.html` for browser routes. The API image runs as an unprivileged user and reports database-aware health through `/ready`.

For a single-host deployment, set `DATABASE_URL`, `WEB_ORIGIN` (the exact public HTTPS origin), and the Cloudinary variables in a private environment file, then run `docker compose -f compose.production.yaml up --build -d`. The production compose file intentionally does not create a database; use a backed-up managed PostgreSQL service or a separately operated database. No provider account is required to build or run the images locally.

## Image uploads

Set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, and `CLOUDINARY_UPLOAD_PRESET` in the API environment. Create a **signed** preset restricting formats to JPEG/PNG/WebP/AVIF and maximum file size to 10 MB. Secrets never belong in `VITE_*` variables. The API signs a unique per-agent public ID, disables overwrites, and the browser uploads directly to Cloudinary. Without credentials, image links remain usable and uploads return an explicit unavailable response. Upload signatures follow [Cloudinary's official signing specification](https://cloudinary.com/documentation/authentication_signatures). The connected development account has passed a live upload, confirmation and deletion cycle.

Each signed upload creates a short-lived database intent. After the browser upload, the API independently verifies the public ID with Cloudinary before it can be attached to a listing. Upload IDs cannot be reused by another account or attached twice. The form discards unused uploads when possible; stale and failed deletions are retried in bounded batches when another upload begins.

## Administration

The `/admin` review queue is available only to database-provisioned administrators. Public registration cannot create administrators. Provision the initial trusted account with an audited database operation after it has registered; no default admin password exists. Property and agent verification are separate and every review action records an actor and reason. Agents can edit their profiles at `/dashboard/profile` and manage inquiry progress in their dashboard.

## Test database and benchmarks

Integration tests create disposable accounts/listings only in `noma_test`, never in `noma_dev`. They start an API on port 8081 and frontend on 5174. Install the test browser with `npx playwright install chromium`. CI provisions its own PostgreSQL service and runs these tests automatically. Test fixture data remains in the isolated test database between runs.

`psql "$TEST_DATABASE_URL" -f scripts/search-benchmark.sql` measures the actual card query with 50,000 synthetic properties and images inside a rolled-back transaction. See `docs/validation.md` for measured results and limits.

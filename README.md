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

The launch location catalog contains Lagos, Abuja, and Port Harcourt with selected areas. No fake accounts or live properties are seeded. The homepage displays clearly labeled illustrative cards until real listings exist. Register an agent account to create a draft, then publish from the dashboard.

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
```

## Working flows

Account registration and sign-in; property seeker and agent roles; server-side ownership checks; draft creation and editing; publish/archive/status management; search and price sorting with stable cursor pagination; property details and galleries; saved properties; inquiries and an agent dashboard. Images currently accept externally hosted HTTPS URLs. No image binaries are stored in PostgreSQL.

## Before public launch

Connect a production image provider for signed direct uploads, production database and hosting, transactional email for verification/recovery, and a reviewed location catalog. Configure HTTPS and `COOKIE_SECURE=true`. Add production monitoring, backups/restore verification, an edge abuse-control policy, legal documents and operational verification procedures. No payment or automated verification claims are made.

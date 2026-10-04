# Validation record — 29 September 2026

## Automated checks

- React/TypeScript production bundle builds successfully.
- Rust formatter and Clippy pass with warnings treated as errors.
- Three Rust unit tests cover request limiting, signature determinism and cursor parsing.
- Ten Playwright integration/browser scenarios pass against a real PostgreSQL test database:
  - Email verification, generic recovery responses, single-use reset tokens, password replacement and session revocation.
  - Malformed edit identifiers cannot fall through to property creation.
  - Managed photo ownership, duplicate attachment prevention and removal queuing.
  - Ownership checks, private drafts, publication, favorites, inquiry isolation and logout revocation.
  - Account profile validation, current-password verification, password replacement and all-session revocation.
  - Database readiness and per-response request correlation identifiers.
  - Stable newest and price pagination across ties.
  - National state/primary-city coverage, invalid location hierarchy, admin role escalation and cross-origin writes.
  - Desktop/mobile homepage, horizontal overflow, mobile navigation/search and the advanced location/bedroom filter panel.
  - Browser registration, draft creation, publishing and detail navigation.
  - Agent profiles, normalized location filters, price and bedroom ranges, amenities, inquiry status permissions and disconnected upload behavior.
  - Administrator review audit, independent verification and suspended-listing protection.
  - Listing report validation, duplicate prevention, owner/admin boundaries and audited resolution.
  - Independent administrator queue pagination and malformed cursor rejection.

## Query plan experiment

PostgreSQL 16 on the development Mac, 50,000 additional synthetic listings and cover images. `EXPLAIN (ANALYZE, BUFFERS)` used the full card projection, location joins and cover lookup, with a 21-row page. All benchmark records were rolled back.

| Query | Index path | Execution time |
| --- | --- | --- |
| Newest active listings | `properties_newest` | 18.085 ms |
| City + sale + price range, price ascending | `properties_location` | 0.420 ms |

These are individual local query executions, not concurrent load-test results or latency guarantees. Data is deliberately synthetic and concentrated in one city. Production performance still depends on data distribution, text queries, concurrent users, cache state, storage, connection budget and network latency. The checked-in benchmark can be rerun as the schema evolves.

## External checks still required

Google authentication and transactional recovery/verification are implemented. Resend is configured for development, while live Google testing still needs the client ID in the private environment and public email delivery needs a verified sending domain. Production deployment has not been connected. Homepage images are illustrative Unsplash images, not evidence of real Nigerian listings; replace with owned or approved launch imagery. Browser screenshots were inspected at desktop and 390-pixel mobile widths. A live signed Cloudinary upload was issued, independently confirmed through the API, discarded through the managed endpoint, and verified absent from the provider afterward.

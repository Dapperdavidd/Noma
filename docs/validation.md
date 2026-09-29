# Validation record — 29 September 2026

## Automated checks

- React/TypeScript production bundle builds successfully.
- Rust formatter and Clippy pass with warnings treated as errors.
- Two Rust unit tests cover request limiting and signature determinism.
- Seven Playwright integration/browser scenarios pass against a real PostgreSQL test database:
  - Ownership checks, private drafts, publication, favorites, inquiry isolation and logout revocation.
  - Stable newest and price pagination across ties.
  - Invalid location hierarchy, admin role escalation and cross-origin writes.
  - Desktop/mobile homepage, horizontal overflow and mobile navigation/search.
  - Browser registration, draft creation, publishing and detail navigation.
  - Agent profiles, amenities, inquiry status permissions and disconnected upload behavior.
  - Administrator review audit, independent verification and suspended-listing protection.

## Query plan experiment

PostgreSQL 16 on the development Mac, 50,000 additional synthetic listings and cover images. `EXPLAIN (ANALYZE, BUFFERS)` used the full card projection, location joins and cover lookup, with a 21-row page. All benchmark records were rolled back.

| Query | Index path | Execution time |
| --- | --- | --- |
| Newest active listings | `properties_newest` | 18.085 ms |
| City + sale + price range, price ascending | `properties_location` | 0.420 ms |

These are individual local query executions, not concurrent load-test results or latency guarantees. Data is deliberately synthetic and concentrated in one city. Production performance still depends on data distribution, text queries, concurrent users, cache state, storage, connection budget and network latency. The checked-in benchmark can be rerun as the schema evolves.

## External checks still required

Cloudinary uploads require the owner's provider configuration. Transactional email recovery/verification and production deployment have not been connected. Homepage images are illustrative Unsplash images, not evidence of real Nigerian listings; replace with owned or approved launch imagery. Browser screenshots were inspected at desktop and 390-pixel mobile widths.

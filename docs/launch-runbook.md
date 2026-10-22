# NOMA launch runbook

## Release gate

1. Create a private production environment file from `.env.example`. Do not copy development database credentials.
2. Run `npm run preflight -- /absolute/path/to/production.env --strict`. The command reports setting names only and never prints their values.
3. Confirm the production Google client includes the exact public HTTPS origin.
4. Keep Paystack in test mode until the product owner approves prices, refund handling and customer support. Register `/api/v1/billing/webhooks/paystack` only on the final HTTPS origin.
5. Verify a Resend sending domain before inviting users outside the account that owns the Resend project.
6. Create the first administrator through an audited database operation after that person registers. Public registration cannot create administrators.

## Database and backup gate

- Use managed PostgreSQL with encrypted connections, point-in-time recovery and a restricted runtime role.
- Take a provider snapshot before every release that contains migrations.
- Restore the latest backup into a separate database at least once before launch. A backup is not considered working until a restore succeeds.
- Record the restore duration and the latest recoverable time. Choose recovery objectives with the product owner.
- The API currently runs migrations during startup. Deploy one API instance first and wait for `/ready` before increasing replicas, so multiple instances do not race through rollout.

## Rollout

1. Build immutable images from the reviewed Git commit.
2. Run backend checks, the frontend production build and the Playwright suite in CI.
3. Deploy the API with one instance. Wait for `/health` and `/ready` to return HTTP 200.
4. Deploy the web image and confirm `/api/` is same-origin through Nginx.
5. Increase API replicas only after the first instance completed migrations and became ready.
6. Run the smoke checks below from a real browser on the public URL.

## Smoke checks

- Create a disposable user, verify the email and sign in again.
- Search sale, rent and short-let listings on desktop and mobile widths.
- Create a draft with one photo and video, publish it, edit it and return it to draft.
- Send an inquiry and an inspection request from a second disposable account; confirm both in-app notifications.
- Confirm Google sign-in on the exact public origin.
- In Paystack test mode, purchase a featured placement and confirm one webhook activates it once.
- Confirm non-admin accounts receive HTTP 403 from admin endpoints.
- Close the disposable accounts and confirm their sessions stop working.

## Monitoring and response

- Route structured API logs to retained storage and index `X-Request-Id`.
- Alert on sustained 5xx responses, readiness failures, database connection exhaustion, webhook failures and abnormal authentication rejection rates.
- Monitor pending upload cleanup, open reports, verification queue age and payment records stuck in `initialized`.
- Keep the edge proxy's distributed request limits enabled. The API limiter is an instance-local guardrail.

## Rollback

- Roll web assets back to the previous immutable image when the API contract remains compatible.
- Roll the API back only when the previous binary supports the migrated schema. Database migrations are forward-only; never delete columns or restore an old snapshot during a live rollback without a reviewed recovery plan.
- For a bad data migration, stop writes, preserve logs, take a fresh snapshot and restore or repair using a rehearsed database procedure.
- After rollback, repeat readiness and the critical sign-in, search and listing smoke checks.

## Inputs still owned by the product owner

The production domain and host, legal business identity, privacy-policy jurisdiction, support contact, final prices, refund rules, commission model and recovery objectives require owner decisions. Add those before opening registration to the public.

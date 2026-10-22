# Free pilot deployment

NOMA can be tested online without buying a domain. The included Render Blueprint builds one container in which the Rust API serves the compiled React app. Render supplies an HTTPS `onrender.com` address, so the browser and API share one origin and secure session cookies work without a second web service.

This setup is suitable for demos and a small private pilot. Render's free web services sleep after inactivity and may take about a minute to wake. Use paid, backed-up infrastructure before a public launch. Do not use Render's expiring free PostgreSQL database for persistent marketplace data.

## 1. Create the database

1. Create a free account at [Neon](https://console.neon.tech/).
2. Create a project named `noma` and choose a nearby region when one is available.
3. Open **Connect**, select the pooled connection, require SSL, and copy the PostgreSQL URL.
4. Keep that URL private. It is the value for `DATABASE_URL` in Render.

The API applies the versioned database migrations when it starts.

## 2. Create the Render service

1. Sign in at [Render](https://dashboard.render.com/) with GitHub.
2. Authorize access to the `Dapperdavidd/Noma` repository.
3. Select **New** → **Blueprint** and choose the repository.
4. Render will detect `render.yaml` and propose the `noma-marketplace` free web service.
5. Enter the required private values when prompted:
   - `DATABASE_URL`: the Neon pooled PostgreSQL URL.
   - `GOOGLE_CLIENT_ID`: the existing Google web client ID.
   - `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, and `CLOUDINARY_UPLOAD_PRESET`: the existing Cloudinary values.
   - `RESEND_API_KEY` and `EMAIL_FROM`: the existing Resend test values. These may be left empty if email verification and password recovery are not being tested yet.
   - `PAYSTACK_SECRET_KEY`: optional for the pilot. Use only a Paystack **test** secret key.
6. For the first deployment, set temporary values for `WEB_ORIGINS` and `PUBLIC_APP_URL` such as `https://noma-marketplace.onrender.com`.
7. Apply the Blueprint and wait for the health check to pass.

If Render adds characters to the service name, its actual address will differ. Copy the exact HTTPS address shown by Render, then set both of these environment variables to it with no trailing slash:

```ini
WEB_ORIGINS=https://your-actual-service.onrender.com
PUBLIC_APP_URL=https://your-actual-service.onrender.com
```

Save the changes and trigger a new deployment. The service's `/ready` endpoint must report `ready` before testing account flows.

## 3. Update the provider dashboards

In Google Cloud Console, open the `NOMA Web` OAuth client and add the exact Render address under **Authorized JavaScript origins**. Keep the local origins for development. This app uses Google Identity Services and does not require an OAuth client secret or redirect URI.

Cloudinary does not need the Render domain for the signed upload flow. Keep every Cloudinary secret in Render; never add it to a `VITE_` variable.

Resend's `onboarding@resend.dev` sender is useful for early testing but normally sends only to the Resend account owner's email. A domain is needed later to send verification messages to arbitrary users. That does not block a private pilot using Google sign-in.

Paystack can remain unconfigured. If billing is tested, use test mode and set its webhook to:

```text
https://your-actual-service.onrender.com/api/v1/billing/webhooks/paystack
```

## 4. Pilot smoke test

1. Open the Render address in a private browser window.
2. Create an account with Google, sign out, and sign in again.
3. Create a draft listing, attach a photo, publish it, and confirm that it appears in Discover.
4. Open the listing in another private window and verify its photo, video preview, agent profile and WhatsApp contact action.
5. Restart the Render service and confirm the account and listing still exist.

Before inviting the public, move the database and service to plans with backups and uptime guarantees, verify a sending domain, add monitoring, and complete the legal and operational items in the [launch runbook](launch-runbook.md).

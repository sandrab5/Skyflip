# Skyflip Firebase + Cloudflare migration

This branch is a safe migration build. **Do not remove the existing Render service yet.**

## Target architecture

- GitHub remains the source of truth.
- Firebase Hosting serves `public/` as the static website.
- Cloudflare Workers serves the `/api/*` backend.
- Neon remains the PostgreSQL database.
- Brevo remains the email provider.
- No secrets are committed to GitHub.

## 1. Firebase Hosting

Create/select a Firebase project on the **Spark (no-cost)** plan. Do not enable billing/Blaze.

From the repository root:

```bash
npm install -g firebase-tools
firebase login
firebase use YOUR_FIREBASE_PROJECT_ID
firebase deploy --only hosting
```

`firebase.json` is already configured to publish `public/`.

## 2. Cloudflare Worker

The Worker lives in `worker/`.

```bash
cd worker
npm install
npx wrangler login
npx wrangler deploy
```

The Worker will be deployed as `skyflip-api` and will receive a `workers.dev` URL.

### Required Worker secrets

Set these in Cloudflare, never in GitHub:

```bash
npx wrangler secret put DATABASE_URL
npx wrangler secret put BREVO_API_KEY
npx wrangler secret put FROM_EMAIL
npx wrangler secret put FROM_NAME
npx wrangler secret put BOOKING_PASSCODE
```

Use the same values currently used by Render. `DATABASE_URL` is the existing Neon connection string.

## 3. Test the Worker before changing the live site

After deployment, test:

```text
GET  https://YOUR-WORKER-URL/api/health
POST https://YOUR-WORKER-URL/api/verify-passcode
POST https://YOUR-WORKER-URL/api/bookings
GET  https://YOUR-WORKER-URL/api/bookings/REF?email=EMAIL
POST https://YOUR-WORKER-URL/api/send-itinerary
```

Do not expose the secrets in logs, screenshots, or GitHub.

## 4. Frontend API URL

The current frontend uses relative `/api/...` calls, because Render currently serves the frontend and API from the same origin. Before moving the frontend away from Render, those calls must be routed to the Worker URL.

The safest final setup is to configure the frontend with the deployed Worker URL and use CORS on the Worker (already implemented). Do this only after the Worker has passed the tests above.

## 5. Final cutover

Only after Firebase Hosting and the Worker are confirmed working:

1. Point the frontend API URL at the Worker.
2. Deploy Firebase Hosting.
3. Test booking creation, booking lookup, passcode verification, and itinerary email.
4. Keep Render running as a fallback until all tests pass.
5. Only then remove Render.

## Rollback

If anything fails, restore the frontend API URL to its existing relative `/api/...` behavior and keep using Render. The Neon database is unchanged by this migration.

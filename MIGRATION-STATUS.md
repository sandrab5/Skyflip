# Migration status

## Completed on `firebase-cloudflare-migration`

- Added Firebase Hosting configuration.
- Added Cloudflare Worker API implementation.
- Kept Neon as the database.
- Kept Brevo as the email provider.
- Added Worker secret templates and ignore rules.
- Documented deployment and rollback steps.

## Still requires account-side setup

- Firebase project selection/hosting deployment.
- Cloudflare Worker deployment.
- Worker secrets must be entered through Cloudflare/Wrangler; they are never committed.
- The frontend must be pointed at the deployed Worker URL before Firebase becomes the production frontend.
- End-to-end tests must pass before Render is removed.

## Safety

`main` and the existing Render deployment have not been changed by this migration branch.

# Skyflip API Worker

This Worker replaces the Express API currently running on Render. It keeps the same API paths and uses the existing Neon database and Brevo account.

## Endpoints

- `GET /api/health`
- `POST /api/verify-passcode`
- `POST /api/bookings`
- `GET /api/bookings/:ref?email=...`
- `POST /api/send-itinerary`

## Secrets

Set these with Wrangler. Never commit real values:

- `DATABASE_URL`
- `BREVO_API_KEY`
- `FROM_EMAIL`
- `FROM_NAME`
- `BOOKING_PASSCODE`

## Local development

Copy `.dev.vars.example` to `.dev.vars`, fill it with local/test values, then:

```bash
npm install
npm run dev
```

## Deployment

```bash
npx wrangler login
npx wrangler secret put DATABASE_URL
npx wrangler secret put BREVO_API_KEY
npx wrangler secret put FROM_EMAIL
npx wrangler secret put FROM_NAME
npx wrangler secret put BOOKING_PASSCODE
npx wrangler deploy
```

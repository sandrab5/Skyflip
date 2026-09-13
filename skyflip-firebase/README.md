# Skyflip — Firebase + Supabase edition

No Render, no card, no sleeping server. This version splits the app across:

| Piece | Provider | Free tier |
|---|---|---|
| Website (frontend) | Firebase Hosting | forever, instant loads |
| Backend logic | Supabase Edge Functions | 500,000 calls/month |
| Booking database | Supabase Postgres | 500 MB storage |
| Email sending | Brevo | 300 emails/day |
| Auto-deploy on push | GitHub Actions | 2,000 minutes/month |

None of these require a credit card.

## Part 1 — Create the Supabase project

1. Sign up at https://supabase.com (or log into your existing account).
2. **New Project** → name it `skyflip` → pick a region → set a database
   password (save it somewhere, though you won't need it day-to-day since
   the app talks to Supabase via API keys, not this password directly).
3. Once it's created, go to **SQL Editor** → **New query**, paste in the
   contents of `supabase/migrations/0001_create_bookings.sql` from this
   repo, and run it. This creates the `bookings` table.
4. Go to **Project Settings → API**. Note down:
   - **Project URL** (looks like `https://abcdefgh.supabase.co`)
   - **Project Reference ID** (the `abcdefgh` part, also shown separately)

## Part 2 — Create the Firebase project

1. Sign up / log in at https://console.firebase.google.com
2. **Add project** → name it `skyflip` (or accept whatever ID it generates
   if that exact name is taken).
3. You don't need Analytics for this — skip/disable it if asked.
4. Once created, go to **Build → Hosting** in the left sidebar and click
   **Get started** (you don't need to follow its CLI instructions — GitHub
   Actions will handle deployment for you, covered in Part 4).

## Part 3 — Configure secrets

### Supabase Edge Function secrets
In the Supabase dashboard: **Project Settings → Edge Functions → Secrets**
(or **Functions → Manage secrets**), add:

- `BOOKING_PASSCODE` — only the agent (you) should know this
- `BREVO_API_KEY` — from your existing Brevo account
- `FROM_EMAIL` — your verified Brevo sender address
- `FROM_NAME` — `Skyflip`

(`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically
by Supabase into every Edge Function — nothing to add for those two.)

### Update the frontend with your Supabase URL
In `public/index.html`, find this line near the top of the `<script>`:
```js
const SUPABASE_FUNCTIONS_URL = "https://YOUR-PROJECT-REF.supabase.co/functions/v1";
```
Replace `YOUR-PROJECT-REF` with your actual project ref from Part 1.

## Part 4 — Set up automatic deployment (GitHub Actions)

Since Firebase and Supabase don't have Render's "just connect your GitHub
repo" simplicity, this repo includes a GitHub Actions workflow
(`.github/workflows/deploy.yml`) that deploys both the site and the
functions automatically every time you push to `main` — same experience as
before, just running in GitHub's cloud instead of Render's.

It needs three secrets added to your GitHub repo
(**Settings → Secrets and variables → Actions → New repository secret**):

### 1. `FIREBASE_SERVICE_ACCOUNT`
1. In the Firebase console: **Project Settings → Service Accounts**
2. Click **Generate new private key** → downloads a `.json` file
3. Open that file, copy its *entire* contents
4. Paste the whole JSON as the value of this GitHub secret

### 2. `SUPABASE_ACCESS_TOKEN`
1. Go to https://supabase.com/dashboard/account/tokens
2. **Generate new token** → name it anything (e.g. `github-actions`)
3. Copy it, paste as this GitHub secret's value

### 3. `SUPABASE_PROJECT_REF`
Your project ref from Part 1 (the short ID, e.g. `abcdefgh`) — paste it
directly as the value.

Also open `.github/workflows/deploy.yml` and `.firebaserc`, and replace
`skyflip` with your actual Firebase project ID if it ended up different
(e.g. `skyflip-a1b2c` if the plain name was taken).

## Part 5 — Ship it

Once all the secrets are in place:
1. Push this whole folder to your GitHub repo (replacing what's there now)
2. GitHub Actions runs automatically — check the **Actions** tab on your
   repo to watch it deploy
3. Once it's green, your site is live at `https://YOUR-PROJECT-ID.web.app`

Every future edit works the same way you're used to: change a file on
GitHub, commit to `main`, and it redeploys automatically within a minute
or two — no Render, no manual redeploy step.

## Good to know

- **No per-IP rate limiting** on these Edge Functions (the old Express
  server had one). Supabase's own invocation limits provide some natural
  ceiling, and the passcode gate remains the real protection for booking
  creation. Worth knowing, not urgent to fix for personal-scale use.
- **Booking emails are now verified against the database** before sending —
  tighter than before, where the browser could technically ask it to email
  any made-up itinerary content.
- **Cold starts**: Supabase Edge Functions typically respond in well under
  a second, even after being idle — nothing like Render's 30-50 second
  wake-up.
- Keep an eye on Supabase's dashboard occasionally; free projects pause
  after 7 days with zero activity (data is preserved, just needs a manual
  "Restore" click) — worth adding a free scheduled ping later if the site
  goes quiet for stretches, happy to set that up if useful.

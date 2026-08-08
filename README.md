# Skyflip — free setup, no domain required

This whole folder is the app: an Express server that serves the frontend
(`public/index.html`) *and* exposes `/api/send-itinerary`, which sends real
itinerary emails through Brevo. Every piece below has a permanent free tier
and none of it requires owning a domain or a credit card.

| Piece | Provider | Free tier |
|---|---|---|
| Email sending | Brevo | 300 emails/day, forever |
| Code hosting | GitHub | free |
| Web hosting | Render.com | free web service |

## Part 1 — Connect Brevo (no domain needed)

Brevo lets you verify a single **email address** instead of a domain, which
is exactly what makes this free path possible.

1. Sign up at https://www.brevo.com — free, no card required.
2. Go to **Senders, Domains & Dedicated IPs → Senders → Add a Sender**.
   Enter any email you actually control (a Gmail/Outlook/Yahoo address is
   fine) and a display name like "Skyflip".
3. Brevo emails that address a confirmation link — click it to verify.
4. Go to **SMTP & API → API Keys → Generate a new API key**. Copy it
   (starts with `xkeysib-`) — shown once.

## Part 2 — Configure the app

```bash
cd skyflip-server
npm install
cp .env.example .env
```

Edit `.env`:
```
BREVO_API_KEY=xkeysib-your_real_key
FROM_EMAIL=you@example.com   # must exactly match the sender you verified
FROM_NAME=Skyflip
PORT=3001
```

## Part 3 — Test locally

```bash
npm start
```

Open http://localhost:3001 — the whole site. Book a flight, click "Send
itinerary," check the inbox. Sanity check:
```bash
curl http://localhost:3001/api/health
```
should show `"brevoConfigured": true`.

## Part 4 — Put it live, free

1. Push this folder to a **free GitHub repo** (github.com → New repository →
   upload these files, or `git push` if you're comfortable with git).
2. Go to https://render.com → sign up free (GitHub login is fastest) →
   **New → Web Service** → connect your repo.
3. Settings:
   - Build command: `npm install`
   - Start command: `npm start`
   - Instance type: **Free**
4. Under **Environment**, add `BREVO_API_KEY`, `FROM_EMAIL`, `FROM_NAME` —
   same values as your `.env`. (Never put these in the code itself.)
5. Click **Deploy**. Render gives you a live URL like
   `https://skyflip.onrender.com` — share that with anyone, it works from
   any device, and itinerary emails send for real. Total cost: $0.

## Good to know

- **Free tier limits**: Brevo caps at 300 emails/day — plenty for personal
  or small-scale use. Render's free web service spins down after ~15 minutes
  of no traffic and takes a few seconds to wake back up on the next visit;
  it doesn't cost anything, it's just not instant if it's been idle.
- **Booking storage**: bookings are saved in each visitor's own browser
  (`localStorage`), not a shared database — so "track a booking" only works
  on the same device/browser it was made on. A real production version would
  need a small free database (e.g. Render's free Postgres tier, or Supabase's
  free tier) so bookings are reachable from anywhere. I can wire that up if
  you want it next — still $0.
- Keep `.env` out of git (add a `.gitignore` with `.env` in it) — the API key
  should only ever live in Render's environment variables, never in code.

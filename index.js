require("dotenv").config();
const path = require("path");
const express = require("express");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3001;

// ---- Config ----
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL; // the exact address you verified as a "Sender" in Brevo
const FROM_NAME = process.env.FROM_NAME || "Skyflip";
const BOOKING_PASSCODE = process.env.BOOKING_PASSCODE; // only the agent knows this — required to create a booking
const DATABASE_URL = process.env.DATABASE_URL; // Neon Postgres connection string

if (!BREVO_API_KEY || !FROM_EMAIL) {
  console.warn("WARNING: BREVO_API_KEY / FROM_EMAIL not set. /api/send-itinerary will fail until they are.");
}
if (!DATABASE_URL) {
  console.warn("WARNING: DATABASE_URL not set. Booking creation/tracking will fail until it is.");
}

// ---- Database ----
const pool = DATABASE_URL
  ? new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : null;

async function initDb() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      ref TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  console.log("Database ready — bookings table checked/created.");
}
initDb().catch((err) => console.error("Failed to initialize database:", err));

app.use(express.json());
// Serve the frontend (index.html and any assets) from ./public
app.use(express.static(path.join(__dirname, "public")));

// Simple in-memory rate limiter (per IP) so this endpoint can't be spammed to mass-mail people.
const rateLimitWindowMs = 60 * 1000;
const rateLimitMax = 5;
const hits = new Map();
function rateLimit(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  const entry = hits.get(ip) || { count: 0, windowStart: now };
  if (now - entry.windowStart > rateLimitWindowMs) {
    entry.count = 0;
    entry.windowStart = now;
  }
  entry.count += 1;
  hits.set(ip, entry);
  if (entry.count > rateLimitMax) {
    return res.status(429).json({ error: "Too many requests. Please wait a minute and try again." });
  }
  next();
}

function isValidEmail(email) {
  return typeof email === "string" && /^\S+@\S+\.\S+$/.test(email);
}

function genRef(){
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let ref = "";
  for(let i=0;i<6;i++) ref += chars[Math.floor(Math.random()*chars.length)];
  return ref;
}

async function generateUniqueRef(){
  for (let attempt = 0; attempt < 10; attempt++) {
    const ref = genRef();
    const existing = await pool.query("SELECT 1 FROM bookings WHERE ref = $1", [ref]);
    if (existing.rowCount === 0) return ref;
  }
  throw new Error("Could not generate a unique booking reference, please try again.");
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildItineraryHtml(booking) {
  const f = booking.flight;
  return `
  <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#111;">
    <div style="background:#0A0E1A;color:#F5A623;padding:18px 22px;border-radius:10px 10px 0 0;font-family:monospace;letter-spacing:1px;">
      SKYFLIP ITINERARY — ${escapeHtml(booking.ref)}
    </div>
    <div style="border:1px solid #eee;border-top:none;padding:22px;border-radius:0 0 10px 10px;">
      <p style="margin:0 0 14px;">Hi ${escapeHtml(booking.passenger?.name || "traveler")}, here's your booking confirmation.</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:6px 0;color:#666;">Route</td><td style="padding:6px 0;text-align:right;font-weight:bold;">${escapeHtml(f.from)} → ${escapeHtml(f.to)}</td></tr>
        <tr><td style="padding:6px 0;color:#666;">Flight</td><td style="padding:6px 0;text-align:right;">${escapeHtml(f.airline)} ${escapeHtml(f.flightNo)}</td></tr>
        <tr><td style="padding:6px 0;color:#666;">Date</td><td style="padding:6px 0;text-align:right;">${escapeHtml(booking.date)}</td></tr>
        <tr><td style="padding:6px 0;color:#666;">Departs</td><td style="padding:6px 0;text-align:right;">${escapeHtml(f.depTime)}</td></tr>
        <tr><td style="padding:6px 0;color:#666;">Arrives</td><td style="padding:6px 0;text-align:right;">${escapeHtml(f.arrTime)}</td></tr>
        <tr><td style="padding:6px 0;color:#666;">Cabin</td><td style="padding:6px 0;text-align:right;">${escapeHtml(f.cabin)}</td></tr>
        <tr><td style="padding:6px 0;color:#666;">Passengers</td><td style="padding:6px 0;text-align:right;">${escapeHtml(booking.passengers)}</td></tr>
        <tr><td style="padding:10px 0 0;color:#666;border-top:1px solid #eee;">Total paid</td><td style="padding:10px 0 0;text-align:right;font-weight:bold;border-top:1px solid #eee;">$${escapeHtml(booking.total)}</td></tr>
      </table>
      <p style="margin:18px 0 0;font-size:12px;color:#999;">Thank you for booking with Skyflip.</p>
    </div>
  </div>`;
}

function buildItineraryText(booking) {
  const f = booking.flight;
  return `SKYFLIP ITINERARY
Booking reference: ${booking.ref}

Passenger: ${booking.passenger?.name || ""}
Route: ${f.from} -> ${f.to}
Flight: ${f.airline} ${f.flightNo}
Date: ${booking.date}
Departs: ${f.depTime}   Arrives: ${f.arrTime}
Cabin: ${f.cabin}
Passengers: ${booking.passengers}
Total paid: $${booking.total}

Thank you for booking with Skyflip.`;
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    brevoConfigured: Boolean(BREVO_API_KEY && FROM_EMAIL),
    passcodeConfigured: Boolean(BOOKING_PASSCODE),
    databaseConfigured: Boolean(DATABASE_URL),
  });
});

app.post("/api/verify-passcode", rateLimit, (req, res) => {
  const { passcode } = req.body || {};
  if (!BOOKING_PASSCODE) {
    return res.status(500).json({ error: "Booking passcode isn't configured on the server yet." });
  }
  if (typeof passcode !== "string" || passcode !== BOOKING_PASSCODE) {
    return res.status(401).json({ error: "Incorrect passcode." });
  }
  res.json({ ok: true });
});

// Creates a booking — requires the agent passcode, stores it in the shared database
// so it can be tracked from any device, not just the browser that created it.
app.post("/api/bookings", rateLimit, async (req, res) => {
  try {
    if (!pool) {
      return res.status(500).json({ error: "Database isn't configured on the server yet." });
    }
    const { passcode, flight, date, passengers, passenger } = req.body || {};

    if (!BOOKING_PASSCODE) {
      return res.status(500).json({ error: "Booking passcode isn't configured on the server yet." });
    }
    if (typeof passcode !== "string" || passcode !== BOOKING_PASSCODE) {
      return res.status(401).json({ error: "Incorrect passcode." });
    }
    if (!flight || !flight.from || !flight.to || !date || !passengers || !passenger) {
      return res.status(400).json({ error: "Missing booking details." });
    }
    if (!passenger.name || !isValidEmail(passenger.email)) {
      return res.status(400).json({ error: "A valid passenger name and email are required." });
    }

    const ref = await generateUniqueRef();
    const booking = {
      ref,
      flight,
      date,
      passengers,
      passenger,
      total: flight.price * passengers,
      createdAt: Date.now(),
    };

    await pool.query(
      "INSERT INTO bookings (ref, email, data) VALUES ($1, $2, $3)",
      [ref, passenger.email.toLowerCase(), JSON.stringify(booking)]
    );

    res.json({ ok: true, booking });
  } catch (err) {
    console.error("Create booking error:", err);
    res.status(500).json({ error: "Failed to create booking. Please try again." });
  }
});

// Looks up a booking by reference + the email used at booking time — works from
// any device, since it reads from the shared database, not browser storage.
app.get("/api/bookings/:ref", rateLimit, async (req, res) => {
  try {
    if (!pool) {
      return res.status(500).json({ error: "Database isn't configured on the server yet." });
    }
    const ref = (req.params.ref || "").toUpperCase();
    const email = (req.query.email || "").toLowerCase();
    if (!ref || !email) {
      return res.status(400).json({ error: "Booking reference and email are required." });
    }

    const result = await pool.query(
      "SELECT data FROM bookings WHERE ref = $1 AND email = $2",
      [ref, email]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "No booking found for that reference and email." });
    }

    res.json({ ok: true, booking: result.rows[0].data });
  } catch (err) {
    console.error("Lookup booking error:", err);
    res.status(500).json({ error: "Failed to look up booking. Please try again." });
  }
});

app.post("/api/send-itinerary", rateLimit, async (req, res) => {
  try {
    const { to, booking } = req.body || {};

    if (!isValidEmail(to)) {
      return res.status(400).json({ error: "A valid recipient email ('to') is required." });
    }
    if (!booking || !booking.ref || !booking.flight) {
      return res.status(400).json({ error: "Booking details are required." });
    }
    if (!BREVO_API_KEY || !FROM_EMAIL) {
      return res.status(500).json({
        error: "Email sending is not configured on the server yet. Set BREVO_API_KEY and FROM_EMAIL.",
      });
    }

    // Brevo's REST API directly — no paid SDK dependency needed.
    const brevoRes = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": BREVO_API_KEY,
      },
      body: JSON.stringify({
        sender: { name: FROM_NAME, email: FROM_EMAIL },
        to: [{ email: to }],
        subject: `Your Skyflip itinerary — ${booking.ref}`,
        htmlContent: buildItineraryHtml(booking),
        textContent: buildItineraryText(booking),
      }),
    });

    const data = await brevoRes.json().catch(() => ({}));

    if (!brevoRes.ok) {
      console.error("Brevo error:", data);
      return res.status(502).json({ error: data.message || "Failed to send email." });
    }

    res.json({ ok: true, message: `Itinerary sent to ${to}`, id: data.messageId });
  } catch (err) {
    console.error("Send error:", err);
    res.status(502).json({ error: "Failed to send email. Check server logs / Brevo setup." });
  }
});

// Fallback: any other route serves the frontend (single-page app)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Skyflip server listening on port ${PORT}`);
});

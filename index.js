require("dotenv").config();
const path = require("path");
const express = require("express");

const app = express();
const PORT = process.env.PORT || 3001;

// ---- Config ----
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL; // the exact address you verified as a "Sender" in Brevo
const FROM_NAME = process.env.FROM_NAME || "Skyflip";

if (!BREVO_API_KEY || !FROM_EMAIL) {
  console.warn("WARNING: BREVO_API_KEY / FROM_EMAIL not set. /api/send-itinerary will fail until they are.");
}

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
  res.json({ ok: true, brevoConfigured: Boolean(BREVO_API_KEY && FROM_EMAIL) });
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

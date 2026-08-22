import { neon } from "@neondatabase/serverless";

const rateLimitWindowMs = 60 * 1000;
const rateLimitMax = 5;
const hits = new Map();
let dbInitPromise;

function json(data, status = 200, origin = "*") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Cache-Control": "no-store",
    },
  });
}

function corsOrigin(request) {
  return request.headers.get("Origin") || "*";
}

function rateLimited(request) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const now = Date.now();
  const entry = hits.get(ip) || { count: 0, windowStart: now };
  if (now - entry.windowStart > rateLimitWindowMs) {
    entry.count = 0;
    entry.windowStart = now;
  }
  entry.count += 1;
  hits.set(ip, entry);
  return entry.count > rateLimitMax;
}

function isValidEmail(email) {
  return typeof email === "string" && /^\S+@\S+\.\S+$/.test(email);
}

function genRef() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

async function generateUniqueRef(sql) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const ref = genRef();
    const existing = await sql`SELECT 1 FROM bookings WHERE ref = ${ref}`;
    if (existing.length === 0) return ref;
  }
  throw new Error("Could not generate a unique booking reference, please try again.");
}

async function getDb(env) {
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is not configured.");
  const sql = neon(env.DATABASE_URL);
  if (!dbInitPromise) {
    dbInitPromise = sql`
      CREATE TABLE IF NOT EXISTS bookings (
        ref TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        data JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
  }
  await dbInitPromise;
  return sql;
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

async function sendItinerary(env, to, booking) {
  if (!env.BREVO_API_KEY || !env.FROM_EMAIL) {
    throw new Error("Email sending is not configured on the server yet.");
  }

  const brevoRes = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": env.BREVO_API_KEY,
    },
    body: JSON.stringify({
      sender: { name: env.FROM_NAME || "Skyflip", email: env.FROM_EMAIL },
      to: [{ email: to }],
      subject: `Your Skyflip itinerary — ${booking.ref}`,
      htmlContent: buildItineraryHtml(booking),
      textContent: buildItineraryText(booking),
    }),
  });

  const data = await brevoRes.json().catch(() => ({}));
  if (!brevoRes.ok) {
    console.error("Brevo error:", data);
    throw new Error(data.message || "Failed to send email.");
  }
  return data;
}

export default {
  async fetch(request, env) {
    const origin = corsOrigin(request);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path === "/api/health" && request.method === "GET") {
      return json({
        ok: true,
        brevoConfigured: Boolean(env.BREVO_API_KEY && env.FROM_EMAIL),
        passcodeConfigured: Boolean(env.BOOKING_PASSCODE),
        databaseConfigured: Boolean(env.DATABASE_URL),
      }, 200, origin);
    }

    if (rateLimited(request)) {
      return json({ error: "Too many requests. Please wait a minute and try again." }, 429, origin);
    }

    try {
      if (path === "/api/verify-passcode" && request.method === "POST") {
        const { passcode } = await request.json().catch(() => ({}));
        if (!env.BOOKING_PASSCODE) {
          return json({ error: "Booking passcode isn't configured on the server yet." }, 500, origin);
        }
        if (typeof passcode !== "string" || passcode !== env.BOOKING_PASSCODE) {
          return json({ error: "Incorrect passcode." }, 401, origin);
        }
        return json({ ok: true }, 200, origin);
      }

      if (path === "/api/bookings" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const { passcode, flight, date, passengers, passenger } = body;

        if (!env.BOOKING_PASSCODE) {
          return json({ error: "Booking passcode isn't configured on the server yet." }, 500, origin);
        }
        if (typeof passcode !== "string" || passcode !== env.BOOKING_PASSCODE) {
          return json({ error: "Incorrect passcode." }, 401, origin);
        }
        if (!flight || !flight.from || !flight.to || !date || !passengers || !passenger) {
          return json({ error: "Missing booking details." }, 400, origin);
        }
        if (!passenger.name || !isValidEmail(passenger.email)) {
          return json({ error: "A valid passenger name and email are required." }, 400, origin);
        }

        const sql = await getDb(env);
        const ref = await generateUniqueRef(sql);
        const booking = {
          ref,
          flight,
          date,
          passengers,
          passenger,
          total: flight.price * passengers,
          createdAt: Date.now(),
        };

        await sql`
          INSERT INTO bookings (ref, email, data)
          VALUES (${ref}, ${passenger.email.toLowerCase()}, ${JSON.stringify(booking)}::jsonb)
        `;

        return json({ ok: true, booking }, 200, origin);
      }

      const bookingMatch = path.match(/^\/api\/bookings\/([^/]+)$/);
      if (bookingMatch && request.method === "GET") {
        const ref = decodeURIComponent(bookingMatch[1] || "").toUpperCase();
        const email = (url.searchParams.get("email") || "").toLowerCase();
        if (!ref || !email) {
          return json({ error: "Booking reference and email are required." }, 400, origin);
        }

        const sql = await getDb(env);
        const result = await sql`
          SELECT data FROM bookings WHERE ref = ${ref} AND email = ${email}
        `;
        if (result.length === 0) {
          return json({ error: "No booking found for that reference and email." }, 404, origin);
        }
        return json({ ok: true, booking: result[0].data }, 200, origin);
      }

      if (path === "/api/send-itinerary" && request.method === "POST") {
        const { to, booking } = await request.json().catch(() => ({}));
        if (!isValidEmail(to)) {
          return json({ error: "A valid recipient email ('to') is required." }, 400, origin);
        }
        if (!booking || !booking.ref || !booking.flight) {
          return json({ error: "Booking details are required." }, 400, origin);
        }

        const data = await sendItinerary(env, to, booking);
        return json({ ok: true, message: `Itinerary sent to ${to}`, id: data.messageId }, 200, origin);
      }

      return json({ error: "Not found" }, 404, origin);
    } catch (err) {
      console.error("Skyflip API error:", err);
      return json({ error: err instanceof Error ? err.message : "Internal server error." }, 500, origin);
    }
  },
};

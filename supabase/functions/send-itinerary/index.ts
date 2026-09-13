import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

function isValidEmail(email: unknown): email is string {
  return typeof email === "string" && /^\S+@\S+\.\S+$/.test(email);
}

function escapeHtml(str: unknown) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildItineraryHtml(booking: any) {
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

function buildItineraryText(booking: any) {
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

  try {
    const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY");
    const FROM_EMAIL = Deno.env.get("FROM_EMAIL");
    const FROM_NAME = Deno.env.get("FROM_NAME") || "Skyflip";

    const body = await req.json().catch(() => ({}));
    const { to, ref, email } = body || {};

    if (!isValidEmail(to)) {
      return new Response(JSON.stringify({ error: "A valid recipient email ('to') is required." }), {
        status: 400,
        headers: jsonHeaders,
      });
    }
    if (!ref || !isValidEmail(email)) {
      return new Response(
        JSON.stringify({ error: "The booking reference and its original email are required." }),
        { status: 400, headers: jsonHeaders }
      );
    }
    if (!BREVO_API_KEY || !FROM_EMAIL) {
      return new Response(
        JSON.stringify({ error: "Email sending is not configured on the server yet." }),
        { status: 500, headers: jsonHeaders }
      );
    }

    // Look the booking up ourselves rather than trusting whatever the
    // browser sends — this way nobody can email arbitrary made-up
    // "itineraries" through this endpoint, only real stored bookings.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { data, error: lookupError } = await supabase
      .from("bookings")
      .select("data")
      .eq("ref", ref.toUpperCase())
      .eq("email", email.toLowerCase())
      .maybeSingle();

    if (lookupError) throw lookupError;
    if (!data) {
      return new Response(
        JSON.stringify({ error: "No booking found for that reference and email." }),
        { status: 404, headers: jsonHeaders }
      );
    }

    const booking = data.data;

    const brevoRes = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": BREVO_API_KEY },
      body: JSON.stringify({
        sender: { name: FROM_NAME, email: FROM_EMAIL },
        to: [{ email: to }],
        subject: `Your Skyflip itinerary — ${booking.ref}`,
        htmlContent: buildItineraryHtml(booking),
        textContent: buildItineraryText(booking),
      }),
    });

    const brevoData = await brevoRes.json().catch(() => ({}));
    if (!brevoRes.ok) {
      console.error("Brevo error:", brevoData);
      return new Response(JSON.stringify({ error: brevoData.message || "Failed to send email." }), {
        status: 502,
        headers: jsonHeaders,
      });
    }

    return new Response(
      JSON.stringify({ ok: true, message: `Itinerary sent to ${to}`, id: brevoData.messageId }),
      { headers: jsonHeaders }
    );
  } catch (err) {
    console.error("Send error:", err);
    return new Response(
      JSON.stringify({ error: "Failed to send email. Check function logs / Brevo setup." }),
      { status: 502, headers: jsonHeaders }
    );
  }
});

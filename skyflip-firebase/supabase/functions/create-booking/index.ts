import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

function genRef() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let ref = "";
  for (let i = 0; i < 6; i++) ref += chars[Math.floor(Math.random() * chars.length)];
  return ref;
}

function isValidEmail(email: unknown): email is string {
  return typeof email === "string" && /^\S+@\S+\.\S+$/.test(email);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

  try {
    const BOOKING_PASSCODE = Deno.env.get("BOOKING_PASSCODE");
    // SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically
    // by Supabase into every Edge Function — no manual setup needed for these two.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json().catch(() => ({}));
    const { passcode, flight, date, passengers, passenger } = body || {};

    if (!BOOKING_PASSCODE) {
      return new Response(
        JSON.stringify({ error: "Booking passcode isn't configured on the server yet." }),
        { status: 500, headers: jsonHeaders }
      );
    }
    if (typeof passcode !== "string" || passcode !== BOOKING_PASSCODE) {
      return new Response(JSON.stringify({ error: "Incorrect passcode." }), {
        status: 401,
        headers: jsonHeaders,
      });
    }
    if (!flight || !flight.from || !flight.to || !date || !passengers || !passenger) {
      return new Response(JSON.stringify({ error: "Missing booking details." }), {
        status: 400,
        headers: jsonHeaders,
      });
    }
    if (!passenger.name || !isValidEmail(passenger.email)) {
      return new Response(
        JSON.stringify({ error: "A valid passenger name and email are required." }),
        { status: 400, headers: jsonHeaders }
      );
    }

    let ref = "";
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = genRef();
      const { data: existing } = await supabase
        .from("bookings")
        .select("ref")
        .eq("ref", candidate)
        .maybeSingle();
      if (!existing) {
        ref = candidate;
        break;
      }
    }
    if (!ref) {
      return new Response(
        JSON.stringify({ error: "Could not generate a unique booking reference, please try again." }),
        { status: 500, headers: jsonHeaders }
      );
    }

    const booking = {
      ref,
      flight,
      date,
      passengers,
      passenger,
      total: flight.price * passengers,
      createdAt: Date.now(),
    };

    const { error: insertError } = await supabase.from("bookings").insert({
      ref,
      email: passenger.email.toLowerCase(),
      data: booking,
    });
    if (insertError) throw insertError;

    return new Response(JSON.stringify({ ok: true, booking }), { headers: jsonHeaders });
  } catch (err) {
    console.error("Create booking error:", err);
    return new Response(JSON.stringify({ error: "Failed to create booking. Please try again." }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
});

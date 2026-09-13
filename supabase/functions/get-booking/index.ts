import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const url = new URL(req.url);
    const ref = (url.searchParams.get("ref") || "").toUpperCase();
    const email = (url.searchParams.get("email") || "").toLowerCase();

    if (!ref || !email) {
      return new Response(
        JSON.stringify({ error: "Booking reference and email are required." }),
        { status: 400, headers: jsonHeaders }
      );
    }

    const { data, error } = await supabase
      .from("bookings")
      .select("data")
      .eq("ref", ref)
      .eq("email", email)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return new Response(
        JSON.stringify({ error: "No booking found for that reference and email." }),
        { status: 404, headers: jsonHeaders }
      );
    }

    return new Response(JSON.stringify({ ok: true, booking: data.data }), { headers: jsonHeaders });
  } catch (err) {
    console.error("Lookup booking error:", err);
    return new Response(JSON.stringify({ error: "Failed to look up booking. Please try again." }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
});

// Shared CORS headers — the frontend (Firebase Hosting) and backend
// (Supabase Edge Functions) run on different domains, so every function
// needs to explicitly allow cross-origin requests.
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

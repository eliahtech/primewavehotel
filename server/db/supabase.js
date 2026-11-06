// server/db/supabase.js
// Replaces server/db/pool.js (mysql2). Uses the SERVICE ROLE key —
// our Express server does its own auth/role checks in
// middleware/auth.js + middleware/requireRole.js, so Row Level
// Security policies are not required for this app to be safe;
// the service role key bypasses RLS entirely, which is what we want
// since the DB is never touched directly by a browser.
//
// NEVER expose SUPABASE_SERVICE_ROLE_KEY to a frontend — it has
// full read/write access to every table with no restrictions.

const { createClient } = require("@supabase/supabase-js");

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn("[supabase] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — requests will fail.");
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

module.exports = supabase;

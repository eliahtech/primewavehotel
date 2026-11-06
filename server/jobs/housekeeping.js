// server/jobs/housekeeping.js — shared by Vercel Cron and the system-owner "run now" button.
const supabase = require("../db/supabase");
const { newId } = require("../utils/helpers");
const { autoDeleteOldData } = require("./autoDelete");

async function runHousekeeping(trigger = "cron") {
  const started = new Date();
  let status = "success", error = null, removed = 0;
  try {
    const now = new Date().toISOString();
    await supabase.from("pending_sessions").delete().lt("expires_at", now);
    await supabase.from("bookings").update({ status: "cancelled", notes: "auto-cancelled (unpaid)" })
      .eq("status", "pending_payment").lt("created_at", new Date(Date.now() - 30 * 60000).toISOString());
    await supabase.from("rate_limits").delete().lt("window_start", new Date(Date.now() - 86400000).toISOString());
    removed = await autoDeleteOldData();
  } catch (e) {
    status = "failed"; error = e.message;
    console.error("[housekeeping]", e);
  }
  await supabase.from("job_log").insert({
    log_id: newId(), job_name: "housekeeping", trigger_type: trigger, started_at: started.toISOString(),
    duration_ms: Date.now() - started.getTime(), status, records_processed: String(removed), error_message: error,
  });
  if (status === "failed") throw new Error(error);
  return removed;
}

module.exports = { runHousekeeping };

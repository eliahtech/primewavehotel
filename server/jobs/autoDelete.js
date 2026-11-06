// server/jobs/autoDelete.js — invoked by /api/cron/housekeeping (no in-process scheduler)
const supabase = require("../db/supabase");
const { CONFIG } = require("../config/config");
const { newId } = require("../utils/helpers");
const { sendEmail } = require("../services/mailer");

async function autoDeleteOldData() {
  const cutoff = new Date(Date.now() - CONFIG.AUTO_DELETE_DAYS * 86400000).toISOString();

  const { data: toDelete, error: selErr } = await supabase
    .from("bookings").select("*").lt("checkout_date", cutoff)
    .in("status", ["confirmed", "checked_out", "cancelled"]).limit(500);
  if (selErr) throw selErr;
  if (!toDelete.length) return 0;

  const ids = toDelete.map(b => b.booking_id);
  const { data: oldPayments, error: payErr } = await supabase.from("payments").select("*").in("booking_id", ids);
  if (payErr) throw payErr;

  // Archive FIRST, and only delete exactly the rows that were archived (by id, not by predicate).
  if (CONFIG.ARCHIVE_BEFORE_DELETE) {
    const rows = [
      ...toDelete.map(r => ({ archived_id: newId(), source_sheet: "bookings", data: r, deleted_by: "auto-delete" })),
      ...oldPayments.map(p => ({ archived_id: newId(), source_sheet: "payments", data: p, deleted_by: "auto-delete" })),
    ];
    const { error: archErr } = await supabase.from("archive").insert(rows);
    if (archErr) throw archErr;
  }

  const { error: delErr } = await supabase.from("bookings").delete().in("booking_id", ids); // payments cascade
  if (delErr) throw delErr;

  await sendEmail({
    to: CONFIG.ADMIN_EMAIL,
    subject: `${CONFIG.HOTEL_NAME} — Auto-Delete Report`,
    body: `${toDelete.length} booking(s) archived and removed (checkout before ${cutoff.slice(0, 10)}).\n\n` +
      toDelete.map(b => "• " + b.booking_id + " | " + b.guest_name + " | " + String(b.checkout_date).slice(0, 10)).join("\n"),
  });
  return toDelete.length;
}

module.exports = { autoDeleteOldData };

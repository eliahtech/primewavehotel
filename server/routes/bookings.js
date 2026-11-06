// server/routes/bookings.js
const express = require("express");
const router  = express.Router();
const supabase = require("../db/supabase");
const { authenticate } = require("../middleware/auth");
const { requireRole }  = require("../middleware/requireRole");
const { ROLES, ROLE_LEVEL, CONFIG } = require("../config/config");
const { logAudit, AUDIT_ACTIONS, reqMeta } = require("../services/audit");
const { sanitize, asyncHandler, httpError, parseRange } = require("../utils/helpers");

// ilike treats % and _ as wildcards — escape them so an email is matched literally
const escLike = v => String(v).replace(/[\\%_]/g, c => "\\" + c);

const STATUSES = ["pending_payment", "confirmed", "checked_in", "checked_out", "cancelled"];
const PAY_STATUSES = ["pending", "paid", "failed", "refunded"];

function isOwner(booking, user) {
  return (booking.user_id && booking.user_id === user.user_id) ||
         String(booking.guest_email || "").toLowerCase() === String(user.email || "").toLowerCase();
}

// NOTE: guests no longer create bookings directly. Online bookings are created
// only after PesaPal confirms payment (POST /api/payments/initiate-session),
// and staff use POST /api/payments/walk-in.

// GET /api/bookings/mine
router.get("/mine", authenticate, asyncHandler(async (req, res) => {
  const [byId, byEmail] = await Promise.all([
    supabase.from("bookings").select("*").eq("user_id", req.user.user_id),
    supabase.from("bookings").select("*").ilike("guest_email", escLike(req.user.email)),
  ]);
  if (byId.error) throw byId.error;
  if (byEmail.error) throw byEmail.error;
  const map = new Map();
  [...byId.data, ...byEmail.data].forEach(b => map.set(b.booking_id, b));
  const list = [...map.values()].sort((a, b) => new Date(b.checkin_date) - new Date(a.checkin_date));

  const rIds = [...new Set(list.map(b => b.room_id).filter(Boolean))], tIds = [...new Set(list.map(b => b.table_id).filter(Boolean))];
  const [rr, tt] = await Promise.all([
    rIds.length ? supabase.from("rooms").select("id,room_number,room_type").in("id", rIds) : { data: [] },
    tIds.length ? supabase.from("tables_").select("id,table_name,table_number").in("id", tIds) : { data: [] },
  ]);
  const label = {};
  (rr.data || []).forEach(r => label[r.id] = `Room ${r.room_number} — ${r.room_type}`);
  (tt.data || []).forEach(t => label[t.id] = `${t.table_name} (${t.table_number})`);
  list.forEach(b => { b.item_label = label[b.room_id || b.table_id] || "—"; });
  res.json({ status: "success", data: list });
}));

// GET /api/bookings/:id/receipt   (owner of the booking, or admin+)
router.get("/:id/receipt", authenticate, asyncHandler(async (req, res) => {
  const { data: booking, error } = await supabase.from("bookings").select("*").eq("booking_id", req.params.id).maybeSingle();
  if (error) throw error;
  if (!booking) throw httpError(404, "Booking not found.");
  if (ROLE_LEVEL[req.user.role] < ROLE_LEVEL[ROLES.ADMIN] && !isOwner(booking, req.user)) {
    throw httpError(403, "You can only view your own receipts.");
  }
  const [{ data: payments }, itemRes] = await Promise.all([
    supabase.from("payments").select("*").eq("booking_id", booking.booking_id).eq("status", "completed"),
    booking.type === "table"
      ? supabase.from("tables_").select("table_name,table_number").eq("id", booking.table_id).maybeSingle()
      : supabase.from("rooms").select("room_number,room_type").eq("id", booking.room_id).maybeSingle(),
  ]);
  const it = itemRes.data;
  const item_label = it ? (booking.type === "table" ? `${it.table_name} (${it.table_number})` : `Room ${it.room_number} — ${it.room_type}`) : "—";
  res.json({ status: "success", data: { booking, payments: payments || [], item_label,
    hotel: { name: CONFIG.HOTEL_NAME, email: CONFIG.ADMIN_EMAIL }, timezone: CONFIG.TIMEZONE } });
}));

// POST /api/bookings/:id/cancel
router.post("/:id/cancel", authenticate, asyncHandler(async (req, res) => {
  const { data: booking, error: selErr } = await supabase
    .from("bookings").select("*").eq("booking_id", req.params.id).maybeSingle();
  if (selErr) throw selErr;
  if (!booking) throw httpError(404, "Booking not found.");
  if (booking.status === "cancelled") return res.json({ status: "success", message: "Booking already cancelled." });

  const isStaff = ROLE_LEVEL[req.user.role] >= ROLE_LEVEL[ROLES.ADMIN];
  if (!isStaff) {
    if (!isOwner(booking, req.user)) throw httpError(403, "You can only cancel your own bookings.");
    if (booking.payment_status === "paid") {
      throw httpError(400, "This booking has been paid and cannot be cancelled online. Please contact us at " + CONFIG.ADMIN_EMAIL + " for assistance.");
    }
  }

  const { error: updErr } = await supabase.from("bookings")
    .update({ status: "cancelled", notes: (booking.notes || "") + " | Cancelled by " + req.user.email })
    .eq("booking_id", req.params.id);
  if (updErr) throw updErr;
  await logAudit(AUDIT_ACTIONS.BOOKING_CANCEL, { userEmail: req.user.email, userRole: req.user.role, entityType: "Booking", entityId: req.params.id, ...reqMeta(req) });
  res.json({ status: "success", message: "Booking cancelled." });
}));

// GET /api/bookings   (admin+)
router.get("/", authenticate, requireRole(ROLES.ADMIN), asyncHandler(async (req, res) => {
  const { status, type, date, room_id, national_id, source, session_id } = req.query;
  let q = supabase.from("bookings").select("*");
  if (status)      q = q.eq("status", status);
  if (type)        q = q.eq("type", type);
  if (date) {
    const start = new Date(date + "T00:00:00+03:00");
    if (!isNaN(start)) q = q.gte("checkin_date", start.toISOString()).lt("checkin_date", new Date(start.getTime() + 86400000).toISOString());
  }
  if (room_id)     q = q.eq("room_id", room_id);
  if (national_id) q = q.eq("national_id", national_id);
  if (source)      q = q.eq("source", source);
  if (session_id)  q = q.eq("session_id", session_id);
  q = q.order("created_at", { ascending: false }).limit(500);
  const { data, error } = await q;
  if (error) throw error;
  res.json({ status: "success", data });
}));

// PUT /api/bookings/:id   (admin+)
router.put("/:id", authenticate, requireRole(ROLES.ADMIN), asyncHandler(async (req, res) => {
  const allowed = ["status", "checkin_date", "checkout_date", "num_guests", "payment_status", "payment_method", "notes", "national_id"];
  const updates = {};
  allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
  if (!Object.keys(updates).length) throw httpError(400, "No fields to update.");

  if (updates.status !== undefined && !STATUSES.includes(updates.status)) throw httpError(400, "Invalid status.");
  if (updates.payment_status !== undefined && !PAY_STATUSES.includes(updates.payment_status)) throw httpError(400, "Invalid payment status.");
  if (updates.checkin_date || updates.checkout_date) {
    const { data: cur } = await supabase.from("bookings").select("checkin_date,checkout_date").eq("booking_id", req.params.id).maybeSingle();
    if (!cur) throw httpError(404, "Booking not found.");
    const r = parseRange(updates.checkin_date || cur.checkin_date, updates.checkout_date || cur.checkout_date, { allowPast: true, maxDays: 365 });
    updates.checkin_date = r.checkin; updates.checkout_date = r.checkout;
  }
  ["notes", "payment_method", "national_id"].forEach(f => { if (updates[f] !== undefined) updates[f] = sanitize(updates[f]); });

  const { data, error } = await supabase.from("bookings").update(updates).eq("booking_id", req.params.id).select();
  if (error) {
    if (error.code === "23P01") throw httpError(409, "Those dates overlap another active booking.");
    throw error;
  }
  if (!data.length) throw httpError(404, "Booking not found.");

  // Physical room state follows the guest's stay, not the booking's creation.
  const b = data[0];
  if (b.type === "room" && b.room_id && updates.status) {
    if (updates.status === "checked_in")  await supabase.from("rooms").update({ status: "occupied" }).eq("id", b.room_id).neq("status", "maintenance");
    if (updates.status === "checked_out") await supabase.from("rooms").update({ status: "available" }).eq("id", b.room_id).eq("status", "occupied");
  }
  await logAudit(AUDIT_ACTIONS.BOOKING_UPDATE, { userEmail: req.user.email, userRole: req.user.role, entityType: "Booking", entityId: req.params.id, newValue: updates, ...reqMeta(req) });
  res.json({ status: "success", message: "Booking updated." });
}));

module.exports = router;

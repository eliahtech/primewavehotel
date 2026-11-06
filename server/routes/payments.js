// server/routes/payments.js — PesaPal pay-first flow + admin payment tools
const express = require("express");
const router  = express.Router();
const supabase = require("../db/supabase");
const { authenticate } = require("../middleware/auth");
const { requireRole }  = require("../middleware/requireRole");
const { payLimit }     = require("../middleware/rateLimit");
const { ROLES, CONFIG } = require("../config/config");
const { sendEmail } = require("../services/mailer");
const { quoteBooking } = require("../services/booking");
const { resolveSession } = require("../services/paymentFlow");
const crypto = require("crypto");
const { savePendingSession, getPendingSession } = require("../services/pendingSessions");
const pesapal = require("../services/pesapal");
const { logAudit, AUDIT_ACTIONS, reqMeta } = require("../services/audit");
const {
  sanitize, validateRequired, newId, generateBookingId, calcNights, calcHours,
  asyncHandler, httpError, parseRange,
} = require("../utils/helpers");

const PAY_METHODS = ["cash", "mpesa", "card", "bank", "pesapal", "other"];

// ─────────────────────────────────────────────────────────────
// POST /api/payments/initiate-session   (logged-in guest)
// Price is ALWAYS computed server-side; the client only picks the item + dates.
// ─────────────────────────────────────────────────────────────
router.post("/initiate-session", payLimit, authenticate, asyncHandler(async (req, res) => {
  const quote = await quoteBooking(req.body);
  if (quote.taken) return res.json({ status: "taken", message: quote.message });

  const sessionId = crypto.randomBytes(12).toString("hex");
  const session = { ...quote.session, session_id: sessionId, user_id: req.user.user_id };
  await savePendingSession(sessionId, session);

  // The return URL is built server-side — never trust a client-supplied redirect target.
  const callback_url = `${CONFIG.PUBLIC_BASE_URL}/book.html?return=1&sid=${sessionId}`;
  let order;
  try {
    order = await pesapal.createOrder({
      session_id: sessionId, name: session.guest_name, email: session.guest_email, phone: session.guest_phone,
      amount: session.total_amount, type: session.type, callback_url,
    });
  } catch (e) {
    console.error("[initiate-session] PesaPal:", e.message);
    throw httpError(502, "Could not reach the payment gateway. Please try again.");
  }
  await savePendingSession(sessionId, { ...session, pesapal_tracking_id: order.order_tracking_id });

  res.json({ status: "success", redirect_url: order.redirect_url, session_id: sessionId, amount: session.total_amount });
}));

// POST /api/payments/session-status   body: { session_id }
router.post("/session-status", payLimit, asyncHandler(async (req, res) => {
  const sessionId = String(req.body.session_id || "").trim();
  if (!/^[a-f0-9]{24}$/.test(sessionId)) throw httpError(400, "Invalid session.");
  res.json(await resolveSession(sessionId));
}));

// GET /api/payments/pesapal-callback   (IPN, server-to-server — public by design)
router.get("/pesapal-callback", asyncHandler(async (req, res) => {
  const sessionId = String(req.query.OrderMerchantReference || "");
  const trackingId = String(req.query.OrderTrackingId || "");
  if (/^[a-f0-9]{24}$/.test(sessionId)) {
    try { await resolveSession(sessionId); } catch (e) { console.error("[ipn]", e.message); }
  }
  res.json({ orderNotificationType: "IPNCHANGE", orderTrackingId: trackingId, orderMerchantReference: sessionId, status: 200 });
}));

// ─────────────────────────────────────────────────────────────
// ADMIN: manual payment log (for cash/bank payments recorded after the fact)
// ─────────────────────────────────────────────────────────────
router.post("/log", authenticate, requireRole(ROLES.ADMIN), asyncHandler(async (req, res) => {
  const body = req.body;
  validateRequired(body, ["booking_id", "amount", "method", "status"]);
  const amount = Number(body.amount);
  if (!(amount > 0)) throw httpError(400, "Amount must be greater than zero.");
  if (!["pending", "completed", "failed", "refunded"].includes(body.status)) throw httpError(400, "Invalid status.");
  const method = sanitize(body.method).toLowerCase();
  if (!PAY_METHODS.includes(method)) throw httpError(400, "Invalid payment method.");

  const { data: booking, error: bErr } = await supabase.from("bookings").select("*").eq("booking_id", body.booking_id).maybeSingle();
  if (bErr) throw bErr;
  if (!booking) throw httpError(404, "Booking not found.");

  const payment = {
    payment_id: newId(), booking_id: booking.booking_id, amount, currency: "KES", method,
    status: body.status, tracking_id: sanitize(body.tracking_id || ""),
    national_id: sanitize(body.national_id || booking.national_id || ""),
    guest_name: booking.guest_name, source: "walk_in",
  };
  const { error: payErr } = await supabase.from("payments").insert(payment);
  if (payErr) throw payErr;

  if (body.status === "completed") {
    const { error: updErr } = await supabase.from("bookings").update({
      status: booking.status === "pending_payment" ? "confirmed" : booking.status,
      payment_status: "paid", payment_method: method,
    }).eq("booking_id", booking.booking_id);
    if (updErr) throw updErr;
  }
  await logAudit(AUDIT_ACTIONS.PAYMENT_LOG, { userEmail: req.user.email, userRole: req.user.role, entityType: "Booking",
    entityId: booking.booking_id, newValue: { amount, method, status: body.status }, ...reqMeta(req) });
  res.json({ status: "success", data: payment, message: "Payment logged." });
}));

// GET /api/payments/mine   (logged-in guest) — payments on the guest's own bookings
router.get("/mine", authenticate, asyncHandler(async (req, res) => {
  const esc = v => String(v).replace(/[\\%_]/g, c => "\\" + c);
  const [a, b] = await Promise.all([
    supabase.from("bookings").select("booking_id").eq("user_id", req.user.user_id),
    supabase.from("bookings").select("booking_id").ilike("guest_email", esc(req.user.email)),
  ]);
  if (a.error) throw a.error;
  if (b.error) throw b.error;
  const ids = [...new Set([...a.data, ...b.data].map(x => x.booking_id))];
  if (!ids.length) return res.json({ status: "success", data: [] });
  const { data, error } = await supabase.from("payments").select("payment_id,booking_id,amount,currency,method,status,tracking_id,created_at")
    .in("booking_id", ids).order("created_at", { ascending: false }).limit(200);
  if (error) throw error;
  res.json({ status: "success", data });
}));

// GET /api/payments   (admin+)
router.get("/", authenticate, requireRole(ROLES.ADMIN), asyncHandler(async (req, res) => {
  const { booking_id, national_id, source, method } = req.query;
  let q = supabase.from("payments").select("*");
  if (booking_id)  q = q.eq("booking_id", booking_id);
  if (national_id) q = q.eq("national_id", national_id);
  if (source)      q = q.eq("source", source);
  if (method)      q = q.eq("method", method);
  q = q.order("created_at", { ascending: false }).limit(500);
  const { data, error } = await q;
  if (error) throw error;
  res.json({ status: "success", data });
}));

// POST /api/payments/walk-in   (admin+)
router.post("/walk-in", authenticate, requireRole(ROLES.ADMIN), asyncHandler(async (req, res) => {
  const body = req.body;
  validateRequired(body, ["guest_name", "guest_phone", "national_id", "amount", "method", "checkin", "checkout", "guests"]);
  if (!body.room_id && !body.table_id) throw httpError(400, "Please select a room or table.");

  const nid = sanitize(String(body.national_id).trim());
  if (!/^\d{7,8}$/.test(nid)) throw httpError(400, "National ID must be 7-8 digits.");
  const method = sanitize(body.method).toLowerCase();
  if (!PAY_METHODS.includes(method)) throw httpError(400, "Invalid payment method.");
  const amount = Number(body.amount);
  if (!(amount > 0)) throw httpError(400, "Amount must be greater than zero.");

  const isTable = body.type === "table" || !!body.table_id;
  const range = parseRange(body.checkin, body.checkout, { isTable, allowPast: true });
  const nights = isTable ? Math.max(1, calcHours(range.checkin, range.checkout)) : calcNights(range.checkin, range.checkout);
  const subtotal = Math.round(amount / 1.16);
  const tax = amount - subtotal;
  const bookingId = generateBookingId();

  const booking = {
    booking_id: bookingId, type: isTable ? "table" : "room",
    room_id: isTable ? null : body.room_id, table_id: isTable ? body.table_id : null,
    guest_name: sanitize(body.guest_name), guest_phone: sanitize(body.guest_phone),
    guest_email: sanitize(body.guest_email || ""),
    checkin_date: range.checkin, checkout_date: range.checkout,
    num_guests: Math.max(1, Math.floor(Number(body.guests))), nights, subtotal, tax, total_amount: amount,
    status: "confirmed", payment_status: "paid", payment_method: method, pesapal_tracking_id: "",
    notes: sanitize(body.notes || "") + " | Walk-in by " + req.user.email,
    national_id: nid, source: "walk_in", session_id: "",
  };

  const { error: bookErr } = await supabase.from("bookings").insert(booking);
  if (bookErr) {
    if (bookErr.code === "23P01") throw httpError(409, "That room/table is already booked for the selected dates.");
    if (bookErr.code === "23503") throw httpError(404, "Room or table not found.");
    throw bookErr;
  }

  const payment = {
    payment_id: newId(), booking_id: bookingId, amount, currency: "KES", method, status: "completed",
    tracking_id: sanitize(body.tracking_id || ""), national_id: nid, guest_name: booking.guest_name, source: "walk_in",
  };
  const { error: payErr } = await supabase.from("payments").insert(payment);
  if (payErr) {
    await supabase.from("bookings").delete().eq("booking_id", bookingId); // don't leave a paid booking with no payment record
    throw payErr;
  }

  await logAudit(AUDIT_ACTIONS.WALKIN_CREATE, { userEmail: req.user.email, userRole: req.user.role, entityType: "Booking",
    entityId: bookingId, newValue: { amount, method }, ...reqMeta(req) });

  await sendEmail({
    to: CONFIG.ADMIN_EMAIL,
    subject: `Walk-in — ${bookingId} | KES ${amount.toLocaleString()}`,
    body: "Walk-in by: " + req.user.email + "\nGuest: " + booking.guest_name + "\nPhone: " + booking.guest_phone +
      "\nType: " + booking.type + "\nAmount: KES " + amount.toLocaleString() + "\nMethod: " + method + "\nBooking ID: " + bookingId,
  });

  res.json({ status: "success", booking_id: bookingId, total: amount, message: "Walk-in recorded.", data: { booking, payment } });
}));

module.exports = router;

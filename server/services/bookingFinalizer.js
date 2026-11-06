// server/services/bookingFinalizer.js
// Turns a PAID pending session into a confirmed booking. Called ONLY after
// PesaPal confirms COMPLETED. Fully idempotent: IPN callback and the browser's
// status polling can race, and both are safe.

const supabase = require("../db/supabase");
const { CONFIG } = require("../config/config");
const { newId, generateBookingId } = require("../utils/helpers");
const { sendEmail } = require("./mailer");
const { deletePendingSession } = require("./pendingSessions");
const { logAudit, AUDIT_ACTIONS } = require("./audit");

function receiptUrl(bookingId) {
  return `${CONFIG.PUBLIC_BASE_URL}/receipt.html?booking_id=${encodeURIComponent(bookingId)}`;
}

async function sendReceiptEmail(r) {
  if (!r.guest_email) return;
  const isTable = r.type === "table";
  const n = Number(r.nights) || 1;
  const durLabel = isTable ? `${n} hr${n !== 1 ? "s" : ""}` : `${n} night${n !== 1 ? "s" : ""}`;
  await sendEmail({
    to: r.guest_email,
    subject: `${CONFIG.HOTEL_NAME} — Receipt: ${r.booking_id}`,
    body:
      "Dear " + r.guest_name + ",\n\nPayment confirmed! Your booking is now active.\n\n" +
      "Booking ID    : " + r.booking_id + "\n" +
      "Type          : " + (isTable ? "Table Reservation" : "Room Booking") + "\n" +
      "Item          : " + (r.item_label || "—") + "\n" +
      "Check-in      : " + new Date(r.checkin_date).toLocaleString("en-GB", { timeZone: CONFIG.TIMEZONE }) + "\n" +
      "Check-out     : " + new Date(r.checkout_date).toLocaleString("en-GB", { timeZone: CONFIG.TIMEZONE }) + "\n" +
      "Duration      : " + durLabel + "\n" +
      "Guests        : " + r.num_guests + "\n" +
      "Subtotal      : KES " + Number(r.subtotal || 0).toLocaleString() + "\n" +
      "VAT (16%)     : KES " + Number(r.tax || 0).toLocaleString() + "\n" +
      "TOTAL PAID    : KES " + Number(r.total_amount || 0).toLocaleString() + "\n" +
      "Payment Method: " + (r.payment_method || "PesaPal") + "\n" +
      "Tracking Ref  : " + (r.pesapal_tracking_id || "N/A") + "\n\n" +
      "View your receipt (login required):\n" + receiptUrl(r.booking_id) + "\n\n" +
      "For enquiries: " + CONFIG.ADMIN_EMAIL + "\n\nWarm regards,\n" + CONFIG.HOTEL_NAME + " Team",
  });
}

/**
 * @returns {Promise<{ok:true, booking_id:string, already?:boolean} | {ok:false, conflict:true}>}
 */
async function finaliseBooking(session, pesapalStatus) {
  // 1) Already finalised (IPN + poll race, or user refreshed)?
  const { data: existing, error: exErr } = await supabase
    .from("bookings").select("booking_id").eq("session_id", session.session_id).maybeSingle();
  if (exErr) throw exErr;
  if (existing) { await deletePendingSession(session.session_id); return { ok: true, booking_id: existing.booking_id, already: true }; }

  const method = pesapalStatus?.payment_method || "PesaPal";
  const trackingId = pesapalStatus?.order_tracking_id || session.pesapal_tracking_id || "";
  const bookingId = generateBookingId();

  const booking = {
    booking_id: bookingId, type: session.type,
    room_id: session.room_id || null, table_id: session.table_id || null,
    user_id: session.user_id || null,
    guest_name: session.guest_name, guest_phone: session.guest_phone, guest_email: session.guest_email,
    checkin_date: session.checkin_date, checkout_date: session.checkout_date,
    num_guests: session.num_guests, nights: session.nights,
    subtotal: session.subtotal, tax: session.tax, total_amount: session.total_amount,
    status: "confirmed", payment_status: "paid", payment_method: method,
    pesapal_tracking_id: trackingId, notes: session.notes || "",
    national_id: session.national_id || "", source: "online", session_id: session.session_id,
  };

  const { error: bErr } = await supabase.from("bookings").insert(booking);
  if (bErr) {
    if (bErr.code === "23505") { // lost the race to a parallel finaliser
      const { data: again } = await supabase.from("bookings").select("booking_id").eq("session_id", session.session_id).maybeSingle();
      if (again) return { ok: true, booking_id: again.booking_id, already: true };
    }
    if (bErr.code === "23P01") { // paid, but the slot was taken in the meantime → needs a refund
      await handlePaidConflict(session, trackingId);
      return { ok: false, conflict: true };
    }
    throw bErr;
  }

  const { error: pErr } = await supabase.from("payments").insert({
    payment_id: newId(), booking_id: bookingId, amount: session.total_amount, currency: "KES",
    method, status: "completed", tracking_id: trackingId, national_id: session.national_id || "",
    guest_name: session.guest_name, source: "online",
  });
  if (pErr) {
    console.error("[finalise] payment row failed:", pErr.message);
    await logAudit(AUDIT_ACTIONS.SECURITY_EVENT, { entityType: "Booking", entityId: bookingId, status: "failed", severity: "warn",
      newValue: { problem: "booking paid but payments row failed", error: pErr.message, tracking: trackingId } });
  }

  await sendReceiptEmail({ ...booking, item_label: session.item_label });
  await sendEmail({
    to: CONFIG.ADMIN_EMAIL,
    subject: `New Booking — ${bookingId}`,
    body: "Payment confirmed.\n\nBooking ID: " + bookingId + "\nGuest: " + session.guest_name +
      "\nEmail: " + session.guest_email + "\nPhone: " + session.guest_phone +
      "\nItem: " + session.item_label + "\nCheck-in: " + session.checkin_date + "\nCheck-out: " + session.checkout_date +
      "\nTotal: KES " + Number(session.total_amount).toLocaleString() + "\nTracking: " + (trackingId || "N/A"),
  });

  await deletePendingSession(session.session_id);
  await logAudit(AUDIT_ACTIONS.PAYMENT_LOG, {
    entityType: "Booking", entityId: bookingId,
    newValue: { total: session.total_amount, method, tracking: trackingId, source: "pesapal" },
  });
  return { ok: true, booking_id: bookingId };
}

async function handlePaidConflict(session, trackingId) {
  console.error("[finalise] PAID BUT SLOT TAKEN", session.session_id, trackingId);
  await logAudit(AUDIT_ACTIONS.SECURITY_EVENT, { entityType: "Session", entityId: session.session_id, status: "failed", severity: "critical",
    newValue: { problem: "paid but slot already booked — refund required", tracking: trackingId, amount: session.total_amount } });
  await sendEmail({
    to: CONFIG.ADMIN_EMAIL,
    subject: `ACTION REQUIRED — paid booking conflict (${session.session_id})`,
    body: "A guest paid via PesaPal but the room/table was booked by someone else first.\nRefund them in the PesaPal dashboard and contact them.\n\n" +
      "Guest: " + session.guest_name + "\nEmail: " + session.guest_email + "\nPhone: " + session.guest_phone +
      "\nAmount: KES " + Number(session.total_amount).toLocaleString() + "\nPesaPal tracking: " + trackingId +
      "\nItem: " + session.item_label + "\nDates: " + session.checkin_date + " → " + session.checkout_date,
  });
  if (session.guest_email) {
    await sendEmail({
      to: session.guest_email,
      subject: `${CONFIG.HOTEL_NAME} — Action needed on your payment`,
      body: "Dear " + session.guest_name + ",\n\nYour payment was received, but unfortunately the selected room/table was reserved by another guest moments earlier. " +
        "We will refund you in full — please contact us at " + CONFIG.ADMIN_EMAIL + " with reference " + trackingId + ".\n\nWe apologise for the inconvenience.\n" + CONFIG.HOTEL_NAME,
    });
  }
  await deletePendingSession(session.session_id);
}

module.exports = { finaliseBooking, sendReceiptEmail, receiptUrl };

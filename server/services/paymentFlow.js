// server/services/paymentFlow.js
// Confirms a PesaPal session with PesaPal itself (never trusting the browser) and finalises the booking.

const supabase = require("../db/supabase");
const { CONFIG } = require("../config/config");
const pesapal = require("./pesapal");
const { getPendingSession } = require("./pendingSessions");
const { finaliseBooking, receiptUrl } = require("./bookingFinalizer");
const { logAudit, AUDIT_ACTIONS } = require("./audit");

/** @returns {Promise<{status:'confirmed'|'pending'|'failed', booking_id?:string, receipt_url?:string, message?:string}>} */
async function resolveSession(sessionId) {
  const { data: booking, error } = await supabase
    .from("bookings").select("booking_id").eq("session_id", sessionId).maybeSingle();
  if (error) throw error;
  if (booking) return { status: "confirmed", booking_id: booking.booking_id, receipt_url: receiptUrl(booking.booking_id) };

  const session = await getPendingSession(sessionId);
  if (!session) return { status: "failed", message: "This payment session has expired. If you were charged, please contact " + CONFIG.ADMIN_EMAIL + "." };
  if (!session.pesapal_tracking_id) return { status: "pending" };

  const st = await pesapal.getTransactionStatus(session.pesapal_tracking_id);
  const desc = String(st.payment_status_description || "").toLowerCase();

  if (desc === "completed") {
    const paid = Number(st.amount);
    if (st.merchant_reference && String(st.merchant_reference) !== sessionId) {
      return { status: "failed", message: "Payment reference mismatch." };
    }
    // If PesaPal reports an amount it must match what we quoted (±KES 1 rounding).
    if (paid && Math.abs(paid - Number(session.total_amount)) > 1) {
      await logAudit(AUDIT_ACTIONS.SECURITY_EVENT, { entityType: "Session", entityId: sessionId, severity: "critical", status: "failed",
        newValue: { problem: "amount mismatch", expected: session.total_amount, paid } });
      return { status: "failed", message: "Payment amount mismatch. Please contact " + CONFIG.ADMIN_EMAIL + "." };
    }
    const r = await finaliseBooking(session, st);
    if (!r.ok) return { status: "failed", message: "Your payment was received but the slot was just taken. We will refund you — check your email." };
    return { status: "confirmed", booking_id: r.booking_id, receipt_url: receiptUrl(r.booking_id) };
  }
  if (["failed", "invalid", "reversed"].includes(desc)) return { status: "failed", message: "Payment was not completed." };
  return { status: "pending" };
}

module.exports = { resolveSession };

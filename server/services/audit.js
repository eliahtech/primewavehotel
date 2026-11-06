// server/services/audit.js
// Replaces logAudit() / AUDIT_ACTIONS from SystemOps.gs, plus the
// Audit.gs helpers that Auth.gs/PasswordReset.gs called (logLogin,
// logLoginFailed, logOtpRequest, ...), which were never sent but are
// all just logAudit() with a specific action name.
// Audit rows are append-only. logAudit NEVER throws — a failed audit
// write must not break the request that triggered it.

const supabase = require("../db/supabase");
const { newId } = require("../utils/helpers");

const AUDIT_ACTIONS = {
  LOGIN_SUCCESS: "LOGIN_SUCCESS", LOGIN_FAILED: "LOGIN_FAILED", LOGOUT: "LOGOUT",
  PASSWORD_CHANGE: "PASSWORD_CHANGE", PASSWORD_RESET: "PASSWORD_RESET",
  PASSWORD_RESET_COMPLETED: "PASSWORD_RESET_COMPLETED", PASSWORD_RESET_ADMIN_BLOCK: "PASSWORD_RESET_ADMIN_BLOCK",
  OTP_REQUESTED: "OTP_REQUESTED", OTP_VERIFIED: "OTP_VERIFIED", OTP_FAILED: "OTP_FAILED", OTP_LOCKED: "OTP_LOCKED",
  USER_CREATE: "USER_CREATE", USER_UPDATE: "USER_UPDATE", USER_DELETE: "USER_DELETE",
  ROLE_CHANGE: "ROLE_CHANGE", ACCOUNT_LOCK: "ACCOUNT_LOCK", ACCOUNT_UNLOCK: "ACCOUNT_UNLOCK",
  BOOKING_CREATE: "BOOKING_CREATE", BOOKING_UPDATE: "BOOKING_UPDATE", BOOKING_CANCEL: "BOOKING_CANCEL",
  PAYMENT_LOG: "PAYMENT_LOG", WALKIN_CREATE: "WALKIN_CREATE",
  ROOM_ADD: "ROOM_ADD", ROOM_EDIT: "ROOM_EDIT", ROOM_DELETE: "ROOM_DELETE",
  TABLE_ADD: "TABLE_ADD", TABLE_EDIT: "TABLE_EDIT", TABLE_DELETE: "TABLE_DELETE",
  AUTO_DELETE_RUN: "AUTO_DELETE_RUN", BACKUP_CREATE: "BACKUP_CREATE",
  CONFIG_CHANGE: "CONFIG_CHANGE", NEWS_CREATE: "NEWS_CREATE", NEWS_UPDATE: "NEWS_UPDATE", NEWS_DELETE: "NEWS_DELETE", SESSION_REVOKE: "SESSION_REVOKE", SECURITY_EVENT: "SECURITY_EVENT",
};

/**
 * @param {string} action - an AUDIT_ACTIONS value
 * @param {{userEmail?,userRole?,entityType?,entityId?,prevValue?,newValue?,ip?,device?,sessionId?,status?,severity?}} opts
 */
async function logAudit(action, opts = {}) {
  try {
    const severity = opts.severity ||
      (action.includes("FAILED") || action.includes("LOCK") || action.includes("BLOCK") ? "warn" : "info");
    const { error } = await supabase.from("audit_log").insert({
      audit_id: newId(),
      user_email: opts.userEmail || "system",
      user_role: opts.userRole || "system",
      action,
      entity_type: opts.entityType || null,
      entity_id: opts.entityId || null,
      prev_value: opts.prevValue ?? null,
      new_value: opts.newValue ?? null,
      ip_address: opts.ip || "unknown",
      device: opts.device || "unknown",
      session_id: opts.sessionId || null,
      status: opts.status || "success",
      severity,
    });
    if (error) console.error("[audit] insert error:", error.message);
  } catch (e) {
    console.error("[audit] logAudit error:", e.message);
  }
}

// Convenience: pull ip + device off an Express request
function reqMeta(req) {
  return { ip: req.ip || "unknown", device: String(req.headers["user-agent"] || "unknown").slice(0, 200) };
}

module.exports = { AUDIT_ACTIONS, logAudit, reqMeta };

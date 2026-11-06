// server/routes/passwordReset.js — Supabase version
const express = require("express");
const router  = express.Router();
const crypto  = require("crypto");
const supabase = require("../db/supabase");
const { authenticate } = require("../middleware/auth");
const { requireRole }  = require("../middleware/requireRole");
const { CONFIG, ROLES, ROLE_LEVEL } = require("../config/config");
const { hashPassword } = require("../utils/password");
const { newId, asyncHandler } = require("../utils/helpers");
const { sendEmail } = require("../services/mailer");

const NEUTRAL_MSG = "If the email address is eligible for recovery, an OTP has been sent.";

// OTPs and reset tokens are stored hashed so a DB read never reveals a usable code.
function hashSecret(v) {
  return crypto.createHash("sha256").update(CONFIG.JWT_SECRET + "|otp|" + v).digest("hex");
}
function safeEq(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function generateOtp() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

function otpEmailHtml(guestName, otp) {
  return `<!DOCTYPE html><html><head><meta charset='UTF-8'></head>
<body style='font-family:Arial,sans-serif;background:#f7f5f0;margin:0;padding:0;'>
<table width='100%' cellpadding='0' cellspacing='0' style='padding:40px 20px;'>
<tr><td align='center'>
<table width='480' cellpadding='0' cellspacing='0' style='background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.10);'>
<tr><td style='background:#0a3d62;padding:32px 40px;text-align:center;'>
<div style='font-size:22px;color:#c9a84c;letter-spacing:3px;font-weight:700;'>PRIME<span style='color:#fff;font-weight:400;'>WAVE</span></div>
<div style='color:rgba(255,255,255,.5);font-size:12px;margin-top:6px;'>Nairobi, Kenya</div>
</td></tr>
<tr><td style='padding:36px 40px;'>
<p style='color:#2c2c2c;font-size:15px;margin:0 0 8px;'>Dear ${guestName},</p>
<p style='color:#6b7280;font-size:14px;line-height:1.6;margin:0 0 28px;'>Use the code below to reset your password.</p>
<div style='background:#f0f4f8;border:2px dashed #c9a84c;border-radius:10px;padding:24px;text-align:center;margin:0 0 28px;'>
<div style='font-size:11px;color:#6b7280;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px;'>Your Reset Code</div>
<div style='font-family:monospace;font-size:44px;font-weight:700;color:#0a3d62;letter-spacing:12px;line-height:1;'>${otp}</div>
<div style='font-size:12px;color:#6b7280;margin-top:10px;'>Expires in <strong>${CONFIG.OTP_EXPIRY_MINUTES} minutes</strong></div></div>
<p style='color:#6b7280;font-size:13px;margin:0;'>If you did not request this, ignore this email.</p>
</td></tr>
<tr><td style='background:#f7f5f0;padding:20px 40px;text-align:center;border-top:1px solid #e5e7eb;'>
<p style='color:#9ca3af;font-size:11px;margin:0;'>&copy; 2026 ${CONFIG.HOTEL_NAME} &middot; Do not reply.</p>
</td></tr></table></td></tr></table></body></html>`;
}

// STEP 1
router.post("/request-otp", asyncHandler(async (req, res) => {
  const email = String(req.body.email || "").toLowerCase().trim();
  if (!email || !email.includes("@")) {
    return res.status(400).json({ status: "error", message: "Please provide a valid email address." });
  }

  const { data: user } = await supabase.from("users").select("*").eq("email", email).maybeSingle();

  if (!user || !user.is_active) {
    return res.json({ status: "success", message: NEUTRAL_MSG });
  }

  const selfResetAllowed = user.allow_self_reset === null || user.allow_self_reset === undefined
    ? String(user.role).toLowerCase() === "user"
    : Boolean(user.allow_self_reset);

  if (!selfResetAllowed) {
    return res.json({ status: "success", message: NEUTRAL_MSG });
  }

  if (user.last_otp_sent) {
    const elapsed = Date.now() - new Date(user.last_otp_sent).getTime();
    if (elapsed < CONFIG.OTP_RESEND_SECONDS * 1000) {
      const wait = Math.ceil((CONFIG.OTP_RESEND_SECONDS * 1000 - elapsed) / 1000);
      return res.status(429).json({ status: "error", message: `Please wait ${wait} seconds before requesting another code.` });
    }
  }

  const otp    = generateOtp();
  const expiry = new Date(Date.now() + CONFIG.OTP_EXPIRY_MINUTES * 60 * 1000).toISOString();

  await supabase.from("users").update({
    otp_code: hashSecret(otp), otp_expiry: expiry, otp_attempts: 0, last_otp_sent: new Date().toISOString(),
  }).eq("user_id", user.user_id);

  await sendEmail({
    to: user.email,
    subject: `${CONFIG.HOTEL_NAME} — Password Reset OTP`,
    body:
      "Dear " + (user.name || "Guest") + ",\n\n" +
      "Your password reset code is:\n\n" +
      "  " + otp + "\n\n" +
      "This code expires in " + CONFIG.OTP_EXPIRY_MINUTES + " minutes.\n\n" +
      "If you did not request this, ignore this message.\n\n" +
      "Warm regards,\n" + CONFIG.HOTEL_NAME,
    html: otpEmailHtml(user.name || "Guest", otp),
  });

  res.json({ status: "success", message: NEUTRAL_MSG });
}));

// STEP 2
router.post("/verify-otp", asyncHandler(async (req, res) => {
  const email = String(req.body.email || "").toLowerCase().trim();
  const otp   = String(req.body.otp || "").trim();

  if (!email || !otp) {
    return res.status(400).json({ status: "error", message: "Email and OTP are required." });
  }

  const { data: user } = await supabase.from("users").select("*").eq("email", email).maybeSingle();
  if (!user) {
    return res.status(400).json({ status: "error", message: "Invalid or expired OTP." });
  }

  const storedOtp = String(user.otp_code || "").trim();

  if (!storedOtp) {
    return res.status(400).json({ status: "error", message: "No active reset code. Please request a new one." });
  }
  if (storedOtp.startsWith("VERIFIED_")) {
    return res.status(400).json({ status: "error", message: "Code already verified. Please set your new password." });
  }
  if (user.otp_expiry && new Date(user.otp_expiry).getTime() < Date.now()) {
    await supabase.from("users").update({ otp_code: "", otp_expiry: null, otp_attempts: 0 }).eq("user_id", user.user_id);
    return res.status(400).json({ status: "error", message: "OTP has expired. Please request a new one." });
  }

  const attempts = Number(user.otp_attempts) || 0;
  if (attempts >= CONFIG.OTP_MAX_ATTEMPTS) {
    await supabase.from("users").update({ otp_code: "", otp_expiry: null, otp_attempts: 0 }).eq("user_id", user.user_id);
    return res.status(400).json({ status: "error", message: "Too many failed attempts. Please request a new OTP." });
  }

  if (!safeEq(storedOtp, hashSecret(otp))) {
    const newAttempts = attempts + 1;

    if (newAttempts >= CONFIG.OTP_MAX_ATTEMPTS) {
      await supabase.from("users").update({ otp_code: "", otp_expiry: null, otp_attempts: 0 }).eq("user_id", user.user_id);
      return res.status(400).json({ status: "error", message: "Too many failed attempts. OTP invalidated. Please request a new one." });
    }

    await supabase.from("users").update({ otp_attempts: newAttempts }).eq("user_id", user.user_id);

    const remaining = CONFIG.OTP_MAX_ATTEMPTS - newAttempts;
    return res.status(400).json({
      status: "error",
      message: `Incorrect OTP. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`,
    });
  }

  const resetToken = crypto.randomBytes(24).toString("hex");
  await supabase.from("users").update({
    otp_code: "VERIFIED_" + hashSecret(resetToken), otp_attempts: 0,
    otp_expiry: new Date(Date.now() + CONFIG.OTP_EXPIRY_MINUTES * 60 * 1000).toISOString(),
  }).eq("user_id", user.user_id);

  res.json({ status: "success", message: "OTP verification successful.", reset_token: resetToken });
}));

// STEP 3
router.post("/complete", asyncHandler(async (req, res) => {
  const email       = String(req.body.email || "").toLowerCase().trim();
  const resetToken  = String(req.body.reset_token || "").trim();
  const newPassword = String(req.body.new_password || "");

  if (!email || !resetToken || !newPassword) {
    return res.status(400).json({ status: "error", message: "Email, reset token, and new password are required." });
  }
  if (newPassword.length < CONFIG.MIN_PASSWORD_LENGTH || newPassword.length > 72) {
    return res.status(400).json({ status: "error", message: `Password must be ${CONFIG.MIN_PASSWORD_LENGTH}-72 characters.` });
  }

  const { data: user } = await supabase.from("users").select("*").eq("email", email).maybeSingle();
  if (!user) {
    return res.status(400).json({ status: "error", message: "Session expired. Please start over." });
  }

  const storedOtp = String(user.otp_code || "").trim();
  if (!storedOtp.startsWith("VERIFIED_") || !safeEq(storedOtp, "VERIFIED_" + hashSecret(resetToken))) {
    return res.status(400).json({ status: "error", message: "Invalid session. Please start over." });
  }
  if (user.otp_expiry && new Date(user.otp_expiry).getTime() < Date.now()) {
    await supabase.from("users").update({ otp_code: "", otp_expiry: null, otp_attempts: 0 }).eq("user_id", user.user_id);
    return res.status(400).json({ status: "error", message: "Session expired. Please start over." });
  }

  await supabase.from("users").update({
    password_hash: await hashPassword(newPassword), token_version: (user.token_version || 0) + 1,
    reset_token: "", otp_code: "", otp_expiry: null, otp_attempts: 0, last_otp_sent: null,
  }).eq("user_id", user.user_id);

  await sendEmail({
    to: user.email,
    subject: `${CONFIG.HOTEL_NAME} — Your Password Has Been Changed`,
    body:
      "Dear " + (user.name || "Guest") + ",\n\n" +
      "Your password for " + CONFIG.HOTEL_NAME + " has been successfully changed.\n\n" +
      "If you did not make this change, contact us immediately at " +
      CONFIG.ADMIN_EMAIL + ".\n\n" +
      "Warm regards,\n" + CONFIG.HOTEL_NAME,
  });

  res.json({ status: "success", message: "Password reset completed successfully." });
}));

// SYSTEM OWNER ACTIONS
router.post("/admin-unlock", authenticate, requireRole(ROLES.SYSTEMOWNER), asyncHandler(async (req, res) => {
  if (!req.body.target_email) {
    return res.status(400).json({ status: "error", message: "target_email required." });
  }
  const targetEmail = req.body.target_email.toLowerCase();
  const { data: user } = await supabase.from("users").select("user_id").eq("email", targetEmail).maybeSingle();
  if (!user) return res.status(404).json({ status: "error", message: "User not found." });

  await supabase.from("users").update({
    otp_code: "", otp_expiry: null, otp_attempts: 0, last_otp_sent: null,
  }).eq("user_id", user.user_id);

  res.json({ status: "success", message: "OTP cleared for " + targetEmail });
}));

router.post("/admin-set-self-reset", authenticate, requireRole(ROLES.SYSTEMOWNER), asyncHandler(async (req, res) => {
  if (!req.body.target_email || req.body.allow === undefined) {
    return res.status(400).json({ status: "error", message: "target_email and allow are required." });
  }
  const targetEmail = req.body.target_email.toLowerCase();
  const { data: user } = await supabase.from("users").select("user_id, role").eq("email", targetEmail).maybeSingle();
  if (!user) return res.status(404).json({ status: "error", message: "User not found." });

  if (req.body.allow === true && ROLE_LEVEL[user.role] > ROLE_LEVEL[ROLES.USER]) {
    return res.status(400).json({ status: "error", message: "Cannot enable self-reset for admin-level accounts." });
  }

  await supabase.from("users").update({ allow_self_reset: req.body.allow === true }).eq("user_id", user.user_id);

  res.json({
    status: "success",
    message: `Self-reset ${req.body.allow ? "enabled" : "disabled"} for ${targetEmail}`,
  });
}));

router.get("/history", authenticate, requireRole(ROLES.SYSTEMOWNER), asyncHandler(async (req, res) => {
  if (!req.query.target_email) {
    return res.status(400).json({ status: "error", message: "target_email required." });
  }
  const { data, error } = await supabase.from("audit_log").select("*")
    .eq("user_email", String(req.query.target_email).toLowerCase()).order("timestamp", { ascending: false }).limit(200);
  if (error) throw error;
  res.json({ status: "success", data, total: data.length });
}));

module.exports = router;

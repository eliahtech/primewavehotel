// server/routes/auth.js — Supabase version
const express = require("express");
const router  = express.Router();
const jwt     = require("jsonwebtoken");
const supabase = require("../db/supabase");
const { authenticate } = require("../middleware/auth");
const { requireRole }  = require("../middleware/requireRole");
const { CONFIG, ROLES, ROLE_LEVEL } = require("../config/config");
const { hashPassword, verifyPassword } = require("../utils/password");
const { logAudit, AUDIT_ACTIONS, reqMeta } = require("../services/audit");
const policy = require("../services/userPolicy");
const { isValidEmailFormat, isBlockedDomain, hasMxRecord } = require("../utils/emailValidation");
const { sanitize, validateRequired, newId, asyncHandler } = require("../utils/helpers");
const { sendEmail } = require("../services/mailer");

const TOKEN_EXPIRY = "24h";

function generateToken(user) {
  return jwt.sign(
    { user_id: user.user_id, email: user.email, role: user.role, name: user.name, tv: user.token_version || 0 },
    CONFIG.JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY, algorithm: "HS256" }
  );
}

// POST /api/auth/login
router.post("/login", asyncHandler(async (req, res) => {
  const email    = String(req.body.email || "").toLowerCase().trim();
  const password = String(req.body.password || "");

  if (!email || !password) {
    return res.status(400).json({ status: "error", message: "Email and password are required." });
  }

  const { data: user, error } = await supabase
    .from("users").select("*").eq("email", email).eq("is_active", true).maybeSingle();
  if (error) throw error;

  const check = user ? await verifyPassword(password, user.password_hash) : { ok: false };
  if (!user || !check.ok) {
    await logAudit(AUDIT_ACTIONS.LOGIN_FAILED, { userEmail: email, status: "failed", ...reqMeta(req) });
    return res.status(401).json({ status: "error", message: "Invalid email or password." });
  }

  const update = { last_login: new Date().toISOString() };
  if (check.needsUpgrade) update.password_hash = await hashPassword(password); // legacy SHA-256 → bcrypt
  await supabase.from("users").update(update).eq("user_id", user.user_id);
  await logAudit(AUDIT_ACTIONS.LOGIN_SUCCESS, { userEmail: user.email, userRole: user.role, ...reqMeta(req) });

  const token = generateToken(user);

  const response = {
    status: "success",
    message: "Login successful.",
    token,
    user: {
      user_id: user.user_id,
      name: user.name,
      email: user.email,
      role: user.role,
      national_id: user.national_id || "",
    },
  };

  // Only same-site relative redirects are echoed back (prevents open-redirect phishing).
  const redirect = String(req.body.redirect || "");
  if (redirect.startsWith("/") && !redirect.startsWith("//") && !redirect.includes("\\")) {
    response.redirect = redirect.slice(0, 500);
  }

  res.json(response);
}));

// POST /api/auth/register
router.post("/register", asyncHandler(async (req, res) => {
  const body = req.body;
  validateRequired(body, ["name", "email", "phone", "password"]);

  const name       = sanitize(body.name);
  const emailClean = String(body.email || "").toLowerCase().trim();
  const phone      = sanitize(body.phone);
  const password   = String(body.password || "");
  const nationalId = sanitize(String(body.national_id || "").trim());

  if (!isValidEmailFormat(emailClean)) {
    return res.status(400).json({ status: "error", message: "Please enter a valid email address (e.g. name@domain.com)." });
  }
  if (isBlockedDomain(emailClean)) {
    return res.status(400).json({ status: "error", message: "Temporary or disposable email addresses are not allowed. Please use a real email address." });
  }
  const mx = await hasMxRecord(emailClean);
  if (!mx.valid) {
    return res.status(400).json({ status: "error", message: "This email domain cannot receive mail. Please use a real email address." });
  }
  if (password.length < CONFIG.MIN_PASSWORD_LENGTH || password.length > 72) {
    return res.status(400).json({ status: "error", message: `Password must be ${CONFIG.MIN_PASSWORD_LENGTH}-72 characters.` });
  }
  if (nationalId && !/^\d{7,8}$/.test(nationalId)) {
    return res.status(400).json({ status: "error", message: "National ID must be 7 or 8 digits." });
  }

  const { data: existing } = await supabase.from("users").select("user_id").eq("email", emailClean).maybeSingle();
  if (existing) {
    return res.status(409).json({ status: "error", message: "An account with this email already exists." });
  }

  if (nationalId) {
    const { data: nidExists } = await supabase.from("users").select("user_id").eq("national_id", nationalId).maybeSingle();
    if (nidExists) {
      return res.status(409).json({ status: "error", message: "This National ID is already registered to an account." });
    }
  }

  const newUser = {
    user_id: newId(),
    name, email: emailClean, phone,
    password_hash: await hashPassword(password),
    role: ROLES.USER,
    national_id: nationalId,
    allow_self_reset: true,
  };

  const { error: insErr } = await supabase.from("users").insert(newUser);
  if (insErr) throw insErr;

  await sendEmail({
    to: emailClean,
    subject: `${CONFIG.HOTEL_NAME} — Welcome!`,
    body:
      "Dear " + name + ",\n\n" +
      "Welcome to " + CONFIG.HOTEL_NAME + "!\n\n" +
      "Your account has been created successfully.\n" +
      "You can now log in and manage your bookings.\n\n" +
      "Warm regards,\n" + CONFIG.HOTEL_NAME,
  });

  res.json({ status: "success", message: "Account created successfully. You can now log in." });
}));

// GET /api/auth/me   — profile for the account page
router.get("/me", authenticate, asyncHandler(async (req, res) => {
  const { data: u, error } = await supabase.from("users")
    .select("user_id,name,email,phone,national_id,role,created_at,last_login").eq("user_id", req.user.user_id).maybeSingle();
  if (error) throw error;
  const { data: nl } = await supabase.from("newsletter").select("subscribed").eq("email", u.email).maybeSingle();
  res.json({ status: "success", data: { ...u, newsletter: !!(nl && nl.subscribed) } });
}));

// PUT /api/auth/profile   body: { name?, phone?, national_id? }  (email and role cannot be changed here)
router.put("/profile", authenticate, asyncHandler(async (req, res) => {
  const updates = {};
  if (req.body.name !== undefined) {
    updates.name = sanitize(req.body.name).trim();
    if (updates.name.length < 2 || updates.name.length > 80) return res.status(400).json({ status: "error", message: "Please enter your full name." });
  }
  if (req.body.phone !== undefined) {
    updates.phone = sanitize(req.body.phone).trim();
    if (!/^[+\d][\d\s-]{7,18}$/.test(updates.phone)) return res.status(400).json({ status: "error", message: "Please enter a valid phone number." });
  }
  if (req.body.national_id !== undefined) {
    updates.national_id = sanitize(req.body.national_id).trim();
    if (updates.national_id && !/^\d{7,8}$/.test(updates.national_id)) return res.status(400).json({ status: "error", message: "National ID must be 7-8 digits." });
  }
  if (!Object.keys(updates).length) return res.status(400).json({ status: "error", message: "Nothing to update." });
  const { data, error } = await supabase.from("users").update(updates).eq("user_id", req.user.user_id)
    .select("user_id,name,email,phone,national_id,role,token_version").single();
  if (error) throw error;
  await logAudit(AUDIT_ACTIONS.USER_UPDATE, { userEmail: req.user.email, userRole: req.user.role, entityType: "User", entityId: req.user.user_id, newValue: Object.keys(updates), ...reqMeta(req) });
  // The token carries the name, so hand back a fresh one.
  res.json({ status: "success", message: "Profile updated.", token: generateToken(data),
    user: { user_id: data.user_id, name: data.name, email: data.email, role: data.role } });
}));

// POST /api/auth/logout-all   — invalidates every token for this account (all devices, including this one)
router.post("/logout-all", authenticate, asyncHandler(async (req, res) => {
  const { data: u, error } = await supabase.from("users").select("token_version").eq("user_id", req.user.user_id).single();
  if (error) throw error;
  await supabase.from("users").update({ token_version: (u.token_version || 0) + 1 }).eq("user_id", req.user.user_id);
  await logAudit(AUDIT_ACTIONS.SESSION_REVOKE, { userEmail: req.user.email, userRole: req.user.role, entityType: "User", entityId: req.user.user_id, ...reqMeta(req) });
  res.json({ status: "success", message: "Signed out of all devices." });
}));

// POST /api/auth/logout
router.post("/logout", (req, res) => {
  res.json({ status: "success", message: "Logged out successfully." });
});

// POST /api/auth/change-password
router.post("/change-password", authenticate, asyncHandler(async (req, res) => {
  validateRequired(req.body, ["oldPassword", "newPassword"]);

  const np = String(req.body.newPassword);
  if (np.length < CONFIG.MIN_PASSWORD_LENGTH || np.length > 72) {
    return res.status(400).json({ status: "error", message: `New password must be ${CONFIG.MIN_PASSWORD_LENGTH}-72 characters.` });
  }

  const { data: dbUser, error } = await supabase.from("users").select("*").eq("user_id", req.user.user_id).maybeSingle();
  if (error) throw error;
  const ok = dbUser && (await verifyPassword(String(req.body.oldPassword), dbUser.password_hash)).ok;
  if (!ok) {
    return res.status(400).json({ status: "error", message: "Current password is incorrect." });
  }

  // Bumping token_version invalidates every other session/token immediately.
  const tv = (dbUser.token_version || 0) + 1;
  await supabase.from("users")
    .update({ password_hash: await hashPassword(np), token_version: tv })
    .eq("user_id", req.user.user_id);
  await logAudit(AUDIT_ACTIONS.PASSWORD_CHANGE, { userEmail: req.user.email, userRole: req.user.role, ...reqMeta(req) });

  res.json({ status: "success", message: "Password changed successfully.", token: generateToken({ ...dbUser, token_version: tv }) });
}));

// POST /api/auth/reset-password   (admin resets another user)
router.post("/reset-password", authenticate, requireRole(ROLES.ADMIN), asyncHandler(async (req, res) => {
  validateRequired(req.body, ["target_user_id", "new_password"]);

  const npw = String(req.body.new_password);
  if (npw.length < CONFIG.MIN_PASSWORD_LENGTH || npw.length > 72) {
    return res.status(400).json({ status: "error", message: `Password must be ${CONFIG.MIN_PASSWORD_LENGTH}-72 characters.` });
  }

  const { data: targetUser, error } = await supabase.from("users").select("*").eq("user_id", req.body.target_user_id).maybeSingle();
  if (error) throw error;
  if (!targetUser) return res.status(404).json({ status: "error", message: "User not found." });
  // You may set the password of any account you are allowed to SEE (admin: guests+admins · owner: + owners · system owner: all).
  // Your own password goes through change-password. The target is signed out everywhere, e-mailed, and the action is audited.
  if (!policy.canResetPassword(req.user, targetUser)) {
    return res.status(403).json({ status: "error", message: targetUser.user_id === req.user.user_id ? "Use Change Password for your own account." : "You do not have access to that account." });
  }

  await supabase.from("users").update({
    password_hash: await hashPassword(npw), token_version: (targetUser.token_version || 0) + 1,
    reset_token: "", otp_code: "", otp_expiry: null, otp_attempts: 0,
  }).eq("user_id", req.body.target_user_id);
  await logAudit(AUDIT_ACTIONS.PASSWORD_RESET, { userEmail: req.user.email, userRole: req.user.role, entityType: "User", entityId: targetUser.user_id, newValue: { target: targetUser.email, target_role: targetUser.role }, ...reqMeta(req) });

  if (targetUser.email) {
    await sendEmail({
      to: targetUser.email,
      subject: `${CONFIG.HOTEL_NAME} — Your Password Has Been Reset`,
      body:
        "Dear " + (targetUser.name || "Guest") + ",\n\n" +
        "Your password was reset by a member of our staff (" + req.user.role + ").\nPlease sign in with the new password you were given and change it from My Account → Security.\n\n" +
        "If you did not request this, please contact us immediately at " +
        CONFIG.ADMIN_EMAIL + ".\n\n" +
        "Warm regards,\n" + CONFIG.HOTEL_NAME,
    });
  }

  res.json({ status: "success", message: "Password reset successfully." });
}));

// POST /api/auth/request-password-reset   (legacy email-to-admin flow)
router.post("/request-password-reset", asyncHandler(async (req, res) => {
  const email = String(req.body.email || "").toLowerCase().trim();
  const publicMessage = "If this email is registered, an administrator will contact you to reset your password.";

  if (!email || !email.includes("@")) {
    return res.status(400).json({ status: "error", message: "Please provide a valid email address." });
  }

  const { data: user } = await supabase.from("users").select("*").eq("email", email).maybeSingle();

  if (user) {
    await sendEmail({
      to: CONFIG.ADMIN_EMAIL,
      subject: `${CONFIG.HOTEL_NAME} — Password Reset Request`,
      body:
        "A guest has requested a password reset.\n\n" +
        "Name  : " + (user.name || "Unknown") + "\n" +
        "Email : " + user.email + "\n" +
        "Phone : " + (user.phone || "N/A") + "\n" +
        "Role  : " + user.role + "\n\n" +
        "To reset this user's password, go to the Users section of the admin " +
        "dashboard and use the Reset Password action.\n\n" +
        "If you did not expect this request, no action is needed.",
    });
  }

  res.json({ status: "success", message: publicMessage });
}));

module.exports = router;

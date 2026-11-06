// server/routes/users.js — Supabase version
const express = require("express");
const { logAudit, AUDIT_ACTIONS, reqMeta } = require("../services/audit");
const router  = express.Router();
const supabase = require("../db/supabase");
const { authenticate } = require("../middleware/auth");
const { requireRole }  = require("../middleware/requireRole");
const { ROLES, ROLE_LEVEL } = require("../config/config");
const { newId, sanitize, validateRequired, asyncHandler, httpError } = require("../utils/helpers");
const { hashPassword } = require("../utils/password");
const { isValidEmailFormat } = require("../utils/emailValidation");
const { CONFIG } = require("../config/config");
const policy = require("../services/userPolicy");

// GET /api/users
router.get("/", authenticate, requireRole(ROLES.ADMIN), asyncHandler(async (req, res) => {
  const { data: rows, error } = await supabase.from("users").select("*");
  if (error) throw error;

  // admin → guests + admins · owner → + owners · systemowner → everyone (see services/userPolicy.js)
  const users = policy.visibleUsers(rows, req.user.role).map(u => ({
    ...u,
    password_hash: "***",
    otp_code: u.otp_code ? "***" : "",
    reset_token: u.reset_token ? "***" : "",
  }));

  res.json({ status: "success", data: users });
}));

// POST /api/users   (owner+) — create a staff/guest account with a role below your own
router.post("/", authenticate, requireRole(ROLES.OWNER), asyncHandler(async (req, res) => {
  validateRequired(req.body, ["name", "email", "phone", "password", "role"]);
  const callerLevel = ROLE_LEVEL[req.user.role] || 0;
  if (!ROLE_LEVEL[req.body.role] || ROLE_LEVEL[req.body.role] >= callerLevel) throw httpError(403, "You can only create accounts below your own role.");
  const email = String(req.body.email).toLowerCase().trim();
  if (!isValidEmailFormat(email)) throw httpError(400, "Invalid email address.");
  const pw = String(req.body.password);
  if (pw.length < CONFIG.MIN_PASSWORD_LENGTH || pw.length > 72) throw httpError(400, `Password must be ${CONFIG.MIN_PASSWORD_LENGTH}-72 characters.`);
  const { data: dup } = await supabase.from("users").select("user_id").eq("email", email).maybeSingle();
  if (dup) throw httpError(409, "An account with this email already exists.");
  const user = { user_id: newId(), name: sanitize(req.body.name), email, phone: sanitize(req.body.phone),
    password_hash: await hashPassword(pw), role: req.body.role, allow_self_reset: req.body.role === ROLES.USER };
  const { error } = await supabase.from("users").insert(user);
  if (error) throw error;
  await logAudit(AUDIT_ACTIONS.USER_CREATE, { userEmail: req.user.email, userRole: req.user.role, entityType: "User", entityId: user.user_id, newValue: { email, role: user.role }, ...reqMeta(req) });
  res.json({ status: "success", message: "Account created.", data: { user_id: user.user_id } });
}));

// PUT /api/users/:id
router.put("/:id", authenticate, requireRole(ROLES.ADMIN), asyncHandler(async (req, res) => {
  const callerLevel = ROLE_LEVEL[req.user.role] || 0;

  const { data: targetUser, error: selErr } = await supabase
    .from("users").select("*").eq("user_id", req.params.id).maybeSingle();
  if (selErr) throw selErr;
  if (!targetUser) return res.status(404).json({ status: "error", message: "User not found." });

  if (!policy.canEditUser(req.user.role, targetUser.role)) {
    return res.status(403).json({ status: "error", message: "Cannot edit an account with equal or higher privileges." });
  }
  if (req.body.role && !policy.canAssignRole(req.user.role, req.body.role)) {
    return res.status(403).json({ status: "error", message: "Cannot assign role equal to or above your own." });
  }

  if (req.body.role !== undefined && !ROLE_LEVEL[req.body.role]) {
    return res.status(400).json({ status: "error", message: "Invalid role." });
  }
  const allowed = ["name", "phone", "role", "is_active", "national_id", "allow_self_reset"];
  const updates = {};
  allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
  if (!Object.keys(updates).length) return res.status(400).json({ status: "error", message: "No fields to update." });
  // Role change or deactivation must kill that user's live tokens straight away.
  if (updates.role !== undefined || updates.is_active === false) updates.token_version = (targetUser.token_version || 0) + 1;

  const { error: updErr } = await supabase.from("users").update(updates).eq("user_id", req.params.id);
  if (updErr) throw updErr;

  await logAudit(updates.role !== undefined ? AUDIT_ACTIONS.ROLE_CHANGE : AUDIT_ACTIONS.USER_UPDATE, { userEmail: req.user.email, userRole: req.user.role, entityType: "User", entityId: req.params.id, prevValue: { role: targetUser.role, is_active: targetUser.is_active }, newValue: updates, ...reqMeta(req) });
  res.json({ status: "success", message: "User updated." });
}));

// DELETE /api/users/:id   (systemowner only)
router.delete("/:id", authenticate, requireRole(ROLES.SYSTEMOWNER), asyncHandler(async (req, res) => {
  if (req.params.id === req.user.user_id) {
    return res.status(400).json({ status: "error", message: "Cannot delete your own account." });
  }

  const { data: user, error: selErr } = await supabase
    .from("users").select("*").eq("user_id", req.params.id).maybeSingle();
  if (selErr) throw selErr;
  if (!user) return res.status(404).json({ status: "error", message: "User not found." });

  const { error: archErr } = await supabase.from("archive").insert({
    archived_id: newId(),
    source_sheet: "users",
    data: { ...user, password_hash: "***", otp_code: "***", reset_token: "***" },
    deleted_by: req.user.email,
  });
  if (archErr) throw archErr;

  const { error: delErr } = await supabase.from("users").delete().eq("user_id", req.params.id);
  if (delErr) throw delErr;

  await logAudit(AUDIT_ACTIONS.USER_DELETE, { userEmail: req.user.email, userRole: req.user.role, entityType: "User", entityId: req.params.id, prevValue: { email: user.email, role: user.role }, ...reqMeta(req) });
  res.json({ status: "success", message: "User deleted." });
}));

module.exports = router;

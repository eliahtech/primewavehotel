// server/routes/site.js — public site settings (social links) + owner-only editing
const express = require("express");
const router  = express.Router();
const { authenticate } = require("../middleware/auth");
const { requireRole }  = require("../middleware/requireRole");
const { ROLES } = require("../config/config");
const { asyncHandler } = require("../utils/helpers");
const { logAudit, AUDIT_ACTIONS, reqMeta } = require("../services/audit");
const settings = require("../services/settings");

// GET /api/site   — PUBLIC: only the links that are set
router.get("/", asyncHandler(async (req, res) => {
  const all = await settings.getSocial();
  const social = Object.fromEntries(Object.entries(all).filter(([, v]) => v));
  res.set("Cache-Control", "public, max-age=60");
  res.json({ status: "success", social });
}));

// PUT /api/site/social   (owner+)   body: { facebook?, youtube?, tiktok?, instagram? }  — '' removes a link
router.put("/social", authenticate, requireRole(ROLES.OWNER), asyncHandler(async (req, res) => {
  const map = settings.validateSocial(req.body || {});
  await settings.saveSocial(map, req.user.email);
  await logAudit(AUDIT_ACTIONS.CONFIG_CHANGE, { userEmail: req.user.email, userRole: req.user.role, entityType: "Settings", entityId: "social", newValue: map, ...reqMeta(req) });
  res.json({ status: "success", message: "Social links saved.", social: await settings.getSocial() });
}));

module.exports = router;

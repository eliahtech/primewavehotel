// server/routes/archive.js — Supabase version
const express = require("express");
const router  = express.Router();
const supabase = require("../db/supabase");
const { authenticate } = require("../middleware/auth");
const { requireRole }  = require("../middleware/requireRole");
const { ROLES } = require("../config/config");
const { asyncHandler } = require("../utils/helpers");
const policy = require("../services/userPolicy");

// GET /api/archive?sheet=rooms|tables|users|bookings|payments
router.get("/", authenticate, requireRole(ROLES.ADMIN), asyncHandler(async (req, res) => {
  let q = supabase.from("archive").select("*");
  if (req.query.sheet) q = q.eq("source_sheet", req.query.sheet);
  q = q.order("deleted_at", { ascending: false }).limit(1000);

  const { data, error } = await q;
  if (error) throw error;
  // Deleted ACCOUNTS follow the same visibility rule as live ones (an admin must not read an archived owner).
  const visible = data.filter(r => r.source_sheet !== "users" || policy.canSeeUser(req.user.role, r.data && r.data.role));
  res.json({ status: "success", data: visible });
}));

module.exports = router;

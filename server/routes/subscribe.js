// server/routes/subscribe.js — Supabase version
const express = require("express");
const router  = express.Router();
const supabase = require("../db/supabase");
const { authenticate } = require("../middleware/auth");
const { requireRole }  = require("../middleware/requireRole");
const { ROLES } = require("../config/config");
const { sanitize, newId, asyncHandler } = require("../utils/helpers");
const { isValidEmailFormat } = require("../utils/emailValidation");

// POST /api/subscribe   body: { name, email }
router.post("/", asyncHandler(async (req, res) => {
  const email = (req.body.email || "").trim().toLowerCase();
  const name  = sanitize(req.body.name || "");

  if (!isValidEmailFormat(email)) {
    return res.status(400).json({ status: "error", message: "Valid email required." });
  }

  const { data: existing, error: selErr } = await supabase
    .from("newsletter").select("*").eq("email", email).maybeSingle();
  if (selErr) throw selErr;

  if (existing) {
    if (existing.subscribed) {
      return res.json({ status: "success", message: "Already subscribed!" });
    }
    const { error: updErr } = await supabase
      .from("newsletter").update({ subscribed: true }).eq("email", email);
    if (updErr) throw updErr;
    return res.json({ status: "success", message: "Welcome back! Subscribed." });
  }

  const { error: insErr } = await supabase
    .from("newsletter").insert({ id: newId(), email, name, subscribed: true });
  if (insErr) throw insErr;

  res.json({ status: "success", message: "Subscribed successfully!" });
}));

// POST /api/subscribe/me   body: { subscribed: boolean }   (logged-in guest, uses their own email)
router.post("/me", authenticate, asyncHandler(async (req, res) => {
  const on = req.body.subscribed === true;
  const { data: existing, error } = await supabase.from("newsletter").select("id").eq("email", req.user.email).maybeSingle();
  if (error) throw error;
  const q = existing
    ? supabase.from("newsletter").update({ subscribed: on }).eq("email", req.user.email)
    : supabase.from("newsletter").insert({ id: newId(), email: req.user.email, name: req.user.name, subscribed: on });
  const { error: e2 } = await q;
  if (e2) throw e2;
  res.json({ status: "success", message: on ? "Subscribed to offers." : "Unsubscribed." });
}));

// GET /api/subscribe/list   (admin+)
router.get("/list", authenticate, requireRole(ROLES.ADMIN), asyncHandler(async (req, res) => {
  const { data, error } = await supabase.from("newsletter").select("*").eq("subscribed", true);
  if (error) throw error;
  res.json({ status: "success", data, total: data.length });
}));

module.exports = router;

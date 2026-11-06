// server/routes/cron.js — called by Vercel Cron (see vercel.json). Replaces node-cron.
// Vercel sends "Authorization: Bearer $CRON_SECRET" automatically.

const express = require("express");
const crypto  = require("crypto");
const router  = express.Router();
const { runHousekeeping } = require("../jobs/housekeeping");
const pesapal = require("../services/pesapal");
const { asyncHandler } = require("../utils/helpers");

function cronAuth(req, res, next) {
  const secret = process.env.CRON_SECRET;
  const got = (req.headers.authorization || "").replace(/^Bearer /, "");
  const a = Buffer.from(got), b = Buffer.from(secret || "");
  if (!secret || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ status: "error", message: "Unauthorised." });
  }
  next();
}

// Daily: archive+delete old bookings, expire stale holds, tidy rate-limit rows. Logged to job_log.
router.get("/housekeeping", cronAuth, asyncHandler(async (req, res) => {
  res.json({ status: "success", removed: await runHousekeeping("cron") });
}));

// One-off helper: GET /api/cron/register-ipn with the cron bearer secret, then store the id as PESAPAL_IPN_ID.
router.get("/register-ipn", cronAuth, asyncHandler(async (req, res) => {
  const d = await pesapal.registerIpn();
  res.json({ status: "success", ipn_id: d.ipn_id, url: pesapal.getIpnCallbackUrl() });
}));

module.exports = router;

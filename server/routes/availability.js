// server/routes/availability.js — public availability check
const express = require("express");
const router  = express.Router();
const { checkAvailable, getCalendar } = require("../services/availability");
const { validateRequired, parseRange, asyncHandler } = require("../utils/helpers");

// GET /api/availability/calendar?type=room|table&room_id=|table_id=&from=YYYY-MM-DD&days=120
// Returns only which nights/slots are taken — never who booked them.
router.get("/calendar", asyncHandler(async (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ status: "success", ...(await getCalendar(req.query)) });
}));

// GET /api/availability?checkin=&checkout=&type=room|table&room_id=&table_id=
router.get("/", asyncHandler(async (req, res) => {
  validateRequired(req.query, ["checkin", "checkout"]);
  const isTable = req.query.type === "table" || !!req.query.table_id;
  const r = parseRange(req.query.checkin, req.query.checkout, { isTable });
  const result = await checkAvailable({ ...req.query, checkin: r.checkin, checkout: r.checkout });
  res.json({ status: "success", ...result });
}));

module.exports = router;

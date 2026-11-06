// server/routes/rooms.js — Supabase version
const express = require("express");
const { logAudit, AUDIT_ACTIONS, reqMeta } = require("../services/audit");
const router  = express.Router();
const supabase = require("../db/supabase");
const { authenticate }  = require("../middleware/auth");
const { requireRole }   = require("../middleware/requireRole");
const { ROLES }         = require("../config/config");
const { sanitize, validateRequired, newId, asyncHandler } = require("../utils/helpers");

// GET /api/rooms?type=&minPrice=&maxPrice=&guests=&ac=
router.get("/", asyncHandler(async (req, res) => {
  const { type, minPrice, maxPrice, guests, ac } = req.query;

  let q = supabase.from("rooms").select("*");
  if (type)     q = q.eq("room_type", type);
  if (minPrice) q = q.gte("price_per_night", Number(minPrice));
  if (maxPrice) q = q.lte("price_per_night", Number(maxPrice));
  if (guests)   q = q.gte("max_guests", Number(guests));
  if (ac !== undefined && ac !== "") q = q.eq("has_ac", ac === "true" || ac === "1");
  q = q.neq("status", "hidden").order("room_number", { ascending: true }); // hidden rooms are never public

  const { data, error } = await q;
  if (error) throw error;
  res.json({ status: "success", data });
}));

// GET /api/rooms/admin/all   (admin+) — includes hidden rooms
router.get("/admin/all", authenticate, requireRole(ROLES.ADMIN), asyncHandler(async (req, res) => {
  const { data, error } = await supabase.from("rooms").select("*").order("room_number", { ascending: true });
  if (error) throw error;
  res.json({ status: "success", data });
}));

// GET /api/rooms/:id
router.get("/:id", asyncHandler(async (req, res) => {
  const { data, error } = await supabase.from("rooms").select("*").eq("id", req.params.id).neq("status", "hidden").maybeSingle();
  if (error) throw error;
  if (!data) return res.status(404).json({ status: "error", message: "Room not found." });
  res.json({ status: "success", data });
}));

// POST /api/rooms   (admin+)
router.post("/", authenticate, requireRole(ROLES.ADMIN), asyncHandler(async (req, res) => {
  validateRequired(req.body, ["room_number", "room_type", "price_per_night", "max_guests"]);

  const { data: existing } = await supabase.from("rooms").select("id").eq("room_number", req.body.room_number).maybeSingle();
  if (existing) return res.status(409).json({ status: "error", message: "Room number already exists." });

  const room = {
    id: newId(),
    room_number: sanitize(req.body.room_number),
    room_type: sanitize(req.body.room_type),
    description: sanitize(req.body.description || ""),
    price_per_night: Number(req.body.price_per_night) > 0 ? Number(req.body.price_per_night) : (() => { const e = new Error("price_per_night must be a positive number."); e.statusCode = 400; throw e; })(),
    max_guests: Math.max(1, Math.floor(Number(req.body.max_guests)) || 1),
    has_ac: req.body.has_ac === true || req.body.has_ac === "true",
    smoking: req.body.smoking === true || req.body.smoking === "true",
    image_url: sanitize(req.body.image_url || ""),
    status: "available",
  };

  const { error } = await supabase.from("rooms").insert(room);
  if (error) throw error;

  await logAudit(AUDIT_ACTIONS.ROOM_ADD, { userEmail: req.user.email, userRole: req.user.role, entityType: "Room", entityId: room.id, newValue: room, ...reqMeta(req) });
  res.json({ status: "success", data: room, message: "Room added." });
}));

// PUT /api/rooms/:id   (admin+)
router.put("/:id", authenticate, requireRole(ROLES.ADMIN), asyncHandler(async (req, res) => {
  const fields = ["room_number", "room_type", "description", "price_per_night",
                   "max_guests", "has_ac", "smoking", "image_url", "status"];
  const updates = {};
  fields.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
  ["price_per_night", "max_guests"].forEach(f => {
    if (updates[f] !== undefined) { updates[f] = Number(updates[f]); if (!(updates[f] > 0)) { const e = new Error(f + " must be a positive number."); e.statusCode = 400; throw e; } }
  });
  if (updates.status !== undefined && !["available", "occupied", "maintenance", "hidden"].includes(updates.status)) { const e = new Error("Invalid status."); e.statusCode = 400; throw e; }
  ["room_number", "room_type", "description", "image_url"].forEach(f => { if (updates[f] !== undefined) updates[f] = sanitize(updates[f]); });
  if (!Object.keys(updates).length) return res.status(400).json({ status: "error", message: "No fields to update." });

  const { data, error } = await supabase.from("rooms").update(updates).eq("id", req.params.id).select();
  if (error) throw error;
  if (!data.length) return res.status(404).json({ status: "error", message: "Room not found." });

  await logAudit(AUDIT_ACTIONS.ROOM_EDIT, { userEmail: req.user.email, userRole: req.user.role, entityType: "Room", entityId: req.params.id, newValue: updates, ...reqMeta(req) });
  res.json({ status: "success", message: "Room updated." });
}));

// DELETE /api/rooms/:id   (owner+) — archives before deleting
router.delete("/:id", authenticate, requireRole(ROLES.OWNER), asyncHandler(async (req, res) => {
  const { data: room, error: selErr } = await supabase.from("rooms").select("*").eq("id", req.params.id).maybeSingle();
  if (selErr) throw selErr;
  if (!room) return res.status(404).json({ status: "error", message: "Room not found." });

  const { error: archErr } = await supabase.from("archive").insert({
    archived_id: newId(), source_sheet: "rooms", data: room, deleted_by: req.user.email,
  });
  if (archErr) throw archErr;

  const { error: delErr } = await supabase.from("rooms").delete().eq("id", req.params.id);
  if (delErr) throw delErr;

  await logAudit(AUDIT_ACTIONS.ROOM_DELETE, { userEmail: req.user.email, userRole: req.user.role, entityType: "Room", entityId: req.params.id, prevValue: room, ...reqMeta(req) });
  res.json({ status: "success", message: "Room deleted." });
}));

module.exports = router;

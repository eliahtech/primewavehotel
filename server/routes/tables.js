// server/routes/tables.js — Supabase version
const express = require("express");
const { logAudit, AUDIT_ACTIONS, reqMeta } = require("../services/audit");
const router  = express.Router();
const supabase = require("../db/supabase");
const { authenticate } = require("../middleware/auth");
const { requireRole }  = require("../middleware/requireRole");
const { ROLES }        = require("../config/config");
const { sanitize, validateRequired, newId, asyncHandler } = require("../utils/helpers");

// GET /api/tables?seats=&status=
router.get("/", asyncHandler(async (req, res) => {
  const { seats, status } = req.query;
  let q = supabase.from("tables_").select("*");
  if (seats)  q = q.gte("seats", Number(seats));
  if (status) q = q.eq("status", status);
  q = q.order("table_number", { ascending: true });

  const { data, error } = await q;
  if (error) throw error;
  res.json({ status: "success", data });
}));

// GET /api/tables/:id
router.get("/:id", asyncHandler(async (req, res) => {
  const { data, error } = await supabase.from("tables_").select("*").eq("id", req.params.id).maybeSingle();
  if (error) throw error;
  if (!data) return res.status(404).json({ status: "error", message: "Table not found." });
  res.json({ status: "success", data });
}));

// POST /api/tables   (admin+)
router.post("/", authenticate, requireRole(ROLES.ADMIN), asyncHandler(async (req, res) => {
  validateRequired(req.body, ["table_number", "seats"]);

  const { data: existing } = await supabase.from("tables_").select("id").eq("table_number", req.body.table_number).maybeSingle();
  if (existing) return res.status(409).json({ status: "error", message: "Table number already exists." });

  const table = {
    id: newId(),
    table_number: sanitize(req.body.table_number),
    table_name: sanitize(req.body.table_name || "Table " + req.body.table_number),
    seats: Math.max(1, Math.floor(Number(req.body.seats)) || 1),
    location: sanitize(req.body.location || "Main Hall"),
    price_per_hour: Number(req.body.price_per_hour || 0),
    status: "available",
  };

  const { error } = await supabase.from("tables_").insert(table);
  if (error) throw error;

  await logAudit(AUDIT_ACTIONS.TABLE_ADD, { userEmail: req.user.email, userRole: req.user.role, entityType: "Table", entityId: table.id, newValue: table, ...reqMeta(req) });
  res.json({ status: "success", data: table, message: "Table added." });
}));

// PUT /api/tables/:id   (admin+)
router.put("/:id", authenticate, requireRole(ROLES.ADMIN), asyncHandler(async (req, res) => {
  const fields = ["table_number", "table_name", "seats", "location", "price_per_hour", "status"];
  const updates = {};
  fields.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
  ["seats", "price_per_hour"].forEach(f => {
    if (updates[f] !== undefined) { updates[f] = Number(updates[f]); if (!(updates[f] >= 0) || (f === "seats" && updates[f] < 1)) { const e = new Error("Invalid " + f + "."); e.statusCode = 400; throw e; } }
  });
  if (updates.status !== undefined && !["available", "reserved", "maintenance"].includes(updates.status)) { const e = new Error("Invalid status."); e.statusCode = 400; throw e; }
  ["table_number", "table_name", "location"].forEach(f => { if (updates[f] !== undefined) updates[f] = sanitize(updates[f]); });
  if (!Object.keys(updates).length) return res.status(400).json({ status: "error", message: "No fields to update." });

  const { data, error } = await supabase.from("tables_").update(updates).eq("id", req.params.id).select();
  if (error) throw error;
  if (!data.length) return res.status(404).json({ status: "error", message: "Table not found." });

  await logAudit(AUDIT_ACTIONS.TABLE_EDIT, { userEmail: req.user.email, userRole: req.user.role, entityType: "Table", entityId: req.params.id, newValue: updates, ...reqMeta(req) });
  res.json({ status: "success", message: "Table updated." });
}));

// DELETE /api/tables/:id   (owner+)
router.delete("/:id", authenticate, requireRole(ROLES.OWNER), asyncHandler(async (req, res) => {
  const { data: table, error: selErr } = await supabase.from("tables_").select("*").eq("id", req.params.id).maybeSingle();
  if (selErr) throw selErr;
  if (!table) return res.status(404).json({ status: "error", message: "Table not found." });

  const { error: archErr } = await supabase.from("archive").insert({
    archived_id: newId(), source_sheet: "tables", data: table, deleted_by: req.user.email,
  });
  if (archErr) throw archErr;

  const { error: delErr } = await supabase.from("tables_").delete().eq("id", req.params.id);
  if (delErr) throw delErr;

  await logAudit(AUDIT_ACTIONS.TABLE_DELETE, { userEmail: req.user.email, userRole: req.user.role, entityType: "Table", entityId: req.params.id, prevValue: table, ...reqMeta(req) });
  res.json({ status: "success", message: "Table deleted." });
}));

module.exports = router;

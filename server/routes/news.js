// server/routes/news.js
const express = require("express");
const router  = express.Router();
const supabase = require("../db/supabase");
const { authenticate } = require("../middleware/auth");
const { requireRole }  = require("../middleware/requireRole");
const { ROLES } = require("../config/config");
const { asyncHandler } = require("../utils/helpers");
const { logAudit, AUDIT_ACTIONS, reqMeta } = require("../services/audit");
const news = require("../services/news");

const who = req => ({ userEmail: req.user.email, userRole: req.user.role, entityType: "News", ...reqMeta(req) });

// GET /api/news?limit=9&before=<cursor>   — PUBLIC: published stories only
router.get("/", asyncHandler(async (req, res) => {
  res.set("Cache-Control", "public, max-age=30");
  res.json({ status: "success", ...(await news.listPublished({ limit: req.query.limit, before: req.query.before })) });
}));

// GET /api/news/manage/all   (admin+) — every story including drafts, with author ids so the dashboard can show Edit/Delete
router.get("/manage/all", authenticate, requireRole(ROLES.ADMIN), asyncHandler(async (req, res) => {
  const { data, error } = await supabase.from("news").select("*").order("created_at", { ascending: false }).limit(500);
  if (error) throw error;
  res.json({ status: "success", data });
}));

// GET /api/news/:id   — PUBLIC: one published story
router.get("/:id", asyncHandler(async (req, res) => {
  res.set("Cache-Control", "public, max-age=30");
  res.json({ status: "success", data: await news.getPublished(req.params.id) });
}));

// POST /api/news   (admin+)
router.post("/", authenticate, requireRole(ROLES.ADMIN), asyncHandler(async (req, res) => {
  const row = await news.createNews(req.user, req.body);
  await logAudit(AUDIT_ACTIONS.NEWS_CREATE, { ...who(req), entityId: row.id, newValue: { title: row.title, status: row.status } });
  res.json({ status: "success", message: row.status === "published" ? "Story published." : "Draft saved.", data: row });
}));

// PUT /api/news/:id   (admin+; admins only their own)
router.put("/:id", authenticate, requireRole(ROLES.ADMIN), asyncHandler(async (req, res) => {
  const { before, changes } = await news.updateNews(req.user, req.params.id, req.body);
  await logAudit(AUDIT_ACTIONS.NEWS_UPDATE, { ...who(req), entityId: req.params.id, prevValue: { title: before.title, status: before.status }, newValue: { title: changes.title, status: changes.status } });
  res.json({ status: "success", message: "Story updated." });
}));

// DELETE /api/news/:id   (admin+; admins only their own)
router.delete("/:id", authenticate, requireRole(ROLES.ADMIN), asyncHandler(async (req, res) => {
  const post = await news.deleteNews(req.user, req.params.id);
  await logAudit(AUDIT_ACTIONS.NEWS_DELETE, { ...who(req), entityId: req.params.id, prevValue: { title: post.title, status: post.status } });
  res.json({ status: "success", message: "Story deleted." });
}));

module.exports = router;

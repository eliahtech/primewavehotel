// server/routes/system.js — System Owner console API (all routes: systemowner only)
const express = require("express");
const router  = express.Router();
const supabase = require("../db/supabase");
const { authenticate } = require("../middleware/auth");
const { requireRole }  = require("../middleware/requireRole");
const { ROLES } = require("../config/config");
const { newId, sanitize, validateRequired, asyncHandler, httpError } = require("../utils/helpers");
const { logAudit, AUDIT_ACTIONS, reqMeta } = require("../services/audit");
const { runHousekeeping } = require("../jobs/housekeeping");

router.use(authenticate, requireRole(ROLES.SYSTEMOWNER));

// GET /api/system/audit?action=&email=&severity=&status=&from=&to=&limit=
router.get("/audit", asyncHandler(async (req, res) => {
  const { action, email, severity, status, from, to } = req.query;
  const limit = Math.min(Number(req.query.limit) || 200, 500);
  let q = supabase.from("audit_log").select("*");
  if (action)   q = q.eq("action", String(action).toUpperCase());
  if (email)    q = q.eq("user_email", String(email).toLowerCase());
  if (severity) q = q.eq("severity", severity);
  if (status)   q = q.eq("status", status);
  if (from)     q = q.gte("timestamp", new Date(from + "T00:00:00+03:00").toISOString());
  if (to)       q = q.lte("timestamp", new Date(to + "T23:59:59+03:00").toISOString());
  const { data, error } = await q.order("timestamp", { ascending: false }).limit(limit);
  if (error) throw error;
  res.json({ status: "success", data });
}));

// GET /api/system/overview — last-24h security picture
router.get("/overview", asyncHandler(async (req, res) => {
  const since = new Date(Date.now() - 86400000).toISOString();
  const [audit, inc, bk, jobs] = await Promise.all([
    supabase.from("audit_log").select("action,severity,user_email,ip_address,timestamp,status,entity_type,entity_id,new_value")
      .gte("timestamp", since).order("timestamp", { ascending: false }).limit(3000),
    supabase.from("incidents").select("incident_id", { count: "exact", head: true }).eq("status", "open"),
    supabase.from("backups").select("created_at,status").order("created_at", { ascending: false }).limit(1),
    supabase.from("job_log").select("job_name,status,finished_at").order("finished_at", { ascending: false }).limit(1),
  ]);
  if (audit.error) throw audit.error;
  const rows = audit.data;
  const top = (arr, key) => Object.entries(arr.reduce((m, r) => { const k = r[key] || "unknown"; m[k] = (m[k] || 0) + 1; return m; }, {}))
    .sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => ({ key: k, count: n }));
  const failed = rows.filter(r => r.action === "LOGIN_FAILED");
  res.json({ status: "success", data: {
    loginSuccess: rows.filter(r => r.action === "LOGIN_SUCCESS").length,
    loginFailed: failed.length,
    warnings: rows.filter(r => r.severity === "warn").length,
    critical: rows.filter(r => r.severity === "critical").length,
    topFailedIps: top(failed, "ip_address"),
    topFailedEmails: top(failed, "user_email"),
    recentCritical: rows.filter(r => r.severity === "critical").slice(0, 10),
    openIncidents: inc.count || 0,
    lastBackup: bk.data?.[0] || null,
    lastJob: jobs.data?.[0] || null,
  } });
}));

// ── Incidents ────────────────────────────────────────────────
router.get("/incidents", asyncHandler(async (req, res) => {
  const { data, error } = await supabase.from("incidents").select("*").order("opened_at", { ascending: false }).limit(200);
  if (error) throw error;
  res.json({ status: "success", data });
}));

router.post("/incidents", asyncHandler(async (req, res) => {
  validateRequired(req.body, ["title", "severity"]);
  if (!["medium", "high", "critical"].includes(req.body.severity)) throw httpError(400, "Invalid severity.");
  const row = { incident_id: newId(), severity: req.body.severity, service: sanitize(req.body.service || "manual"),
    title: sanitize(req.body.title), description: sanitize(req.body.description || ""), opened_by: req.user.email };
  const { error } = await supabase.from("incidents").insert(row);
  if (error) throw error;
  await logAudit(AUDIT_ACTIONS.SECURITY_EVENT, { userEmail: req.user.email, userRole: req.user.role, entityType: "Incident", entityId: row.incident_id, newValue: row, ...reqMeta(req) });
  res.json({ status: "success", data: row });
}));

router.put("/incidents/:id/resolve", asyncHandler(async (req, res) => {
  const { data, error } = await supabase.from("incidents")
    .update({ status: "resolved", resolved_at: new Date().toISOString() }).eq("incident_id", req.params.id).select();
  if (error) throw error;
  if (!data.length) throw httpError(404, "Incident not found.");
  res.json({ status: "success", message: "Incident resolved." });
}));

// ── Jobs ─────────────────────────────────────────────────────
router.get("/jobs", asyncHandler(async (req, res) => {
  const { data, error } = await supabase.from("job_log").select("*").order("finished_at", { ascending: false }).limit(100);
  if (error) throw error;
  res.json({ status: "success", data });
}));

router.post("/jobs/housekeeping", asyncHandler(async (req, res) => {
  const removed = await runHousekeeping("manual:" + req.user.email);
  await logAudit(AUDIT_ACTIONS.AUTO_DELETE_RUN, { userEmail: req.user.email, userRole: req.user.role, newValue: { removed }, ...reqMeta(req) });
  res.json({ status: "success", removed, message: `Housekeeping finished (${removed} booking(s) archived).` });
}));

// ── Sessions ─────────────────────────────────────────────────
// Tokens are stateless; bumping token_version invalidates every live token for that user at once.
router.post("/users/:id/revoke-sessions", asyncHandler(async (req, res) => {
  const { data: u, error } = await supabase.from("users").select("user_id,email,token_version").eq("user_id", req.params.id).maybeSingle();
  if (error) throw error;
  if (!u) throw httpError(404, "User not found.");
  const { error: e2 } = await supabase.from("users").update({ token_version: (u.token_version || 0) + 1 }).eq("user_id", u.user_id);
  if (e2) throw e2;
  await logAudit(AUDIT_ACTIONS.SESSION_REVOKE, { userEmail: req.user.email, userRole: req.user.role, entityType: "User", entityId: u.user_id, ...reqMeta(req) });
  res.json({ status: "success", message: "All sessions for " + u.email + " have been signed out." });
}));

// ── Backups (stored in a PRIVATE Supabase Storage bucket) ────
const BACKUP_TABLES = ["rooms", "tables_", "users", "bookings", "payments", "newsletter", "archive", "news", "site_settings"];
const BUCKET = "backups";

async function fetchAll(table) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select("*").range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

router.post("/backups", asyncHandler(async (req, res) => {
  const id = newId();
  const dump = {}, counts = {};
  for (const t of BACKUP_TABLES) {
    let rows = await fetchAll(t);
    if (t === "users") rows = rows.map(({ otp_code, reset_token, otp_expiry, otp_attempts, ...rest }) => rest); // never back up live OTPs
    dump[t] = rows; counts[t] = rows.length;
  }
  const body = Buffer.from(JSON.stringify({ created_at: new Date().toISOString(), by: req.user.email, tables: dump }));
  await supabase.storage.createBucket(BUCKET, { public: false }).catch(() => {}); // ignore "already exists"
  const path = `backup-${new Date().toISOString().slice(0, 10)}-${id}.json`;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, body, { contentType: "application/json", upsert: false });
  if (upErr) throw httpError(500, "Backup upload failed.");
  const row = { backup_id: id, created_by: req.user.email, type: "full", tables_included: BACKUP_TABLES.join(","),
    row_counts: counts, size_kb: Math.ceil(body.length / 1024), file_path: path, status: "complete" };
  const { error } = await supabase.from("backups").insert(row);
  if (error) throw error;
  await logAudit(AUDIT_ACTIONS.BACKUP_CREATE, { userEmail: req.user.email, userRole: req.user.role, entityType: "Backup", entityId: id, newValue: counts, ...reqMeta(req) });
  res.json({ status: "success", data: row, message: "Backup created." });
}));

router.get("/backups", asyncHandler(async (req, res) => {
  const { data, error } = await supabase.from("backups").select("*").order("created_at", { ascending: false }).limit(100);
  if (error) throw error;
  res.json({ status: "success", data });
}));

router.get("/backups/:id/download", asyncHandler(async (req, res) => {
  const { data: b, error } = await supabase.from("backups").select("file_path").eq("backup_id", req.params.id).maybeSingle();
  if (error) throw error;
  if (!b) throw httpError(404, "Backup not found.");
  const { data, error: sErr } = await supabase.storage.from(BUCKET).createSignedUrl(b.file_path, 120);
  if (sErr) throw httpError(500, "Could not create download link.");
  await logAudit(AUDIT_ACTIONS.SECURITY_EVENT, { userEmail: req.user.email, userRole: req.user.role, entityType: "Backup", entityId: req.params.id, newValue: { action: "download" }, ...reqMeta(req) });
  res.json({ status: "success", url: data.signedUrl, expires_in: 120 });
}));

module.exports = router;

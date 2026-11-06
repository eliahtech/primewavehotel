// server/services/news.js — validation, permissions and queries for news posts.
const supabase = require("../db/supabase");
const { ROLE_LEVEL } = require("../config/config");
const { newId, httpError } = require("../utils/helpers");

const LIMITS = { title: [3, 150], summary: 300, body: [10, 20000], image: 500 };
const ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

/** Plain text only: trims, removes control characters and angle brackets (the pages also escape everything they render). */
function cleanText(v, { multiline = false } = {}) {
  let s = String(v == null ? "" : v).replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F<>]/g, "");
  if (!multiline) s = s.replace(/\s*\n\s*/g, " ");
  else s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

function cleanImageUrl(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return "";
  let u; try { u = new URL(s); } catch { throw httpError(400, "Image link must be a full web address (https://…)."); }
  if (u.protocol !== "https:" || s.length > LIMITS.image) throw httpError(400, "Image link must start with https:// and be under 500 characters.");
  return u.toString();
}

const autoSummary = body => { const t = body.replace(/\s+/g, " ").trim(); return t.length <= 180 ? t : t.slice(0, 177).replace(/\s+\S*$/, "") + "…"; };

/** @param {object} input raw request body   @param {{partial?:boolean}} o   partial = update (only validate what was sent) */
function validateNews(input, { partial = false } = {}) {
  const out = {}, has = k => input[k] !== undefined;
  if (!partial || has("title")) {
    out.title = cleanText(input.title);
    if (out.title.length < LIMITS.title[0] || out.title.length > LIMITS.title[1]) throw httpError(400, `Title must be ${LIMITS.title[0]}–${LIMITS.title[1]} characters.`);
  }
  if (!partial || has("body")) {
    out.body = cleanText(input.body, { multiline: true });
    if (out.body.length < LIMITS.body[0] || out.body.length > LIMITS.body[1]) throw httpError(400, `Story must be ${LIMITS.body[0]}–${LIMITS.body[1]} characters.`);
  }
  if (has("summary") || (!partial)) {
    out.summary = cleanText(input.summary);
    if (out.summary.length > LIMITS.summary) throw httpError(400, `Summary must be at most ${LIMITS.summary} characters.`);
  }
  if (has("image_url")) out.image_url = cleanImageUrl(input.image_url);
  if (has("status")) {
    if (!["draft", "published"].includes(input.status)) throw httpError(400, "Status must be draft or published.");
    out.status = input.status;
  } else if (!partial) out.status = "draft";
  if (has("pinned")) out.pinned = input.pinned === true || input.pinned === "true";
  if (!partial && !out.summary && out.body) out.summary = autoSummary(out.body);
  return out;
}

/** Admins edit their own posts; owners and system owners edit anyone's. */
function canEditNews(user, post) {
  const l = ROLE_LEVEL[user.role] || 0;
  return l >= ROLE_LEVEL.owner || (l >= ROLE_LEVEL.admin && post.author_id === user.user_id);
}

/** What the public may see: never the author's id/e-mail, never drafts. */
const toPublic = (p, { withBody = false } = {}) => ({
  id: p.id, title: p.title, summary: p.summary, image_url: p.image_url, pinned: !!p.pinned,
  published_at: p.published_at, author_name: p.author_name || "PrimeWave Hotel", ...(withBody ? { body: p.body } : {}),
});

async function listPublished({ limit = 9, before } = {}) {
  limit = Math.min(Math.max(parseInt(limit, 10) || 9, 1), 30);
  let q = supabase.from("news").select("*").eq("status", "published").eq("pinned", false).order("published_at", { ascending: false }).limit(limit + 1);
  if (before) { if (isNaN(Date.parse(before))) throw httpError(400, "Invalid cursor."); q = q.lt("published_at", before); }
  const { data: rest, error } = await q; if (error) throw error;
  let pinned = [];
  if (!before) {                                   // pinned posts lead the FIRST page only
    const r = await supabase.from("news").select("*").eq("status", "published").eq("pinned", true).order("published_at", { ascending: false }).limit(3);
    if (r.error) throw r.error; pinned = r.data;
  }
  const page = rest.slice(0, limit), more = rest.length > limit;
  return { data: [...pinned, ...page].map(p => toPublic(p)), next: more ? page[page.length - 1].published_at : null };
}

async function getPublished(id) {
  if (!ID_RE.test(String(id))) throw httpError(404, "Story not found.");
  const { data, error } = await supabase.from("news").select("*").eq("id", id).eq("status", "published").maybeSingle();
  if (error) throw error;
  if (!data) throw httpError(404, "Story not found.");
  return toPublic(data, { withBody: true });
}

async function createNews(user, input) {
  const f = validateNews(input);
  const now = new Date().toISOString();
  const row = { id: newId(), ...f, image_url: f.image_url || "", pinned: !!f.pinned, author_id: user.user_id, author_name: user.name, author_role: user.role,
    published_at: f.status === "published" ? now : null, created_at: now, updated_at: now };
  const { error } = await supabase.from("news").insert(row); if (error) throw error;
  return row;
}

async function updateNews(user, id, input) {
  if (!ID_RE.test(String(id))) throw httpError(404, "Story not found.");
  const { data: post, error } = await supabase.from("news").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!post) throw httpError(404, "Story not found.");
  if (!canEditNews(user, post)) throw httpError(403, "You can only edit your own stories.");
  const f = validateNews(input, { partial: true });
  if (!Object.keys(f).length) throw httpError(400, "Nothing to update.");
  if (f.status === "published" && post.status !== "published") f.published_at = post.published_at || new Date().toISOString(); // keep the original date on re-publish
  f.updated_at = new Date().toISOString();
  const { error: uErr } = await supabase.from("news").update(f).eq("id", id); if (uErr) throw uErr;
  return { before: post, changes: f };
}

async function deleteNews(user, id) {
  if (!ID_RE.test(String(id))) throw httpError(404, "Story not found.");
  const { data: post, error } = await supabase.from("news").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!post) throw httpError(404, "Story not found.");
  if (!canEditNews(user, post)) throw httpError(403, "You can only delete your own stories.");
  const { error: dErr } = await supabase.from("news").delete().eq("id", id); if (dErr) throw dErr;
  return post;
}

module.exports = { validateNews, cleanText, canEditNews, toPublic, listPublished, getPublished, createNews, updateNews, deleteNews, ID_RE };

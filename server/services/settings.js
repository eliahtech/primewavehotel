// server/services/settings.js — site-wide settings. Today: social-media links shown in the site footer.
const supabase = require("../db/supabase");
const { httpError } = require("../utils/helpers");

// A link must be https and point at the matching network — this also blocks javascript:/data: URLs.
const NETWORKS = {
  facebook:  ["facebook.com", "fb.com", "fb.me"],
  youtube:   ["youtube.com", "youtu.be"],
  tiktok:    ["tiktok.com"],
  instagram: ["instagram.com"],
};
const hostOk = (host, allowed) => allowed.some(d => host === d || host.endsWith("." + d));

/** @returns {Record<string,string>} only the networks that were sent ('' clears a link) */
function validateSocial(input) {
  const out = {};
  for (const [net, domains] of Object.entries(NETWORKS)) {
    if (input[net] === undefined) continue;
    const s = String(input[net] || "").trim();
    if (!s) { out[net] = ""; continue; }
    let u; try { u = new URL(s); } catch { throw httpError(400, `${net[0].toUpperCase() + net.slice(1)}: please paste the full link (https://…).`); }
    if (u.protocol !== "https:" || s.length > 300 || !hostOk(u.hostname.toLowerCase(), domains)) {
      throw httpError(400, `${net[0].toUpperCase() + net.slice(1)}: the link must be an https:// address on ${domains[0]}.`);
    }
    out[net] = u.toString();
  }
  return out;
}

async function getSocial() {
  const { data, error } = await supabase.from("site_settings").select("key,value").in("key", Object.keys(NETWORKS).map(n => "social_" + n));
  if (error) throw error;
  const out = {}; for (const n of Object.keys(NETWORKS)) out[n] = "";
  (data || []).forEach(r => { out[r.key.replace("social_", "")] = r.value || ""; });
  return out;
}

async function saveSocial(map, userEmail) {
  const rows = Object.entries(map).map(([n, v]) => ({ key: "social_" + n, value: v, updated_by: userEmail, updated_at: new Date().toISOString() }));
  if (!rows.length) throw httpError(400, "Nothing to update.");
  const { error } = await supabase.from("site_settings").upsert(rows); if (error) throw error;
}

module.exports = { NETWORKS, validateSocial, getSocial, saveSocial };

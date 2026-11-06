// server/services/pendingSessions.js
// Replaces GAS's CacheService-based savePendingSession_/getPendingSession_/
// deletePendingSession_. Backed by the pending_sessions table so a server
// restart mid-payment doesn't lose the session.

const supabase = require("../db/supabase");

const TTL_MS = require("../config/config").CONFIG.SESSION_TTL_MINUTES * 60 * 1000;

async function savePendingSession(sessionId, data) {
  const { error } = await supabase.from("pending_sessions").upsert({
    session_id: sessionId,
    data,
    pesapal_tracking_id: data.pesapal_tracking_id || null,
    expires_at: new Date(Date.now() + TTL_MS).toISOString(),
  });
  if (error) throw error;
}

async function getPendingSession(sessionId) {
  if (!sessionId) return null;
  const { data, error } = await supabase
    .from("pending_sessions").select("*").eq("session_id", sessionId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (new Date(data.expires_at).getTime() < Date.now()) {
    await deletePendingSession(sessionId);
    return null;
  }
  return data.data;
}

async function deletePendingSession(sessionId) {
  if (!sessionId) return;
  await supabase.from("pending_sessions").delete().eq("session_id", sessionId);
}

module.exports = { savePendingSession, getPendingSession, deletePendingSession };

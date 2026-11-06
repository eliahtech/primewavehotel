// server/utils/sanitize.js
// Replaces the GAS `sanitize()` helper referenced in chatAssistant.
// Basic trim + strip of control characters; the frontend already
// HTML-escapes on render, so this just guards what we send to the
// AI provider / log.

function sanitize(str) {
  return String(str || "")
    .replace(/[\u0000-\u001F\u007F]/g, "") // strip control chars
    .trim();
}

module.exports = { sanitize };

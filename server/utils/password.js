// server/utils/password.js
// bcrypt for new hashes. Legacy unsalted SHA-256 hashes (from the Apps Script
// system) are still accepted once, then transparently upgraded on login.

const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { CONFIG } = require("../config/config");

const ROUNDS = 10;

async function hashPassword(password) {
  return bcrypt.hash(String(password), ROUNDS);
}

function legacyHash(password) {
  return crypto.createHash("sha256").update(CONFIG.JWT_SECRET + "|" + password, "utf8").digest("hex");
}

/** @returns {Promise<{ok:boolean, needsUpgrade:boolean}>} */
async function verifyPassword(password, stored) {
  stored = String(stored || "");
  if (stored.startsWith("$2")) {
    return { ok: await bcrypt.compare(String(password), stored), needsUpgrade: false };
  }
  const a = Buffer.from(legacyHash(String(password)));
  const b = Buffer.from(stored);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  return { ok, needsUpgrade: ok };
}

module.exports = { hashPassword, verifyPassword };

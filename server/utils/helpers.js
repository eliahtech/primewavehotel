// server/utils/helpers.js
// Replaces the small utility functions at the bottom of Code.gs:
// sanitize(), sanitizeBookingInput(), validateRequired(), newId(),
// generateBookingId(), calcNights(), calcHours_().

const crypto = require("crypto");
const { CONFIG } = require("../config/config");

function sanitize(val) {
  if (typeof val !== "string") return String(val ?? "");
  return val.replace(/[<>"'`]/g, "").trim().slice(0, 500);
}

function sanitizeBookingInput(body) {
  ["name", "phone", "email", "notes"].forEach(k => {
    if (body[k]) body[k] = sanitize(body[k]);
  });
}

/**
 * Throws if any of `fields` is missing/empty on `body`.
 * Callers should wrap route handlers in try/catch (or use asyncHandler)
 * so this surfaces as a 400, matching the GAS validateRequired() behavior.
 */
function validateRequired(body, fields) {
  const missing = fields.filter(f => body[f] === undefined || body[f] === null || body[f] === "");
  if (missing.length) {
    const err = new Error("Missing required fields: " + missing.join(", "));
    err.statusCode = 400;
    throw err;
  }
}

// 12-char id, same shape as GAS's Utilities.getUuid().replace(/-/g,"").slice(0,12)
function newId() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

function generateBookingId() {
  // crypto-random, 8 chars from an unambiguous alphabet (~10^12 combos); PK still guards collisions
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) out += alphabet[bytes[i] % alphabet.length];
  return CONFIG.BOOKING_PREFIX + "-" + new Date().getFullYear() + "-" + out;
}

function calcNights(checkin, checkout) {
  const diff = Math.round((new Date(checkout) - new Date(checkin)) / 86400000);
  return diff > 0 ? diff : 1;
}

function calcHours(checkin, checkout) {
  const ms = new Date(checkout) - new Date(checkin);
  const h  = Math.round(ms / 3600000);
  return h > 0 ? h : 1;
}

// Small wrapper so async route handlers don't need try/catch boilerplate —
// forwards rejected promises (including validateRequired's thrown errors)
// to an Express error handler.
function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

/**
 * Validates a checkin/checkout pair. Returns { checkin, checkout } as ISO strings.
 * Throws a 400 for unparsable, inverted, past or too-long ranges.
 */
// Hotel is in Nairobi (UTC+3, no DST). Naive strings from the forms ("2026-11-02" or
// "2026-11-02T14:00:00") are interpreted as Nairobi local time, not the server's (UTC on Vercel).
function toEat(v) {
  const s = String(v || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + "T00:00:00+03:00");
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/.test(s)) return new Date(s.replace(" ", "T") + (s.length === 16 ? ":00" : "") + "+03:00");
  return new Date(s);
}

function parseRange(checkin, checkout, { allowPast = false, maxDays = CONFIG.MAX_STAY_DAYS, isTable = false } = {}) {
  const a = toEat(checkin), b = toEat(checkout);
  if (isNaN(a) || isNaN(b)) throw httpError(400, "Invalid check-in or check-out date.");
  if (b <= a) throw httpError(400, "Check-out must be after check-in.");
  if (!allowPast && a.getTime() < Date.now() - 24 * 3600 * 1000) throw httpError(400, "Check-in cannot be in the past.");
  const days = (b - a) / 86400000;
  if (days > (isTable ? 1 : maxDays)) throw httpError(400, isTable ? "Table reservations cannot exceed 24 hours." : `Stays are limited to ${maxDays} nights.`);
  return { checkin: a.toISOString(), checkout: b.toISOString() };
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = {
  sanitize, sanitizeBookingInput, validateRequired,
  newId, generateBookingId, calcNights, calcHours, asyncHandler, httpError, parseRange, toEat,
};

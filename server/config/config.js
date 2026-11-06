// server/config/config.js
const secret = process.env.JWT_SECRET;
if (!secret || secret.length < 32 || /CHANGE/i.test(secret)) {
  throw new Error("JWT_SECRET must be set to a random string of at least 32 characters.");
}

function publicBaseUrl() {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return "https://" + process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return `http://localhost:${process.env.PORT || 3000}`;
}

const CONFIG = {
  HOTEL_NAME:            process.env.HOTEL_NAME  || "PrimeWave Hotel",
  ADMIN_EMAIL:           process.env.ADMIN_EMAIL || "",
  BOOKING_PREFIX:        "PW",
  AUTO_DELETE_DAYS:      180,
  ARCHIVE_BEFORE_DELETE: true,
  JWT_SECRET:            secret,
  PUBLIC_BASE_URL:       publicBaseUrl(),
  TIMEZONE:              "Africa/Nairobi",
  MIN_PASSWORD_LENGTH:   8,
  OTP_EXPIRY_MINUTES: 10,
  OTP_MAX_ATTEMPTS:   5,
  OTP_RESEND_SECONDS: 60,
  MAX_STAY_DAYS:      60,
  SESSION_TTL_MINUTES: 15,
};

const ROLES = { SYSTEMOWNER: "systemowner", OWNER: "owner", ADMIN: "admin", USER: "user" };
const ROLE_LEVEL = { systemowner: 4, owner: 3, admin: 2, user: 1 };

module.exports = { CONFIG, ROLES, ROLE_LEVEL };

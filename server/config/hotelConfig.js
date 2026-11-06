// server/config/hotelConfig.js
// Replaces the GAS `CONFIG` object referenced throughout the
// original script (CONFIG.HOTEL_NAME, CONFIG.ADMIN_EMAIL, etc).
// Pull from env where it makes sense so staging/prod can differ
// from local without code changes.

module.exports = {
  HOTEL_NAME:    process.env.HOTEL_NAME    || "PrimeWave Hotel",
  ADMIN_EMAIL:   process.env.ADMIN_EMAIL   || "",
  ADMIN_PHONE:   process.env.ADMIN_PHONE   || "",
  GROQ_API_URL:  "https://api.groq.com/openai/v1/chat/completions",
  GROQ_MODEL:    "llama-3.3-70b-versatile",
};

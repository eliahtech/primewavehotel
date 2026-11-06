// server/middleware/rateLimit.js
// Shared (Postgres-backed) rate limiter — in-memory counters don't work on
// serverless because every instance has its own memory.
// Fails OPEN if the DB is unreachable so an outage can't lock everyone out.

const supabase = require("../db/supabase");

function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

/**
 * @param {{name:string, max:number, windowSec:number, key?:(req)=>string}} opts
 */
function rateLimit({ name, max, windowSec, key }) {
  return async function (req, res, next) {
    try {
      const k = `${name}:${key ? key(req) : clientIp(req)}`;
      const { data, error } = await supabase.rpc("rate_limit_hit", {
        p_key: k.slice(0, 200), p_window_seconds: windowSec, p_max: max,
      });
      if (error) { console.error("[rateLimit]", error.message); return next(); }
      if (data === false) {
        res.set("Retry-After", String(windowSec));
        return res.status(429).json({ status: "error", message: "Too many requests. Please slow down and try again shortly." });
      }
    } catch (e) {
      console.error("[rateLimit]", e.message);
    }
    next();
  };
}

const globalLimit = rateLimit({ name: "api",  max: 300, windowSec: 600 });
const authLimit   = rateLimit({ name: "auth", max: 10,  windowSec: 900 });
const otpLimit    = rateLimit({ name: "otp",  max: 8,   windowSec: 900 });
const chatLimit   = rateLimit({ name: "chat", max: 20,  windowSec: 600 });
const payLimit    = rateLimit({ name: "pay",  max: 15,  windowSec: 900 });
const formLimit   = rateLimit({ name: "form", max: 10,  windowSec: 900 });

module.exports = { rateLimit, globalLimit, authLimit, otpLimit, chatLimit, payLimit, formLimit, clientIp };

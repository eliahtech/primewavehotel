// server/middleware/auth.js
// Verifies a JWT, then re-reads the user's row so deactivation, role changes
// and password changes (token_version) take effect immediately.

const jwt      = require("jsonwebtoken");
const supabase = require("../db/supabase");
const { CONFIG } = require("../config/config");

async function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const token  = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ status: "error", message: "Unauthorised: no token provided" });
  }

  let payload;
  try {
    payload = jwt.verify(token, CONFIG.JWT_SECRET, { algorithms: ["HS256"] });
  } catch (err) {
    const reason = err.name === "TokenExpiredError"
      ? "Token has expired. Please log in again."
      : "Token signature invalid.";
    return res.status(401).json({ status: "error", message: "Unauthorised: " + reason });
  }

  try {
    const { data: user, error } = await supabase
      .from("users")
      .select("user_id, email, name, role, is_active, token_version")
      .eq("user_id", payload.user_id)
      .maybeSingle();
    if (error) throw error;

    if (!user || !user.is_active || (user.token_version || 0) !== (payload.tv || 0)) {
      return res.status(401).json({ status: "error", message: "Unauthorised: session no longer valid. Please log in again." });
    }

    req.user = { user_id: user.user_id, email: user.email, name: user.name, role: user.role };
    next();
  } catch (err) {
    console.error("[authenticate] DB error:", err.message);
    return res.status(500).json({ status: "error", message: "Server error during authentication." });
  }
}

module.exports = { authenticate };

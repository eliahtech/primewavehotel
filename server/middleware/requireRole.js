// server/middleware/requireRole.js
// Replaces GAS's requireRole(user, minRole) throw-based check.
// Use AFTER `authenticate` so req.user is populated.

const { ROLE_LEVEL } = require("../config/config");

function requireRole(minRole) {
  return (req, res, next) => {
    const userLevel = ROLE_LEVEL[req.user?.role] || 0;
    const minLevel  = ROLE_LEVEL[minRole] || 0;
    if (userLevel < minLevel) {
      return res.status(403).json({ status: "error", message: "Insufficient permissions. Required: " + minRole });
    }
    next();
  };
}

module.exports = { requireRole };

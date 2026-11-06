// server/services/userPolicy.js — who may see and manage which accounts. One place, so every route agrees.
//
//   admin        → sees guests + admins            (not owners / system owners)
//   owner        → sees guests + admins + owners   (not the system owner)
//   systemowner  → sees everyone
//
// SEEING an account is enough to reset its password (the user is e-mailed, signed out everywhere, and the action is audited).
// EDITING an account (role, active, details) is stricter: only accounts strictly BELOW you, and only roles below yours can be assigned.

const { ROLE_LEVEL } = require("../config/config");
const lvl = r => ROLE_LEVEL[String(r || "").toLowerCase()] || 0;

const canSeeUser       = (callerRole, targetRole) => lvl(callerRole) >= ROLE_LEVEL.admin && lvl(targetRole) <= lvl(callerRole);
const canResetPassword = (caller, target) => canSeeUser(caller.role, target.role) && target.user_id !== caller.user_id; // own password → change-password
const canEditUser      = (callerRole, targetRole) => lvl(callerRole) >= ROLE_LEVEL.admin && lvl(targetRole) < lvl(callerRole);
const canAssignRole    = (callerRole, newRole) => !!ROLE_LEVEL[newRole] && lvl(newRole) < lvl(callerRole);
const visibleUsers     = (users, callerRole) => users.filter(u => canSeeUser(callerRole, u.role));

module.exports = { canSeeUser, canResetPassword, canEditUser, canAssignRole, visibleUsers };

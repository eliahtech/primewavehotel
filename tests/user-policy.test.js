const S = require("./helpers/setup");
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../server/services/userPolicy");

const ROLES = ["user", "admin", "owner", "systemowner"];
const users = ROLES.map(r => ({ user_id: "id-" + r, role: r }));
const seen = role => P.visibleUsers(users, role).map(u => u.role);

test("admin sees guests and admins — NOT owners or the system owner", () => assert.deepEqual(seen("admin"), ["user", "admin"]));
test("owner sees everyone except the system owner", () => assert.deepEqual(seen("owner"), ["user", "admin", "owner"]));
test("system owner sees everyone", () => assert.deepEqual(seen("systemowner"), ROLES));
test("guests (and unknown roles) see no accounts at all", () => { assert.deepEqual(seen("user"), []); assert.deepEqual(seen("hacker"), []); assert.deepEqual(seen(undefined), []); });

test("password resets follow visibility: you can reset anyone you can see, never above you, never yourself", () => {
  const me = r => ({ user_id: "me", role: r });
  const can = (caller, target) => P.canResetPassword(me(caller), { user_id: "x", role: target });
  assert.equal(can("admin", "user"), true);   assert.equal(can("admin", "admin"), true);
  assert.equal(can("admin", "owner"), false); assert.equal(can("admin", "systemowner"), false);
  assert.equal(can("owner", "owner"), true);  assert.equal(can("owner", "systemowner"), false);
  assert.equal(can("systemowner", "systemowner"), true); assert.equal(can("systemowner", "user"), true);
  assert.equal(can("user", "user"), false, "guests can never reset anyone");
  assert.equal(P.canResetPassword({ user_id: "me", role: "owner" }, { user_id: "me", role: "owner" }), false, "own password uses change-password");
});

test("editing roles/active is stricter: only accounts strictly below you, and only lower roles can be granted", () => {
  assert.equal(P.canEditUser("admin", "user"), true);
  assert.equal(P.canEditUser("admin", "admin"), false);
  assert.equal(P.canEditUser("owner", "admin"), true);
  assert.equal(P.canEditUser("owner", "owner"), false);
  assert.equal(P.canEditUser("systemowner", "owner"), true);
  assert.equal(P.canAssignRole("admin", "user"), true);
  assert.equal(P.canAssignRole("admin", "admin"), false, "no promoting someone to your own level");
  assert.equal(P.canAssignRole("owner", "admin"), true);
  assert.equal(P.canAssignRole("owner", "systemowner"), false);
  assert.equal(P.canAssignRole("systemowner", "superuser"), false, "unknown roles");
});

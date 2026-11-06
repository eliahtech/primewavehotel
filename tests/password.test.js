const S = require("./helpers/setup");
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
let have = true; try { require.resolve("bcryptjs"); } catch { have = false; }
const opts = { skip: have ? false : "bcryptjs not installed — run `npm install` first" };

test("new passwords are stored as salted bcrypt and verify correctly", opts, async () => {
  const { hashPassword, verifyPassword } = require("../server/utils/password");
  const h = await hashPassword("correct horse"), h2 = await hashPassword("correct horse");
  assert.match(h, /^\$2[aby]\$/); assert.notEqual(h, h2, "salted");
  assert.deepEqual(await verifyPassword("correct horse", h), { ok: true, needsUpgrade: false });
  assert.equal((await verifyPassword("wrong", h)).ok, false);
});

test("old Apps-Script SHA-256 hashes still work once and are flagged for upgrade", opts, async () => {
  const { verifyPassword } = require("../server/utils/password");
  const legacy = crypto.createHash("sha256").update(process.env.JWT_SECRET + "|" + "oldpass1", "utf8").digest("hex");
  assert.deepEqual(await verifyPassword("oldpass1", legacy), { ok: true, needsUpgrade: true });
  assert.equal((await verifyPassword("nope", legacy)).ok, false);
  assert.equal((await verifyPassword("x", "")).ok, false);
});

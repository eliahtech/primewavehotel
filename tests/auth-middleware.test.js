const S = require("./helpers/setup");
const test = require("node:test");
const assert = require("node:assert/strict");
let jwt = null; try { jwt = require("jsonwebtoken"); } catch {}
const opts = { skip: jwt ? false : "jsonwebtoken not installed — run `npm install` first" };

const user = (o = {}) => ({ user_id: "U1", email: "a@x.com", name: "A", role: "admin", is_active: true, token_version: 0, ...o });
const sign = (payload, secret = process.env.JWT_SECRET, o = { algorithm: "HS256", expiresIn: "1h" }) => jwt.sign(payload, secret, o);
async function call(headers = {}, body = {}) {
  const { authenticate } = require("../server/middleware/auth");
  const res = { code: null, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  const req = { headers, body };
  let passed = false; await authenticate(req, res, () => { passed = true; });
  return { passed, res, req };
}
test.beforeEach(() => { S.reset(); S.fake.t.users.push(user()); });

test("a valid token for an active user is accepted and the role comes from the DATABASE, not the token", opts, async () => {
  const r = await call({ authorization: "Bearer " + sign({ user_id: "U1", tv: 0, role: "systemowner" }) });
  assert.equal(r.passed, true); assert.equal(r.req.user.role, "admin");
});
test("no token, garbage, wrong secret, expired and alg=none are all 401", opts, async () => {
  const none = Buffer.from('{"alg":"none","typ":"JWT"}').toString("base64url") + "." + Buffer.from('{"user_id":"U1","tv":0}').toString("base64url") + ".";
  for (const h of [{}, { authorization: "Bearer junk" }, { authorization: "Bearer " + sign({ user_id: "U1", tv: 0 }, "x".repeat(48)) },
    { authorization: "Bearer " + sign({ user_id: "U1", tv: 0 }, undefined, { algorithm: "HS256", expiresIn: -10 }) }, { authorization: "Bearer " + none }]) {
    const r = await call(h); assert.equal(r.res.code, 401); assert.equal(r.passed, false);
  }
});
test("a token placed in the request BODY is ignored", opts, async () => {
  const r = await call({}, { token: sign({ user_id: "U1", tv: 0 }) }); assert.equal(r.res.code, 401);
});
test("deactivated users and users whose sessions were revoked are cut off immediately", opts, async () => {
  const t = sign({ user_id: "U1", tv: 0 });
  S.fake.t.users[0].token_version = 1; assert.equal((await call({ authorization: "Bearer " + t })).res.code, 401);
  S.fake.t.users[0].token_version = 0; S.fake.t.users[0].is_active = false; assert.equal((await call({ authorization: "Bearer " + t })).res.code, 401);
  S.fake.t.users.length = 0; assert.equal((await call({ authorization: "Bearer " + t })).res.code, 401, "deleted user");
});

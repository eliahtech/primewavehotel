const S = require("./helpers/setup");
const test = require("node:test");
const assert = require("node:assert/strict");
const { rateLimit } = require("../server/middleware/rateLimit");

const run = async (mw, ip = "1.1.1.1") => {
  const res = { code: 200, headers: {}, body: null, set(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  let passed = false; await mw({ ip, socket: {} }, res, () => { passed = true; });
  return { passed, res };
};
test.beforeEach(() => S.reset());

test("allows up to the limit, then answers 429 with Retry-After", async () => {
  const mw = rateLimit({ name: "t", max: 3, windowSec: 60 });
  for (let i = 0; i < 3; i++) assert.equal((await run(mw)).passed, true);
  const r = await run(mw);
  assert.equal(r.passed, false); assert.equal(r.res.code, 429); assert.equal(r.res.headers["Retry-After"], "60");
});

test("each client IP and each limiter has its own counter", async () => {
  const a = rateLimit({ name: "a", max: 1, windowSec: 60 }), b = rateLimit({ name: "b", max: 1, windowSec: 60 });
  await run(a, "1.1.1.1");
  assert.equal((await run(a, "2.2.2.2")).passed, true);
  assert.equal((await run(b, "1.1.1.1")).passed, true);
  assert.equal((await run(a, "1.1.1.1")).passed, false);
});

test("fails OPEN: a database outage must not lock every guest out", async () => {
  const orig = S.fake.rpc; S.fake.rpc = async () => ({ data: null, error: { message: "db down" } });
  try { assert.equal((await run(rateLimit({ name: "x", max: 1, windowSec: 60 }))).passed, true); } finally { S.fake.rpc = orig; }
});

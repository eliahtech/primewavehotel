// Runs public/guard.js in a sandbox that imitates a browser — no real browser needed.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), path = require("path"), vm = require("vm");
const code = fs.readFileSync(path.join(__dirname, "..", "public", "guard.js"), "utf8");

const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
const token = (exp = Math.floor(Date.now() / 1000) + 3600) => `${b64({ alg: "HS256" })}.${b64({ exp })}.sig`;

function visit(min, { tok, user, path: pth = "/admin.html" } = {}) {
  const store = {}; if (tok) store.pw_token = tok; if (user) store.pw_user = JSON.stringify(user);
  const out = { redirected: null, hidden: false, listeners: {} };
  vm.runInNewContext(code, {
    document: { currentScript: { getAttribute: () => min }, documentElement: { style: { set display(v) { out.hidden = v === "none"; } } } },
    sessionStorage: { getItem: k => store[k] ?? null, removeItem: k => { delete store[k]; } },
    location: { pathname: pth, replace: u => { out.redirected = u; } },
    window: { addEventListener: (ev, fn) => { out.listeners[ev] = fn; } },
    atob: s => Buffer.from(s, "base64").toString("binary"), encodeURIComponent, JSON, Date,
  });
  out.store = store; return out;
}
const guest = { role: "user", name: "G" }, admin = { role: "admin" }, owner = { role: "owner" }, sys = { role: "systemowner" };

test("signed-out visitors never see a dashboard: hidden and sent to login with a return path", () => {
  for (const min of ["admin", "owner", "systemowner", "user"]) {
    const r = visit(min, { path: `/${min}.html` });
    assert.equal(r.hidden, true, min); assert.equal(r.redirected, `/login.html?redirect=%2F${min}.html`, min);
  }
});

test("an expired token counts as signed out, and is wiped", () => {
  const r = visit("admin", { tok: token(Math.floor(Date.now() / 1000) - 10), user: admin });
  assert.match(r.redirected, /^\/login\.html/); assert.equal(r.store.pw_token, undefined);
});

test("garbage in storage is treated as signed out", () => {
  assert.match(visit("admin", { tok: "not-a-jwt", user: admin }).redirected, /^\/login\.html/);
  assert.match(visit("admin", { tok: token() }).redirected, /^\/login\.html/, "token but no user");
});

test("a guest is bounced away from staff pages to their own account page", () => {
  for (const min of ["admin", "owner", "systemowner"]) assert.equal(visit(min, { tok: token(), user: guest }).redirected, "/account.html", min);
});

test("each staff role is kept to its own level", () => {
  assert.equal(visit("owner", { tok: token(), user: admin }).redirected, "/admin.html");
  assert.equal(visit("systemowner", { tok: token(), user: owner }).redirected, "/owner.html");
  assert.equal(visit("systemowner", { tok: token(), user: admin }).redirected, "/admin.html");
});

test("allowed users are left alone (higher roles may open lower pages)", () => {
  for (const [min, user] of [["admin", admin], ["admin", owner], ["admin", sys], ["owner", owner], ["owner", sys], ["systemowner", sys], ["user", guest], ["user", admin]]) {
    const r = visit(min, { tok: token(), user }); assert.equal(r.redirected, null, `${min} / ${user.role}`); assert.equal(r.hidden, false);
  }
});

test("after sign-out, pressing Back (page restored from cache) is re-checked and blocked", () => {
  const r = visit("admin", { tok: token(), user: admin });
  assert.equal(r.redirected, null);
  delete r.store.pw_token; delete r.store.pw_user;                      // user signs out in the meantime
  r.listeners.pageshow({ persisted: true });
  assert.match(r.redirected, /^\/login\.html/); assert.equal(r.hidden, true);
});

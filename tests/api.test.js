// End-to-end HTTP tests: the real Express app + real middleware, with the in-memory database.
// Needs `npm install` (express, jsonwebtoken, helmet…). Skips itself if they are missing.
const S = require("./helpers/setup");
const test = require("node:test");
const assert = require("node:assert/strict");
let jwt = null, app = null;
try { jwt = require("jsonwebtoken"); require("express"); require("helmet"); app = require("../server/app"); } catch (e) { /* skipped below */ }
const opts = { skip: app ? false : "dependencies not installed — run `npm install` first" };
const { day, fake } = S;

let server, base;
const tok = (id, o = {}) => jwt.sign({ user_id: id, tv: 0, ...o }, process.env.JWT_SECRET, { algorithm: "HS256", expiresIn: "1h" });
const as = t => ({ authorization: "Bearer " + t });
async function http(method, url, { headers = {}, body } = {}) {
  const r = await fetch(base + url, { method, headers: { "content-type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text, type: r.headers.get("content-type") || "" };
}
const iso = (d, t = "00:00:00") => new Date(`${d}T${t}+03:00`).toISOString();

test.before(async () => { if (!app) return; await new Promise(r => { server = app.listen(0, r); }); base = "http://127.0.0.1:" + server.address().port; });
test.after(() => server && server.close());
test.beforeEach(() => {
  if (!app) return; S.reset(); S.seedRoom(); S.seedTable();
  for (const [id, role] of [["G", "user"], ["A", "admin"], ["O", "owner"], ["S", "systemowner"]]) fake.t.users.push({ user_id: id, email: id.toLowerCase() + "@x.com", name: id, role, is_active: true, token_version: 0 });
});

const DASHBOARD_APIS = ["/api/dashboard", "/api/dashboard/owner", "/api/dashboard/revenue", "/api/users", "/api/bookings", "/api/payments",
  "/api/rooms/admin/all", "/api/archive", "/api/system/overview", "/api/system/audit", "/api/system/backups", "/api/system/jobs", "/api/system/incidents"];

test("EVERY dashboard API refuses a visitor who is not signed in (401)", opts, async () => {
  for (const u of DASHBOARD_APIS) assert.equal((await http("GET", u)).status, 401, u);
});
test("…and refuses forged tokens, tokens in the body, and a revoked session", opts, async () => {
  for (const u of DASHBOARD_APIS) {
    assert.equal((await http("GET", u, { headers: as(jwt.sign({ user_id: "S", tv: 0 }, "x".repeat(48))) })).status, 401, "forged " + u);
    assert.equal((await http("GET", u, { body: undefined, headers: {} })).status, 401);
  }
  fake.t.users.find(u => u.user_id === "S").token_version = 5;
  assert.equal((await http("GET", "/api/system/overview", { headers: as(tok("S")) })).status, 401, "revoked");
});
test("a signed-in GUEST is refused (403) by every staff API", opts, async () => {
  for (const u of DASHBOARD_APIS) assert.equal((await http("GET", u, { headers: as(tok("G")) })).status, 403, u);
});
test("each staff role reaches its own level and no higher", opts, async () => {
  const ok = async (id, u) => { const s = (await http("GET", u, { headers: as(tok(id)) })).status; return s !== 401 && s !== 403; };
  assert.equal(await ok("A", "/api/dashboard"), true);
  assert.equal(await ok("A", "/api/dashboard/owner"), false);
  assert.equal(await ok("A", "/api/system/overview"), false);
  assert.equal(await ok("O", "/api/dashboard/owner"), true);
  assert.equal(await ok("O", "/api/system/overview"), false);
  assert.equal(await ok("S", "/api/system/overview"), true);
  assert.equal(await ok("S", "/api/dashboard/owner"), true);
});

test("marking a booking paid (/payments/log) needs an admin — this used to be open to everyone", opts, async () => {
  S.seedBooking({ booking_id: "PW-1", status: "pending_payment", payment_status: "pending" });
  const body = { booking_id: "PW-1", amount: 100, method: "cash", status: "completed" };
  assert.equal((await http("POST", "/api/payments/log", { body })).status, 401);
  assert.equal((await http("POST", "/api/payments/log", { body, headers: as(tok("G")) })).status, 403);
  assert.equal(fake.t.bookings[0].payment_status, "pending");
  assert.equal((await http("POST", "/api/payments/log", { body, headers: as(tok("A")) })).status, 200);
});

test("walk-ins cannot double-book a room", opts, async () => {
  const body = { type: "room", room_id: "R1", guest_name: "W Guest", guest_phone: "0712345678", national_id: "12345678", amount: 11600, method: "cash",
    checkin: day(20) + "T14:00", checkout: day(22) + "T10:00", guests: 2 };
  assert.equal((await http("POST", "/api/payments/walk-in", { body, headers: as(tok("A")) })).status, 200);
  assert.equal((await http("POST", "/api/payments/walk-in", { body: { ...body, guest_name: "Second" }, headers: as(tok("A")) })).status, 409);
  assert.equal(fake.t.bookings.length, 1);
});

test("online checkout: needs sign-in, prices on the server, returns the PesaPal redirect", opts, async () => {
  const body = { name: "Jane", phone: "0712345678", email: "jane@example.com", type: "room", room_id: "R1", checkin: day(10), checkout: day(12), guests: 2, total_amount: 1 };
  assert.equal((await http("POST", "/api/payments/initiate-session", { body })).status, 401);
  const r = await http("POST", "/api/payments/initiate-session", { body, headers: as(tok("G")) });
  assert.equal(r.status, 200); assert.equal(r.json.amount, 11600); assert.match(r.json.redirect_url, /^https:\/\/pay\.test/);
  assert.equal(fake.t.pending_sessions.length, 1);
  assert.equal(fake.t.bookings.length, 0, "no booking until PesaPal confirms payment");
});

test("session-status and the IPN callback reject junk ids without touching the database", opts, async () => {
  assert.equal((await http("POST", "/api/payments/session-status", { body: { session_id: "x" } })).status, 400);
  const r = await http("GET", "/api/payments/pesapal-callback?OrderMerchantReference=' OR 1=1--&OrderTrackingId=1");
  assert.equal(r.status, 200); assert.equal(fake.t.bookings.length, 0);
});

test("the public calendar is open but reveals no guest details", opts, async () => {
  S.seedBooking({ guest_name: "Private Person", guest_email: "p@x.com" });
  const r = await http("GET", "/api/availability/calendar?type=room&room_id=R1");
  assert.equal(r.status, 200); assert.ok(r.json.nights.length > 0); assert.ok(!/Private|p@x\.com/.test(r.text));
});

test("cron endpoints need the secret", opts, async () => {
  assert.equal((await http("GET", "/api/cron/housekeeping")).status, 401);
  assert.equal((await http("GET", "/api/cron/housekeeping", { headers: as("wrong") })).status, 401);
  assert.notEqual((await http("GET", "/api/cron/housekeeping", { headers: as("cron-secret") })).status, 401);
});

test("robots.txt and sitemap.xml are served with the right content types and base URL", opts, async () => {
  const r = await http("GET", "/robots.txt"); assert.equal(r.status, 200); assert.match(r.type, /text\/plain/); assert.match(r.text, /Sitemap: https:\/\/hotel\.test\/sitemap\.xml/);
  const s = await http("GET", "/sitemap.xml"); assert.equal(s.status, 200); assert.match(s.type, /xml/); assert.match(s.text, /<loc>https:\/\/hotel\.test\/rooms\.html<\/loc>/);
});

test("errors never leak internals, and unknown API paths return JSON 404", opts, async () => {
  const r = await http("GET", "/api/nope"); assert.equal(r.status, 404); assert.equal(r.json.status, "error");
  const bad = await fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
  assert.equal(bad.status, 400);
});

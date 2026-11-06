const S = require("./helpers/setup");
const test = require("node:test");
const assert = require("node:assert/strict");
const { finaliseBooking } = require("../server/services/bookingFinalizer");
const { fake, sent } = S;

test.beforeEach(async () => { S.reset(); S.seedRoom(); await S.storeSession(S.paidSession()); });

test("a paid session becomes a confirmed, paid booking with a payment row, receipt email and admin alert", async () => {
  const r = await finaliseBooking(S.paidSession(), { payment_method: "MPESA", order_tracking_id: "TRK-1" });
  assert.equal(r.ok, true);
  const [b] = fake.t.bookings, [p] = fake.t.payments;
  assert.deepEqual([b.status, b.payment_status, b.source, b.user_id, b.session_id], ["confirmed", "paid", "online", "U1", "a".repeat(24)]);
  assert.deepEqual([p.booking_id, p.amount, p.status, p.method, p.tracking_id], [b.booking_id, 11600, "completed", "MPESA", "TRK-1"]);
  assert.equal(fake.t.pending_sessions.length, 0, "hold is released");
  assert.deepEqual(sent.map(m => m.to).sort(), ["admin@hotel.test", "jane@example.com"]);
  assert.match(sent.find(m => m.to === "jane@example.com").body, /https:\/\/hotel\.test\/receipt\.html\?booking_id=/);
});

test("running it twice never creates a second booking or payment", async () => {
  const a = await finaliseBooking(S.paidSession(), {});
  const b = await finaliseBooking(S.paidSession(), {});
  assert.equal(b.already, true); assert.equal(b.booking_id, a.booking_id);
  assert.equal(fake.t.bookings.length, 1); assert.equal(fake.t.payments.length, 1);
});

test("the IPN callback and the browser racing each other still produce exactly one booking", async () => {
  const results = await Promise.all([1, 2, 3, 4].map(() => finaliseBooking(S.paidSession(), { payment_method: "CARD" })));
  assert.ok(results.every(r => r.ok));
  assert.equal(new Set(results.map(r => r.booking_id)).size, 1);
  assert.equal(fake.t.bookings.length, 1); assert.equal(fake.t.payments.length, 1);
  assert.equal(sent.filter(m => m.to === "jane@example.com").length, 1, "guest gets one receipt, not four");
});

test("if the slot was taken while the guest was paying: no booking, refund alerts, critical audit entry", async () => {
  S.seedBooking({ booking_id: "PW-OTHER", checkin_date: S.paidSession().checkin_date, checkout_date: S.paidSession().checkout_date });
  const r = await finaliseBooking(S.paidSession(), { order_tracking_id: "TRK-1" });
  assert.deepEqual([r.ok, r.conflict], [false, true]);
  assert.equal(fake.t.bookings.length, 1, "only the other guest's booking exists");
  assert.equal(fake.t.payments.length, 0);
  assert.equal(fake.t.pending_sessions.length, 0);
  assert.ok(sent.some(m => m.to === "admin@hotel.test" && /ACTION REQUIRED/.test(m.subject)));
  assert.ok(sent.some(m => m.to === "jane@example.com" && /refund/i.test(m.body)));
  const audit = fake.t.audit_log.find(a => a.severity === "critical");
  assert.ok(audit && /refund required/.test(JSON.stringify(audit.new_value)));
});

test("falls back to the stored tracking id when PesaPal's status omits it", async () => {
  await finaliseBooking(S.paidSession(), { payment_method: "CARD" });
  assert.equal(fake.t.payments[0].tracking_id, "TRK-1");
});

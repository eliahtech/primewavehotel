const S = require("./helpers/setup");
const test = require("node:test");
const assert = require("node:assert/strict");
const { quoteBooking } = require("../server/services/booking");
const { day } = S;

const base = (o = {}) => ({ name: "Jane Guest", phone: "+254 712 345 678", email: "Jane@Example.com ", type: "room", room_id: "R1",
  checkin: day(10), checkout: day(12), guests: 2, ...o });

test.beforeEach(() => { S.reset(); S.seedRoom(); S.seedTable(); });

test("prices rooms on the server: nights × rate + 16% VAT", async () => {
  const q = await quoteBooking(base());
  assert.equal(q.taken, false);
  assert.deepEqual([q.session.nights, q.session.subtotal, q.session.tax, q.session.total_amount], [2, 10000, 1600, 11600]);
});

test("a price sent by the browser is ignored", async () => {
  const q = await quoteBooking(base({ total_amount: 1, subtotal: 1, price: 1, amount: 1 }));
  assert.equal(q.session.total_amount, 11600);
});

test("tables are priced per hour", async () => {
  const q = await quoteBooking({ name: "Jo Guest", phone: "0712345678", email: "jo@example.com", type: "table", table_id: "T1",
    checkin: `${day(5)}T12:00`, checkout: `${day(5)}T14:00`, guests: 3 });
  assert.deepEqual([q.session.nights, q.session.subtotal, q.session.total_amount], [2, 2000, 2320]);
});

test("cleans up input: lower-cased email, no HTML characters", async () => {
  const q = await quoteBooking(base({ name: "<b>Jane</b>", notes: "<script>alert(1)</script>" }));
  assert.equal(q.session.guest_email, "jane@example.com");
  assert.ok(!/[<>]/.test(q.session.guest_name + q.session.notes));
});

test("rejects bad input with a 400/404", async () => {
  const bad = [
    [base({ guests: 3 }), 400, "more guests than the room allows"],
    [base({ guests: 0 }), 400, "zero guests"],
    [base({ checkin: day(-3), checkout: day(-1) }), 400, "dates in the past"],
    [base({ checkout: day(10) }), 400, "checkout = checkin"],
    [base({ email: "not-an-email" }), 400, "bad email"],
    [base({ phone: "abc" }), 400, "bad phone"],
    [base({ name: "" }), 400, "missing name"],
    [base({ room_id: undefined }), 400, "no item chosen"],
    [base({ room_id: "NOPE" }), 404, "unknown room"],
  ];
  for (const [input, code, why] of bad) await assert.rejects(quoteBooking(input), e => e.statusCode === code, why);
});

test("a free-of-charge item is refused rather than sold for KES 0", async () => {
  S.fake.t.rooms[0].price_per_night = 0;
  await assert.rejects(quoteBooking(base()), e => e.statusCode === 400);
});

test("reports a taken room instead of throwing", async () => {
  S.seedBooking({ checkin_date: new Date(day(10) + "T00:00:00+03:00").toISOString(), checkout_date: new Date(day(12) + "T00:00:00+03:00").toISOString() });
  const q = await quoteBooking(base());
  assert.equal(q.taken, true); assert.match(q.message, /taken/i);
});

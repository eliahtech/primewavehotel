const S = require("./helpers/setup");
const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveSession } = require("../server/services/paymentFlow");
const { fake, pesapal } = S;

const SID = "a".repeat(24);
let calls;
const pesaSays = o => { calls = 0; pesapal.getTransactionStatus = async () => { calls++; return o; }; };

test.beforeEach(async () => { S.reset(); S.seedRoom(); calls = 0; await S.storeSession(S.paidSession()); });

test("unknown or expired session → failed, and PesaPal is never asked", async () => {
  pesaSays({ payment_status_description: "Completed" });
  const r = await resolveSession("b".repeat(24));
  assert.equal(r.status, "failed"); assert.equal(calls, 0);
});

test("a session that has not reached PesaPal yet is pending", async () => {
  fake.t.pending_sessions[0].data.pesapal_tracking_id = "";
  assert.equal((await resolveSession(SID)).status, "pending");
});

test("Completed + matching amount → confirmed booking with a receipt link", async () => {
  pesaSays({ payment_status_description: "Completed", amount: 11600, merchant_reference: SID, payment_method: "MPESA" });
  const r = await resolveSession(SID);
  assert.equal(r.status, "confirmed");
  assert.equal(fake.t.bookings.length, 1);
  assert.equal(r.receipt_url, `https://hotel.test/receipt.html?booking_id=${r.booking_id}`);
});

test("asking again afterwards is answered from our own records (idempotent, no second charge-check)", async () => {
  pesaSays({ payment_status_description: "Completed", amount: 11600, merchant_reference: SID });
  const a = await resolveSession(SID); const before = calls;
  const b = await resolveSession(SID);
  assert.equal(b.booking_id, a.booking_id); assert.equal(calls, before); assert.equal(fake.t.bookings.length, 1);
});

test("amount paid differs from the quote → refused, nothing booked, critical audit entry", async () => {
  pesaSays({ payment_status_description: "Completed", amount: 100, merchant_reference: SID });
  const r = await resolveSession(SID);
  assert.equal(r.status, "failed"); assert.equal(fake.t.bookings.length, 0);
  assert.ok(fake.t.audit_log.some(a => a.severity === "critical" && /amount mismatch/.test(JSON.stringify(a.new_value))));
});

test("±KES 1 rounding is tolerated", async () => {
  pesaSays({ payment_status_description: "Completed", amount: 11600.6, merchant_reference: SID });
  assert.equal((await resolveSession(SID)).status, "confirmed");
});

test("a payment for a different merchant reference is refused", async () => {
  pesaSays({ payment_status_description: "Completed", amount: 11600, merchant_reference: "someone-elses-session" });
  const r = await resolveSession(SID);
  assert.equal(r.status, "failed"); assert.equal(fake.t.bookings.length, 0);
});

test("non-completed PesaPal states never create a booking", async () => {
  for (const [desc, want] of [["Pending", "pending"], ["", "pending"], ["Failed", "failed"], ["Invalid", "failed"], ["Reversed", "failed"]]) {
    pesaSays({ payment_status_description: desc, amount: 11600, merchant_reference: SID });
    assert.equal((await resolveSession(SID)).status, want, desc || "(empty)");
  }
  assert.equal(fake.t.bookings.length, 0);
});

test("paid but the room was just taken → failed with a refund message", async () => {
  S.seedBooking({ checkin_date: S.paidSession().checkin_date, checkout_date: S.paidSession().checkout_date });
  pesaSays({ payment_status_description: "Completed", amount: 11600, merchant_reference: SID });
  const r = await resolveSession(SID);
  assert.equal(r.status, "failed"); assert.match(r.message, /refund/i);
});

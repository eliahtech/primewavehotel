const S = require("./helpers/setup");
const test = require("node:test");
const assert = require("node:assert/strict");
const { checkAvailable } = require("../server/services/availability");
const { day, fake } = S;

const iso = d => new Date(d + "T00:00:00+03:00").toISOString();
const ask = (a, b, extra = {}) => checkAvailable({ type: "room", room_id: "R1", checkin: iso(day(a)), checkout: iso(day(b)), ...extra });

test.beforeEach(() => { S.reset(); S.seedRoom(); });

test("an empty room is available", async () => assert.equal((await ask(10, 12)).available, true));

test("overlapping a confirmed booking is refused", async () => {
  S.seedBooking({ checkin_date: iso(day(10)), checkout_date: iso(day(13)) });
  for (const [a, b] of [[10, 13], [9, 11], [12, 15], [11, 12], [8, 20]]) assert.equal((await ask(a, b)).available, false, `${a}-${b}`);
});

test("same-day turnover is allowed (checkout day = next check-in day)", async () => {
  S.seedBooking({ checkin_date: iso(day(10)), checkout_date: iso(day(12)) });
  assert.equal((await ask(12, 14)).available, true);
  assert.equal((await ask(8, 10)).available, true);
});

test("cancelled and checked-out bookings do not block; pending_payment does", async () => {
  S.seedBooking({ status: "cancelled" }); S.seedBooking({ status: "checked_out" });
  assert.equal((await ask(10, 12)).available, true);
  S.seedBooking({ status: "pending_payment" });
  assert.equal((await ask(10, 12)).available, false);
});

test("rooms under maintenance or hidden cannot be booked; unknown rooms are reported", async () => {
  fake.t.rooms[0].status = "maintenance"; assert.equal((await ask(10, 12)).available, false);
  fake.t.rooms[0].status = "hidden";      assert.equal((await ask(10, 12)).available, false);
  const r = await checkAvailable({ type: "room", room_id: "NOPE", checkin: iso(day(1)), checkout: iso(day(2)) });
  assert.equal(r.available, false); assert.match(r.message, /not found/i);
});

test("another guest's unexpired payment hold blocks the slot, an expired one does not", async () => {
  await S.storeSession(S.paidSession({ checkin_date: iso(day(10)), checkout_date: iso(day(12)) }));
  assert.equal((await ask(10, 12, { includeSessions: true })).available, false);
  assert.equal((await ask(10, 12)).available, true, "holds are only checked when asked (initiate-session)");
  fake.t.pending_sessions[0].expires_at = new Date(Date.now() - 1000).toISOString();
  assert.equal((await ask(10, 12, { includeSessions: true })).available, true);
});

test("tables clash by time of day", async () => {
  S.seedTable();
  const t = (h1, h2) => checkAvailable({ type: "table", table_id: "T1", checkin: `${day(5)}T${h1}:00+03:00`, checkout: `${day(5)}T${h2}:00+03:00` });
  S.seedBooking({ type: "table", room_id: null, table_id: "T1", checkin_date: `${day(5)}T12:00:00+03:00`, checkout_date: `${day(5)}T14:00:00+03:00` });
  assert.equal((await t("13:00", "15:00")).available, false);
  assert.equal((await t("14:00", "16:00")).available, true);
  assert.equal((await t("10:00", "12:00")).available, true);
});

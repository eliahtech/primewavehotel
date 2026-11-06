const S = require("./helpers/setup");
const test = require("node:test");
const assert = require("node:assert/strict");
const { getCalendar } = require("../server/services/availability");
const { day, fake } = S;
const iso = (d, t = "00:00:00") => new Date(`${d}T${t}+03:00`).toISOString();

test.beforeEach(() => { S.reset(); S.seedRoom(); S.seedTable(); });

test("lists every taken NIGHT, leaving the checkout day free for the next guest", async () => {
  S.seedBooking({ checkin_date: iso(day(10)), checkout_date: iso(day(13)) });
  const c = await getCalendar({ type: "room", room_id: "R1" });
  assert.deepEqual(c.nights, [day(10), day(11), day(12)]);
  assert.ok(!c.nights.includes(day(13)));
});

test("back-to-back bookings merge into one unbroken run; cancelled ones vanish", async () => {
  S.seedBooking({ checkin_date: iso(day(10)), checkout_date: iso(day(12)) });
  S.seedBooking({ checkin_date: iso(day(12)), checkout_date: iso(day(14)) });
  S.seedBooking({ checkin_date: iso(day(20)), checkout_date: iso(day(22)), status: "cancelled" });
  const c = await getCalendar({ type: "room", room_id: "R1" });
  assert.deepEqual(c.nights, [day(10), day(11), day(12), day(13)]);
});

test("a stay with clock times does not block its checkout day", async () => {
  S.seedBooking({ checkin_date: iso(day(10), "14:00:00"), checkout_date: iso(day(12), "11:00:00") });
  assert.deepEqual((await getCalendar({ type: "room", room_id: "R1" })).nights, [day(10), day(11)]);
});

test("only the requested window is returned", async () => {
  S.seedBooking({ checkin_date: iso(day(5)), checkout_date: iso(day(8)) });
  S.seedBooking({ checkin_date: iso(day(300)), checkout_date: iso(day(302)) });
  const c = await getCalendar({ type: "room", room_id: "R1", days: 30 });
  assert.deepEqual(c.nights, [day(5), day(6), day(7)]); assert.equal(c.days, 30);
  assert.equal((await getCalendar({ type: "room", room_id: "R1", days: 99999 })).days, 180, "capped at 180 days");
});

test("someone else's unexpired payment hold shows as taken (and is flagged held)", async () => {
  await S.storeSession(S.paidSession({ checkin_date: iso(day(7)), checkout_date: iso(day(9)) }));
  const c = await getCalendar({ type: "room", room_id: "R1" });
  assert.deepEqual(c.nights, [day(7), day(8)]); assert.equal(c.ranges[0].held, true);
  fake.t.pending_sessions[0].expires_at = new Date(Date.now() - 1000).toISOString();
  assert.deepEqual((await getCalendar({ type: "room", room_id: "R1" })).nights, []);
});

test("rooms in maintenance are reported closed; unknown ids are 404; missing id is 400", async () => {
  fake.t.rooms[0].status = "maintenance";
  assert.equal((await getCalendar({ type: "room", room_id: "R1" })).closed, true);
  await assert.rejects(getCalendar({ type: "room", room_id: "NOPE" }), e => e.statusCode === 404);
  await assert.rejects(getCalendar({ type: "room" }), e => e.statusCode === 400);
});

test("tables return exact time ranges, not nights", async () => {
  S.seedBooking({ type: "table", room_id: null, table_id: "T1", checkin_date: iso(day(3), "12:00:00"), checkout_date: iso(day(3), "14:00:00") });
  const c = await getCalendar({ type: "table", table_id: "T1" });
  assert.deepEqual(c.nights, []); assert.equal(c.ranges.length, 1);
  assert.equal(c.ranges[0].start, iso(day(3), "12:00:00"));
});

test("the response never exposes guest details", async () => {
  S.seedBooking({ guest_name: "Secret Person", guest_email: "secret@example.com", guest_phone: "0700" });
  const text = JSON.stringify(await getCalendar({ type: "room", room_id: "R1" }));
  assert.ok(!/Secret|secret@|0700|booking_id/.test(text));
});

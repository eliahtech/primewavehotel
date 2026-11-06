require("./helpers/setup");
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseRange, generateBookingId, calcNights, calcHours } = require("../server/utils/helpers");
const { day } = require("./helpers/setup");

test("date-only values are read as Nairobi midnight (UTC+3), not server time", () => {
  const r = parseRange("2030-01-01", "2030-01-03");
  assert.equal(r.checkin, "2029-12-31T21:00:00.000Z");
  assert.equal(r.checkout, "2030-01-02T21:00:00.000Z");
});

test("naive date-times from the table form are read as Nairobi time", () => {
  const r = parseRange("2030-01-01T14:00", "2030-01-01T16:00:00", { isTable: true });
  assert.equal(r.checkin, "2030-01-01T11:00:00.000Z");
  assert.equal(r.checkout, "2030-01-01T13:00:00.000Z");
});

test("an explicit timezone is respected", () => {
  assert.equal(parseRange("2030-01-01T10:00:00Z", "2030-01-02T10:00:00Z").checkin, "2030-01-01T10:00:00.000Z");
});

test("rejects bad ranges with a 400", () => {
  for (const [a, b] of [["2030-01-03", "2030-01-01"], ["2030-01-01", "2030-01-01"], ["nope", "2030-01-01"], ["2030-01-01", ""]]) {
    assert.throws(() => parseRange(a, b), e => e.statusCode === 400, `${a} → ${b}`);
  }
});

test("past check-in is rejected unless staff allow it (walk-ins)", () => {
  assert.throws(() => parseRange(day(-5), day(-3)), e => e.statusCode === 400);
  assert.doesNotThrow(() => parseRange(day(-5), day(-3), { allowPast: true }));
});

test("stay length limits: 60 nights for rooms, 24h for tables", () => {
  assert.throws(() => parseRange(day(1), day(70)), e => e.statusCode === 400);
  assert.doesNotThrow(() => parseRange(day(1), day(61)));
  assert.throws(() => parseRange(day(1) + "T10:00", day(3) + "T10:00", { isTable: true }), e => e.statusCode === 400);
});

test("booking ids look right and do not collide", () => {
  const ids = new Set();
  for (let i = 0; i < 3000; i++) { const id = generateBookingId(); assert.match(id, /^PW-\d{4}-[A-HJ-NP-Z2-9]{8}$/); ids.add(id); }
  assert.equal(ids.size, 3000);
});

test("night and hour counting", () => {
  assert.equal(calcNights("2030-01-01", "2030-01-04"), 3);
  assert.equal(calcHours("2030-01-01T10:00:00Z", "2030-01-01T13:00:00Z"), 3);
});

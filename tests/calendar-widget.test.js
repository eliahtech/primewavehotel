// Tests the date-range picker's selection logic (public/calendar.js) without a browser.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), path = require("path"), vm = require("vm");

const ctx = { globalThis: null };
ctx.globalThis = ctx;
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "public", "calendar.js"), "utf8"), ctx);
const { maxCheckout, rangeIsFree, _add } = ctx.PWCalendar;
const busy = (...ds) => Object.fromEntries(ds.map(d => [d, true]));

test("you may check out on the first taken date after your check-in (the morning is free)", () => {
  assert.equal(maxCheckout("2030-05-10", busy("2030-05-14", "2030-05-15")), "2030-05-14");
});
test("with nothing booked ahead the range is open-ended", () => assert.equal(maxCheckout("2030-05-10", {}), null));
test("a range is free only if none of its nights are taken (checkout day excluded)", () => {
  const b = busy("2030-05-14");
  assert.equal(rangeIsFree("2030-05-10", "2030-05-14", b), true);
  assert.equal(rangeIsFree("2030-05-10", "2030-05-15", b), false);
  assert.equal(rangeIsFree("2030-05-14", "2030-05-16", b), false);
  assert.equal(rangeIsFree("2030-05-15", "2030-05-17", b), true);
});
test("date arithmetic is timezone-proof across month and year ends", () => {
  assert.equal(_add("2030-01-31", 1), "2030-02-01");
  assert.equal(_add("2030-12-31", 1), "2031-01-01");
  assert.equal(_add("2028-02-28", 1), "2028-02-29");
  assert.equal(_add("2030-03-01", -1), "2030-02-28");
});

// Static checks that run without a browser: each higher dashboard must contain every module of the lower ones.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), path = require("path"), vm = require("vm");
const pub = path.join(__dirname, "..", "public");
const modulesOf = page => { const m = fs.readFileSync(path.join(pub, page + ".html"), "utf8").match(/Console\.start\(\{ min: '(\w+)', modules: (\[[^\]]*\]) \}\)/); assert.ok(m, page + " does not start the console"); return { min: m[1], list: JSON.parse(m[2].replace(/'/g, '"')) }; };
const admin = modulesOf("admin"), owner = modulesOf("owner"), sys = modulesOf("systemowner");

test("the three dashboards are wired to the right minimum roles", () => assert.deepEqual([admin.min, owner.min, sys.min], ["admin", "owner", "systemowner"]));
test("the Owner has every Admin module, and the System Owner has every Admin AND Owner module", () => {
  for (const m of admin.list) { assert.ok(owner.list.includes(m), "owner lacks " + m); assert.ok(sys.list.includes(m), "system owner lacks " + m); }
  for (const m of owner.list) assert.ok(sys.list.includes(m), "system owner lacks " + m);
});
test("every module named by a page exists, and each page offers the new News and Users modules", () => {
  const ctx = { window: {}, document: {}, $: () => ({}), esc: x => x, kes: x => x, dt: x => x, LEVEL: {}, ME: 4, USER: {}, bars() {}, csv() {}, tabs() {}, gate: () => false, api() {}, note() {} };
  ctx.window = ctx; vm.runInNewContext(fs.readFileSync(path.join(pub, "console.js"), "utf8"), ctx);
  const known = new Set(ctx.Console.modules());
  for (const m of sys.list) assert.ok(known.has(m), "unknown module " + m);
  for (const m of ["news", "users"]) for (const page of [admin, owner, sys]) assert.ok(page.list.includes(m), m);
  assert.ok(owner.list.includes("settings") && sys.list.includes("settings"), "social links live in Site settings (owner+)");
});
test("the System Owner page also has the system-only modules; lower pages do not", () => {
  const only = ["security", "audit", "incidents", "backups", "jobs"];
  for (const m of only) { assert.ok(sys.list.includes(m), m); assert.ok(!owner.list.includes(m) && !admin.list.includes(m), m + " leaked to a lower role"); }
});

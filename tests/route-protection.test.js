// Static audit of every API route file — no server needed. Fails if a route loses its login/role check,
// or if a NEW route is added without anyone deciding whether it should be public.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");
const dir = path.join(__dirname, "..", "server", "routes");

function routes() {
  const out = [];
  for (const f of fs.readdirSync(dir).filter(n => n.endsWith(".js"))) {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    const fileLevel = /router\.use\([^)]*authenticate/.test(src);
    const fileRole = (src.match(/router\.use\([^)]*requireRole\(ROLES\.(\w+)\)/) || [])[1];
    for (const m of src.matchAll(/router\.(get|post|put|delete)\(\s*"([^"]*)"\s*,([^\n]*)/g)) {
      out.push({ id: `${f.replace(".js", "")} ${m[1].toUpperCase()} ${m[2]}`, auth: fileLevel || /\bauthenticate\b/.test(m[3]),
        cron: /cronAuth/.test(m[3]), role: (m[3].match(/requireRole\(ROLES\.(\w+)\)/) || [])[1] || fileRole || null });
    }
  }
  return out;
}
const all = routes();

// Routes that are public ON PURPOSE. Anything not listed here must require a signed-in user.
const PUBLIC = new Set([
  "auth POST /login", "auth POST /register", "auth POST /logout", "auth POST /request-password-reset",
  "passwordReset POST /request-otp", "passwordReset POST /verify-otp", "passwordReset POST /complete",
  "rooms GET /", "rooms GET /:id", "tables GET /", "tables GET /:id", "availability GET /",
  "news GET /", "news GET /:id",                   // published stories only (see news.test.js)
  "site GET /",                                     // public social links
  "seo GET /robots.txt", "seo GET /sitemap.xml",   // crawler files
  "availability GET /calendar",         // dates only, no guest details (see calendar.test.js)
  "subscribe POST /", "contact POST /", "chat POST /",
  "payments POST /session-status",      // guarded by an unguessable 96-bit session id; verified with PesaPal
  "payments GET /pesapal-callback",     // PesaPal IPN; re-verified with PesaPal, idempotent
]);

test("found the routes (sanity)", () => assert.ok(all.length > 50, `only found ${all.length}`));

test("every route is either deliberately public, cron-secret protected, or requires a signed-in user", () => {
  const exposed = all.filter(r => !r.auth && !r.cron && !PUBLIC.has(r.id)).map(r => r.id);
  assert.deepEqual(exposed, [], "unprotected routes: " + exposed.join(", "));
});

test("the public allow-list contains no stale entries", () => {
  const ids = new Set(all.map(r => r.id));
  assert.deepEqual([...PUBLIC].filter(id => !ids.has(id)), []);
});

test("cron endpoints are protected by the cron secret", () => {
  for (const r of all.filter(r => r.id.startsWith("cron "))) assert.ok(r.cron, r.id);
});

// Minimum role per sensitive route. A route may be STRICTER than this, never looser.
const LEVEL = { user: 1, admin: 2, owner: 3, systemowner: 4 };
const MIN = {
  "dashboard GET /": "admin", "dashboard GET /revenue": "admin", "dashboard GET /owner": "owner",
  "bookings GET /": "admin", "bookings PUT /:id": "admin",
  "payments GET /": "admin", "payments POST /log": "admin", "payments POST /walk-in": "admin",
  "rooms POST /": "admin", "rooms PUT /:id": "admin", "rooms DELETE /:id": "owner", "rooms GET /admin/all": "admin",
  "tables POST /": "admin", "tables PUT /:id": "admin", "tables DELETE /:id": "owner",
  "users GET /": "admin", "users PUT /:id": "admin", "users POST /": "owner", "users DELETE /:id": "systemowner",
  "news GET /manage/all": "admin", "news POST /": "admin", "news PUT /:id": "admin", "news DELETE /:id": "admin", "site PUT /social": "owner",
  "archive GET /": "admin", "subscribe GET /list": "admin", "auth POST /reset-password": "admin",
  "passwordReset POST /admin-unlock": "systemowner", "passwordReset POST /admin-set-self-reset": "systemowner", "passwordReset GET /history": "systemowner",
};
test("staff routes demand at least the intended role", () => {
  for (const [id, min] of Object.entries(MIN)) {
    const r = all.find(x => x.id === id); assert.ok(r, "route missing: " + id);
    assert.ok(r.role && LEVEL[r.role.toLowerCase()] >= LEVEL[min], `${id} needs ${min}, has ${r.role}`);
  }
});

test("the whole System Owner API requires the systemowner role", () => {
  const sys = all.filter(r => r.id.startsWith("system "));
  assert.ok(sys.length >= 10);
  for (const r of sys) assert.ok(r.auth && r.role === "SYSTEMOWNER", r.id);
});

test("every dashboard page loads the guard with the right minimum role", () => {
  const pub = path.join(__dirname, "..", "public");
  for (const [page, min] of [["admin", "admin"], ["owner", "owner"], ["systemowner", "systemowner"], ["account", "user"]]) {
    const html = fs.readFileSync(path.join(pub, page + ".html"), "utf8");
    assert.match(html, new RegExp(`<script src="/guard\\.js" data-min="${min}"></script>`), page);
    assert.match(html, /name="robots" content="noindex/, page + " should be noindex");
  }
});

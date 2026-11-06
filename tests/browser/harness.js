// tests/browser/harness.js — serves public/ and a MOCK API that runs the REAL policy / news / settings / availability services
// against the in-memory database. The Express glue is imitated here; the business rules are not.
const S = require("../helpers/setup");
const http = require("http"), fs = require("fs"), path = require("path");
const policy = require("../../server/services/userPolicy");
const news = require("../../server/services/news");
const settings = require("../../server/services/settings");
const { getCalendar, checkAvailable } = require("../../server/services/availability");
const { parseRange } = require("../../server/utils/helpers");
const { fake } = S;
const PUBLIC = path.join(S.root, "public");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };

const LEVEL = { user: 1, admin: 2, owner: 3, systemowner: 4 };
const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
const fakeJwt = (u, exp = Math.floor(Date.now() / 1000) + 3600) => `${b64({ alg: "HS256" })}.${b64({ user_id: u.user_id, exp })}.sig`;

function seedUsers() {
  fake.t.users.length = 0;
  [["U-guest", "Gina Guest", "gina@x.com", "user"], ["U-admin", "Ann Admin", "ann@x.com", "admin"], ["U-admin2", "Abe Admin", "abe@x.com", "admin"],
   ["U-owner", "Olu Owner", "olu@x.com", "owner"], ["U-sys", "Sam System", "sam@x.com", "systemowner"]]
    .forEach(([user_id, name, email, role]) => fake.t.users.push({ user_id, name, email, role, is_active: true, token_version: 0, phone: "0700", password_hash: "x", allow_self_reset: role === "user" }));
}
const sessionFor = id => { const u = fake.t.users.find(x => x.user_id === id); return { token: fakeJwt(u), user: JSON.stringify({ user_id: u.user_id, name: u.name, email: u.email, role: u.role }) }; };

function start() {
  const calls = { resets: [] };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const send = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
    if (!url.pathname.startsWith("/api/")) {
      let f = path.join(PUBLIC, url.pathname === "/" ? "index.html" : url.pathname);
      if (!f.startsWith(PUBLIC) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("not found"); }
      res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" }); return res.end(fs.readFileSync(f));
    }
    let body = {}; try { const raw = await new Promise(r => { let d = ""; req.on("data", c => d += c); req.on("end", () => r(d)); }); if (raw) body = JSON.parse(raw); } catch {}
    const tok = (req.headers.authorization || "").replace("Bearer ", "");
    let user = null; try { const p = JSON.parse(Buffer.from(tok.split(".")[1], "base64url").toString()); user = fake.t.users.find(u => u.user_id === p.user_id); } catch {}
    const need = min => { if (!user) { send(401, { status: "error", message: "Unauthorised" }); return false; } if (LEVEL[user.role] < LEVEL[min]) { send(403, { status: "error", message: "Forbidden" }); return false; } return true; };
    const m = req.method, p = url.pathname;
    try {
      if (p === "/api/news" && m === "GET") return send(200, { status: "success", ...(await news.listPublished({ limit: url.searchParams.get("limit"), before: url.searchParams.get("before") })) });
      if (p === "/api/news/manage/all" && m === "GET") return need("admin") && send(200, { status: "success", data: fake.t.news.slice().reverse() });
      let mm = p.match(/^\/api\/news\/([^/]+)$/);
      if (mm && m === "GET") return send(200, { status: "success", data: await news.getPublished(mm[1]) });
      if (p === "/api/news" && m === "POST") return need("admin") && send(200, { status: "success", message: "Story saved.", data: await news.createNews(user, body) });
      if (mm && m === "PUT") { if (!need("admin")) return; await news.updateNews(user, mm[1], body); return send(200, { status: "success", message: "Story updated." }); }
      if (mm && m === "DELETE") { if (!need("admin")) return; await news.deleteNews(user, mm[1]); return send(200, { status: "success", message: "Story deleted." }); }
      if (p === "/api/site" && m === "GET") { const all = await settings.getSocial(); return send(200, { status: "success", social: Object.fromEntries(Object.entries(all).filter(([, v]) => v)) }); }
      if (p === "/api/site/social" && m === "PUT") { if (!need("owner")) return; await settings.saveSocial(settings.validateSocial(body), user.email); return send(200, { status: "success", message: "Social links saved." }); }
      if (p === "/api/users" && m === "GET") return need("admin") && send(200, { status: "success", data: policy.visibleUsers(fake.t.users, user.role).map(u => ({ ...u, password_hash: "***" })) });
      if (p === "/api/auth/reset-password" && m === "POST") {
        if (!need("admin")) return; const t = fake.t.users.find(u => u.user_id === body.target_user_id);
        if (!t || !policy.canResetPassword(user, t)) return send(403, { status: "error", message: "You do not have access to that account." });
        calls.resets.push({ by: user.user_id, target: t.user_id, pw: body.new_password }); return send(200, { status: "success", message: "Password reset." });
      }
      if (p === "/api/rooms" && m === "GET") return send(200, { status: "success", data: fake.t.rooms.filter(r => r.status !== "hidden") });
      if (p === "/api/rooms/admin/all") return need("admin") && send(200, { status: "success", data: fake.t.rooms });
      if (p === "/api/tables") return send(200, { status: "success", data: fake.t.tables_ });
      if (p === "/api/availability/calendar") return send(200, { status: "success", ...(await getCalendar(Object.fromEntries(url.searchParams))) });
      if (p === "/api/availability") { const q = Object.fromEntries(url.searchParams); const r = parseRange(q.checkin, q.checkout, { isTable: q.type === "table" }); return send(200, { status: "success", ...(await checkAvailable({ ...q, checkin: r.checkin, checkout: r.checkout })) }); }
      if (p === "/api/dashboard") return need("admin") && send(200, { status: "success", data: { totalRevenue: 0, onlineRevenue: 0, walkInRevenue: 0, totalBookings: 0, confirmed: 0, checkedIn: 0, pending: 0, cancelled: 0, availableRooms: 1, totalRooms: 1, availableTables: 1, totalTables: 1 } });
      if (p === "/api/dashboard/owner") return need("owner") && send(200, { status: "success", data: { revenue12m: 0, revenue30d: 0, avgBookingValue: 0, cancellationRate: 0, occupancy30d: 0, totalBookings12m: 0, daily: [], monthly: [], byMethod: {}, bySource: {}, topItems: [] } });
      if (p === "/api/dashboard/revenue") return need("admin") && send(200, { status: "success", data: [], total: 0 });
      if (["/api/bookings", "/api/payments", "/api/system/audit", "/api/system/incidents", "/api/system/backups", "/api/system/jobs"].includes(p)) return need(p.includes("/system/") ? "systemowner" : "admin") && send(200, { status: "success", data: [] });
      if (p === "/api/system/overview") return need("systemowner") && send(200, { status: "success", data: { loginSuccess: 0, loginFailed: 0, warnings: 0, critical: 0, openIncidents: 0, topFailedIps: [], topFailedEmails: [], recentCritical: [], lastBackup: null, lastJob: null } });
      return send(404, { status: "error", message: "Not found." });
    } catch (e) { send(e.statusCode || 500, { status: "error", message: e.statusCode ? e.message : "Server error" }); }
  });
  return new Promise(r => server.listen(0, "127.0.0.1", () => r({ url: "http://127.0.0.1:" + server.address().port, calls, close: () => new Promise(c => server.close(c)) })));
}

function loadPlaywright() {
  for (const get of [() => require("playwright"), () => require(require("child_process").execSync("npm root -g", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() + "/playwright")]) {
    try { const pw = get(); if (fs.existsSync(pw.chromium.executablePath())) return pw; } catch {}
  }
  return null;
}

module.exports = { start, seedUsers, sessionFor, loadPlaywright, S, fake };

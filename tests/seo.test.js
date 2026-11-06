const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");
const { PAGES, BLOCKED, buildRobots, buildSitemap } = require("../server/utils/seo");
const pub = path.join(__dirname, "..", "public");
const PRIVATE = ["login", "account", "receipt", "admin", "owner", "systemowner"];

test("robots.txt welcomes crawlers, blocks the API and staff consoles, and points to the sitemap", () => {
  const r = buildRobots("https://hotel.example");
  assert.match(r, /^User-agent: \*\nAllow: \/\n/);
  for (const p of ["/api/", "/admin.html", "/owner.html", "/systemowner.html"]) assert.match(r, new RegExp(`^Disallow: ${p.replace(/[./]/g, "\\$&")}$`, "m"));
  assert.match(r, /^Sitemap: https:\/\/hotel\.example\/sitemap\.xml$/m);
  assert.ok(!/^Disallow: \/$/m.test(r), "must never block the whole site");
});

test("pages that carry a noindex tag are NOT blocked in robots.txt (or crawlers could never read the tag)", () => {
  for (const page of ["login", "account", "receipt"]) assert.ok(!BLOCKED.includes(`/${page}.html`), page);
});

test("sitemap.xml is well-formed and lists absolute URLs for every public page", () => {
  const x = buildSitemap("https://hotel.example/");
  assert.match(x, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.ok(x.trimEnd().endsWith("</urlset>"));
  const locs = [...x.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  assert.deepEqual(locs, PAGES.map(p => "https://hotel.example" + p.path), "trailing slash on the base URL must not double up");
  assert.equal((x.match(/<url>/g) || []).length, (x.match(/<\/url>/g) || []).length);
});

test("the sitemap never advertises private pages", () => {
  const x = buildSitemap("https://hotel.example");
  for (const p of PRIVATE) assert.ok(!x.includes(`/${p}.html`), p);
});

test("every page in the sitemap exists, and every public page on disk is in the sitemap", () => {
  for (const p of PAGES) assert.ok(fs.existsSync(path.join(pub, p.path === "/" ? "index.html" : p.path.slice(1))), p.path);
  const listed = new Set(PAGES.map(p => (p.path === "/" ? "index" : p.path.slice(1).replace(".html", ""))));
  const onDisk = fs.readdirSync(pub).filter(f => f.endsWith(".html")).map(f => f.replace(".html", "")).filter(n => !PRIVATE.includes(n));
  assert.deepEqual(onDisk.filter(n => !listed.has(n)), [], "public page missing from sitemap (or add it to PRIVATE if it should not be indexed)");
});

test("special characters in the base URL are XML-escaped", () => {
  assert.ok(buildSitemap("https://a.example/?x=1&y=2").includes("&amp;y=2"));
});

test("on Vercel both files are served by the API function (a static file would hard-code the domain)", () => {
  const v = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "vercel.json"), "utf8"));
  for (const src of ["/robots.txt", "/sitemap.xml"]) assert.ok(v.rewrites.some(r => r.source === src && r.destination === "/api/index.js"), src);
  assert.ok(!fs.existsSync(path.join(pub, "robots.txt")) && !fs.existsSync(path.join(pub, "sitemap.xml")), "a static copy would override the generated one");
});

test("private pages carry noindex", () => {
  for (const p of PRIVATE) assert.match(fs.readFileSync(path.join(pub, p + ".html"), "utf8"), /name="robots" content="noindex/, p);
});

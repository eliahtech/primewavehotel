// server/utils/seo.js — builds robots.txt and sitemap.xml from the site's base URL (so no domain is hard-coded).

// Public pages worth indexing. (Sign-in, account, receipt and the staff consoles are deliberately absent — they are noindex.)
const PAGES = [
  { path: "/",              changefreq: "weekly",  priority: "1.0" },
  { path: "/rooms.html",    changefreq: "weekly",  priority: "0.9" },
  { path: "/book.html",     changefreq: "monthly", priority: "0.8" },
  { path: "/news.html",     changefreq: "weekly",  priority: "0.8" },
  { path: "/services.html", changefreq: "monthly", priority: "0.6" },
  { path: "/about.html",    changefreq: "yearly",  priority: "0.5" },
  { path: "/contact.html",  changefreq: "yearly",  priority: "0.5" },
];

// Staff consoles are never linked publicly, so blocking crawling is safe. The pages a visitor CAN reach
// (login, account, receipt) stay crawlable so search engines can read their noindex tag.
const BLOCKED = ["/api/", "/admin.html", "/owner.html", "/systemowner.html"];

const clean = base => String(base).replace(/\/+$/, "");
const xml = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

function buildRobots(base) {
  return [
    "User-agent: *",
    "Allow: /",
    ...BLOCKED.map(p => `Disallow: ${p}`),
    "",
    `Sitemap: ${clean(base)}/sitemap.xml`,
    "",
  ].join("\n");
}

function buildSitemap(base) {
  const b = clean(base);
  const urls = PAGES.map(p =>
    `  <url>\n    <loc>${xml(b + p.path)}</loc>\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

module.exports = { PAGES, BLOCKED, buildRobots, buildSitemap };

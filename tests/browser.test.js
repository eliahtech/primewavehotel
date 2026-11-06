// Real-browser tests (Chromium via Playwright): the actual pages, scripts and CSS, driven like a person would.
// Skips itself unless Playwright + Chromium are installed:  npm i -D playwright && npx playwright install chromium
const H = require("./browser/harness");
const test = require("node:test");
const assert = require("node:assert/strict");
const { S, fake } = H;
const pw = H.loadPlaywright();
const opts = { skip: pw ? false : "Playwright/Chromium not installed (optional)" };
const SHOTS = process.env.SHOTS;

let srv, browser;
test.before(async () => { if (!pw) return; srv = await H.start(); browser = await pw.chromium.launch(); });
test.after(async () => { if (browser) await browser.close(); if (srv) await srv.close(); });
test.beforeEach(() => {
  if (!pw) return;
  S.reset(); H.seedUsers(); S.seedRoom(); S.seedTable();
  fake.t.rooms[0].image_url = ""; fake.t.rooms[0].description = "Comfortable room";
});

async function open(userId, url, { mobile = false } = {}) {
  const ctx = await browser.newContext({ viewport: mobile ? { width: 390, height: 800 } : { width: 1280, height: 900 }, deviceScaleFactor: mobile ? 2 : 1 });
  if (userId) { const s = H.sessionFor(userId); await ctx.addInitScript(([t, u]) => { sessionStorage.setItem("pw_token", t); sessionStorage.setItem("pw_user", u); }, [s.token, s.user]); }
  await ctx.route("**/*", r => (r.request().url().startsWith(srv.url) || r.request().url().startsWith("data:")) ? r.continue() : r.abort());
  const page = await ctx.newPage(), errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("dialog", d => d.accept());
  if (url) { await page.goto(srv.url + url); await page.waitForLoadState("networkidle"); }
  return { page, ctx, errors };
}
const tabsOf = page => page.$$eval("#tabs button", bs => bs.map(b => b.textContent.trim()));
const shot = (page, name) => SHOTS ? page.screenshot({ path: `/tmp/shots/${name}.png`, fullPage: true }) : null;
const ADMIN = ["Overview", "Bookings", "Walk-in", "Payments", "Rooms & tables", "News", "Users"];
const OWNER = ["Overview", "Business", "Bookings", "Walk-in", "Payments", "Rooms & tables", "News", "Users", "Revenue reports", "Site settings"];
const SYS = [...OWNER, "Security", "Audit log", "Incidents", "Backups", "Jobs"];

// ───────────── access ─────────────
test("signed-out visitors never see a dashboard — they land on the login page", opts, async () => {
  for (const p of ["admin", "owner", "systemowner", "account"]) {
    const { page, ctx } = await open(null, `/${p}.html`);
    assert.match(page.url(), /\/login\.html\?redirect=/, p); await ctx.close();
  }
});
test("a guest or lower staff role is bounced from higher dashboards", opts, async () => {
  for (const [who, page_, to] of [["U-guest", "admin", "/account.html"], ["U-admin", "owner", "/admin.html"], ["U-admin", "systemowner", "/admin.html"], ["U-owner", "systemowner", "/owner.html"]]) {
    const { page, ctx } = await open(who, `/${page_}.html`); assert.ok(page.url().split("#")[0].endsWith(to), `${who} on ${page_} → ${page.url()}`); await ctx.close();
  }
});

// ───────────── modules per role ─────────────
test("Admin / Owner / System Owner each get their modules — and every higher role has ALL the lower roles' modules", opts, async () => {
  const seen = {};
  for (const [who, page_, want] of [["U-admin", "admin", ADMIN], ["U-owner", "owner", OWNER], ["U-sys", "systemowner", SYS]]) {
    const { page, ctx, errors } = await open(who, `/${page_}.html`);
    seen[page_] = await tabsOf(page); assert.deepEqual(seen[page_], want, page_);
    for (const label of want) { await page.click(`#tabs button:has-text("${label}")`, { force: true }); await page.waitForLoadState("networkidle"); }   // every module opens without a script error
    assert.deepEqual(errors, [], page_ + " threw: " + errors.join(" | ")); await ctx.close();
  }
  for (const t of seen.admin) assert.ok(seen.owner.includes(t) && seen.systemowner.includes(t), "missing from higher role: " + t);
  for (const t of seen.owner) assert.ok(seen.systemowner.includes(t), "system owner lacks: " + t);
});

// ───────────── users ─────────────
async function usersSeenBy(who, page_) {
  const { page, ctx } = await open(who, `/${page_}.html#users`); await page.waitForSelector("#us-t tr"); 
  const names = await page.$$eval("#us-t tr td:first-child", t => t.map(x => x.textContent.replace("(you)", "").trim())); await ctx.close(); return names;
}
test("Admin sees guests + admins only; Owner also sees owners; System Owner sees everyone", opts, async () => {
  assert.deepEqual((await usersSeenBy("U-admin", "admin")).sort(), ["Abe Admin", "Ann Admin", "Gina Guest"]);
  assert.deepEqual((await usersSeenBy("U-owner", "owner")).sort(), ["Abe Admin", "Ann Admin", "Gina Guest", "Olu Owner"]);
  assert.deepEqual((await usersSeenBy("U-sys", "systemowner")).sort(), ["Abe Admin", "Ann Admin", "Gina Guest", "Olu Owner", "Sam System"]);
});
test("Admin sets a user's password from a dialog; weak ones are refused; no button on their own row", opts, async () => {
  const { page, ctx, errors } = await open("U-admin", "/admin.html#users"); await page.waitForSelector("#us-t tr");
  const rowOf = n => page.locator("#us-t tr", { hasText: n });
  assert.equal(await rowOf("Ann Admin").locator('[data-a="pw"]').count(), 0, "no 'Set password' on your own account");
  await rowOf("Gina Guest").locator('[data-a="pw"]').click();
  assert.equal(await page.isVisible("#dlg"), true);
  await page.fill("#dlg-pw", "abc"); await page.click("#dlg-ok"); assert.match(await page.textContent("#dlg-err"), /8/); assert.equal(await page.isVisible("#dlg"), true);
  await page.click("#dlg-gen"); const pwd = await page.inputValue("#dlg-pw"); assert.equal(pwd.length, 14);
  await shot(page, "password-dialog"); await page.click("#dlg-ok");
  await page.waitForFunction(() => document.querySelector("#msg").textContent.includes("Password updated"));
  assert.deepEqual(srv.calls.resets.pop(), { by: "U-admin", target: "U-guest", pw: pwd }); assert.equal(await page.isVisible("#dlg"), false);
  await rowOf("Abe Admin").locator('[data-a="pw"]').click(); await page.fill("#dlg-pw", "peer-password-1"); await page.click("#dlg-ok");     // peers too, as requested
  await page.waitForFunction(() => document.querySelector("#msg").textContent.includes("Password updated"));
  const refused = await page.evaluate(async t => (await fetch("/api/auth/reset-password", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + sessionStorage.pw_token }, body: JSON.stringify({ target_user_id: "U-owner", new_password: "whatever123" }) })).status);
  assert.equal(refused, 403, "the server refuses an owner even if the UI is bypassed"); assert.deepEqual(errors, []); await ctx.close();
});
test("Owner can create staff accounts only below their role", opts, async () => {
  const { page, ctx } = await open("U-owner", "/owner.html#users"); await page.waitForSelector("#us-role");
  assert.deepEqual(await page.$$eval("#us-role option", o => o.map(x => x.value)), ["user", "admin"]); await ctx.close();
});

// ───────────── news ─────────────
const write = async (page, { title, body, status = "published", pin = "false" }) => {
  await page.fill("#nw-title", title); await page.fill("#nw-body", body); await page.selectOption("#nw-status", status); await page.selectOption("#nw-pin", pin);
  const real = () => page.locator("#nw-t tr:not(:has(td[colspan]))").count();       // the "No stories yet" placeholder row doesn't count
  const before = await real();
  await page.click("#nw-save"); await page.waitForFunction(n => document.querySelectorAll("#nw-t tr:not(:has(td[colspan]))").length > n, before);
};
test("an admin writes news from their dashboard; published stories appear on the news page and home page, drafts do not", opts, async () => {
  const a = await open("U-admin", "/admin.html#news"); await a.page.waitForSelector("#nw-form");
  await write(a.page, { title: "Sunday brunch is back", body: "Join us every Sunday from 10am.\n\nBook a table early — it fills up fast." });
  await write(a.page, { title: "Secret draft story", body: "Not ready for guests yet, still working on this.", status: "draft" });
  assert.equal(await a.page.locator("#nw-t tr:not(:has(td[colspan]))").count(), 2); assert.deepEqual(a.errors, []);
  const g = await open(null, "/news.html"); await shot(g.page, "news-list");
  const titles = await g.page.$$eval(".n-card h3", h => h.map(x => x.textContent)); assert.deepEqual(titles, ["Sunday brunch is back"]);
  await g.page.click(".n-card"); await g.page.waitForSelector(".article h1");
  assert.equal(await g.page.textContent(".article h1"), "Sunday brunch is back"); assert.equal(await g.page.locator(".article .txt p").count(), 2);
  await shot(g.page, "news-article");
  await g.page.goto(srv.url + "/"); await g.page.waitForSelector("#homeNews .n-card"); assert.equal(await g.page.locator("#homeNews .n-card").count(), 1);
  await a.ctx.close(); await g.ctx.close();
});
test("the home page hides the news block when there is nothing to show", opts, async () => {
  const { page, ctx } = await open(null, "/"); assert.equal(await page.isVisible("#latestNews"), false); await ctx.close();
});
test("story text is always escaped — markup in a story can never run", opts, async () => {
  fake.t.news.push({ id: "evil0001", title: `<img src=x onerror="window.__xss=1">Bad`, summary: `<script>window.__xss=2</script>`, body: `<b onmouseover="window.__xss=3">x</b>\n\n<iframe src="javascript:window.__xss=4"></iframe>`,
    image_url: `javascript:window.__xss=5`, status: "published", pinned: false, author_name: `<i>Mallory</i>`, published_at: new Date().toISOString(), created_at: new Date().toISOString() });
  const { page, ctx } = await open(null, "/news.html"); assert.match(await page.textContent(".n-card h3"), /<img src=x/); assert.equal(await page.locator(".n-card img").count(), 0, "unsafe image link ignored");
  await page.click(".n-card"); await page.waitForSelector(".article h1"); assert.match(await page.textContent(".article .txt"), /<b onmouseover/);
  assert.equal(await page.evaluate(() => window.__xss), undefined); assert.equal(await page.locator(".article iframe, .article b").count(), 0); await ctx.close();
});
test("admins manage only their own stories; owners manage everyone's; edit, unpublish and delete work", opts, async () => {
  const a1 = await open("U-admin", "/admin.html#news"); await a1.page.waitForSelector("#nw-form");
  await write(a1.page, { title: "Ann's announcement", body: "Written by Ann the admin, for guests." });
  const a2 = await open("U-admin2", "/admin.html#news"); await a2.page.waitForSelector("#nw-t tr");
  assert.match(await a2.page.textContent("#nw-t"), /Only the author or an owner/); assert.equal(await a2.page.locator('#nw-t [data-a="edit"]').count(), 0);
  const o = await open("U-owner", "/owner.html#news"); await o.page.waitForSelector('#nw-t [data-a="edit"]');
  await o.page.click('#nw-t [data-a="edit"]'); assert.equal(await o.page.inputValue("#nw-title"), "Ann's announcement");
  await o.page.fill("#nw-title", "Ann's updated announcement"); await o.page.click("#nw-save"); await o.page.waitForFunction(() => document.querySelector("#nw-t").textContent.includes("updated announcement"));
  await o.page.click('#nw-t [data-a="toggle"]'); await o.page.waitForFunction(() => document.querySelector('#nw-t [data-a="toggle"]')?.textContent === "Publish");
  const g = await open(null, "/news.html"); assert.equal(await g.page.locator(".n-card").count(), 0, "unpublished stories leave the public page");
  await o.page.click('#nw-t [data-a="del"]'); await o.page.waitForFunction(() => document.querySelectorAll("#nw-t tr")[0]?.textContent.includes("No stories yet"));
  assert.equal(fake.t.news.length, 0); for (const c of [a1, a2, o, g]) { assert.deepEqual(c.errors, []); await c.ctx.close(); }
});

// ───────────── social links ─────────────
test("the owner sets social links; coloured icons appear in every footer, open safely, and unset ones stay hidden", opts, async () => {
  const pub = await open(null, "/"); assert.equal(await pub.page.locator("footer .soc").count(), 0, "nothing shown until links are set");
  assert.equal(await pub.page.isVisible("footer [data-social]"), false);
  const o = await open("U-owner", "/owner.html#settings"); await o.page.waitForSelector("#st-form");
  await o.page.fill("#st-facebook", "https://www.facebook.com/primewave"); await o.page.fill("#st-instagram", "https://www.instagram.com/primewave");
  await o.page.fill("#st-youtube", "https://www.youtube.com/@primewave"); await o.page.fill("#st-tiktok", "https://www.tiktok.com/@primewave");
  await o.page.click("#st-form button"); await o.page.waitForFunction(() => /saved/i.test(document.querySelector("#msg").textContent));
  await o.page.waitForFunction(() => document.querySelectorAll("#st-prev .soc").length === 4); await shot(o.page, "settings");
  for (const path of ["/", "/rooms.html", "/about.html", "/services.html", "/contact.html", "/news.html", "/book.html"]) {
    const g = await open(null, path); const links = await g.page.$$eval("footer .soc", as => as.map(a => ({ n: a.title, h: a.href, t: a.target, r: a.rel })));
    assert.deepEqual(links.map(l => l.n), ["Facebook", "Instagram", "YouTube", "TikTok"], path);
    assert.ok(links.every(l => l.t === "_blank" && /noopener/.test(l.r) && l.h.startsWith("https://")), path);
    if (path === "/") { await g.page.locator("footer .social").scrollIntoViewIfNeeded(); await shot(g.page, "footer-social"); }
    await g.ctx.close();
  }
  await o.page.fill("#st-tiktok", ""); await o.page.click("#st-form button"); await o.page.waitForFunction(() => document.querySelectorAll("#st-prev .soc").length === 3);
  const bad = async v => { await o.page.evaluate(() => { document.querySelector("#msg").className = "msg"; document.querySelector("#msg").textContent = ""; });
    await o.page.fill("#st-facebook", v); await o.page.click("#st-form button"); await o.page.waitForSelector("#msg.err"); return o.page.textContent("#msg"); };
  assert.match(await bad("http://facebook.com/x"), /https/); assert.match(await bad("javascript:alert(1)"), /https|link/); assert.match(await bad("https://evil.example/x"), /facebook\.com/);
  await o.ctx.close(); await pub.ctx.close();
});

// ───────────── phones ─────────────
test("no page overflows sideways at phone width", opts, async () => {
  const pages = [[null, "/"], [null, "/rooms.html"], [null, "/news.html"], [null, "/about.html"], [null, "/services.html"], [null, "/contact.html"], [null, "/login.html"], ["U-guest", "/book.html"],
    ["U-admin", "/admin.html"], ["U-owner", "/owner.html"], ["U-sys", "/systemowner.html"]];
  fake.t.news.push({ id: "n0000001", title: "A reasonably long headline that has to wrap across several lines on a phone", summary: "Summary text that is long enough to wrap onto more than one line.", body: "Body text here for the story.", status: "published", pinned: true, author_name: "Ann", published_at: new Date().toISOString(), created_at: new Date().toISOString() });
  for (const [who, p] of pages) {
    const { page, ctx } = await open(who, p, { mobile: true }); await page.waitForTimeout(150);
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, wide: [...document.querySelectorAll("body *")].filter(e => e.getBoundingClientRect().right > window.innerWidth + 1 && getComputedStyle(e).position !== "fixed" && !e.closest(".site-nav,.tbl,[hidden],.pwcal")).slice(0, 3).map(e => e.tagName + "." + e.className) }));
    assert.ok(m.sw <= m.iw + 1, `${p} overflows: ${m.sw} > ${m.iw} (${m.wide.join(", ")})`);
    if (p === "/" || p === "/news.html" || p === "/systemowner.html") await shot(page, "mobile" + p.replace(/[/.]/g, "-")); await ctx.close();
  }
});
test("mobile menu opens, lists News, and navigates", opts, async () => {
  const { page, ctx } = await open(null, "/", { mobile: true });
  assert.equal(await page.isVisible("#siteNav a[href='/news.html']"), false); await page.click("#siteHam");
  await page.waitForSelector("#siteNav.open a[href='/news.html']", { state: "visible" }); await shot(page, "mobile-menu");
  await page.click("#siteNav a[href='/news.html']"); await page.waitForURL("**/news.html"); await ctx.close();
});

// ───────────── booking calendar ─────────────
test("the booking calendar crosses out taken nights, preselects from a link, and keeps the date fields in sync", opts, async () => {
  S.seedBooking({ checkin_date: new Date(S.day(10) + "T00:00:00+03:00").toISOString(), checkout_date: new Date(S.day(13) + "T00:00:00+03:00").toISOString() });
  const { page, ctx, errors } = await open("U-guest", `/book.html?type=room&room_id=R1&checkin=${S.day(20)}&checkout=${S.day(22)}`);
  await page.waitForSelector("#roomCal .d", { state: "attached" });
  assert.equal(await page.inputValue("#roomSel"), "R1", "room preselected from the link");
  assert.equal(await page.inputValue("#checkin"), S.day(20)); assert.equal(await page.inputValue("#checkout"), S.day(22));
  const busy = await page.$$eval("#roomCal .d.busy", ds => ds.map(d => d.getAttribute("aria-label")));
  assert.ok(busy.length >= 3 && busy.every(l => /unavailable/.test(l)), "taken nights are crossed out: " + busy.length);
  await shot(page, "booking-calendar");
  const free = S.day(16);                                                       // both ends were chosen via the link, so the next click starts a new range
  await page.click(`#roomCal [data-k="${free}"]`); await page.click(`#roomCal [data-k="${S.day(18)}"]`);
  assert.equal(await page.inputValue("#checkin"), free); assert.equal(await page.inputValue("#checkout"), S.day(18));
  assert.equal(await page.locator(`#roomCal [data-k="${S.day(11)}"]`).isDisabled(), true, "a taken night cannot be chosen");
  await page.click(`#roomCal [data-k="${S.day(8)}"]`);                           // new start just before the taken run…
  assert.match(await page.getAttribute(`#roomCal [data-k="${S.day(10)}"]`, "class"), /\bco\b/, "…the first taken date is offered as check-out only");
  assert.equal(await page.locator(`#roomCal [data-k="${S.day(11)}"]`).isDisabled(), true, "…and nothing beyond it can be picked");
  await shot(page, "booking-calendar-selecting");
  assert.deepEqual(errors, []); await ctx.close();
});

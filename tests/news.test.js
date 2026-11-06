const S = require("./helpers/setup");
const test = require("node:test");
const assert = require("node:assert/strict");
const N = require("../server/services/news");
const { fake } = S;

const guest = { user_id: "G", name: "Gina", role: "user" };
const admin = { user_id: "A", name: "Ann Admin", role: "admin" }, admin2 = { user_id: "A2", name: "Bob Admin", role: "admin" };
const owner = { user_id: "O", name: "Olu Owner", role: "owner" }, sys = { user_id: "S", name: "Sam Sys", role: "systemowner" };
const story = (o = {}) => ({ title: "Weekend brunch is back", body: "Join us every Sunday from 10am for brunch on the garden terrace.", status: "published", ...o });
test.beforeEach(() => S.reset());

test("validation: lengths, status and a plain-text-only body", () => {
  for (const bad of [{ title: "ab" }, { title: "x".repeat(151) }, { body: "short" }, { body: "x".repeat(20001) }, { summary: "x".repeat(301) }, { status: "live" }])
    assert.throws(() => N.validateNews(story(bad)), e => e.statusCode === 400, JSON.stringify(bad).slice(0, 40));
  const ok = N.validateNews(story({ title: "  <b>Big</b> news!  ", body: "Line one\r\n\r\n\r\n\r\nLine two <script>x</script>" }));
  assert.equal(ok.title, "bBig/b news!"); assert.ok(!/[<>]/.test(ok.body)); assert.ok(!/\n{3,}/.test(ok.body));
});
test("apostrophes and quotes survive (unlike the old sanitiser that ate them)", () => assert.equal(N.validateNews(story({ title: `We're open — "all week"` })).title, `We're open — "all week"`));
test("a missing summary is generated from the story", () => {
  const f = N.validateNews(story({ body: "A ".repeat(300) }));
  assert.ok(f.summary.length > 0 && f.summary.length <= 181 && f.summary.endsWith("…"));
});
test("image links must be https; javascript:/data:/http are refused", () => {
  for (const u of ["javascript:alert(1)", "data:text/html,x", "http://x.com/a.jpg", "not a url", "https://x.com/" + "a".repeat(500)]) assert.throws(() => N.validateNews(story({ image_url: u })), e => e.statusCode === 400, u.slice(0, 30));
  assert.equal(N.validateNews(story({ image_url: "https://images.example.com/a.jpg" })).image_url, "https://images.example.com/a.jpg");
});

test("who can write: admin, owner and system owner — guests cannot", async () => {
  for (const u of [admin, owner, sys]) assert.ok((await N.createNews(u, story())).id);
  assert.equal(fake.t.news.length, 3);
  assert.deepEqual(new Set(fake.t.news.map(n => n.author_role)), new Set(["admin", "owner", "systemowner"]));
});
test("publishing stamps the date; drafts have none; re-publishing keeps the original date", async () => {
  const draft = await N.createNews(admin, story({ status: "draft" })); assert.equal(draft.published_at, null);
  await N.updateNews(admin, draft.id, { status: "published" });
  const first = fake.t.news[0].published_at; assert.ok(first);
  await N.updateNews(admin, draft.id, { status: "draft" }); await N.updateNews(admin, draft.id, { status: "published" });
  assert.equal(fake.t.news[0].published_at, first);
});
test("admins edit/delete only THEIR stories; owners and system owners can manage anyone's", async () => {
  const mine = await N.createNews(admin, story());
  await assert.rejects(N.updateNews(admin2, mine.id, { title: "Hijacked title" }), e => e.statusCode === 403);
  await assert.rejects(N.deleteNews(admin2, mine.id), e => e.statusCode === 403);
  await assert.doesNotReject(N.updateNews(admin, mine.id, { title: "My edited title" }));
  await assert.doesNotReject(N.updateNews(owner, mine.id, { title: "Owner edited title" }));
  await assert.doesNotReject(N.deleteNews(sys, mine.id));
  assert.equal(fake.t.news.length, 0);
  await assert.rejects(N.updateNews(guest, "nope-nope-nope", { title: "xxxx" }), e => e.statusCode === 404);
});
test("the public list: published only, pinned first, newest first, never author ids or drafts", async () => {
  const mk = async (title, o) => { const r = await N.createNews(admin, story({ title, ...o })); return r; };
  await mk("Old news item", {}); await mk("Newer news item", {}); await mk("Secret draft here", { status: "draft" }); await mk("Pinned announcement", { pinned: true });
  fake.t.news.find(n => n.title === "Old news item").published_at = "2026-01-01T00:00:00.000Z";
  fake.t.news.find(n => n.title === "Newer news item").published_at = "2026-02-01T00:00:00.000Z";
  const { data, next } = await N.listPublished();
  assert.deepEqual(data.map(d => d.title), ["Pinned announcement", "Newer news item", "Old news item"]); assert.equal(next, null);
  const text = JSON.stringify(data); assert.ok(!/Secret draft|author_id|"A"/.test(text));
  assert.ok(data.every(d => d.author_name === "Ann Admin" && !("body" in d)));
});
test("pagination: cursor pages through older stories; pinned appear on page one only", async () => {
  for (let i = 1; i <= 5; i++) { await N.createNews(owner, story({ title: "Story number " + i })); fake.t.news[i - 1].published_at = `2026-03-0${i}T00:00:00.000Z`; }
  await N.createNews(owner, story({ title: "Pinned one", pinned: true }));
  const p1 = await N.listPublished({ limit: 2 }); assert.deepEqual(p1.data.map(d => d.title), ["Pinned one", "Story number 5", "Story number 4"]); assert.ok(p1.next);
  const p2 = await N.listPublished({ limit: 2, before: p1.next }); assert.deepEqual(p2.data.map(d => d.title), ["Story number 3", "Story number 2"]);
  const p3 = await N.listPublished({ limit: 2, before: p2.next }); assert.deepEqual(p3.data.map(d => d.title), ["Story number 1"]); assert.equal(p3.next, null);
  await assert.rejects(N.listPublished({ before: "garbage" }), e => e.statusCode === 400);
});
test("a single story: published ones return the body; drafts and junk ids are 404", async () => {
  const pub = await N.createNews(admin, story()), dr = await N.createNews(admin, story({ status: "draft", title: "Hidden draft" }));
  const got = await N.getPublished(pub.id); assert.equal(got.body, pub.body); assert.ok(!("author_id" in got));
  for (const id of [dr.id, "does-not-exist", "../etc/passwd", "x"]) await assert.rejects(N.getPublished(id), e => e.statusCode === 404, id);
});

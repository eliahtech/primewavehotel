const S = require("./helpers/setup");
const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../server/services/settings");
test.beforeEach(() => S.reset());

test("accepts real links for each network (including subdomains and short domains)", () => {
  const r = T.validateSocial({ facebook: "https://www.facebook.com/primewave", youtube: "https://youtube.com/@primewave", tiktok: "https://www.tiktok.com/@primewave", instagram: "https://instagram.com/primewave" });
  assert.deepEqual(Object.keys(r), ["facebook", "youtube", "tiktok", "instagram"]);
  assert.equal(T.validateSocial({ youtube: "https://youtu.be/abc" }).youtube, "https://youtu.be/abc");
});
test("rejects unsafe or wrong-network links", () => {
  for (const [k, v] of [["facebook", "javascript:alert(1)"], ["facebook", "http://facebook.com/x"], ["facebook", "https://evilfacebook.com/x"], ["facebook", "https://facebook.com.evil.io/x"],
    ["instagram", "https://facebook.com/x"], ["tiktok", "tiktok.com/@x"], ["youtube", "data:text/html,x"], ["tiktok", "https://tiktok.com/" + "a".repeat(300)]])
    assert.throws(() => T.validateSocial({ [k]: v }), e => e.statusCode === 400, `${k}: ${v.slice(0, 40)}`);
});
test("an empty string removes a link; networks not sent are left alone", () =>
  assert.deepEqual(T.validateSocial({ facebook: "  ", tiktok: "https://tiktok.com/@a" }), { facebook: "", tiktok: "https://tiktok.com/@a" }));
test("save then read back; clearing works; an empty save is refused", async () => {
  await T.saveSocial({ facebook: "https://facebook.com/pw", tiktok: "https://tiktok.com/@pw" }, "o@x.com");
  assert.deepEqual(await T.getSocial(), { facebook: "https://facebook.com/pw", youtube: "", tiktok: "https://tiktok.com/@pw", instagram: "" });
  await T.saveSocial({ facebook: "" }, "o@x.com"); assert.equal((await T.getSocial()).facebook, "");
  await assert.rejects(T.saveSocial({}, "o@x.com"), e => e.statusCode === 400);
  assert.equal(S.fake.t.site_settings.length, 2, "upserts reuse the same rows");
});

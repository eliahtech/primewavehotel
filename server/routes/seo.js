// server/routes/seo.js — /robots.txt and /sitemap.xml (public by design)
const express = require("express");
const router  = express.Router();
const { CONFIG } = require("../config/config");
const { buildRobots, buildSitemap } = require("../utils/seo");

router.get("/robots.txt", (req, res) => {
  res.type("text/plain").set("Cache-Control", "public, max-age=3600").send(buildRobots(CONFIG.PUBLIC_BASE_URL));
});

router.get("/sitemap.xml", (req, res) => {
  res.type("application/xml").set("Cache-Control", "public, max-age=3600").send(buildSitemap(CONFIG.PUBLIC_BASE_URL));
});

module.exports = router;

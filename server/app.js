// server/app.js
// Exports the Express app (used by Vercel via api/index.js).
// Only listens on a port when run directly: `node server/app.js`.

// Node 26 loads .env natively (no dotenv package). Missing file is fine
// (e.g. on Vercel, where variables come from the dashboard).
try { process.loadEnvFile(); } catch (e) { if (e.code !== "ENOENT") throw e; }

const express = require("express");
const helmet  = require("helmet");
const path    = require("path");

const { globalLimit, authLimit, otpLimit, chatLimit, formLimit } = require("./middleware/rateLimit");

const app = express();
app.set("trust proxy", 1); // Vercel sits behind a proxy; needed for correct req.ip

app.use(helmet({
  contentSecurityPolicy: false, // pages use inline scripts/styles + Google Fonts; tighten once they are externalised
  crossOriginEmbedderPolicy: false,
}));
app.use(express.json({ limit: "50kb" }));

// robots.txt + sitemap.xml are generated from PUBLIC_BASE_URL (must come before the static handler)
app.use("/", require("./routes/seo"));

// Static files are served by Vercel from /public in production; this is for local dev.
if (!process.env.VERCEL) {
  app.use(express.static(path.join(__dirname, "..", "public")));
}

app.use("/api", globalLimit);

app.use("/api/auth/login",     authLimit);
app.use("/api/auth/register",  authLimit);
app.use("/api/auth/request-password-reset", formLimit);
app.use("/api/auth/password-reset", otpLimit);
app.use("/api/chat",      chatLimit);
app.use("/api/contact",   formLimit);
app.use("/api/subscribe", formLimit);

app.use("/api/auth/password-reset", require("./routes/passwordReset")); // before /api/auth
app.use("/api/auth",         require("./routes/auth"));
app.use("/api/rooms",        require("./routes/rooms"));
app.use("/api/tables",       require("./routes/tables"));
app.use("/api/availability", require("./routes/availability"));
app.use("/api/bookings",     require("./routes/bookings"));
app.use("/api/payments",     require("./routes/payments"));
app.use("/api/dashboard",    require("./routes/dashboard"));
app.use("/api/users",        require("./routes/users"));
app.use("/api/archive",      require("./routes/archive"));
app.use("/api/subscribe",    require("./routes/subscribe"));
app.use("/api/news",         require("./routes/news"));
app.use("/api/site",         require("./routes/site"));
app.use("/api/chat",         require("./routes/chat"));
app.use("/api/contact",      require("./routes/contact"));
app.use("/api/cron",         require("./routes/cron"));
app.use("/api/system",       require("./routes/system"));

app.use("/api", (req, res) => res.status(404).json({ status: "error", message: "Not found." }));

// Central error handler: map known Postgres errors, never leak internals on 5xx.
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") return res.status(400).json({ status: "error", message: "Invalid JSON." });
  if (err.type === "entity.too.large")    return res.status(413).json({ status: "error", message: "Request too large." });

  let status = err.statusCode || err.status;
  let message = err.message;
  if (err.code === "23P01") { status = 409; message = "That time slot is already booked."; }
  else if (err.code === "23505") { status = 409; message = "That record already exists."; }
  else if (err.code === "23503") { status = 400; message = "Referenced record does not exist."; }
  else if (err.code === "23514" || err.code === "22007" || err.code === "22008" || err.code === "22P02") { status = 400; message = "Invalid input."; }

  if (!status || status >= 500) {
    console.error("[error]", req.method, req.originalUrl, err);
    status = status || 500;
    message = "Server error. Please try again.";
  }
  res.status(status).json({ status: "error", message });
});

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`PrimeWave server running at http://localhost:${PORT}`));
}

module.exports = app;

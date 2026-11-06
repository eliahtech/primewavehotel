// server/routes/contact.js
// New route — the old contact.html posted to a completely separate,
// unrelated GAS deployment (its scriptURL didn't match any action
// in Code.gs's doPost switch, so this form was likely already broken
// in production). This gives it a real, working endpoint: it just
// emails the admin — no DB table needed for a contact form.

const express = require("express");
const router  = express.Router();
const { CONFIG } = require("../config/config");
const { sanitize, asyncHandler } = require("../utils/helpers");
const { sendEmail } = require("../services/mailer");
const { isValidEmailFormat } = require("../utils/emailValidation");

// POST /api/contact   body: { name, email, phone, message }
router.post("/", asyncHandler(async (req, res) => {
  const name    = sanitize(req.body.name || "");
  const email   = String(req.body.email || "").trim();
  const phone   = sanitize(req.body.phone || "");
  const message = sanitize(req.body.message || "");

  if (!name || !isValidEmailFormat(email) || !message || message.length < 5) {
    return res.status(400).json({ status: "error", message: "Name, email, and message are required." });
  }

  await sendEmail({
    to: CONFIG.ADMIN_EMAIL,
    subject: `${CONFIG.HOTEL_NAME} — New Contact Message from ${name}`,
    body:
      "New message from the website contact form:\n\n" +
      "Name    : " + name + "\n" +
      "Email   : " + email + "\n" +
      "Phone   : " + (phone || "N/A") + "\n\n" +
      "Message:\n" + message,
  });

  res.json({ status: "success", message: "Message sent successfully!" });
}));

module.exports = router;

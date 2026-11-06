// server/services/mailer.js
// Replaces GAS's MailApp.sendEmail(). Requires SMTP creds in .env —
// GAS used your Google account's built-in mail quota, which has no
// direct Node equivalent, so pick any SMTP provider (Gmail app
// password, SendGrid, Mailgun, etc.) and set SMTP_* in .env.

const nodemailer = require("nodemailer");

let transporter = null;
function getTransporter() {
  if (transporter) return transporter;

  if (!process.env.SMTP_HOST) {
    console.warn("[mailer] SMTP_HOST not set — emails will be logged, not sent.");
    return null;
  }

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 10000,
  });
  return transporter;
}

async function sendEmail({ to, subject, body, html }) {
  if (!to) return; // e.g. ADMIN_EMAIL not configured
  const t = getTransporter();
  if (!t) {
    console.log(`[mailer:stub] To: ${to} | Subject: ${subject}\n${body}`);
    return;
  }
  try {
    const mail = { from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, text: body };
    if (html) mail.html = html;
    await t.sendMail(mail);
  } catch (err) {
    console.error("[mailer] send error:", err.message);
  }
}

module.exports = { sendEmail };

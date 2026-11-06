// server/utils/emailValidation.js
// Replaces isValidEmailFormat / isBlockedDomain / hasMxRecord in Auth.gs.
// hasMxRecord now uses Node's built-in dns module instead of a
// dns.google HTTP call — simpler and doesn't need an outbound
// fetch allowance.

const dns = require("dns").promises;

const EMAIL_RE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;

function isValidEmailFormat(email) {
  if (!EMAIL_RE.test(email)) return false;
  if (email.includes("..")) return false;
  const [local, domain] = email.split("@");
  if (local.length > 64) return false;
  if (domain.length > 255) return false;
  return true;
}

// Same blocklist as Auth.gs, verbatim.
const BLOCKED_DOMAINS = new Set([
  "mailinator.com","mailinater.com","mailinator2.com",
  "trashmail.com","trashmail.at","trashmail.io","trashmail.me",
  "trashmail.net","trashmail.org",
  "10minutemail.com","10minutemail.net","10minutemail.org",
  "10minutemail.co.za","10minutemail.de","10minutemail.info",
  "10minemail.com","10minutemail.nl","10mail.org",
  "guerrillamail.com","guerrillamail.net","guerrillamail.org",
  "guerrillamail.biz","guerrillamail.de","guerrillamail.info",
  "guerrillamailblock.com","grr.la","spam4.me",
  "yopmail.com","yopmail.fr","cool.fr.nf","jetable.fr.nf",
  "nospam.ze.tc","nomail.xl.cx","mega.zik.dj","speed.1s.fr",
  "courriel.fr.nf","moncourrier.fr.nf","monemail.fr.nf","monmail.fr.nf",
  "fakeinbox.com","fakeinbox.net","tempinbox.com","tempinbox.net",
  "tempr.email","tempmail.com","tempmail.net","tempmail.org",
  "tempmail.de","tempmailo.com","temp-mail.org","temp-mail.io",
  "tempail.com","dispostable.com","spamgourmet.com",
  "spamgourmet.net","spamgourmet.org",
  "spaml.com","spamspot.com","spaml.de",
  "throwam.com","throwaway.email",
  "discard.email","discardmail.com","discardmail.de",
  "maildrop.cc","maildrop.cf","maildrop.ga","maildrop.gq",
  "maildrop.ml","maildrop.tk",
  "sharklasers.com","mailnull.com","spambox.us",
  "spamday.com","spamcannon.com","spamcannon.net",
]);

function isBlockedDomain(email) {
  const domain = (email.split("@")[1] || "").toLowerCase();
  return BLOCKED_DOMAINS.has(domain);
}

// Returns { valid, reason? } — mirrors Auth.gs's shape.
// On any DNS lookup error, allow through (same fail-open behavior as GAS).
async function hasMxRecord(email) {
  const domain = email.split("@")[1] || "";
  if (!domain || !domain.includes(".")) {
    return { valid: false, reason: "Invalid domain: " + domain };
  }
  try {
    const records = await dns.resolveMx(domain);
    if (!records || !records.length) {
      return { valid: false, reason: "No MX records for domain: " + domain };
    }
    return { valid: true };
  } catch (err) {
    if (err.code === "ENOTFOUND" || err.code === "ENODATA") {
      return { valid: false, reason: "Domain does not exist: " + domain };
    }
    console.warn(`[emailValidation] MX check error for ${domain}: ${err.message} — allowing through`);
    return { valid: true };
  }
}

module.exports = { isValidEmailFormat, isBlockedDomain, hasMxRecord };

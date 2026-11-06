// server/services/pesapal.js
// Replaces the PesaPal API helpers in payment-integration.gs
// (pesapalAccessToken_, pesapalRegisterIpn_, pesapalCreateOrder_,
// pesapalGetTransactionStatus_). Uses Node's built-in fetch (Node 18+).
//
// Keys now come from .env — the originals were hardcoded in
// payment-integration.gs's setPesapalKeys() and should be treated as
// compromised: rotate them in the PesaPal dashboard.

const { CONFIG } = require("../config/config");

const ENDPOINTS = {
  sandbox: {
    token:  "https://cybqa.pesapal.com/pesapalv3/api/Auth/RequestToken",
    order:  "https://cybqa.pesapal.com/pesapalv3/api/Transactions/SubmitOrderRequest",
    ipn:    "https://cybqa.pesapal.com/pesapalv3/api/URLSetup/RegisterIPN",
    status: "https://cybqa.pesapal.com/pesapalv3/api/Transactions/GetTransactionStatus",
  },
  live: {
    token:  "https://pay.pesapal.com/v3/api/Auth/RequestToken",
    order:  "https://pay.pesapal.com/v3/api/Transactions/SubmitOrderRequest",
    ipn:    "https://pay.pesapal.com/v3/api/URLSetup/RegisterIPN",
    status: "https://pay.pesapal.com/v3/api/Transactions/GetTransactionStatus",
  },
};

function env() {
  return ENDPOINTS[process.env.PESAPAL_ENV === "live" ? "live" : "sandbox"];
}

// Bearer token cached ~4.5 min (same as GAS)
let cachedToken = null;
let cachedTokenExpiry = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < cachedTokenExpiry) return cachedToken;

  const key = process.env.PESAPAL_CONSUMER_KEY;
  const secret = process.env.PESAPAL_CONSUMER_SECRET;
  if (!key || !secret) throw new Error("PesaPal keys not set. Add PESAPAL_CONSUMER_KEY / PESAPAL_CONSUMER_SECRET to .env.");

  const res = await fetch(env().token, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ consumer_key: key, consumer_secret: secret }),
    ...T(),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.token) throw new Error("PesaPal auth failed: " + JSON.stringify(data));

  cachedToken = data.token;
  cachedTokenExpiry = Date.now() + 270 * 1000;
  return cachedToken;
}

// PesaPal calls this URL server-to-server after payment events, so it
// MUST be publicly reachable (PUBLIC_BASE_URL).
function getIpnCallbackUrl() {
  return CONFIG.PUBLIC_BASE_URL + "/api/payments/pesapal-callback";
}

// Every outbound call gets a timeout so a slow gateway can't hang a serverless function.
const T = () => ({ signal: AbortSignal.timeout(10000) });

let cachedIpnId = process.env.PESAPAL_IPN_ID || null;

async function registerIpn() {
  const token = await getAccessToken();
  const res = await fetch(env().ipn, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ url: getIpnCallbackUrl(), ipn_notification_type: "GET" }),
    ...T(),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ipn_id) throw new Error("IPN registration failed: " + JSON.stringify(data));
  cachedIpnId = data.ipn_id;
  console.log(`[PesaPal] IPN registered: ${data.ipn_id} -> ${getIpnCallbackUrl()}`);
  console.log(`[PesaPal] Set PESAPAL_IPN_ID=${data.ipn_id} in your environment (required on serverless).`);
  return data;
}

async function createOrder({ session_id, name, email, phone, amount, type, callback_url }) {
  const token = await getAccessToken();
  if (!cachedIpnId) await registerIpn(); // set PESAPAL_IPN_ID in prod to avoid this on every cold start

  const parts = (name || "").split(" ");
  const body = {
    id: String(session_id),
    currency: "KES",
    amount: Number(amount),
    description: `${CONFIG.HOTEL_NAME} — ${type === "table" ? "Table Reservation" : "Room Booking"}`,
    callback_url,
    notification_id: cachedIpnId,
    billing_address: {
      email_address: email || "",
      phone_number: phone || "",
      first_name: parts[0] || "",
      last_name: parts.slice(1).join(" ") || "-",
      country_code: "KE",
    },
  };

  const res = await fetch(env().order, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify(body),
    ...T(),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.redirect_url) throw new Error("PesaPal order failed: " + JSON.stringify(data));
  return data; // { order_tracking_id, redirect_url, ... }
}

async function getTransactionStatus(orderTrackingId) {
  if (!orderTrackingId) throw new Error("orderTrackingId required.");
  const token = await getAccessToken();
  const res = await fetch(`${env().status}?orderTrackingId=${encodeURIComponent(orderTrackingId)}`, {
    headers: { Accept: "application/json", Authorization: "Bearer " + token },
    ...T(),
  });
  return res.json().catch(() => ({}));
}

module.exports = { getAccessToken, registerIpn, createOrder, getTransactionStatus, getIpnCallbackUrl };

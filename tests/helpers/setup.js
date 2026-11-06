// tests/helpers/setup.js — require this FIRST in every test file.
// Swaps the real database, mailer and PesaPal client for in-memory fakes, so no network or secrets are needed.

process.env.JWT_SECRET = "t".repeat(48);
process.env.SUPABASE_URL = "http://fake.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";
process.env.PUBLIC_BASE_URL = "https://hotel.test";
process.env.ADMIN_EMAIL = "admin@hotel.test";
process.env.CRON_SECRET = "cron-secret";

const path = require("path");
const { FakeDB } = require("./fakeSupabase");

const root = path.join(__dirname, "..", "..");
const fake = new FakeDB();
const sent = [];
const pesapal = {
  createOrder: async () => ({ order_tracking_id: "TRK-1", redirect_url: "https://pay.test/checkout" }),
  getTransactionStatus: async () => ({}),
  getIpnCallbackUrl: () => "https://hotel.test/api/payments/pesapal-callback",
  registerIpn: async () => ({ ipn_id: "ipn" }),
  getAccessToken: async () => "token",
};

function stub(rel, exports) {
  const p = require.resolve(path.join(root, rel));
  require.cache[p] = { id: p, filename: p, loaded: true, exports, children: [], paths: [] };
}
stub("server/db/supabase.js", fake);
stub("server/services/mailer.js", { sendEmail: async m => { sent.push(m); } });
stub("server/services/pesapal.js", pesapal);

// ── helpers shared by the tests ──
const DAY = 86400000;
/** YYYY-MM-DD in Nairobi time, `n` days from today */
const day = n => new Date(Date.now() + 3 * 3600000 + n * DAY).toISOString().slice(0, 10);

function reset() { fake.reset(); sent.length = 0; pesapal.getTransactionStatus = async () => ({}); }
function seedRoom(o = {}) { const r = { id: "R1", room_number: "101", room_type: "Deluxe", price_per_night: 5000, max_guests: 2, status: "available", ...o }; fake.t.rooms.push(r); return r; }
function seedTable(o = {}) { const t = { id: "T1", table_number: "T-1", table_name: "Garden Table", seats: 4, price_per_hour: 1000, status: "available", location: "Garden", ...o }; fake.t.tables_.push(t); return t; }
function seedBooking(o = {}) {
  const b = { booking_id: "PW-X-" + Math.random().toString(36).slice(2, 8), type: "room", room_id: "R1", status: "confirmed", payment_status: "paid",
    checkin_date: new Date(day(10) + "T00:00:00+03:00").toISOString(), checkout_date: new Date(day(12) + "T00:00:00+03:00").toISOString(), ...o };
  fake.t.bookings.push(b); return b;
}
function paidSession(o = {}) {
  return { session_id: "a".repeat(24), user_id: "U1", type: "room", room_id: "R1", table_id: null, item_label: "Room 101 — Deluxe",
    guest_name: "Jane Guest", guest_phone: "+254712345678", guest_email: "jane@example.com",
    checkin_date: new Date(day(10) + "T00:00:00+03:00").toISOString(), checkout_date: new Date(day(12) + "T00:00:00+03:00").toISOString(),
    num_guests: 2, nights: 2, subtotal: 10000, tax: 1600, total_amount: 11600, notes: "", national_id: "",
    pesapal_tracking_id: "TRK-1", ...o };
}
async function storeSession(s, expiresInMs = 15 * 60000) {
  fake.t.pending_sessions.push({ session_id: s.session_id, data: s, pesapal_tracking_id: s.pesapal_tracking_id || null, expires_at: new Date(Date.now() + expiresInMs).toISOString() });
}

module.exports = { fake, sent, pesapal, day, reset, seedRoom, seedTable, seedBooking, paidSession, storeSession, root };

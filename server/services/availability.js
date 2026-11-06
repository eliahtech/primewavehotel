// server/services/availability.js
// Soft check used for friendly UX. The AUTHORITATIVE guard against double
// booking is the Postgres exclusion constraint (migrations/002_hardening.sql).

const supabase = require("../db/supabase");
const { httpError, toEat } = require("../utils/helpers");

const ACTIVE = ["pending_payment", "confirmed", "checked_in"];

async function checkAvailable({ type, room_id, table_id, checkin, checkout, includeSessions = false }) {
  const isTable = type === "table" || !!table_id;
  const col  = isTable ? "table_id" : "room_id";
  const id   = isTable ? table_id : room_id;
  const word = isTable ? "Table" : "Room";
  if (!id) return { available: false, message: `${col} required.` };

  const { data: item, error: itemErr } = await supabase
    .from(isTable ? "tables_" : "rooms").select("id,status").eq("id", id).maybeSingle();
  if (itemErr) throw itemErr;
  if (!item) return { available: false, message: `${word} not found.` };
  if (["maintenance", "hidden"].includes(item.status)) {
    return { available: false, message: `${word} is not currently open for booking.` };
  }

  const { data, error } = await supabase
    .from("bookings").select("booking_id")
    .eq(col, id).in("status", ACTIVE)
    .lt("checkin_date", checkout).gt("checkout_date", checkin).limit(1);
  if (error) throw error;
  if (data.length) return { available: false, message: isTable ? "Table is already booked for that time slot." : "Room is taken for those dates." };

  if (includeSessions) {
    // Someone may be mid-payment for the same slot — hold it for them.
    const { data: sess, error: sErr } = await supabase
      .from("pending_sessions").select("data")
      .eq(`data->>${col}`, id).gt("expires_at", new Date().toISOString());
    if (sErr) throw sErr;
    const clash = (sess || []).some(s =>
      new Date(s.data.checkin_date) < new Date(checkout) && new Date(s.data.checkout_date) > new Date(checkin));
    if (clash) return { available: false, message: "Another guest is completing payment for this slot. Try again in a few minutes." };
  }

  return { available: true, message: isTable ? "Table is available." : "Room is available ✔" };
}

// ── Calendar: which nights / time slots are taken (dates only — no guest details are ever returned) ──
const DAY = 86400000, EAT = 3 * 3600000;
const eatMidnight = t => Math.floor((t + EAT) / DAY) * DAY - EAT;   // Nairobi midnight (epoch ms) of the day containing t
const dayKey = t => new Date(t + EAT).toISOString().slice(0, 10);   // "YYYY-MM-DD" in Nairobi time

/**
 * @param {{type?:string, room_id?:string, table_id?:string, from?:string, days?:number}} q
 * @returns {Promise<{closed:boolean, from:string, days:number, nights:string[], ranges:{start:string,end:string,held:boolean}[]}>}
 *  nights — rooms: every Nairobi date whose NIGHT is taken. A guest may check out on the first free date after a run of taken nights.
 *  ranges — exact busy intervals (used for tables, which book by the hour).
 */
async function getCalendar({ type, room_id, table_id, from, days }) {
  const isTable = type === "table" || !!table_id;
  const col = isTable ? "table_id" : "room_id";
  const id = isTable ? table_id : room_id;
  if (!id) throw httpError(400, `${col} required.`);
  days = Math.min(Math.max(parseInt(days, 10) || 120, 1), 180);

  const start = from ? toEat(from).getTime() : eatMidnight(Date.now());
  if (isNaN(start)) throw httpError(400, "Invalid from date.");
  const end = start + days * DAY;
  const base = { from: dayKey(start), days };

  const { data: item, error: itemErr } = await supabase.from(isTable ? "tables_" : "rooms").select("id,status").eq("id", id).maybeSingle();
  if (itemErr) throw itemErr;
  if (!item) throw httpError(404, isTable ? "Table not found." : "Room not found.");
  if (["maintenance", "hidden"].includes(item.status)) return { ...base, closed: true, nights: [], ranges: [] };

  const { data: bk, error } = await supabase.from("bookings").select("checkin_date,checkout_date")
    .eq(col, id).in("status", ACTIVE).lt("checkin_date", new Date(end).toISOString()).gt("checkout_date", new Date(start).toISOString());
  if (error) throw error;
  const { data: held, error: hErr } = await supabase.from("pending_sessions").select("data")
    .eq(`data->>${col}`, id).gt("expires_at", new Date().toISOString());
  if (hErr) throw hErr;

  const ranges = [
    ...bk.map(b => ({ start: b.checkin_date, end: b.checkout_date, held: false })),
    ...(held || []).map(h => ({ start: h.data.checkin_date, end: h.data.checkout_date, held: true }))
      .filter(r => Date.parse(r.start) < end && Date.parse(r.end) > start),
  ];

  const nights = new Set();
  if (!isTable) {
    for (const r of ranges) {
      // nights are [date(checkin), date(checkout)) in Nairobi time, so the checkout day itself stays free
      for (let cur = eatMidnight(Date.parse(r.start)); cur < eatMidnight(Date.parse(r.end)); cur += DAY) {
        if (cur >= start && cur < end) nights.add(dayKey(cur));
      }
    }
  }
  return { ...base, closed: false, nights: [...nights].sort(), ranges };
}

module.exports = { checkAvailable, getCalendar, ACTIVE };

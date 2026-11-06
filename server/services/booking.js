// server/services/booking.js
// Validates a guest's booking request and prices it SERVER-SIDE.
// The client only chooses the item + dates; it can never choose the price.

const supabase = require("../db/supabase");
const { checkAvailable } = require("./availability");
const { isValidEmailFormat } = require("../utils/emailValidation");
const { sanitize, validateRequired, calcNights, calcHours, httpError, parseRange } = require("../utils/helpers");

const VAT_RATE = 0.16;

/**
 * @returns {Promise<{taken:true,message:string} | {taken:false,session:object}>}
 */
async function quoteBooking(b) {
  validateRequired(b, ["name", "phone", "email", "checkin", "checkout", "guests"]);
  if (!b.room_id && !b.table_id) throw httpError(400, "Please select a room or table.");

  const isTable = b.type === "table" || !!b.table_id;
  const range = parseRange(b.checkin, b.checkout, { isTable });
  const email = String(b.email).trim().toLowerCase();
  if (!isValidEmailFormat(email)) throw httpError(400, "Please enter a valid email address.");
  const phone = sanitize(b.phone);
  if (!/^[+\d][\d\s-]{7,18}$/.test(phone)) throw httpError(400, "Please enter a valid phone number.");
  const guests = Math.floor(Number(b.guests));
  if (!(guests >= 1 && guests <= 50)) throw httpError(400, "Invalid number of guests.");

  let item, nights, unit;
  if (isTable) {
    const { data, error } = await supabase.from("tables_").select("*").eq("id", b.table_id).maybeSingle();
    if (error) throw error;
    if (!data) throw httpError(404, "Table not found.");
    if (guests > data.seats) throw httpError(400, `This table seats ${data.seats} guests.`);
    item = data; unit = Number(data.price_per_hour || 0);
    nights = Math.max(1, calcHours(range.checkin, range.checkout));
  } else {
    const { data, error } = await supabase.from("rooms").select("*").eq("id", b.room_id).maybeSingle();
    if (error) throw error;
    if (!data) throw httpError(404, "Room not found.");
    if (guests > data.max_guests) throw httpError(400, `This room allows up to ${data.max_guests} guests.`);
    item = data; unit = Number(data.price_per_night);
    nights = calcNights(range.checkin, range.checkout);
  }

  const subtotal = Math.round(unit * nights);
  const tax = Math.round(subtotal * VAT_RATE);
  const total = subtotal + tax;
  if (!(total > 0)) throw httpError(400, "This item has no price set — please contact the hotel.");

  const avail = await checkAvailable({
    type: isTable ? "table" : "room", room_id: b.room_id, table_id: b.table_id,
    checkin: range.checkin, checkout: range.checkout, includeSessions: true,
  });
  if (!avail.available) return { taken: true, message: avail.message };

  return {
    taken: false,
    session: {
      type: isTable ? "table" : "room", room_id: b.room_id || null, table_id: b.table_id || null,
      item_label: isTable ? `${item.table_name} (${item.table_number})` : `Room ${item.room_number} — ${item.room_type}`,
      guest_name: sanitize(b.name), guest_phone: phone, guest_email: email,
      checkin_date: range.checkin, checkout_date: range.checkout,
      num_guests: guests, nights, subtotal, tax, total_amount: total,
      notes: sanitize(b.notes || ""), national_id: sanitize(b.national_id || ""),
    },
  };
}

module.exports = { quoteBooking, VAT_RATE };

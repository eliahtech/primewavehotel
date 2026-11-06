// server/routes/chat.js — Supabase version
const express  = require("express");
const router   = express.Router();
const supabase = require("../db/supabase");
const { callGroq } = require("../services/groq");
const { sanitize }  = require("../utils/sanitize");
const { HOTEL_NAME, ADMIN_EMAIL, ADMIN_PHONE } = require("../config/hotelConfig");

router.post("/", async (req, res) => {
  if (!req.body.message || !String(req.body.message).trim()) {
    return res.status(400).json({ status: "error", message: "message is required." });
  }

  const userMessage = sanitize(req.body.message).slice(0, 500);
  const history      = Array.isArray(req.body.history) ? req.body.history.slice(-8) : [];

  try {
    const [{ data: rooms, error: roomsErr }, { data: tables, error: tablesErr }] = await Promise.all([
      supabase.from("rooms").select("*"),
      supabase.from("tables_").select("*"),
    ]);
    if (roomsErr) throw roomsErr;
    if (tablesErr) throw tablesErr;

    const availableRooms  = rooms.filter(r => r.status === "available");
    const availableTables = tables.filter(t => t.status === "available");

    const reply = await getReply(userMessage, history, rooms, tables, availableRooms, availableTables);
    res.json(reply);

  } catch (err) {
    console.error("[POST /api/chat]", err);
    res.status(500).json({ status: "error", message: "Chat assistant is unavailable." });
  }
});

async function getReply(userMessage, history, rooms, tables, availableRooms, availableTables) {
  const systemPrompt = buildSystemPrompt(rooms, tables, availableRooms, availableTables);

  try {
    const messages = [
      { role: "system", content: systemPrompt },
      ...history.map(h => ({
        role:    h.role === "assistant" ? "assistant" : "user",
        content: String(h.content || "").slice(0, 400),
      })),
      { role: "user", content: userMessage },
    ];

    const reply = await callGroq(messages);

    if (reply) {
      return { status: "success", reply, source: "groq" };
    }
    return chatFallback(userMessage, rooms, tables);

  } catch (err) {
    console.error("[Groq chat error]", err.message);
    return chatFallback(userMessage, rooms, tables);
  }
}

function buildSystemPrompt(rooms, tables, availableRooms, availableTables) {
  const roomContext = rooms.length
    ? rooms.map(r => [
        "• Room " + r.room_number,
        "Type: " + r.room_type,
        "Price: KES " + Number(r.price_per_night).toLocaleString() + "/night",
        "Max guests: " + r.max_guests,
        "AC: " + (r.has_ac === true || r.has_ac === 1 || r.has_ac === "true" ? "Yes" : "No"),
        "Status: " + String(r.status).toUpperCase(),
        r.description ? "Info: " + r.description : ""
      ].filter(Boolean).join(" | ")
    ).join("\n")
    : "No rooms configured yet.";

  const tableContext = tables.length
    ? tables.map(t => [
        "• Table " + t.table_number + " (" + t.table_name + ")",
        "Seats: " + t.seats,
        "Location: " + (t.location || "Main Hall"),
        "Price: KES " + Number(t.price_per_hour || 0).toLocaleString() + "/hr",
        "Status: " + String(t.status).toUpperCase()
      ].join(" | ")
    ).join("\n")
    : "No tables configured yet.";

  const availNow =
    (availableRooms.length
      ? "ROOMS AVAILABLE NOW:\n" + availableRooms.map(r =>
          "  • Room " + r.room_number + " — " + r.room_type +
          " @ KES " + Number(r.price_per_night).toLocaleString() + "/night" +
          " (max " + r.max_guests + " guests)"
        ).join("\n")
      : "ROOMS: No rooms available right now — all fully occupied.") +
    "\n\n" +
    (availableTables.length
      ? "TABLES AVAILABLE NOW:\n" + availableTables.map(t =>
          "  • Table " + t.table_number + " (" + t.table_name + ")" +
          " — " + t.seats + " seats @ KES " + Number(t.price_per_hour || 0).toLocaleString() + "/hr" +
          " · " + (t.location || "Main Hall")
        ).join("\n")
      : "TABLES: All tables are currently reserved.");

  return [
    "You are Aria, the professional and warmly welcoming AI concierge for " + HOTEL_NAME + ",",
    "a luxury hotel in Nairobi, Kenya. You represent the hotel with grace, clarity, and genuine hospitality.",
    "",
    "YOUR PERSONALITY:",
    "- Warm, polished, and professional — like a five-star hotel concierge.",
    "- Concise but thorough: answer the question fully without being verbose.",
    "- Always address the guest respectfully. Never use slang or overly casual language.",
    "- Use a friendly tone; occasionally use tasteful emojis (✦ ✓ 📧) but sparingly.",
    "- Never say 'I don't know' — if you cannot help, offer a graceful alternative.",
    "",
    "HOTEL INFORMATION:",
    "- Name: " + HOTEL_NAME,
    "- Location: Nairobi, Kenya",
    "- Contact email: " + ADMIN_EMAIL,
    "- Phone: " + ADMIN_PHONE,
    "- Check-in: 2:00 PM | Check-out: 11:00 AM",
    "- Early check-in / late check-out: Subject to availability — guests should request in advance.",
    "- WiFi: Complimentary high-speed WiFi throughout all areas.",
    "- Parking: Available on-site — guests should notify us in advance for reserved spaces.",
    "- Breakfast: Available at the hotel restaurant. Ask staff for current menu and times.",
    "- Cancellations: Contact us with your Booking ID at least 24 hours before arrival for a full waiver.",
    "- Payment methods accepted: M-Pesa, Visa/Mastercard, Bank Transfer (via PesaPal).",
    "- Booking page: Guests book online via the hotel website.",
    "",
    "ALL ROOMS:",
    roomContext,
    "",
    "ALL TABLES:",
    tableContext,
    "",
    availNow,
    "",
    "STRICT RULES — follow these at all times:",
    "1. ONLY answer questions related to " + HOTEL_NAME + " and hotel services. Politely decline all unrelated topics.",
    "2. NEVER invent room numbers, prices, availability, or any data not in the context above.",
    "3. NEVER promise specific availability for future dates — direct guests to check on the booking page or email.",
    "4. When a guest wants to book, direct them to the booking page on the website or to email " + ADMIN_EMAIL + ".",
    "5. For complaints or serious issues, escalate warmly: 'I'll connect you with our team at " + ADMIN_EMAIL + " right away.'",
    "6. Format prices always as: KES X,XXX — never USD or other currencies.",
    "7. If asked about a specific room that is OCCUPIED, acknowledge it and suggest available alternatives.",
    "8. Keep responses under 120 words unless the guest asks for detailed information.",
    "9. Never reveal that you are powered by Groq, llama, or any external AI service.",
    "10. You are Aria — if asked who you are, say: 'I'm Aria, the virtual concierge for " + HOTEL_NAME + ".'",
  ].join("\n");
}

function chatFallback(msg, rooms, tables) {
  const m = msg.toLowerCase().trim();

  if (/^(hi|hello|hey|good morning|good afternoon|good evening|howdy|greetings)/.test(m)) {
    return fb(
      "Hello and welcome to " + HOTEL_NAME + "! 😊\n\n" +
      "I'm Aria, your virtual concierge. I'm here to help with room bookings, table reservations, " +
      "pricing, directions, and any other hotel queries.\n\nHow may I assist you today?"
    );
  }

  if (m.includes("available") || m.includes("free") || m.includes("vacant") || m.includes("open room")) {
    const avail = rooms.filter(r => r.status === "available");
    if (!avail.length) {
      return fb(
        "We regret that all our rooms are currently occupied. 🏨\n\n" +
        "Please check back soon or contact us at " + ADMIN_EMAIL + " — we'd be happy to " +
        "notify you as soon as a room becomes available."
      );
    }
    const list = avail.map(r =>
      "✦ Room " + r.room_number + " — " + r.room_type +
      " · KES " + Number(r.price_per_night).toLocaleString() + "/night" +
      " · Max " + r.max_guests + " guest(s)"
    ).join("\n");
    return fb("We have the following rooms available right now:\n\n" + list + "\n\nWould you like to make a booking?");
  }

  if (m.includes("price") || m.includes("cost") || m.includes("rate") || m.includes("how much") || m.includes("tariff")) {
    const roomList = rooms.length
      ? rooms.map(r =>
          "✦ Room " + r.room_number + " (" + r.room_type + "): KES " +
          Number(r.price_per_night).toLocaleString() + "/night"
        ).join("\n")
      : "Room rates are not configured yet — please contact us.";

    const tableList = tables.length
      ? "\n\nTable rates:\n" + tables.map(t =>
          "✦ Table " + t.table_number + " (" + t.seats + " seats): KES " +
          Number(t.price_per_hour || 0).toLocaleString() + "/hr"
        ).join("\n")
      : "";

    return fb(
      "Here is our current pricing:\n\n" + roomList + tableList +
      "\n\nAll prices are inclusive of service. VAT (16%) applies at checkout. " +
      "Ready to book? Visit our booking page or email " + ADMIN_EMAIL + "."
    );
  }

  if (m.includes("table") || m.includes("restaurant") || m.includes("dining") || m.includes("reservation") || m.includes("dinner") || m.includes("lunch") || m.includes("eat")) {
    const avail = tables.filter(t => t.status === "available");
    if (!avail.length) {
      return fb(
        "All our tables are currently reserved. 🍽️\n\n" +
        "Please contact us at " + ADMIN_EMAIL + " or call " + ADMIN_PHONE + " to check upcoming availability or make a special arrangement."
      );
    }
    const list = avail.map(t =>
      "✦ Table " + t.table_number + " (" + t.table_name + ")" +
      " — " + t.seats + " seats · " + (t.location || "Main Hall") +
      " · KES " + Number(t.price_per_hour || 0).toLocaleString() + "/hr"
    ).join("\n");
    return fb(
      "We'd love to host you at our restaurant! The following tables are available:\n\n" + list +
      "\n\nTo reserve, please visit our booking page or email " + ADMIN_EMAIL + "."
    );
  }

  if (m.includes("check") && (m.includes("in") || m.includes("-in"))) {
    return fb(
      "✦ Check-in time is from 2:00 PM.\n\n" +
      "Early check-in may be arranged subject to room availability — please request it in advance " +
      "when booking or by emailing " + ADMIN_EMAIL + ". We'll do our best to accommodate you!"
    );
  }

  if (m.includes("check") && (m.includes("out") || m.includes("-out"))) {
    return fb(
      "✦ Check-out time is 11:00 AM.\n\n" +
      "Late check-out may be arranged subject to room availability. Kindly notify our reception team " +
      "at least one hour before your scheduled departure."
    );
  }

  if (m.includes("wifi") || m.includes("wi-fi") || m.includes("internet") || m.includes("network")) {
    return fb(
      "✦ Complimentary high-speed WiFi is available throughout " + HOTEL_NAME + " — " +
      "in all rooms, the restaurant, lobby, and common areas.\n\n" +
      "WiFi credentials will be provided at check-in. No additional charge applies."
    );
  }

  if (m.includes("cancel") || m.includes("refund") || m.includes("modify booking")) {
    return fb(
      "To cancel or modify a booking, please:\n\n" +
      "1. Have your Booking ID ready.\n" +
      "2. Email us at " + ADMIN_EMAIL + " at least 24 hours before your arrival date.\n" +
      "3. Full cancellation terms will be included in your booking confirmation email.\n\n" +
      "Our team will process your request promptly."
    );
  }

  if (m.includes("direction") || m.includes("location") || m.includes("where") || m.includes("address") || m.includes("map") || m.includes("find you")) {
    return fb(
      HOTEL_NAME + " is located in Nairobi, Kenya. 📍\n\n" +
      "🗺 View on Google Maps: https://maps.google.com/?q=PrimeWave+Hotel+Nairobi\n\n" +
      "Our team can also arrange airport transfers on request — " +
      "please email " + ADMIN_EMAIL + " with your arrival details."
    );
  }

  if (m.includes("parking") || m.includes("car park") || m.includes("vehicle")) {
    return fb(
      "✦ Complimentary parking is available for hotel guests.\n\n" +
      "If you require a reserved parking space, please notify us in advance by emailing " +
      ADMIN_EMAIL + " with your vehicle details and expected arrival time."
    );
  }

  if (m.includes("breakfast") || m.includes("meal") || m.includes("food") || m.includes("menu") || m.includes("drink")) {
    return fb(
      "✦ " + HOTEL_NAME + " features an in-house restaurant serving breakfast, lunch, and dinner.\n\n" +
      "Breakfast is available to all guests. For current menus, timings, or special dietary " +
      "requirements, please contact our team at " + ADMIN_EMAIL + " or speak with reception on arrival."
    );
  }

  if (m.includes("pay") || m.includes("payment") || m.includes("mpesa") || m.includes("m-pesa") || m.includes("card") || m.includes("visa") || m.includes("cash")) {
    return fb(
      "We accept the following payment methods:\n\n" +
      "✦ M-Pesa (Lipa Na M-Pesa)\n" +
      "✦ Visa / Mastercard\n" +
      "✦ Bank Transfer\n\n" +
      "All online bookings are processed securely via PesaPal with 256-bit SSL encryption. " +
      "A VAT receipt is emailed to you instantly upon successful payment."
    );
  }

  if (m.includes("pool") || m.includes("gym") || m.includes("spa") || m.includes("amenities") || m.includes("facilities") || m.includes("services")) {
    return fb(
      "✦ " + HOTEL_NAME + " offers a range of premium amenities including:\n\n" +
      "• Complimentary high-speed WiFi\n" +
      "• In-house restaurant & bar\n" +
      "• 24/7 reception and concierge service\n" +
      "• On-site parking\n" +
      "• Air conditioning in select rooms\n\n" +
      "For a full list of facilities or to request specific services, " +
      "please contact us at " + ADMIN_EMAIL + "."
    );
  }

  if (m.includes("book") || m.includes("reserv") || m.includes("how do i") || m.includes("how to")) {
    return fb(
      "Booking with us is quick and easy! Here's how:\n\n" +
      "1. Visit our booking page on the website.\n" +
      "2. Select your room or table and preferred dates.\n" +
      "3. Enter your details and choose your payment method.\n" +
      "4. Receive instant confirmation and a receipt by email.\n\n" +
      "Prefer to book directly? Email us at " + ADMIN_EMAIL + " and our team will assist you personally."
    );
  }

  if (m.includes("booking id") || m.includes("confirmation") || m.includes("reference") || m.includes("receipt")) {
    return fb(
      "Your booking ID and receipt are sent to your email immediately after a successful booking.\n\n" +
      "If you have not received your confirmation, please:\n" +
      "• Check your spam / junk folder.\n" +
      "• Email us at " + ADMIN_EMAIL + " with your name and booking date.\n\n" +
      "Our team will resend your confirmation promptly."
    );
  }

  if (m.includes("pet") || m.includes("dog") || m.includes("cat") || m.includes("animal")) {
    return fb(
      "Thank you for asking about our pet policy. For information on whether pets are permitted " +
      "and any associated arrangements, please contact our team directly at " + ADMIN_EMAIL + ".\n\n" +
      "We'll be happy to advise on the best options for you and your companion."
    );
  }

  if (m.includes("child") || m.includes("children") || m.includes("kid") || m.includes("family") || m.includes("baby") || m.includes("infant")) {
    return fb(
      HOTEL_NAME + " warmly welcomes families! 👨‍👩‍👧‍👦\n\n" +
      "We can arrange extra beds or cots for young children on request. " +
      "Please mention the ages and number of children when booking so we can prepare the ideal room for your family.\n\n" +
      "Email us at " + ADMIN_EMAIL + " for family-specific arrangements."
    );
  }

  if (m.includes("contact") || m.includes("speak") || m.includes("call") || m.includes("phone") || m.includes("human") || m.includes("manager") || m.includes("staff")) {
    return fb(
      "Our team is available 24/7 and would be delighted to assist you.\n\n" +
      "📧 Email: " + ADMIN_EMAIL + "\n" +
      "📞 Phone: " + ADMIN_PHONE + "\n\n" +
      "You can also visit us in person at " + HOTEL_NAME + ", Nairobi, Kenya. " +
      "We look forward to hearing from you!"
    );
  }

  if (m.includes("thank") || m.includes("great") || m.includes("excellent") || m.includes("amazing") || m.includes("love") || m.includes("wonderful")) {
    return fb(
      "Thank you so much — that truly means a lot to us! 🌟\n\n" +
      "It is our privilege to provide you with a memorable experience. " +
      "If there is anything else we can do to make your stay even more special, please don't hesitate to ask."
    );
  }

  if (m.includes("complain") || m.includes("bad") || m.includes("terrible") || m.includes("disappointed") || m.includes("unhappy") || m.includes("problem") || m.includes("issue")) {
    return fb(
      "We sincerely apologise for any inconvenience you have experienced. 🙏\n\n" +
      "Your feedback is very important to us. Please share the details of your concern directly " +
      "with our management team at " + ADMIN_EMAIL + " and we will address it as a priority.\n\n" +
      "We are committed to making things right for you."
    );
  }

  return fb(
    "Thank you for reaching out to " + HOTEL_NAME + "! 😊\n\n" +
    "I'd be happy to help with:\n" +
    "• Room availability and pricing\n" +
    "• Table reservations\n" +
    "• Check-in / check-out information\n" +
    "• Directions, parking, and amenities\n" +
    "• Booking and payment queries\n\n" +
    "You're also welcome to contact our team directly at " + ADMIN_EMAIL + " or call " + ADMIN_PHONE + "."
  );
}

function fb(reply) {
  return { status: "success", reply: reply.trim(), source: "fallback" };
}

module.exports = router;

// server/routes/dashboard.js — Supabase version
const express = require("express");
const router  = express.Router();
const supabase = require("../db/supabase");
const { authenticate } = require("../middleware/auth");
const { requireRole }  = require("../middleware/requireRole");
const { ROLES } = require("../config/config");
const { asyncHandler } = require("../utils/helpers");

router.get("/", authenticate, requireRole(ROLES.ADMIN), asyncHandler(async (req, res) => {
  const [bookingsRes, roomsRes, tablesRes, paymentsRes, usersRes] = await Promise.all([
    supabase.from("bookings").select("status, type, source, created_at"),
    supabase.from("rooms").select("status"),
    supabase.from("tables_").select("status"),
    supabase.from("payments").select("status, source, amount, created_at"),
    supabase.from("users").select("user_id, role"),
  ]);
  for (const r of [bookingsRes, roomsRes, tablesRes, paymentsRes, usersRes]) {
    if (r.error) throw r.error;
  }
  const bookingsRows = bookingsRes.data;
  const roomsRows    = roomsRes.data;
  const tablesRows   = tablesRes.data;
  const paymentsRows = paymentsRes.data;
  const usersRows    = usersRes.data;

  const completed     = paymentsRows.filter(p => p.status === "completed");
  const totalRevenue  = completed.reduce((s, p) => s + Number(p.amount || 0), 0);
  const onlineRevenue = completed.filter(p => p.source !== "walk_in").reduce((s, p) => s + Number(p.amount || 0), 0);
  const walkInRevenue = completed.filter(p => p.source === "walk_in").reduce((s, p) => s + Number(p.amount || 0), 0);

  const monthly = buildMonthlyRevenue(paymentsRows);

  const bookingsByMonth = {};
  bookingsRows.forEach(b => {
    const m = String(b.created_at || "").slice(0, 7);
    if (m) bookingsByMonth[m] = (bookingsByMonth[m] || 0) + 1;
  });

  res.json({
    status: "success",
    data: {
      totalBookings:   bookingsRows.length,
      confirmed:       bookingsRows.filter(b => b.status === "confirmed").length,
      checkedIn:       bookingsRows.filter(b => b.status === "checked_in").length,
      pending:         bookingsRows.filter(b => b.status === "pending_payment").length,
      cancelled:       bookingsRows.filter(b => b.status === "cancelled").length,
      roomBookings:    bookingsRows.filter(b => b.type === "room").length,
      tableBookings:   bookingsRows.filter(b => b.type === "table").length,
      walkInBookings:  bookingsRows.filter(b => b.source === "walk_in").length,
      onlineBookings:  bookingsRows.filter(b => b.source === "online").length,
      totalRooms:      roomsRows.length,
      availableRooms:  roomsRows.filter(r => r.status === "available").length,
      occupiedRooms:   roomsRows.filter(r => r.status === "occupied").length,
      totalTables:     tablesRows.length,
      availableTables: tablesRows.filter(t => t.status === "available").length,
      totalRevenue, onlineRevenue, walkInRevenue, monthly, bookingsByMonth,
      totalUsers: usersRows.length,
      admins:     usersRows.filter(u => u.role === ROLES.ADMIN).length,
    },
  });
}));

// GET /api/dashboard/owner   (owner+) — business analytics, last 12 months
router.get("/owner", authenticate, requireRole(ROLES.OWNER), asyncHandler(async (req, res) => {
  const yearAgo = new Date(Date.now() - 365 * 86400000).toISOString();
  const [pay, bk, rooms, tables] = await Promise.all([
    supabase.from("payments").select("amount,method,source,created_at").eq("status", "completed").gte("created_at", yearAgo).limit(20000),
    supabase.from("bookings").select("type,room_id,table_id,status,checkin_date,checkout_date,total_amount,created_at").gte("created_at", yearAgo).limit(20000),
    supabase.from("rooms").select("id,room_number,room_type,status"),
    supabase.from("tables_").select("id,table_number,table_name"),
  ]);
  for (const r of [pay, bk, rooms, tables]) if (r.error) throw r.error;

  const eat = v => new Date(new Date(v).getTime() + 3 * 3600000).toISOString();   // Nairobi wall-clock
  const day = v => eat(v).slice(0, 10), month = v => eat(v).slice(0, 7);
  const sum = a => a.reduce((t, x) => t + Number(x.amount || 0), 0);

  const today = day(new Date());
  const days30 = [...Array(30)].map((_, i) => day(Date.now() - (29 - i) * 86400000));
  const daily = Object.fromEntries(days30.map(d => [d, 0]));
  const monthly = {}, byMethod = {}, bySource = {};
  pay.data.forEach(p => {
    const d = day(p.created_at), m = month(p.created_at), a = Number(p.amount || 0);
    if (d in daily) daily[d] += a;
    monthly[m] = (monthly[m] || 0) + a;
    byMethod[p.method || "other"] = (byMethod[p.method || "other"] || 0) + a;
    bySource[p.source || "online"] = (bySource[p.source || "online"] || 0) + a;
  });

  const live = bk.data.filter(b => ["confirmed", "checked_in", "checked_out"].includes(b.status));
  const cancelled = bk.data.filter(b => b.status === "cancelled").length;

  // Room occupancy over the NEXT 30 nights (booked room-nights / available room-nights)
  const winStart = new Date(today + "T00:00:00+03:00").getTime(), winEnd = winStart + 30 * 86400000;
  const sellable = rooms.data.filter(r => !["maintenance", "hidden"].includes(r.status)).length;
  let booked = 0;
  live.filter(b => b.type === "room").forEach(b => {
    const a = Math.max(winStart, new Date(b.checkin_date).getTime()), z = Math.min(winEnd, new Date(b.checkout_date).getTime());
    if (z > a) booked += (z - a) / 86400000;
  });

  const label = {}; rooms.data.forEach(r => label[r.id] = `Room ${r.room_number} (${r.room_type})`);
  tables.data.forEach(t => label[t.id] = t.table_name);
  const byItem = {};
  live.forEach(b => { const id = b.room_id || b.table_id; if (id) { byItem[id] = byItem[id] || { name: label[id] || "Removed item", bookings: 0, revenue: 0 };
    byItem[id].bookings++; byItem[id].revenue += Number(b.total_amount || 0); } });

  const last30 = sum(pay.data.filter(p => day(p.created_at) >= days30[0]));
  res.json({ status: "success", data: {
    revenue12m: sum(pay.data), revenue30d: last30,
    avgBookingValue: live.length ? Math.round(sum(live.map(b => ({ amount: b.total_amount }))) / live.length) : 0,
    cancellationRate: bk.data.length ? Math.round((cancelled / bk.data.length) * 1000) / 10 : 0,
    occupancy30d: sellable ? Math.round((booked / (sellable * 30)) * 1000) / 10 : 0,
    totalBookings12m: bk.data.length,
    daily: days30.map(d => ({ label: d.slice(5), value: Math.round(daily[d]) })),
    monthly: Object.keys(monthly).sort().slice(-12).map(m => ({ label: m, value: Math.round(monthly[m]) })),
    byMethod, bySource,
    topItems: Object.values(byItem).sort((a, b) => b.revenue - a.revenue).slice(0, 8),
  } });
}));

router.get("/revenue", authenticate, requireRole(ROLES.ADMIN), asyncHandler(async (req, res) => {
  const { from, to, source } = req.query;
  let q = supabase.from("payments").select("*").eq("status", "completed");

  if (from)   q = q.gte("created_at", from + "T00:00:00+03:00");
  if (to)     q = q.lte("created_at", to + "T23:59:59+03:00");
  if (source) q = q.eq("source", source);
  q = q.order("created_at", { ascending: false }).limit(5000);

  const { data, error } = await q;
  if (error) throw error;
  const total = data.reduce((s, p) => s + Number(p.amount || 0), 0);

  res.json({ status: "success", data, total });
}));

function buildMonthlyRevenue(payments) {
  const map = {};
  payments.filter(p => p.status === "completed").forEach(p => {
    const m = String(p.created_at || "").slice(0, 7);
    if (m) map[m] = (map[m] || 0) + Number(p.amount || 0);
  });
  return Object.entries(map)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-6)
    .map(([month, revenue]) => ({ month, revenue }));
}

module.exports = router;

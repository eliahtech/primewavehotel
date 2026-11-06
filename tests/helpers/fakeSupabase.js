// tests/helpers/fakeSupabase.js
// A small in-memory stand-in for the Supabase client — just enough of the query builder our code uses.
// It also reproduces the database rules from migrations/002_hardening.sql that the app relies on:
//   • no overlapping active bookings per room/table   (23P01)
//   • one booking per PesaPal session_id               (23505)
//   • one completed payment per tracking_id            (23505)
//   • primary-key uniqueness                           (23505)
//   • checkout must be after checkin                   (23514)
// It is a fake: it proves OUR code behaves correctly against those rules, not that Postgres enforces them.

const PK = { bookings: "booking_id", payments: "payment_id", pending_sessions: "session_id", rooms: "id", tables_: "id",
  users: "user_id", audit_log: "audit_id", newsletter: "id", archive: "archived_id", incidents: "incident_id",
  job_log: "log_id", backups: "backup_id", news: "id", site_settings: "key" };
const ACTIVE = ["pending_payment", "confirmed", "checked_in"];

const isDateStr = v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v);
function cmp(a, b) {
  if (isDateStr(a) && isDateStr(b)) return Date.parse(a) - Date.parse(b);
  return a < b ? -1 : a > b ? 1 : 0;
}
function get(row, col) {
  if (col.includes("->>")) { const [a, b] = col.split("->>"); const v = row[a] && row[a][b]; return v == null ? v : String(v); }
  return row[col];
}
function likeToRegex(p) {
  let out = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "\\" && i + 1 < p.length) { out += p[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
    else if (c === "%") out += ".*";
    else if (c === "_") out += ".";
    else out += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp("^" + out + "$", "i");
}
const clone = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

class Query {
  constructor(db, table) { this.db = db; this.table = table; this.op = "select"; this.filters = []; this.ord = null; this.lim = null; this.rng = null; this.ret = false; this.mode = null; this.countOnly = false; }
  select(_cols, opts) { if (this.op !== "select") this.ret = true; if (opts && opts.head) this.countOnly = true; return this; }
  insert(rows) { this.op = "insert"; this.payload = Array.isArray(rows) ? rows : [rows]; return this; }
  update(v) { this.op = "update"; this.payload = v; return this; }
  delete() { this.op = "delete"; return this; }
  upsert(rows) { this.op = "upsert"; this.payload = Array.isArray(rows) ? rows : [rows]; return this; }
  eq(c, v) { this.filters.push(r => { const x = get(r, c); return c.includes("->>") ? String(x) === String(v) : x === v; }); return this; }
  neq(c, v) { this.filters.push(r => get(r, c) !== v); return this; }
  in(c, vs) { this.filters.push(r => vs.includes(get(r, c))); return this; }
  lt(c, v) { this.filters.push(r => get(r, c) != null && cmp(get(r, c), v) < 0); return this; }
  lte(c, v) { this.filters.push(r => get(r, c) != null && cmp(get(r, c), v) <= 0); return this; }
  gt(c, v) { this.filters.push(r => get(r, c) != null && cmp(get(r, c), v) > 0); return this; }
  gte(c, v) { this.filters.push(r => get(r, c) != null && cmp(get(r, c), v) >= 0); return this; }
  ilike(c, p) { const re = likeToRegex(String(p)); this.filters.push(r => re.test(String(get(r, c) ?? ""))); return this; }
  is(c, v) { this.filters.push(r => (get(r, c) ?? null) === v); return this; }
  order(c, o) { this.ord = { c, asc: !o || o.ascending !== false }; return this; }
  limit(n) { this.lim = n; return this; }
  range(a, b) { this.rng = [a, b]; return this; }
  maybeSingle() { this.mode = "maybe"; return this; }
  single() { this.mode = "single"; return this; }
  then(res, rej) { return this._run().then(res, rej); }

  async _run() {
    await Promise.resolve(); // yield so concurrent callers interleave like real network calls
    const rows = this.db.t[this.table];
    if (!rows) return { data: null, error: { code: "42P01", message: "no such table " + this.table } };
    const match = () => rows.filter(r => this.filters.every(f => f(r)));
    const finish = list => {
      if (this.mode === "maybe") return list.length > 1 ? { data: null, error: { code: "PGRST116", message: "multiple rows" } } : { data: clone(list[0]) ?? null, error: null };
      if (this.mode === "single") return list.length !== 1 ? { data: null, error: { code: "PGRST116", message: "expected one row" } } : { data: clone(list[0]), error: null };
      return { data: clone(list), error: null };
    };

    if (this.op === "select") {
      let list = match();
      if (this.countOnly) return { data: null, count: list.length, error: null };
      if (this.ord) { const { c, asc } = this.ord; list = [...list].sort((a, b) => (asc ? 1 : -1) * cmp(a[c], b[c])); }
      if (this.rng) list = list.slice(this.rng[0], this.rng[1] + 1);
      if (this.lim != null) list = list.slice(0, this.lim);
      return finish(list);
    }

    if (this.op === "insert" || this.op === "upsert") {
      const staged = [];
      for (const raw of this.payload) {
        const row = { created_at: new Date().toISOString(), ...clone(raw) };
        const pk = PK[this.table];
        const existing = pk ? rows.find(r => r[pk] === row[pk]) : null;
        if (existing && this.op === "upsert") { const next = { ...existing, ...row }; const err = this.db._check(this.table, next, existing); if (err) return { data: null, error: err }; staged.push({ replace: existing, row: next }); continue; }
        const err = this.db._check(this.table, row, null, staged.map(s => s.row)); if (err) return { data: null, error: err };
        staged.push({ row });
      }
      staged.forEach(s => { if (s.replace) rows[rows.indexOf(s.replace)] = s.row; else rows.push(s.row); });
      return this.ret ? finish(staged.map(s => s.row)) : { data: null, error: null };
    }

    if (this.op === "update") {
      const targets = match(); const staged = [];
      for (const r of targets) { const next = { ...r, ...clone(this.payload) }; const err = this.db._check(this.table, next, r); if (err) return { data: null, error: err }; staged.push([r, next]); }
      staged.forEach(([r, next]) => { rows[rows.indexOf(r)] = next; });
      return this.ret ? finish(staged.map(s => s[1])) : { data: null, error: null };
    }

    if (this.op === "delete") {
      const targets = match(); targets.forEach(r => rows.splice(rows.indexOf(r), 1));
      return this.ret ? finish(targets) : { data: null, error: null };
    }
    return { data: null, error: { message: "unsupported op" } };
  }
}

class FakeDB {
  constructor() { this.reset(); this.storage = { from: () => ({ upload: async () => ({ error: null }), createSignedUrl: async () => ({ data: { signedUrl: "https://files.test/x" }, error: null }) }), createBucket: async () => ({}) }; }
  reset() { this.t = Object.fromEntries(Object.keys(PK).map(k => [k, []])); this.t.rate_limits = []; this.rl = {}; }
  from(name) { return new Query(this, name); }
  async rpc(name, a) {
    if (name !== "rate_limit_hit") return { data: null, error: { message: "unknown rpc" } };
    const now = Date.now(), cur = this.rl[a.p_key];
    if (!cur || now - cur.start > a.p_window_seconds * 1000) this.rl[a.p_key] = { start: now, count: 1 }; else cur.count++;
    return { data: this.rl[a.p_key].count <= a.p_max, error: null };
  }
  _check(table, row, self, pending = []) {
    const rows = this.t[table].filter(r => r !== self).concat(pending);
    const pk = PK[table];
    if (pk && rows.some(r => r[pk] === row[pk])) return { code: "23505", message: `duplicate key on ${table}.${pk}` };
    if (table === "bookings") {
      if (row.session_id && rows.some(r => r.session_id === row.session_id)) return { code: "23505", message: "duplicate session_id" };
      if (row.checkin_date && row.checkout_date && !(Date.parse(row.checkout_date) > Date.parse(row.checkin_date))) return { code: "23514", message: "chk_booking_dates" };
      if (ACTIVE.includes(row.status)) {
        for (const col of ["room_id", "table_id"]) {
          if (!row[col]) continue;
          const clash = rows.some(r => r[col] === row[col] && ACTIVE.includes(r.status) &&
            Date.parse(r.checkin_date) < Date.parse(row.checkout_date) && Date.parse(row.checkin_date) < Date.parse(r.checkout_date));
          if (clash) return { code: "23P01", message: "conflicting key value violates exclusion constraint" };
        }
      }
    }
    if (table === "payments" && row.status === "completed" && row.tracking_id && rows.some(r => r.status === "completed" && r.tracking_id === row.tracking_id)) {
      return { code: "23505", message: "duplicate tracking_id" };
    }
    return null;
  }
}

module.exports = { FakeDB };

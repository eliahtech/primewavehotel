-- schema.sql — Supabase / Postgres version
-- Run this in the Supabase SQL Editor (Project → SQL Editor → New query).
-- Converted from the original MySQL schema: ENUM columns became TEXT +
-- CHECK constraints (simpler to alter later than native Postgres ENUM
-- types), INSERT IGNORE became ON CONFLICT DO NOTHING, and the old
-- `archive.data` JSON column is now JSONB (Postgres's indexed/binary
-- JSON type — strictly better here, no reason to use plain JSON).
--
-- ids are still app-generated 12-char strings (TEXT), matching
-- newId() in server/utils/helpers.js — Supabase's usual uuid_generate_v4()
-- default isn't used, to keep IDs consistent with the rest of the app.

-- ── ROOMS ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rooms (
  id              TEXT PRIMARY KEY,
  room_number     TEXT NOT NULL UNIQUE,
  room_type       TEXT NOT NULL,
  description     TEXT,
  price_per_night NUMERIC(10,2) NOT NULL,
  max_guests      INT DEFAULT 2,
  has_ac          BOOLEAN DEFAULT FALSE,
  smoking         BOOLEAN DEFAULT FALSE,
  image_url       TEXT,
  status          TEXT DEFAULT 'available' CHECK (status IN ('available','occupied','maintenance','hidden')),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── RESTAURANT TABLES ─────────────────────────────────────────
-- Trailing underscore avoids the reserved word `table`.
CREATE TABLE IF NOT EXISTS tables_ (
  id             TEXT PRIMARY KEY,
  table_number   TEXT NOT NULL UNIQUE,
  table_name     TEXT NOT NULL,
  seats          INT NOT NULL,
  location       TEXT,
  price_per_hour NUMERIC(10,2) DEFAULT 0,
  status         TEXT DEFAULT 'available' CHECK (status IN ('available','reserved','maintenance')),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ── USERS ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  user_id          TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  email            TEXT NOT NULL UNIQUE,
  phone            TEXT,
  password_hash    TEXT NOT NULL,
  role             TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('systemowner','owner','admin','user')),
  is_active        BOOLEAN DEFAULT TRUE,
  last_login       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  reset_token      TEXT,
  national_id      TEXT,
  otp_code         TEXT,
  otp_expiry       TIMESTAMPTZ,
  otp_attempts     INT DEFAULT 0,
  last_otp_sent    TIMESTAMPTZ,
  allow_self_reset BOOLEAN DEFAULT TRUE
);

-- ── BOOKINGS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bookings (
  booking_id           TEXT PRIMARY KEY,
  type                 TEXT NOT NULL CHECK (type IN ('room','table')),
  room_id              TEXT REFERENCES rooms(id) ON DELETE SET NULL,
  table_id             TEXT REFERENCES tables_(id) ON DELETE SET NULL,
  guest_name           TEXT NOT NULL,
  guest_phone          TEXT NOT NULL,
  guest_email          TEXT NOT NULL,
  checkin_date         TIMESTAMPTZ NOT NULL,
  checkout_date        TIMESTAMPTZ NOT NULL,
  num_guests           INT NOT NULL,
  nights               INT NOT NULL,
  subtotal             NUMERIC(10,2) NOT NULL,
  tax                  NUMERIC(10,2) NOT NULL,
  total_amount         NUMERIC(10,2) NOT NULL,
  status               TEXT DEFAULT 'pending_payment'
                         CHECK (status IN ('pending_payment','confirmed','checked_in','checked_out','cancelled')),
  payment_status       TEXT DEFAULT 'pending' CHECK (payment_status IN ('pending','paid','failed','refunded')),
  payment_method       TEXT,
  pesapal_tracking_id  TEXT,
  notes                TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  national_id          TEXT,
  source               TEXT DEFAULT 'online' CHECK (source IN ('online','walk_in')),
  session_id           TEXT
);
CREATE INDEX IF NOT EXISTS idx_room_dates  ON bookings (room_id, checkin_date, checkout_date);
CREATE INDEX IF NOT EXISTS idx_table_dates ON bookings (table_id, checkin_date, checkout_date);
CREATE INDEX IF NOT EXISTS idx_guest_email ON bookings (guest_email);

-- ── PAYMENTS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  payment_id  TEXT PRIMARY KEY,
  booking_id  TEXT NOT NULL REFERENCES bookings(booking_id) ON DELETE CASCADE,
  amount      NUMERIC(10,2) NOT NULL,
  currency    TEXT DEFAULT 'KES',
  method      TEXT,
  status      TEXT DEFAULT 'pending' CHECK (status IN ('pending','completed','failed','refunded')),
  tracking_id TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  national_id TEXT,
  guest_name  TEXT,
  source      TEXT DEFAULT 'online' CHECK (source IN ('online','walk_in'))
);
CREATE INDEX IF NOT EXISTS idx_payment_booking ON payments (booking_id);

-- ── NEWSLETTER ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS newsletter (
  id           TEXT PRIMARY KEY,
  email        TEXT NOT NULL UNIQUE,
  name         TEXT,
  subscribed   BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── ARCHIVE ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS archive (
  archived_id  TEXT PRIMARY KEY,
  source_sheet TEXT NOT NULL,
  data         JSONB NOT NULL,
  deleted_at   TIMESTAMPTZ DEFAULT NOW(),
  deleted_by   TEXT
);
CREATE INDEX IF NOT EXISTS idx_archive_source ON archive (source_sheet);

-- ── SAMPLE DATA ───────────────────────────────────────────────
INSERT INTO rooms (id, room_number, room_type, description, price_per_night, max_guests, has_ac, smoking, image_url, status) VALUES
  ('rm000000001a', '101', 'Deluxe',    'Spacious deluxe room with city view.',                5000,  2, TRUE, FALSE, 'https://images.unsplash.com/photo-1566665797739-1674de7a421a?w=800', 'available'),
  ('rm000000002b', '102', 'Executive', 'Executive room with lounge, desk and mini-bar.',       7000,  2, TRUE, FALSE, 'https://images.unsplash.com/photo-1590490360182-c33d57733427?w=800', 'available'),
  ('rm000000003c', '103', 'VIP Suite', 'VIP suite with jacuzzi and panoramic Nairobi views.', 10000,  4, TRUE, FALSE, 'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=800', 'available')
ON CONFLICT (id) DO NOTHING;

INSERT INTO tables_ (id, table_number, table_name, seats, location, price_per_hour, status) VALUES
  ('tb00000001a', 'T01', 'Garden Table 1', 2, 'Garden',    500,  'available'),
  ('tb00000002b', 'T02', 'Garden Table 2', 4, 'Garden',    800,  'available'),
  ('tb00000003c', 'T03', 'Main Hall A',    6, 'Main Hall', 1200, 'available')
ON CONFLICT (id) DO NOTHING;

-- ════════════════════════════════════════════════════════════
-- ADDED FOR: PesaPal pay-first flow, SystemOps (audit/sessions/
-- backups/incidents/jobs). If you already ran the earlier part of
-- this file on an existing Supabase project, run just this block.
-- ════════════════════════════════════════════════════════════

-- Replaces GAS's CacheService.put(sessionId, ..., 900) — a real table
-- survives server restarts, unlike an in-memory cache.
CREATE TABLE IF NOT EXISTS pending_sessions (
  session_id           TEXT PRIMARY KEY,
  data                 JSONB NOT NULL,
  pesapal_tracking_id  TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  expires_at           TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pending_sessions_expires ON pending_sessions (expires_at);

CREATE TABLE IF NOT EXISTS audit_log (
  audit_id     TEXT PRIMARY KEY,
  timestamp    TIMESTAMPTZ DEFAULT NOW(),
  user_email   TEXT DEFAULT 'system',
  user_role    TEXT DEFAULT 'system',
  action       TEXT NOT NULL,
  entity_type  TEXT,
  entity_id    TEXT,
  prev_value   JSONB,
  new_value    JSONB,
  ip_address   TEXT DEFAULT 'unknown',
  device       TEXT DEFAULT 'unknown',
  session_id   TEXT,
  status       TEXT DEFAULT 'success',
  severity     TEXT DEFAULT 'info'
);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action    ON audit_log (action);
CREATE INDEX IF NOT EXISTS idx_audit_email     ON audit_log (user_email);

CREATE TABLE IF NOT EXISTS sessions (
  session_id   TEXT PRIMARY KEY,
  user_id      TEXT REFERENCES users(user_id) ON DELETE CASCADE,
  user_email   TEXT,
  user_role    TEXT,
  login_at     TIMESTAMPTZ DEFAULT NOW(),
  last_active  TIMESTAMPTZ DEFAULT NOW(),
  logout_at    TIMESTAMPTZ,
  ip_address   TEXT DEFAULT 'unknown',
  device       TEXT DEFAULT 'unknown',
  status       TEXT DEFAULT 'active' CHECK (status IN ('active','ended')),
  token_hash   TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions (status, login_at);

-- Backups are written as local JSON files under /backups (Drive has no
-- Node equivalent) — this table is just the manifest.
CREATE TABLE IF NOT EXISTS backups (
  backup_id        TEXT PRIMARY KEY,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  created_by       TEXT,
  type             TEXT DEFAULT 'full',
  tables_included  TEXT,
  row_counts       JSONB,
  size_kb          INT,
  file_path        TEXT,
  status           TEXT DEFAULT 'complete',
  notes            TEXT
);

CREATE TABLE IF NOT EXISTS incidents (
  incident_id  TEXT PRIMARY KEY,
  opened_at    TIMESTAMPTZ DEFAULT NOW(),
  resolved_at  TIMESTAMPTZ,
  severity     TEXT CHECK (severity IN ('medium','high','critical')),
  service      TEXT DEFAULT 'manual',
  title        TEXT NOT NULL,
  description  TEXT,
  status       TEXT DEFAULT 'open' CHECK (status IN ('open','resolved')),
  opened_by    TEXT
);

CREATE TABLE IF NOT EXISTS job_log (
  log_id             TEXT PRIMARY KEY,
  job_name           TEXT NOT NULL,
  trigger_type       TEXT DEFAULT 'manual',
  started_at         TIMESTAMPTZ,
  finished_at        TIMESTAMPTZ DEFAULT NOW(),
  duration_ms        INT,
  status             TEXT DEFAULT 'success',
  records_processed  TEXT,
  error_message      TEXT
);
CREATE INDEX IF NOT EXISTS idx_job_log_name ON job_log (job_name, finished_at DESC);

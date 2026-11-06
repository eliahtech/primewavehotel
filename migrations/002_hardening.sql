-- 002_hardening.sql — run once in the Supabase SQL Editor AFTER schema.sql.
-- Safe to re-run (idempotent where Postgres allows).

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ── New columns ────────────────────────────────────────────────
ALTER TABLE users    ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings (user_id);

-- Emails are now compared exactly (lower-cased). Normalise legacy rows first.
-- If this fails on a unique violation you have two accounts differing only by case — merge them manually.
UPDATE users SET email = lower(trim(email)) WHERE email <> lower(trim(email));
UPDATE newsletter SET email = lower(trim(email)) WHERE email <> lower(trim(email));

-- ── Data integrity ────────────────────────────────────────────
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS chk_booking_dates;
ALTER TABLE bookings ADD CONSTRAINT chk_booking_dates CHECK (checkout_date > checkin_date);
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS chk_booking_target;
ALTER TABLE bookings ADD CONSTRAINT chk_booking_target
  CHECK ((type = 'room' AND room_id IS NOT NULL) OR (type = 'table' AND table_id IS NOT NULL) OR status = 'cancelled');

-- Idempotency: one booking per PesaPal session, one completed payment per tracking id
CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_session ON bookings (session_id) WHERE session_id IS NOT NULL AND session_id <> '';
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_tracking ON payments (tracking_id)
  WHERE status = 'completed' AND tracking_id IS NOT NULL AND tracking_id <> '';

-- THE double-booking fix: the database itself refuses overlapping active bookings.
-- Ranges are [checkin, checkout) so a same-day turnover is allowed.
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS no_room_overlap;
ALTER TABLE bookings ADD CONSTRAINT no_room_overlap EXCLUDE USING gist (
  room_id WITH =, tstzrange(checkin_date, checkout_date, '[)') WITH &&
) WHERE (room_id IS NOT NULL AND status IN ('pending_payment','confirmed','checked_in'));

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS no_table_overlap;
ALTER TABLE bookings ADD CONSTRAINT no_table_overlap EXCLUDE USING gist (
  table_id WITH =, tstzrange(checkin_date, checkout_date, '[)') WITH &&
) WHERE (table_id IS NOT NULL AND status IN ('pending_payment','confirmed','checked_in'));

-- ── Shared rate limiter (works across serverless instances) ───
CREATE TABLE IF NOT EXISTS rate_limits (
  key          TEXT PRIMARY KEY,
  count        INT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL
);

CREATE OR REPLACE FUNCTION rate_limit_hit(p_key TEXT, p_window_seconds INT, p_max INT)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE c INT;
BEGIN
  INSERT INTO rate_limits AS r (key, count, window_start) VALUES (p_key, 1, NOW())
  ON CONFLICT (key) DO UPDATE SET
    count = CASE WHEN r.window_start < NOW() - make_interval(secs => p_window_seconds) THEN 1 ELSE r.count + 1 END,
    window_start = CASE WHEN r.window_start < NOW() - make_interval(secs => p_window_seconds) THEN NOW() ELSE r.window_start END
  RETURNING r.count INTO c;
  RETURN c <= p_max;   -- TRUE = allowed
END $$;

-- ── Lock everything down: the browser must never touch tables directly ──
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['rooms','tables_','users','bookings','payments','newsletter','archive',
    'pending_sessions','audit_log','sessions','backups','incidents','job_log','rate_limits']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION rate_limit_hit(TEXT, INT, INT) FROM PUBLIC, anon, authenticated;

-- ── Housekeeping inside Postgres (replaces the in-process cron) ──
-- Enable pg_cron first: Dashboard → Database → Extensions → pg_cron.
-- Then run this block.
-- SELECT cron.schedule('pw-expire-sessions', '*/15 * * * *', $$DELETE FROM pending_sessions WHERE expires_at < NOW()$$);
-- SELECT cron.schedule('pw-expire-unpaid',   '*/15 * * * *', $$UPDATE bookings SET status='cancelled', notes=COALESCE(notes,'')||' | auto-cancelled (unpaid)' WHERE status='pending_payment' AND created_at < NOW() - INTERVAL '30 minutes'$$);
-- SELECT cron.schedule('pw-clean-ratelimit', '0 * * * *',    $$DELETE FROM rate_limits WHERE window_start < NOW() - INTERVAL '1 day'$$);

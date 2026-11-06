-- 003_news_and_settings.sql — run once in the Supabase SQL Editor (after 002).

-- News posts, written from the Admin / Owner / System Owner dashboards.
CREATE TABLE IF NOT EXISTS news (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  summary      TEXT NOT NULL DEFAULT '',
  body         TEXT NOT NULL,
  image_url    TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  pinned       BOOLEAN NOT NULL DEFAULT FALSE,
  author_id    TEXT,
  author_name  TEXT,
  author_role  TEXT,
  published_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_news_public ON news (status, pinned, published_at DESC);

-- Small key/value store for site-wide settings (social links today).
CREATE TABLE IF NOT EXISTS site_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The browser must never read these tables directly; the API does it with the service role.
ALTER TABLE news          ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_settings ENABLE ROW LEVEL SECURITY;

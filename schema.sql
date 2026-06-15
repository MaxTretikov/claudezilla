-- Claudezilla D1 Schema
--
-- This file is the source of truth for the claudezilla-emails D1 database
-- bindings in worker/wrangler.toml. Apply via:
--   wrangler d1 execute claudezilla-emails --file=../schema.sql

-- ─── Migration tracking ────────────────────────────────────────────────
-- Records every schema version applied so future migrations can detect
-- which steps already ran. Insert a row whenever a CREATE/ALTER ships.

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL,
  description TEXT NOT NULL
);

-- ─── v1: Email signups ─────────────────────────────────────────────────
-- "Notify me when Claudezilla launches" capture for the marketing site.

CREATE TABLE IF NOT EXISTS email_signups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  notified BOOLEAN DEFAULT 0
);

-- Note: the `email TEXT NOT NULL UNIQUE` constraint above already creates
-- an implicit unique index on email, so a separate `idx_email` index would
-- have been redundant. Only `idx_created_at` is worth keeping for the
-- "notify in bulk by signup date" query.
CREATE INDEX IF NOT EXISTS idx_created_at ON email_signups(created_at);

-- ─── v2: Donations (Stripe webhook) ────────────────────────────────────
-- Populated by the /webhook handler on `checkout.session.completed`.
-- stripe_event_id is unique so a Stripe redelivery (e.g. lost 200 ack)
-- inserts at most once.

CREATE TABLE IF NOT EXISTS donations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stripe_event_id TEXT NOT NULL UNIQUE,
  stripe_session_id TEXT NOT NULL,
  stripe_payment_intent TEXT,
  email TEXT,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  mode TEXT NOT NULL DEFAULT 'payment',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_donations_session ON donations(stripe_session_id);
CREATE INDEX IF NOT EXISTS idx_donations_email ON donations(email);
CREATE INDEX IF NOT EXISTS idx_donations_created_at ON donations(created_at);

-- ─── Migration log ─────────────────────────────────────────────────────
-- Record the versions this file represents. Each future schema change
-- bumps the version and appends a row here.

INSERT OR IGNORE INTO schema_version (version, applied_at, description) VALUES
  (1, unixepoch() * 1000, 'Initial email_signups table'),
  (2, unixepoch() * 1000, 'Add donations table for Stripe webhook receipts');

CREATE TABLE IF NOT EXISTS contacts (
  phone TEXT PRIMARY KEY,
  last_inbound INTEGER NOT NULL DEFAULT 0,
  inbound_version INTEGER NOT NULL DEFAULT 0,
  paused INTEGER NOT NULL DEFAULT 1 CHECK(paused=1)
);
CREATE TABLE IF NOT EXISTS events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  phone TEXT NOT NULL,
  wa_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  occurred_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  payload TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  inbound_version INTEGER NOT NULL,
  wa_id TEXT,
  error TEXT
);
CREATE INDEX IF NOT EXISTS drafts_phone_state ON drafts(phone,state);

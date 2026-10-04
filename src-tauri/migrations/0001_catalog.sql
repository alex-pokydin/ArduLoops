-- The catalog schema. Edit this file while it is still the only migration.
-- Startup folds a database that recorded the old split versions 1 through 6 into this file.
CREATE TABLE IF NOT EXISTS firmware_artifacts (
  artifact_id TEXT PRIMARY KEY,
  build_id TEXT,
  vehicle_id TEXT NOT NULL,
  board_name TEXT,
  board_id INTEGER NOT NULL,
  version_id TEXT,
  git_identity TEXT,
  image_size INTEGER,
  description TEXT,
  file_path TEXT,
  features_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  comment TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS controllers (
  controller_key TEXT PRIMARY KEY,
  board_id INTEGER NOT NULL,
  vehicle_id TEXT NOT NULL,
  system_id INTEGER NOT NULL,
  component_id INTEGER NOT NULL,
  vendor_id INTEGER,
  product_id INTEGER,
  uid TEXT,
  flight_version INTEGER,
  git_identity TEXT,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  comment TEXT NOT NULL DEFAULT '',
  flashed_artifact_id TEXT
);
CREATE TABLE IF NOT EXISTS controller_seen (
  id INTEGER PRIMARY KEY,
  controller_key TEXT NOT NULL REFERENCES controllers(controller_key),
  seen_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_provider (
  provider TEXT PRIMARY KEY,
  active INTEGER NOT NULL DEFAULT 0,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  storage TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_chat (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  vehicle_key TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS ai_message (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  role TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_proposal (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  status TEXT NOT NULL,
  param TEXT NOT NULL,
  old_value REAL,
  new_value REAL NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'param',
  payload TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS ai_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  result TEXT NOT NULL,
  source TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS ai_bench (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  until_ms INTEGER NOT NULL,
  params TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_message_chat ON ai_message(chat_id, id);
CREATE INDEX IF NOT EXISTS ai_audit_at ON ai_audit(at);
CREATE TABLE IF NOT EXISTS param_cache (
  vehicle_key TEXT NOT NULL,
  name TEXT NOT NULL,
  value REAL NOT NULL,
  saved_at INTEGER NOT NULL,
  PRIMARY KEY (vehicle_key, name)
);
CREATE TABLE IF NOT EXISTS param_cache_meta (
  vehicle_key TEXT PRIMARY KEY,
  frame TEXT NOT NULL,
  board_name TEXT NOT NULL,
  boot_uid TEXT NOT NULL,
  saved_at INTEGER NOT NULL,
  count INTEGER NOT NULL
);

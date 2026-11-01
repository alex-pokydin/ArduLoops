-- The user's star and note on a log, keyed by the hash of the file contents (sha256, first 16 hex),
-- so they survive a rename or a move and a log downloaded twice shares one note.
-- board, onboard_id and bytes are kept for display and for matching a board log before it is saved.
CREATE TABLE IF NOT EXISTS log_notes (
  hash TEXT PRIMARY KEY,
  board TEXT NOT NULL DEFAULT '',
  onboard_id INTEGER,
  bytes INTEGER NOT NULL DEFAULT 0,
  star INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);

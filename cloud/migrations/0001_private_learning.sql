CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  auth_epoch TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS login_limits (
  bucket TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
-- Append-only history gives retries, deletions and incremental pulls one identity.
CREATE TABLE IF NOT EXISTS changes (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('note', 'practice')),
  id TEXT NOT NULL,
  version INTEGER NOT NULL,
  operation_id TEXT NOT NULL UNIQUE,
  data TEXT,
  deleted INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  UNIQUE(kind, id, version)
);
CREATE INDEX IF NOT EXISTS changes_identity ON changes(kind, id, seq DESC);

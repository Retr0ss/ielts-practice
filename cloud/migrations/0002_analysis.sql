CREATE TABLE IF NOT EXISTS analysis_requests (
  request_id TEXT PRIMARY KEY,
  cache_key TEXT NOT NULL,
  day TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','complete','failed')),
  result_json TEXT,
  error_code TEXT,
  created_ms INTEGER NOT NULL,
  finished_ms INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS analysis_pending ON analysis_requests(cache_key) WHERE status='pending';
CREATE INDEX IF NOT EXISTS analysis_cache ON analysis_requests(cache_key,status,finished_ms DESC);
CREATE INDEX IF NOT EXISTS analysis_daily ON analysis_requests(day);

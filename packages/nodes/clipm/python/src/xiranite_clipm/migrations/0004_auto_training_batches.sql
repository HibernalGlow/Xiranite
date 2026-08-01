BEGIN IMMEDIATE;

CREATE TABLE auto_training_batches (
  batch_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('automatic', 'manual')),
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'cancelled')),
  requested_batch_size INTEGER NOT NULL CHECK (requested_batch_size >= 1),
  feedback_work_count INTEGER NOT NULL CHECK (feedback_work_count >= 1),
  training_run_id TEXT REFERENCES training_runs(run_id),
  created_at TEXT NOT NULL,
  finished_at TEXT,
  error_message TEXT
) STRICT;

CREATE TABLE auto_training_batch_feedback (
  batch_id TEXT NOT NULL REFERENCES auto_training_batches(batch_id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES feedback_events(event_id) ON DELETE CASCADE,
  work_id TEXT NOT NULL REFERENCES works(work_id) ON DELETE CASCADE,
  PRIMARY KEY(batch_id, event_id),
  UNIQUE(event_id)
) WITHOUT ROWID, STRICT;

CREATE INDEX auto_training_batches_by_status
ON auto_training_batches(status, created_at);

INSERT INTO schema_migrations(version, applied_at)
VALUES (4, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

PRAGMA user_version = 4;
COMMIT;

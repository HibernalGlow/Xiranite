BEGIN IMMEDIATE;

CREATE TABLE perceptual_calibration_runs (
  run_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('running', 'accepted', 'rejected', 'failed', 'cancelled')),
  requested_max_works INTEGER NOT NULL CHECK(requested_max_works >= 12),
  evidence_work_count INTEGER NOT NULL DEFAULT 0 CHECK(evidence_work_count >= 0),
  evaluated_work_count INTEGER NOT NULL DEFAULT 0 CHECK(evaluated_work_count >= 0),
  positive_sample_count INTEGER NOT NULL DEFAULT 0 CHECK(positive_sample_count >= 0),
  negative_sample_count INTEGER NOT NULL DEFAULT 0 CHECK(negative_sample_count >= 0),
  positive_recall REAL CHECK(positive_recall >= 0 AND positive_recall <= 1),
  negative_ceiling REAL CHECK(negative_ceiling >= -1 AND negative_ceiling <= 1),
  threshold REAL CHECK(threshold >= -1 AND threshold <= 1),
  safety_margin REAL NOT NULL CHECK(safety_margin > 0 AND safety_margin < 1),
  metrics_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT NOT NULL,
  completed_at TEXT,
  error_message TEXT
) STRICT;

CREATE TABLE perceptual_recovery_policy (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  calibration_run_id TEXT NOT NULL REFERENCES perceptual_calibration_runs(run_id),
  enabled INTEGER NOT NULL CHECK(enabled IN (0, 1)),
  threshold REAL NOT NULL CHECK(threshold >= -1 AND threshold <= 1),
  method TEXT NOT NULL,
  calibrated_at TEXT NOT NULL
) STRICT;

INSERT INTO schema_migrations(version, applied_at)
VALUES (7, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

PRAGMA user_version = 7;
COMMIT;

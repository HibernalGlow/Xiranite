BEGIN IMMEDIATE;

CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
) STRICT;

CREATE TABLE works (
  record_number INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id TEXT NOT NULL UNIQUE,
  short_code TEXT NOT NULL UNIQUE COLLATE BINARY,
  first_seen_name TEXT NOT NULL,
  current_base_name TEXT NOT NULL,
  name_revision INTEGER NOT NULL DEFAULT 0 CHECK (name_revision >= 0),
  current_label TEXT CHECK (current_label IN ('P', 'N')),
  current_score INTEGER CHECK (current_score BETWEEN 0 AND 1000),
  active_bundle_version INTEGER CHECK (active_bundle_version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE work_locations (
  location_id INTEGER PRIMARY KEY,
  work_id TEXT NOT NULL REFERENCES works(work_id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  path_key TEXT NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0, 1)),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  removed_at TEXT,
  UNIQUE(work_id, path_key)
) STRICT;

CREATE UNIQUE INDEX one_current_location_per_work
ON work_locations(work_id) WHERE is_current = 1;

CREATE UNIQUE INDEX one_current_work_per_path
ON work_locations(path_key) WHERE is_current = 1;

CREATE TABLE work_names (
  name_id INTEGER PRIMARY KEY,
  work_id TEXT NOT NULL REFERENCES works(work_id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  name TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('model', 'filename', 'gui', 'neoview', 'json')),
  changed_at TEXT NOT NULL,
  UNIQUE(work_id, revision)
) STRICT;

CREATE TABLE embeddings (
  work_id TEXT NOT NULL REFERENCES works(work_id) ON DELETE CASCADE,
  encoder TEXT NOT NULL,
  preprocess TEXT NOT NULL,
  dtype TEXT NOT NULL CHECK (dtype = 'float16'),
  dimension INTEGER NOT NULL CHECK (dimension = 768),
  data BLOB NOT NULL CHECK (length(data) = 1536),
  created_at TEXT NOT NULL,
  PRIMARY KEY(work_id, encoder, preprocess)
) WITHOUT ROWID, STRICT;

CREATE TABLE score_snapshots (
  snapshot_id INTEGER PRIMARY KEY,
  work_id TEXT NOT NULL REFERENCES works(work_id) ON DELETE CASCADE,
  bundle_version INTEGER NOT NULL CHECK (bundle_version >= 1),
  predicted_label TEXT NOT NULL CHECK (predicted_label IN ('P', 'N')),
  predicted_score INTEGER NOT NULL CHECK (predicted_score BETWEEN 0 AND 1000),
  probability REAL CHECK (probability BETWEEN 0.0 AND 1.0),
  scored_at TEXT NOT NULL
) STRICT;

CREATE INDEX score_snapshots_by_work ON score_snapshots(work_id, scored_at DESC);

CREATE TABLE feedback_events (
  event_id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL REFERENCES works(work_id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('filename', 'gui', 'neoview')),
  classification_before TEXT CHECK (classification_before IN ('P', 'N')),
  classification_after TEXT CHECK (classification_after IN ('P', 'N')),
  ranking_before INTEGER CHECK (ranking_before BETWEEN 0 AND 1000),
  ranking_after INTEGER CHECK (ranking_after BETWEEN 0 AND 1000),
  occurred_at TEXT NOT NULL,
  undone_by TEXT REFERENCES feedback_events(event_id),
  CHECK (
    (classification_before IS NOT NULL AND classification_after IS NOT NULL)
    OR (ranking_before IS NOT NULL AND ranking_after IS NOT NULL)
  ),
  CHECK ((classification_before IS NULL) = (classification_after IS NULL)),
  CHECK ((ranking_before IS NULL) = (ranking_after IS NULL))
) STRICT;

CREATE INDEX feedback_events_by_work ON feedback_events(work_id, occurred_at DESC);

CREATE TABLE review_queue (
  review_id TEXT PRIMARY KEY,
  work_id TEXT REFERENCES works(work_id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('invalid_suffix', 'identity_conflict', 'short_code_conflict', 'recovery_candidate')),
  path TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved')),
  resolution TEXT CHECK (resolution IN ('use_filename', 'use_json', 'link_existing', 'new_work')),
  created_at TEXT NOT NULL,
  resolved_at TEXT
) STRICT;

CREATE INDEX pending_review_items ON review_queue(created_at) WHERE status = 'pending';

CREATE TABLE data_revisions (
  revision INTEGER PRIMARY KEY AUTOINCREMENT,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE training_runs (
  run_id TEXT PRIMARY KEY,
  data_revision INTEGER NOT NULL REFERENCES data_revisions(revision),
  config_json TEXT NOT NULL CHECK (json_valid(config_json)),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  started_at TEXT,
  finished_at TEXT,
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  error_message TEXT
) STRICT;

CREATE TABLE model_bundles (
  bundle_version INTEGER PRIMARY KEY CHECK (bundle_version >= 1),
  status TEXT NOT NULL CHECK (status IN ('candidate', 'active', 'inactive', 'failed')),
  manifest_path TEXT NOT NULL,
  weights_path TEXT NOT NULL,
  metrics_json TEXT NOT NULL CHECK (json_valid(metrics_json)),
  data_revision INTEGER NOT NULL REFERENCES data_revisions(revision),
  created_at TEXT NOT NULL,
  activated_at TEXT,
  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1))
) STRICT;

CREATE UNIQUE INDEX one_active_model_bundle
ON model_bundles(status) WHERE status = 'active';

INSERT INTO schema_migrations(version, applied_at)
VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

PRAGMA user_version = 1;
COMMIT;

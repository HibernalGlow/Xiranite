BEGIN IMMEDIATE;

ALTER TABLE score_snapshots
ADD COLUMN baseline_score INTEGER CHECK (baseline_score BETWEEN 0 AND 1000);

UPDATE score_snapshots
SET baseline_score = CASE
  WHEN probability IS NULL THEN predicted_score
  ELSE MIN(1000, MAX(0, CAST(ROUND(probability * 1000) AS INTEGER)))
END;

CREATE TRIGGER score_snapshot_baseline_required_on_insert
BEFORE INSERT ON score_snapshots
WHEN NEW.baseline_score IS NULL
BEGIN
  SELECT RAISE(ABORT, 'score_snapshots.baseline_score is required');
END;

CREATE TRIGGER score_snapshot_baseline_required_on_update
BEFORE UPDATE OF baseline_score ON score_snapshots
WHEN NEW.baseline_score IS NULL
BEGIN
  SELECT RAISE(ABORT, 'score_snapshots.baseline_score is required');
END;

INSERT INTO schema_migrations(version, applied_at)
VALUES (3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

PRAGMA user_version = 3;
COMMIT;

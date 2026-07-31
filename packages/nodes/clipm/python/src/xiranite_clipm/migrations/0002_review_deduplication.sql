BEGIN IMMEDIATE;

CREATE UNIQUE INDEX pending_review_deduplication
ON review_queue(kind, path, payload_json)
WHERE status = 'pending';

INSERT INTO schema_migrations(version, applied_at)
VALUES (2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

PRAGMA user_version = 2;
COMMIT;

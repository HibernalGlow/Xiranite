BEGIN IMMEDIATE;

CREATE TABLE content_evidence (
  work_id TEXT NOT NULL REFERENCES works(work_id) ON DELETE CASCADE,
  evidence_kind TEXT NOT NULL CHECK (evidence_kind = 'sampled_pixel_sha256'),
  digest TEXT NOT NULL CHECK (length(digest) = 64),
  page_count INTEGER NOT NULL CHECK (page_count >= 1),
  sampled_page_count INTEGER NOT NULL CHECK (sampled_page_count >= 1),
  created_at TEXT NOT NULL,
  PRIMARY KEY(work_id, evidence_kind)
) WITHOUT ROWID, STRICT;

CREATE INDEX content_evidence_by_digest
ON content_evidence(evidence_kind, digest);

INSERT INTO schema_migrations(version, applied_at)
VALUES (5, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

PRAGMA user_version = 5;
COMMIT;

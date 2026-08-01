BEGIN IMMEDIATE;

CREATE TABLE page_embeddings (
  work_id TEXT NOT NULL REFERENCES works(work_id) ON DELETE CASCADE,
  encoder TEXT NOT NULL,
  preprocess TEXT NOT NULL,
  page_index INTEGER NOT NULL CHECK(page_index >= 0),
  source_name TEXT NOT NULL,
  dtype TEXT NOT NULL CHECK(dtype = 'float16'),
  dimension INTEGER NOT NULL CHECK(dimension = 768),
  data BLOB NOT NULL CHECK(length(data) = 1536),
  created_at TEXT NOT NULL,
  PRIMARY KEY(work_id, encoder, preprocess, page_index)
) WITHOUT ROWID, STRICT;

CREATE TABLE perceptual_similarity_observations (
  work_id TEXT NOT NULL REFERENCES works(work_id) ON DELETE CASCADE,
  candidate_work_id TEXT NOT NULL REFERENCES works(work_id) ON DELETE CASCADE,
  encoder TEXT NOT NULL,
  preprocess TEXT NOT NULL,
  mean_similarity REAL NOT NULL CHECK(mean_similarity >= -1 AND mean_similarity <= 1),
  matched_page_count INTEGER NOT NULL CHECK(matched_page_count >= 3),
  query_page_count INTEGER NOT NULL CHECK(query_page_count >= matched_page_count),
  candidate_page_count INTEGER NOT NULL CHECK(candidate_page_count >= matched_page_count),
  pairings_json TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  PRIMARY KEY(work_id, candidate_work_id, encoder, preprocess),
  CHECK(work_id != candidate_work_id)
) WITHOUT ROWID, STRICT;

CREATE INDEX perceptual_similarity_observations_similarity_idx
  ON perceptual_similarity_observations(mean_similarity DESC, observed_at DESC);

INSERT INTO schema_migrations(version, applied_at)
VALUES (6, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

PRAGMA user_version = 6;
COMMIT;

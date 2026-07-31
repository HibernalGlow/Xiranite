from __future__ import annotations

import base64
from datetime import datetime, timezone
import os
from pathlib import Path
import sqlite3
from uuid import UUID

from .contracts import (
    ArchiveSnapshot,
    ClassificationSnapshot,
    CmLabel,
    CmScoreDocument,
    EmbeddingPayload,
    FeedbackHistoryEntry,
    NameHistoryEntry,
    RankingSnapshot,
    ScoreSnapshot,
    ValueSource,
    WorkIdentity,
)
from .filename import strip_cm_tag
from .short_codes import decode_canonical_short_code, encode_record_number


class MetadataRepositoryError(RuntimeError):
    pass


class IdentityConflictError(MetadataRepositoryError):
    pass


def normalized_path_key(path: Path) -> str:
    return os.path.normcase(str(path.resolve())).casefold()


def build_score_document(
    connection: sqlite3.Connection,
    work_id: str | UUID,
    archive: ArchiveSnapshot,
) -> CmScoreDocument:
    work_id_text = str(work_id)
    work = connection.execute(
        """SELECT record_number, work_id, short_code, first_seen_name, current_base_name,
                  name_revision, current_label, current_score, active_bundle_version
           FROM works WHERE work_id = ?""",
        (work_id_text,),
    ).fetchone()
    if work is None:
        raise KeyError(f"Unknown ClipM work: {work_id_text}")
    score = connection.execute(
        """SELECT bundle_version, predicted_label, predicted_score, probability, scored_at
           FROM score_snapshots WHERE work_id = ? ORDER BY snapshot_id DESC LIMIT 1""",
        (work_id_text,),
    ).fetchone()
    embedding = connection.execute(
        """SELECT encoder, preprocess, dtype, dimension, data
           FROM embeddings WHERE work_id = ?
           ORDER BY created_at DESC LIMIT 1""",
        (work_id_text,),
    ).fetchone()
    if score is None or embedding is None:
        raise MetadataRepositoryError(f"Work {work_id_text} has no complete score and embedding snapshot")
    if work["current_label"] is None or work["current_score"] is None:
        raise MetadataRepositoryError(f"Work {work_id_text} has no current score")

    name_rows = connection.execute(
        """SELECT revision, name, source, changed_at FROM work_names
           WHERE work_id = ? ORDER BY revision""",
        (work_id_text,),
    ).fetchall()
    if not name_rows or int(name_rows[0]["revision"]) != 0:
        raise MetadataRepositoryError(f"Work {work_id_text} has no revision zero name")
    expected_revisions = list(range(int(work["name_revision"]) + 1))
    actual_revisions = [int(row["revision"]) for row in name_rows]
    if actual_revisions != expected_revisions or name_rows[-1]["name"] != work["current_base_name"]:
        raise MetadataRepositoryError(f"Work {work_id_text} name history is inconsistent")
    name_history = [
        NameHistoryEntry(
            revision=int(current["revision"]),
            previous_name=str(previous["name"]),
            current_name=str(current["name"]),
            changed_at=str(current["changed_at"]),
            source=ValueSource(str(current["source"])),
        )
        for previous, current in zip(name_rows, name_rows[1:], strict=False)
    ]

    feedback_rows = connection.execute(
        """SELECT event_id, source, classification_before, classification_after,
                  ranking_before, ranking_after, occurred_at, undone_by
           FROM feedback_events WHERE work_id = ? ORDER BY occurred_at, event_id""",
        (work_id_text,),
    ).fetchall()
    feedback_history = [FeedbackHistoryEntry.model_validate(dict(row)) for row in feedback_rows]
    classification_source = _current_feedback_source(connection, work_id_text, "classification_after")
    ranking_source = _current_feedback_source(connection, work_id_text, "ranking_after")

    if int(embedding["dimension"]) != 768 or str(embedding["dtype"]) != "float16":
        raise MetadataRepositoryError(f"Work {work_id_text} has an incompatible embedding")
    return CmScoreDocument(
        schema_version=1,
        work=WorkIdentity(
            work_id=work_id_text,
            record_number=int(work["record_number"]),
            short_code=str(work["short_code"]),
            first_seen_name=str(work["first_seen_name"]),
            current_base_name=str(work["current_base_name"]),
            name_revision=int(work["name_revision"]),
        ),
        score=ScoreSnapshot(
            bundle_version=int(score["bundle_version"]),
            classification=ClassificationSnapshot(
                predicted=CmLabel(str(score["predicted_label"])),
                current=CmLabel(str(work["current_label"])),
                source=classification_source,
            ),
            ranking=RankingSnapshot(
                predicted=int(score["predicted_score"]),
                current=int(work["current_score"]),
                source=ranking_source,
            ),
            probability=float(score["probability"]) if score["probability"] is not None else None,
            scored_at=str(score["scored_at"]),
        ),
        embedding=EmbeddingPayload(
            encoder=str(embedding["encoder"]),
            preprocess=str(embedding["preprocess"]),
            dtype=str(embedding["dtype"]),
            shape=[int(embedding["dimension"])],
            encoding="base64",
            data=base64.b64encode(bytes(embedding["data"])).decode("ascii"),
        ),
        archive=archive,
        name_history=name_history,
        feedback_history=feedback_history,
    )


def recover_work_from_document(
    connection: sqlite3.Connection,
    path: Path,
    document: CmScoreDocument,
) -> str:
    resolved = path.resolve(strict=True)
    _validate_document_identity(document)
    work_id = str(document.work.work_id)
    path_text = str(resolved)
    path_key = normalized_path_key(resolved)
    now = datetime.now(timezone.utc).isoformat()
    created_at = document.score.scored_at.isoformat()
    actual_name = strip_cm_tag(resolved.name)
    name_revision = document.work.name_revision
    current_name = document.work.current_base_name
    connection.execute("BEGIN IMMEDIATE")
    try:
        identity_rows = connection.execute(
            """SELECT work_id, record_number, short_code FROM works
               WHERE work_id = ? OR record_number = ? OR short_code = ?""",
            (work_id, document.work.record_number, document.work.short_code),
        ).fetchall()
        location = connection.execute(
            """SELECT work_id FROM work_locations
               WHERE path_key = ? AND is_current = 1""",
            (path_key,),
        ).fetchone()
        if identity_rows or location is not None:
            raise IdentityConflictError(
                f"ClipM JSON identity or path is already present; identityRows={len(identity_rows)}, "
                f"pathWork={location['work_id'] if location else None}"
            )
        if actual_name != current_name:
            name_revision += 1
            current_name = actual_name
        connection.execute(
            """INSERT INTO works(
                record_number, work_id, short_code, first_seen_name, current_base_name,
                name_revision, current_label, current_score, active_bundle_version, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                document.work.record_number,
                work_id,
                document.work.short_code,
                document.work.first_seen_name,
                current_name,
                name_revision,
                document.score.classification.current.value,
                document.score.ranking.current,
                document.score.bundle_version,
                created_at,
                now,
            ),
        )
        connection.execute(
            """INSERT INTO work_locations(work_id, path, path_key, first_seen_at, last_seen_at)
               VALUES (?, ?, ?, ?, ?)""",
            (work_id, path_text, path_key, now, now),
        )
        connection.execute(
            """INSERT INTO work_names(work_id, revision, name, source, changed_at)
               VALUES (?, 0, ?, 'json', ?)""",
            (work_id, document.work.first_seen_name, created_at),
        )
        for entry in document.name_history:
            connection.execute(
                """INSERT INTO work_names(work_id, revision, name, source, changed_at)
                   VALUES (?, ?, ?, ?, ?)""",
                (work_id, entry.revision, entry.current_name, entry.source.value, entry.changed_at.isoformat()),
            )
        if actual_name != document.work.current_base_name:
            connection.execute(
                """INSERT INTO work_names(work_id, revision, name, source, changed_at)
                   VALUES (?, ?, ?, 'filename', ?)""",
                (work_id, name_revision, actual_name, now),
            )
        embedding_data = base64.b64decode(document.embedding.data, validate=True)
        connection.execute(
            """INSERT INTO embeddings(work_id, encoder, preprocess, dtype, dimension, data, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                work_id,
                document.embedding.encoder,
                document.embedding.preprocess,
                document.embedding.dtype,
                document.embedding.shape[0],
                embedding_data,
                created_at,
            ),
        )
        connection.execute(
            """INSERT INTO score_snapshots(
                work_id, bundle_version, predicted_label, predicted_score, probability, scored_at
            ) VALUES (?, ?, ?, ?, ?, ?)""",
            (
                work_id,
                document.score.bundle_version,
                document.score.classification.predicted.value,
                document.score.ranking.predicted,
                document.score.probability,
                created_at,
            ),
        )
        for entry in document.feedback_history:
            connection.execute(
                """INSERT INTO feedback_events(
                    event_id, work_id, source, classification_before, classification_after,
                    ranking_before, ranking_after, occurred_at, undone_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)""",
                (
                    str(entry.event_id),
                    work_id,
                    entry.source.value,
                    entry.classification_before.value if entry.classification_before else None,
                    entry.classification_after.value if entry.classification_after else None,
                    entry.ranking_before,
                    entry.ranking_after,
                    entry.occurred_at.isoformat(),
                ),
            )
        for entry in document.feedback_history:
            if entry.undone_by is not None:
                connection.execute(
                    "UPDATE feedback_events SET undone_by = ? WHERE event_id = ?",
                    (str(entry.undone_by), str(entry.event_id)),
                )
        if document.feedback_history:
            connection.execute(
                "INSERT INTO data_revisions(reason, created_at) VALUES (?, ?)",
                (f"json-recovery-feedback:{work_id}", now),
            )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    return work_id


def _validate_document_identity(document: CmScoreDocument) -> None:
    decoded = decode_canonical_short_code(document.work.short_code)
    if decoded != document.work.record_number or encode_record_number(document.work.record_number) != document.work.short_code:
        raise IdentityConflictError("ClipM JSON recordNumber and shortCode are not a canonical pair")


def _current_feedback_source(connection: sqlite3.Connection, work_id: str, field: str) -> ValueSource:
    if field not in {"classification_after", "ranking_after"}:
        raise ValueError(f"Unsupported feedback field: {field}")
    row = connection.execute(
        f"""SELECT source FROM feedback_events
            WHERE work_id = ? AND {field} IS NOT NULL AND undone_by IS NULL
            ORDER BY occurred_at DESC, event_id DESC LIMIT 1""",
        (work_id,),
    ).fetchone()
    return ValueSource(str(row["source"])) if row is not None else ValueSource.MODEL

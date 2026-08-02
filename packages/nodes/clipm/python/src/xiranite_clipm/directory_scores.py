from __future__ import annotations

import os
from pathlib import Path
import sqlite3
from typing import Iterator

from .contracts import CmLabel, DirectoryScoreResult, DirectoryScoresResult, WorkScoreResult


def get_directory_scores(
    connection: sqlite3.Connection,
    directory_paths: list[str],
    active_bundle_version: int | None,
) -> DirectoryScoresResult:
    directories = [_absolute_directory(path) for path in directory_paths]
    directory_entries = [(directory, _resolved_path_key(directory)) for directory in directories]
    directory_keys = {directory_key for _, directory_key in directory_entries}
    rows = connection.execute(
        """SELECT works.work_id, works.short_code, works.current_label, works.current_score,
                  locations.path, snapshots.bundle_version, snapshots.predicted_label,
                  snapshots.predicted_score, snapshots.probability,
                  EXISTS(
                    SELECT 1 FROM feedback_events classification_feedback
                    WHERE classification_feedback.work_id = works.work_id
                      AND classification_feedback.classification_after IS NOT NULL
                      AND classification_feedback.undone_by IS NULL
                  ) AS classification_corrected,
                  EXISTS(
                    SELECT 1 FROM feedback_events ranking_feedback
                    WHERE ranking_feedback.work_id = works.work_id
                      AND ranking_feedback.ranking_after IS NOT NULL
                      AND ranking_feedback.undone_by IS NULL
                  ) AS ranking_corrected
           FROM works
           JOIN work_locations locations
             ON locations.work_id = works.work_id AND locations.is_current = 1
           JOIN score_snapshots snapshots ON snapshots.snapshot_id = (
             SELECT snapshot_id FROM score_snapshots latest
             WHERE latest.work_id = works.work_id ORDER BY snapshot_id DESC LIMIT 1
           )
           WHERE works.current_label IS NOT NULL AND works.current_score IS NOT NULL"""
    ).fetchall()
    winners = _best_descendants(rows, directory_keys)
    return DirectoryScoresResult(
        directories=[
            DirectoryScoreResult(
                directory_path=str(directory),
                work=(
                    _work_score(winners[directory_key], active_bundle_version)
                    if directory_key in winners
                    else None
                ),
            )
            for directory, directory_key in directory_entries
        ]
    )


def _absolute_directory(value: str) -> Path:
    path = Path(value)
    if not path.is_absolute():
        raise ValueError("ClipM directory score paths must be absolute")
    return path.resolve(strict=False)


def _path_key(path: Path) -> str:
    return _resolved_path_key(path.resolve(strict=False))


def _resolved_path_key(path: Path) -> str:
    return os.path.normcase(str(path)).casefold().rstrip("\\/")


def _best_descendants(
    rows: list[sqlite3.Row],
    directory_keys: set[str],
) -> dict[str, sqlite3.Row]:
    winners: dict[str, sqlite3.Row] = {}
    for row in rows:
        candidate_sort_key = _row_sort_key(row)
        for ancestor_key in _ancestor_directory_keys(Path(str(row["path"]))):
            if ancestor_key not in directory_keys:
                continue
            previous = winners.get(ancestor_key)
            if previous is None or candidate_sort_key < _row_sort_key(previous):
                winners[ancestor_key] = row
    return winners


def _ancestor_directory_keys(path: Path) -> Iterator[str]:
    current = path.resolve(strict=False).parent
    while True:
        yield _resolved_path_key(current)
        parent = current.parent
        if parent == current:
            return
        current = parent


def _row_sort_key(row: sqlite3.Row) -> tuple[int, str]:
    return (-int(row["current_score"]), str(row["path"]).casefold())


def _work_score(row: sqlite3.Row, active_bundle_version: int | None) -> WorkScoreResult:
    bundle_version = int(row["bundle_version"])
    return WorkScoreResult(
        work_id=str(row["work_id"]),
        path=str(row["path"]),
        label=CmLabel(str(row["current_label"])),
        score=int(row["current_score"]),
        predicted_label=CmLabel(str(row["predicted_label"])),
        predicted_score=int(row["predicted_score"]),
        classification_corrected=bool(row["classification_corrected"]),
        ranking_corrected=bool(row["ranking_corrected"]),
        probability=float(row["probability"]) if row["probability"] is not None else None,
        bundle_version=bundle_version,
        short_code=str(row["short_code"]),
        stale=active_bundle_version is not None and bundle_version != active_bundle_version,
    )

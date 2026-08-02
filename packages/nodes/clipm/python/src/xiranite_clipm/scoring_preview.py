from __future__ import annotations

from hashlib import blake2s
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5

from .contracts import CmLabel, ScoreOptions, WorkScoreResult
from .filename import CmFilenameTag, scored_path


PREVIEW_SHORT_CODE = "PREV"


def preview_score_work(
    path: Path,
    options: ScoreOptions,
    active_bundle_version: int | None,
) -> WorkScoreResult:
    source = path.resolve(strict=True)
    identity_key = str(source).casefold()
    digest = blake2s(identity_key.encode("utf-8"), digest_size=8).digest()
    label = CmLabel.POSITIVE if digest[0] % 2 == 0 else CmLabel.NEGATIVE
    score = int.from_bytes(digest[1:3], "big") % 1001
    bundle_version = active_bundle_version or 1
    proposed_path = str(source)
    if options.rename:
        proposed_path = scored_path(
            proposed_path,
            CmFilenameTag(bundle_version, label, score, PREVIEW_SHORT_CODE),
        )
    return WorkScoreResult(
        work_id=uuid5(NAMESPACE_URL, f"xiranite:clipm:preview:{identity_key}"),
        path=proposed_path,
        source_path=str(source),
        label=label,
        score=score,
        predicted_label=label,
        predicted_score=score,
        bundle_version=bundle_version,
        short_code=PREVIEW_SHORT_CODE,
        simulated=True,
        planned_rename=proposed_path != str(source),
        planned_metadata_write=options.write_metadata,
    )

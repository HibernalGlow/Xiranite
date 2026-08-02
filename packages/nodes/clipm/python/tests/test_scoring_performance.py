from pathlib import Path

from xiranite_clipm.scoring_performance import (
    ScoringPerformanceController,
    ScoringPerformanceLimits,
)


def test_reloads_limits_and_retains_last_valid_config(tmp_path: Path) -> None:
    config = tmp_path / "xiranite.config.toml"
    controller = ScoringPerformanceController(ScoringPerformanceLimits(), config)
    config.write_text(
        """[nodes.clipm]
scoring_work_batch_size = 2
scoring_page_batch_size = 8
scoring_batch_pause_ms = 250
""",
        encoding="utf-8",
    )

    assert controller.current() == ScoringPerformanceLimits(2, 8, 250)

    config.write_text("[nodes.clipm\n", encoding="utf-8")
    assert controller.current() == ScoringPerformanceLimits(2, 8, 250)

    config.write_text(
        """[nodes.clipm]
scoring_work_batch_size = 1
scoring_page_batch_size = 4
scoring_batch_pause_ms = 500
""",
        encoding="utf-8",
    )
    assert controller.current() == ScoringPerformanceLimits(1, 4, 500)

# SerieX TUI visual review

## References

- GUI comparison sheet: `output/playwright/seriex/seriex-reference-review.jpg`
- OpenTUI PTY capture: `artifacts/cli/seriex/constellation-archive.png`

## Layout and component mapping

The GUI series scan, cluster cards, and execution card are represented as a constellation workbench: the series map lists detected clusters, the file orbit keeps their member files visible, and execution telemetry combines move counts, recent events, and progress. Shared termcn-derived action tabs, fields, numeric input, switches, panels, execution actions, and progress components provide the interaction layer.

The 120-column capture verifies that the similarity input retains its configured default of `75`, dry run starts enabled, and the shared top-bar controls remain available. Undefined node configuration values are filtered before merging so they cannot erase schema defaults.

## Identity, motion, and safety

- Unicode symbols distinguish cluster planning, execution, apply, series, files, success, and failure without requiring Nerd Font.
- A restrained four-frame orbital pulse accelerates while clustering and slows while idle.
- `execute` and `apply` with dry run disabled require a second confirmation before file moves.
- `pipe`, `gd` (`guided` compatibility alias), and `ui` share the central interaction router.
- CLI preferences persist under `nodes.seriex.cli`.


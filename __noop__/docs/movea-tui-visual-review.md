# MoveA TUI visual review

## References

- GUI comparison sheet: `output/playwright/movea/movea-reference-review.jpg`
- OpenTUI PTY capture: `artifacts/cli/movea/route-radar.png`

## Mapping

The GUI scan statistics and route table become a route radar workbench. Directory radar shows first-level folders and movable contents, route matrix keeps source-to-target decisions visible, and move telemetry summarizes archives, folders, successes, failures, and progress. Shared termcn-derived tabs, fields, switches, panels, execution controls, and progress are used throughout.

## Interaction and safety

- Unicode symbols distinguish scan, match, single move, batch move, folders, archives, and outcomes.
- A five-frame radar sweep accelerates during scanning without dominating the interface.
- Live single or batch moves require a second confirmation; dry run starts enabled.
- `pipe`, `gd` (`guided` alias), and `ui` coexist through the shared router.
- Real CLI tests cover JSON scanning and filesystem moves; the stdin path only activates for genuinely readable piped streams.
- CLI preferences persist under `nodes.movea.cli`.


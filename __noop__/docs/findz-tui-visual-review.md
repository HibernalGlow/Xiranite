# FindZ TUI visual review

## References

- GUI comparison sheet: `output/playwright/findz/findz-reference-review.jpg`
- OpenTUI PTY capture: `artifacts/cli/findz/archive-query-radar.png`

## Layout mapping

The GUI query controls and result tabs become an archive query radar. The file table receives the largest region, group and extension summaries remain beside it, and scan telemetry shows files, directories, archives, nested archives, errors, elapsed time, and scanned count. Shared termcn-derived fields, tabs, panels, numeric input, execution actions, and progress controls provide the interaction layer.

## Action efficiency and motion

- Search, archives-only, nested, and refine remain configurable actions followed by execution.
- Filter syntax help is a true one-step action and opens immediately through the shared Action Launcher.
- Unicode symbols distinguish files, directories, archives, nested archives, groups, and failures.
- A restrained five-frame query beam accelerates while scanning.
- The top query row keeps path, WHERE expression, editable result limit, and execution visible at 120 columns.
- `pipe`, `gd` (`guided` alias), and `ui` coexist through the shared router; CLI preferences persist under `nodes.findz.cli`.


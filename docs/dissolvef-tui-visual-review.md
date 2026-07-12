# DissolveF TUI visual review

## References

- GUI comparison sheet: `output/playwright/dissolvef/dissolvef-reference-review.jpg`
- OpenTUI PTY capture: `artifacts/cli/dissolvef/folder-flux.png`

## Layout mapping

The GUI dissolve controls, plan tab, history tab, and conflict settings become a folder-flux workbench. The operation stream receives the largest region, conflict and similarity decisions stay visible beside it, and history telemetry combines undo batches with success, skipped, and failed counts. Shared termcn-derived fields, tabs, panels, conflict selectors, execution actions, and progress controls form the interaction layer.

## Action policy, motion, and safety

- Configurable dissolve modes remain select-then-configure actions.
- History is read-only and launches in one click through the shared Action Launcher.
- Unicode symbols identify plan, dissolve, nested folders, media, archives, direct release, collection, undo, move, and delete operations.
- A restrained four-frame dissolve wave accelerates while executing.
- Live dissolve and every undo require confirmation; preview starts enabled.
- Real CLI tests cover nested dissolve and undo, and stdin is only read from genuinely async-readable pipes.
- `pipe`, `gd` (`guided` alias), and `ui` coexist; preferences persist under `nodes.dissolvef.cli`.


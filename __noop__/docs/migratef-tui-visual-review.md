# MigrateF TUI visual review

## References

- GUI comparison sheet: `output/playwright/migratef/migratef-reference-review.jpg`
- OpenTUI PTY capture: `artifacts/cli/migratef/transfer-diff.png`

## Layout mapping

The GUI source controls, migration result tabs, and history list become a transfer diff workbench. The source queue shows pending or skipped inputs, the central mapping panel gives source-to-target diff space the largest share, and undo telemetry keeps batch history and execution counts visible. Shared termcn-derived tabs, fields, switches, panels, execution actions, and progress controls provide the interaction layer.

## Modes, motion, and safety

- Actions: plan, move, copy, history, and undo.
- Layout modes: preserve, flat, and direct.
- Unicode symbols distinguish planning, moving, copying, history, undo, skips, and failures.
- A four-frame transfer cursor accelerates during migration and remains restrained while idle.
- Live move/copy and every undo require confirmation; dry run starts enabled for migration.
- `pipe`, `gd` (`guided` alias), and `ui` coexist through the shared interaction router.
- CLI preferences persist under `nodes.migratef.cli`.


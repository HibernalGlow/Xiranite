# Rawfilter TUI visual review

## References

- GUI comparison sheet: `output/playwright/rawfilter/rawfilter-reference-review.jpg`
- OpenTUI PTY capture: `artifacts/cli/rawfilter/archive-sorter.png`

## Layout mapping

The GUI tabs and archive table are reorganized into one terminal workbench with three simultaneous regions: archive groups, the planned file operations, and statistics plus runtime logs. This keeps the scan result and the consequences of the current options visible without repeatedly switching tabs.

The shared top bar supplies reset, exit, help, task queue, and node preferences. Rawfilter-specific controls remain in the action and field areas, including path, similarity threshold, name matching, shortcut creation, trash-only filtering, and dry run.

Unicode symbols are the portable default: `✓` for retained files, `⌫` for trash operations, `▦` for multi-file groups, and `↗` for shortcuts. No Nerd Font or emoji glyph is required.

## Safety and interaction

- `pipe`, `gd` (plus the `guided` compatibility alias), and `ui` remain independent entry modes.
- The similarity value supports direct text entry as well as pointer-driven decrement and increment controls.
- Executing with dry run disabled is destructive and requires a second confirmation.
- The PTY capture at 120 columns keeps the shared top bar, action tabs, and all three workbench regions visible.


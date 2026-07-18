# MarkU TUI visual review

## References

- GUI comparison sheet: `output/playwright/marku/marku-reference-review.jpg`
- OpenTUI PTY capture: `artifacts/cli/marku/document-forge.png`

## Layout mapping

The GUI module picker, text/file inputs, result tabs, and undo controls become a document forge. The left panel contains the scrollable nine-module toolbox plus input/output comparison, the central panel renders Unified Diff with semantic colors, and the right panel combines processing telemetry with history records. Shared termcn-derived fields, selectors, panels, execution actions, and progress controls form the interaction layer.

## Action policy, motion, and safety

- Text and file processing remain configurable actions.
- History is read-only and launches in one click through the shared Action Launcher.
- Unicode symbols identify text, files, modules, history, undo, input, output, and diff lines.
- A restrained four-frame document scanner accelerates while processing.
- File writes and undo require confirmation; file processing starts in dry-run mode.
- Real CLI tests cover inline text and filesystem writes; stdin is read only from an async-readable pipe.
- `pipe`, `gd` (`guided` alias), and `ui` coexist; preferences persist under `nodes.marku.cli`.


# Bandia TUI visual review

- GUI reference: `output/playwright/bandia/bandia-reference-review.jpg`
- PTY capture: `artifacts/cli/bandia/archive-pipeline.png`

The terminal workbench retains the GUI pipeline's three primary zones:
input queue, animated command chamber, and mapping/result output. Archive
operations consume the existing core result and mapping data; execution remains
dry-run by default, with live filesystem work guarded by confirmation.

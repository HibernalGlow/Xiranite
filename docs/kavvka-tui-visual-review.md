# Kavvka OpenTUI visual review

- GUI reference: `output/playwright/kavvka/kavvka-reference-review.jpg`
- Terminal capture: `artifacts/cli/kavvka/compare-path-workbench.png`
- Capture command: `node --experimental-strip-types scripts/capture-cli-ui.ts --node kavvka --cli packages/nodes/kavvka/src/cli.ts --case compare-path-workbench --wait "KAVVKA // PATH LAB"`

## Parity decisions

- The GUI's scan / preview / process rhythm becomes three mouse-first workbench tabs: `扫描候选`, `预演路径`, and `实际整理`.
- The terminal keeps input queue, candidate or move-plan list, and execution/log output visible at once. This turns the GUI's stacked cards into a responsive three-region layout.
- `预演路径` always maps to a dry run. `实际整理` becomes dangerous only after `仅预演` is disabled, then requires a confirmation surface that points back to the plan.
- The shared header keeps reset, exit, help, task queue, and node preferences. The node adds no persistent footer.

## Verification

- `bun run --cwd packages/nodes/kavvka build`
- `bun run --cwd packages/nodes/kavvka test`
- `bun test packages/nodes/kavvka/src/Tui.bun.test.tsx`
- Real PTY capture reviewed against the GUI reference.

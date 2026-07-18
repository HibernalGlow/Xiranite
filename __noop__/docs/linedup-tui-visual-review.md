# LinedUp TUI visual review

## Sources

- GUI/reference comparison: `output/playwright/linedup/linedup-reference-review.jpg`
- GUI implementation: `src/nodes/linedup/Component.tsx`
- TUI capture: `artifacts/cli/linedup/text-filter.png`

## Reproduction decisions

- The workbench follows Raw Input, Filter Logic, and Filtered Output.
- Filtering is the only action, so there is no action tab or selector. One
  `运行过滤` button runs the current text immediately.
- Source and filter tokens use multiline editors. Case sensitivity and sorting
  remain visible beside kept/removed counts.
- Output includes kept lines and removed lines annotated with the matching
  filter token. A Unicode stream marker animates filtering.
- The TUI performs pure text computation; file writes remain explicit pipe CLI
  behavior.

## Automated evidence

```powershell
bun run --cwd packages/nodes/linedup build
bun run --cwd packages/nodes/linedup test
bun test packages/nodes/linedup/src/Tui.bun.test.tsx
node --experimental-strip-types scripts/capture-cli-ui.ts --node linedup --cli packages/nodes/linedup/src/cli.ts --case text-filter --wait "LINEDUP // TEXT FILTER"
```

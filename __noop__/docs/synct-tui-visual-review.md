# Synct TUI visual review

## Sources

- GUI/reference comparison: `output/playwright/synct/synct-reference-review.jpg`
- GUI implementation: `src/nodes/synct/Component.tsx`
- TUI capture: `artifacts/cli/synct/chronological-flow.png`

## Reproduction decisions

- The workbench preserves the reference's chronological flow: source queue on
  the left, animated timestamp stream in the centre, mapping rules on the right,
  and a wide archive-path plan below.
- Scan, plan, and archive are commands rather than tabs. Each starts from one
  click with the current paths and mapping rules. Live archive opens the shared
  destructive confirmation; dry-run archive executes as a safe preview.
- The `◇` marker travels through the connector while work is active and at a
  slower idle cadence. All icons have portable Unicode fallbacks.
- The configuration band is capped at eight rows so a 24-row terminal retains
  useful space for the plan and telemetry instead of hiding the result area.
- The lower plan uses table-like aligned status, source, timestamp, and target
  columns. Conflicts and errors use the shared semantic colours.

## Automated evidence

```powershell
bun run --cwd packages/nodes/synct build
bun run --cwd packages/nodes/synct test
bun test packages/nodes/synct/src/Tui.bun.test.tsx
node --experimental-strip-types scripts/capture-cli-ui.ts --node synct --cli packages/nodes/synct/src/cli.ts --case chronological-flow --wait "SYNCT // CHRONOLOGICAL FLOW"
```

The mouse test clicks the plan command once, verifies `action: "plan"`, and
waits for the generated archive target to appear in the path-plan table.

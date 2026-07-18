# LinkU TUI visual review

## Sources

- GUI/reference comparison: `output/playwright/linku/linku-reference-review.jpg`
- GUI implementation: `src/nodes/linku/Component.tsx`
- TUI capture: `artifacts/cli/linku/active-topology.png`

## Reproduction decisions

- The workbench follows Initialize Link, Topology Map, Active Associations,
  and Recovery Queue rather than presenting a generic path form.
- Info and list are one-click safe queries. Create, move-and-link, and recover
  reach destructive confirmation on their first click.
- Source, target, and config paths stay directly editable. The topology area
  uses portable Unicode nodes and an animated relation marker.
- Results show either path/symlink diagnostics or recorded link-to-target
  associations with type and creation time.
- Tests inject result data; existing core integration tests cover real temporary
  symlink records without touching user paths.

## Automated evidence

```powershell
bun run --cwd packages/nodes/linku build
bun run --cwd packages/nodes/linku test
bun test packages/nodes/linku/src/Tui.bun.test.tsx
node --experimental-strip-types scripts/capture-cli-ui.ts --node linku --cli packages/nodes/linku/src/cli.ts --case active-topology --wait "LINKU // ACTIVE TOPOLOGY"
```

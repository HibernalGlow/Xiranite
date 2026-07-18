# SimiU TUI visual review

## Sources

- GUI/reference comparison: `output/playwright/simiu/simiu-reference-review.jpg`
- GUI implementation: `src/nodes/simiu/Component.tsx`
- TUI capture: `artifacts/cli/simiu/cluster-hub.png`

## Reproduction decisions

- The workbench preserves Scanning Parameters and Cluster Hub. It focuses on
  signature groups rather than duplicating EngineV's SIXEL gallery.
- Scan and plan are direct safe commands. Live apply enters confirmation and
  identifies whether files will be moved, copied, or linked.
- Roots remain multiline. Scan order, prefix, minimum group size, byte
  tolerance, and operation mode share a compact rules band.
- A Unicode convergence animation represents images flowing into a cluster.
  Group cards show parent directory, member count, and member paths.
- Run-database state is shown in telemetry; tests never mutate image files.

## Automated evidence

```powershell
bun run --cwd packages/nodes/simiu build
bun run --cwd packages/nodes/simiu test
bun test packages/nodes/simiu/src/Tui.bun.test.tsx
node --experimental-strip-types scripts/capture-cli-ui.ts --node simiu --cli packages/nodes/simiu/src/cli.ts --case cluster-hub --wait "SIMIU // CLUSTER HUB"
```

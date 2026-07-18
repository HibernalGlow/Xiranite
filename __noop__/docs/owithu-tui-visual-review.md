# OwithU TUI visual review

## Sources

- GUI/reference comparison: `output/playwright/owithu/owithu-reference-review.jpg`
- GUI implementation: `src/nodes/owithu/Component.tsx`
- TUI capture: `artifacts/cli/owithu/registry-topology.png`

## Reproduction decisions

- The workbench follows the GUI's configuration editor, registry topology,
  live menu preview, and system-log structure.
- Preview is a one-click safe command. Register and unregister enter destructive
  confirmation on their first click because both modify Windows registry state.
- Configuration may come from a path or directly editable TOML. Hive and entry
  key filters remain available without another mode screen.
- A four-frame Unicode topology pulse animates nodes and branches. Plan rows
  align Hive, scope, label, registry path, and generated command.
- Automated tests inject result data and never call the Windows registry
  executor.

## Automated evidence

```powershell
bun run --cwd packages/nodes/owithu build
bun run --cwd packages/nodes/owithu test
bun test packages/nodes/owithu/src/Tui.bun.test.tsx
node --experimental-strip-types scripts/capture-cli-ui.ts --node owithu --cli packages/nodes/owithu/src/cli.ts --case registry-topology --wait "OWITHU // REGISTRY TOPOLOGY"
```

The mouse test invokes preview in one click and verifies the generated menu
entry appears in the topology workbench.

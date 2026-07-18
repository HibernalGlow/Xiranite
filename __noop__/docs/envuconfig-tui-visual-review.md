# EnvUConfig TUI visual review

## Sources

- GUI/reference comparison: `output/playwright/envuconfig/envuconfig-reference-review.jpg`
- GUI implementation: `src/nodes/envuconfig/Component.tsx`
- TUI capture: `artifacts/cli/envuconfig/configuration-ledger.png`

## Reproduction decisions

- The workbench preserves Root Context, Detected Objects, and Target Vector.
- Scan and manifest are direct safe commands. Live backup reaches destructive
  confirmation because it copies files and writes a manifest.
- Root, include patterns, backup directory, manifest, and run database remain
  directly editable. The inventory table aligns file, group, and size.
- A Unicode source-to-target sync marker animates scanning and backup.
- Tests inject inventory results and never copy user configuration files.

## Automated evidence

```powershell
bun run --cwd packages/nodes/envuconfig build
bun run --cwd packages/nodes/envuconfig test
bun test packages/nodes/envuconfig/src/Tui.bun.test.tsx
node --experimental-strip-types scripts/capture-cli-ui.ts --node envuconfig --cli packages/nodes/envuconfig/src/cli.ts --case configuration-ledger --wait "ENVU CONFIG // CONFIGURATION LEDGER"
```

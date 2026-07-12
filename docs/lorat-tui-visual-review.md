# LoRaT TUI visual review

## Sources

- GUI/reference comparison: `output/playwright/lorat/lorat-reference-review.jpg`
- GUI implementation: `src/nodes/lorat/Component.tsx`
- TUI capture: `artifacts/cli/lorat/model-signal-matrix.png`

## Reproduction decisions

- The GUI's two persistent surfaces remain two tabs: `管理` and `收集`.
- Scan, TriggerDB application, sidecar writes, no-trigger marking, collection,
  and export are commands rather than tabs. They use the shared one-click
  command launcher; dangerous writes enter confirmation on their first click.
- The main work area mirrors the GUI's library emphasis with a wide editable
  model table and compact write/collection telemetry. Search and status filters
  are applied immediately to the current table rather than only being passed to
  the scanner.
- Each visible row can be selected directly and its trigger cell is a focused
  OpenTUI input. Edits update the rows JSON and selected-key command payloads,
  so write commands consume the current table state.
- Every row also exposes a `✓ 写入` action. It atomically binds that row's
  edited data and key, then opens the shared destructive-action confirmation;
  the toolbar write command remains available for multi-row selection.
- The four-frame `◈` signal pulse is Unicode-only and remains readable without
  Nerd Font support.
- Collection items are accepted as structured JSON in terminal mode because
  desktop drag-and-drop is not available in a terminal.

## Automated evidence

```powershell
bun run --cwd packages/nodes/lorat build
bun run --cwd packages/nodes/lorat test
bun test packages/nodes/lorat/src/Tui.bun.test.tsx
node --experimental-strip-types scripts/capture-cli-ui.ts --node lorat --cli packages/nodes/lorat/src/cli.ts --case model-signal-matrix --wait "LORAT // MODEL SIGNAL MATRIX"
```

The mouse test clicks `lorat-command-scan` once and asserts that the scan
executor receives `action: "scan"`. It then filters the returned table through
the search input and directly types into a row's trigger input. The capture is
stored beside its ANSI and HTML forms under `artifacts/cli/lorat/`.

# SameA TUI visual review

## Source of truth

SameA does not currently have a retained `output/playwright/samea/samea-reference-review.jpg`. The visual and interaction reference for this migration is therefore the live GUI implementation in `src/nodes/samea/Component.tsx`, together with the result contracts in `packages/nodes/samea/src/core.ts`.

The TUI preserves the GUI's workflow hierarchy:

- Source Control for editable archive roots.
- Operation Gate for threshold, centralization, dry-run, and path-blacklist behavior.
- Analysis Chamber as the primary table-like result surface.
- Filter Protocols with Artist / Path / Regex tabs. These tabs only switch persistent configuration context.
- Telemetry for counts, progress, and logs.

`Plan` and `Classify` are direct command buttons. Plan executes with one click. Live classification reaches the shared dangerous-operation confirmation with one click.

## Terminal-specific composition

- `SAMEA // EXTRACTOR PROTOCOL` uses a Unicode archive-to-artist extraction animation.
- The result matrix distinguishes artists, archives, statuses, and targets with portable Unicode symbols and theme colors.
- All path, blacklist, regex, extension, and numeric values remain directly editable.
- Shared OpenTUI chrome provides Reset, Exit, F1 help, task queue, and node configuration without a footer.

## Evidence

- Capture: `artifacts/cli/samea/extractor-protocol.png`
- Mouse test: `packages/nodes/samea/src/Tui.bun.test.tsx`
- CLI routing test: `packages/nodes/samea/src/cli.test.ts`

Capture command:

```powershell
node --experimental-strip-types scripts/capture-cli-ui.ts --node samea --cli packages/nodes/samea/src/cli.ts --case extractor-protocol --wait "SAMEA // EXTRACTOR PROTOCOL"
```

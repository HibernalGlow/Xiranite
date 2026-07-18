# MVZ TUI visual review

## Sources

- GUI/reference comparison: `output/playwright/mvz/mvz-reference-review.jpg`
- GUI implementation: `src/nodes/mvz/Component.tsx`
- TUI capture: `artifacts/cli/mvz/archive-explorer.png`

## Reproduction decisions

- The workbench keeps Archive Explorer, Commit Preview, and operation status.
- Extract, move, delete, and rename are direct commands. Any live operation
  enters destructive confirmation; dry-run produces a safe preview.
- Entries remain an editable multiline `archive//internal/path` list. Output,
  near/auto-directory/flatten, and rename fields are shown contextually.
- A Unicode archive-unpack animation identifies active processing. Preview rows
  group by archive and show output, commands, and rename diffs.
- Mouse tests inject a fake preview and never call 7-Zip.

## Automated evidence

```powershell
bun run --cwd packages/nodes/mvz build
bun run --cwd packages/nodes/mvz test
bun test packages/nodes/mvz/src/Tui.bun.test.tsx
node --experimental-strip-types scripts/capture-cli-ui.ts --node mvz --cli packages/nodes/mvz/src/cli.ts --case archive-explorer --wait "MVZ // ARCHIVE EXPLORER"
```

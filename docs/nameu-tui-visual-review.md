# NameU TUI visual review

## Sources

- GUI/reference comparison: `output/playwright/nameu/nameu-reference-review.jpg`
- GUI implementation: `src/nodes/nameu/Component.tsx`
- TUI capture: `artifacts/cli/nameu/rename-review.png`

## Reproduction decisions

- The workbench follows the GUI's rules-matrix and review-desk hierarchy: input
  queue and normalization rules above a wide before/after projection table.
- Scan, preview, and rename are direct commands. Live rename enters destructive
  confirmation on its first click; dry-run remains a safe preview.
- Multi-artist versus single-artist is a persistent configuration choice, not
  an action tab. Recursive traversal, artist injection, folder normalization,
  and timestamp preservation remain visible together.
- A four-frame Unicode `A → Z` projection animation identifies normalization
  work without relying on Nerd Font glyphs.
- Result rows align status, source name, artist/kind metadata, and target name;
  conflicts and errors receive semantic colours.

## Automated evidence

```powershell
bun run --cwd packages/nodes/nameu build
bun run --cwd packages/nodes/nameu test
bun test packages/nodes/nameu/src/Tui.bun.test.tsx
node --experimental-strip-types scripts/capture-cli-ui.ts --node nameu --cli packages/nodes/nameu/src/cli.ts --case rename-review --wait "NAMEU // RENAME REVIEW DESK"
```

The mouse test invokes preview with one click and verifies the generated target
name appears in the rename-projection table.

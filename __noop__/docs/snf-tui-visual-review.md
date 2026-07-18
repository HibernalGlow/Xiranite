# SNF TUI visual review

## Sources

- GUI/reference comparison: `output/playwright/snf/snf-reference-review.jpg`
- GUI implementation: `src/nodes/snf/Component.tsx`
- TUI capture: `artifacts/cli/snf/sequence-repair.png`

## Reproduction decisions

- The workbench preserves Sequence Feed, Gap Scan, ordering rules, and
  Integrity Status rather than presenting SNF as a generic rename form.
- Scan, preview, and repair are direct commands. Live repair enters destructive
  confirmation on the first click.
- Library versus artist mode is configuration. Priority keywords and timestamp
  preservation remain visible in the same compact rules matrix.
- A four-frame Unicode sequence-gap animation closes the distance between 001
  and 004. Result rows align original folder, new sequence, target, and status.
- Tests use injected plan results and never rename real folders.

## Automated evidence

```powershell
bun run --cwd packages/nodes/snf build
bun run --cwd packages/nodes/snf test
bun test packages/nodes/snf/src/Tui.bun.test.tsx
node --experimental-strip-types scripts/capture-cli-ui.ts --node snf --cli packages/nodes/snf/src/cli.ts --case sequence-repair --wait "SNF // SEQUENCE REPAIR UNIT"
```

# CrashU TUI visual review

## Sources

- GUI/reference comparison: `output/playwright/crashu/crashu-reference-review.jpg`
- GUI implementation: `src/nodes/crashu/Component.tsx`
- TUI capture: `artifacts/cli/crashu/collision-resolver.png`

## Reproduction decisions

- The TUI keeps the Collision Resolver hierarchy: source array, similarity
  index, movement policy, wide auto-match plan, and risk telemetry.
- Scan, plan, and move are one-click commands rather than tabs. A live move
  reaches destructive confirmation on its first click.
- Source paths remain a multiline editor. Target path, target-name fallback,
  similarity threshold, destination, direction, and conflict strategy share a
  compact single-row matrix so none disappear in a 24-row terminal.
- The similarity scanner uses a four-frame Unicode density pulse. Each plan row
  also renders a five-cell similarity bar with semantic threshold colours.
- Tests use an injected fake executor and never move real folders.

## Automated evidence

```powershell
bun run --cwd packages/nodes/crashu build
bun run --cwd packages/nodes/crashu test
bun test packages/nodes/crashu/src/Tui.bun.test.tsx
node --experimental-strip-types scripts/capture-cli-ui.ts --node crashu --cli packages/nodes/crashu/src/cli.ts --case collision-resolver --wait "CRASHU // COLLISION RESOLVER"
```

The mouse test clicks the plan command once, verifies the requested action, and
waits for the 94% collision match to appear in the plan table.

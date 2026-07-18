# NeoView TUI visual review

## Sources

- Shared application adapter: `packages/nodes/neoview/src/application/headless/ReaderHeadlessController.ts`
- Terminal implementation: `packages/nodes/neoview/src/Tui.tsx`
- Automated interaction: `packages/nodes/neoview/src/testing/Tui.bun.test.tsx`
- Pseudo-terminal capture: `artifacts/cli/neoview/reader-workbench.png`

## Layout decisions

- The top input deck keeps book path, page jump, open, previous, next and close actions visible without turning reading into a guided form.
- A bounded page rail occupies the left side. It follows the current page in windows of at most 500 entries, so very large books do not create an unbounded terminal tree.
- The dominant right surface shows the current frame, page metadata and frame state. It intentionally remains textual until SIXEL/Kitty capability detection is implemented.
- The TUI holds one `ReaderHeadlessController` for its lifetime. Mouse and keyboard navigation call the same ReaderSession methods as CLI and GUI adapters; archive/index/navigation logic is not copied into React state.
- The 100-column by 24-row Nord capture was reviewed for clipped controls, overlapping text, stable panel widths and readable empty state. The path editor occupies a stable first row; page jump and all five primary actions remain reachable on the second row without wrapping.

## Automated evidence

```powershell
bun run --cwd packages/nodes/neoview build:tsc
bun run --cwd packages/nodes/neoview test
node --experimental-strip-types scripts/audit-node-tuis.ts --only neoview
node --experimental-strip-types scripts/capture-cli-ui.ts --node neoview --cli packages/nodes/neoview/dist/cli.js --case reader-workbench --wait "NEOVIEW // READER"
```

The OpenTUI test opens a book through an injected controller, clicks Next, verifies the second page and destroys the renderer. Destruction must dispose the persistent controller exactly once.

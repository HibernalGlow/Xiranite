# Czkawka OpenTUI visual review

Review date: 2026-07-15

## Scope

- Rendered the package-owned OpenTUI composition at `150×42`, `170×46`, and both `zh`/`en` languages through `@opentui/react/test-utils`.
- Covered the scanner rail, shared scan/operation fields, result tabs and virtual rows, analysis metrics, inspector details, operation outcomes, logs, progress, and open-file action.
- Exercised real mouse targets for input tabs, result rows, result tabs, inspector tabs, action launchers, and the active-file control.

## Findings

- All 11 scanners remain visible in the scanner rail at the reviewed terminal sizes.
- The three-column workbench keeps the input, result, and inspector regions reachable without overlapping controls.
- Media metadata remains readable for audio and image/video-shaped entries; long paths stay in the dedicated path column.
- Chinese and English frames use the same interaction schema and layout. The English-frame assertion rejects any leaked Han characters.
- Portable Unicode symbols provide selection, group, action, and status cues without relying on emoji width.
- No mojibake, clipped primary action, missing mouse target, or terminal-only duplicate business logic was observed.

## Repeatable evidence

Run:

```powershell
bun --bun vitest run packages/nodes/czkawka/src/Tui.bun.test.tsx
bun run audit:tui -- --only czkawka
```

The test suite captures terminal character frames and validates the Chinese workbench, the complete English workbench, result selection/media inspection/opening, and operation/log inspection.

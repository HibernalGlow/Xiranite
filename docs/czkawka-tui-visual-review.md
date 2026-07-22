# Czkawka OpenTUI visual review

Review date: 2026-07-22

## Scope

- Rendered the package-owned OpenTUI composition at `150×42`, `170×46`, and both `zh`/`en` languages through `@opentui/react/test-utils`.
- Covered the single scanner palette, setup tabs, result rows, inspector deck, analysis summary, operation outcomes, logs, progress, and open-file action.
- Exercised real mouse targets for tool chips, input tabs, result rows, result tabs, inspector tabs, action launchers, and the active-file control.

## Layout contract (terminal-native, not a GUI clone)

The GUI swimlane/甬道 is intentionally **not** reproduced. Terminal density needs a different information architecture:

```text
header          title · phase · current tool/action
command strip   scan / delete / move / rename / export · live summary
scanner palette single interactive tool list (11 chips, [ ] to cycle)
main body
  left  32%     setup tabs (dirs / filters / algo / ops) + compact summary
  right 68%     result table (dominant) + stacked inspector (details/op/logs)
```

### What changed from the previous TUI

| Before | After |
| --- | --- |
| Left-top decorative "SCANNER RAIL" (not clickable) | One interactive scanner palette under the command strip |
| Left-bottom form also had a `tool` select field | Tool field removed from setup; palette is the only picker |
| Tall right ANALYSIS card + INSPECTOR | Compact SUMMARY under setup; inspector stacked under results |
| Three equal-ish columns trying to mirror GUI | Two-column forensics console: setup \| results+inspect |

Tool labels appear **once**. Selecting a chip updates `session.values.tool` and the header status line.

## Findings

- All 11 scanners remain visible in the palette at the reviewed terminal sizes.
- Chinese and English frames use the same interaction schema and layout. The English-frame assertion rejects any leaked Han characters.
- Result selection, media metadata, open-path, operation outcomes, and logs still work through the shared definition / session contract.
- Portable Unicode symbols provide selection, group, action, and status cues without relying on emoji width.
- No second tool list, mojibake, or terminal-only duplicate business logic was observed.

## Repeatable evidence

Run:

```powershell
bun --bun vitest run packages/nodes/czkawka/src/Tui.bun.test.tsx
bun run audit:tui -- --only czkawka
```

The test suite captures terminal character frames and validates the Chinese workbench, the complete English workbench, single-appearance tool labels, result selection/media inspection/opening, and operation/log inspection.

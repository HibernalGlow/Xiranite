# Trename TUI visual review

## Evidence

- GUI design/final comparison: `output/playwright/trename/trename-reference-review.jpg`
- OpenTUI PTY capture: `artifacts/cli/trename/rename-review.png`
- Reproduction:

  ```powershell
  node --experimental-strip-types scripts/capture-cli-ui.ts --node trename --cli packages/nodes/trename/src/cli.ts --case rename-review --wait "TRENAME // 重命名审阅台"
  ```

## Layout correspondence

| GUI surface | OpenTUI surface |
| --- | --- |
| left JSON/source panel | directory tree derived from the same rename JSON |
| central rename-operation list | scrollable Git-style path diff review |
| right options and conflict rail | conflict/status rail plus execution safety gate |
| preview rename then live rename | dry-run by default; live execution requires a separate danger confirmation |

The terminal version intentionally compresses the GUI toolbar into workflow tabs so the
review list receives most of the available height. Path differences consume core
`operations` directly; the TUI does not recalculate filesystem plans.

## Component policy

The shared `PathDiff` is a rename-specific adaptation of termcn's OpenTUI `diff-view`
review pattern. Generic controls continue to come from the shared termcn-first runtime;
only the path-segment comparison is specialized because line-oriented source diff does
not preserve rename semantics.

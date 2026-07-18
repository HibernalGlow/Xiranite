# Scoolp TUI visual review

## Evidence

- GUI reference/final comparison: `output/playwright/scoolp/scoolp-reference-review.jpg`
- OpenTUI PTY capture: `artifacts/cli/scoolp/cache-deck-settings.png`

## Correspondence

| GUI workbench | OpenTUI workbench |
| --- | --- |
| cache analysis / capacity blocks | Unicode block capacity map, scaled from real obsolete package sizes |
| purgeable targets table | scrollable package target rows with filename, size, and relative size bar |
| destructive operations rail | scan, backup, and purge action rail with dry-run status and live confirmation |
| scope/config controls | compact top controls for Scoop root, cache path, sync config, and safety mode |

The node uses the shared OpenTUI runner's top-bar TOML preferences entry. Its
settings icon comes from `terminalIcon("settings")`; it is not an emoji and
does not consume any workbench height.

## Reproduction

```powershell
node --experimental-strip-types scripts/capture-cli-ui.ts --node scoolp --cli packages/nodes/scoolp/src/cli.ts --case cache-deck-settings --wait "SCOOLP // CACHE DECK"
```

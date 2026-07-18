# Lorat Node UI Design Note

## Basic Judgment

Lorat is a LoRA trigger sidecar and TriggerDB manager. The UI should not be a plain form wrapped around a large text log. The primary user loop is: scan a LoRA folder, inspect model trigger status, edit or apply triggers, then optionally write sidecars or export TriggerDB JSON.

The app-owned UI is responsible for the interaction surface. The package remains headless and exports `def` plus `core` only.

## Core Tasks

1. Scan a LoRA folder for model files and sidecars.
2. Infer missing trigger text from file names or folders.
3. Apply TriggerDB JSON to scanned rows.
4. Edit trigger text row by row.
5. Select missing rows and write `.trigger.txt` sidecars.
6. Mark selected rows as no-trigger with `.notrigger.txt`.
7. Export current rows back to TriggerDB JSON.

## Common Path

```text
paste LoRA folder
-> scan
-> filter rows by model/status/source/trigger
-> edit trigger text
-> select missing rows
-> write sidecars or export TriggerDB
```

## Dangerous Actions

- `write_triggers` writes real sidecar files and may overwrite existing sidecars.
- `mark_no_trigger` writes `.notrigger.txt` and removes trigger sidecar intent.
- Applying TriggerDB is local state only, but it can overwrite visible row trigger text and should remain reversible by clearing state or rescanning.

Danger strategy:

- Keep scan and apply/export as normal actions.
- Use destructive styling and confirmation for real sidecar writes.
- Row-level write/no-trigger actions must also require confirmation.
- Progress and latest error must stay visible outside the long result table.

## Preview Data

The main preview is structured row data, so it should use Dice/TanStack DataTable rather than text rows:

- model name
- relative directory
- status: `missing`, `trigger`, `notrigger`
- editable trigger text
- source: `filename`, `folder`, `sidecar`, `json`, `notrigger`, `written`
- row selection state
- row actions

Logs are secondary and can remain as a copyable text panel.

## Runtime Focus

During a run, the user needs:

- current action
- latest progress message
- percent progress
- number of total/missing/trigger/no-trigger rows
- current result/log tab, auto-switching to logs while running and rows after scan

## Success Next Step

- After scan: inspect/filter rows and select missing models.
- After applying TriggerDB: review changed rows and write/export.
- After sidecar write: copy logs or rescan to verify.
- After export: copy/download TriggerDB JSON.

## Failure Help

- Show the latest failure in the status strip, not only inside logs.
- Preserve rows and user edits after a failed write when possible.
- Keep logs copyable for debugging.
- Do not hide filters when the current filter returns zero rows.

## Surface Layout

### Collapsed

Show:

- Lorat icon
- status badge
- one-line summary: folder waiting, row counts, or progress
- compact primary action button

Do not show:

- full path input
- table
- TriggerDB textarea

### Compact

Show:

- header with status and primary action
- action picker
- folder input
- search input
- compact toolbar actions
- result/log tabs

Low-frequency filters and defaults stay in popovers.

### Portrait

Show:

- header and primary action
- action picker, folder input, search input
- compact toolbar
- result/log tabs taking the remaining height

The table/list area is the flexible region. Controls stay above it.

### Regular

Show:

- left task column: action, folder, search, TriggerDB input, status
- right result area: model/log tabs
- top stats and toolbar

### Expanded / Workspace

Use the same information architecture as regular, with more room for:

- wider stats row
- larger DataTable viewport
- persistent toolbar actions
- TriggerDB textarea and status strip visible without pushing the result panel below the fold

## Component Choices

Use:

- shadcn Button, Badge, Tabs, Popover, Tooltip, AlertDialog, ScrollArea
- Dice/TanStack DataTable for row results
- DataTableToolbar for model/status/source/trigger filtering
- icon-only toolbar buttons with accessible labels and tooltips for compact actions

Do not use:

- package-side React UI
- text-only result rows for model status
- hidden filters that disappear when there are zero rows
- fixed card heights or hardcoded old package shells

## Split Points

Current app-owned structure:

```text
src/nodes/lorat/
  Component.tsx
  constants.ts
  controls.tsx
  entry.ts
  results.tsx
  types.ts
  Component.test.tsx
```

`Component.tsx` owns state orchestration and surface branching. `controls.tsx` owns inputs/popovers/default config UI. `results.tsx` owns the Dice table and log panel.

## Tests

Package:

- `bun --filter @xiranite/node-lorat test`
- `bun --filter @xiranite/node-lorat build`

App:

- `bunx vitest run src/nodes/lorat/Component.test.tsx`
- surface matrix for collapsed/compact/portrait/regular/expanded/workspace
- force-collapsed compact height branch
- tall compact portrait branch
- Dice table filtering controls
- default config save/restore/reset
- runner progress, failure, and destructive confirmation paths

QA:

```bash
bun run qa:card -- lorat matrix --screenshot
```

Acceptance:

- compact and portrait do not waste height on separate result columns
- model rows are filterable even when a filter produces zero results
- dangerous write operations require confirmation
- status and primary action remain visible while long tables/logs scroll locally

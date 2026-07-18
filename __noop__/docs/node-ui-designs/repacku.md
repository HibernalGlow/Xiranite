# Repacku Node UI Design Note

## Basic Judgment

Repacku is a folder analysis and archive planning tool. The UI should make the planned folder strategy visible before any real compression happens. The main surface is not a log viewer; it is a folder tree, a compression plan, and a risk-aware execution panel.

The node package stays headless. The app-owned UI owns shadcn, Dice, file-tree, confirmation, tabs, and responsive surface behavior.

## Core Tasks

1. Analyze one or more folders and classify each folder as `entire`, `selective`, or `skip`.
2. Write and reload a generated config JSON.
3. Execute planned compression operations.
4. Run full analyze-plus-compress flows.
5. Single-pack child folders.
6. Gallery-pack folders matching a marker.
7. Review planned, completed, skipped, and failed operations.

## Common Path

```text
paste folder path
-> analyze
-> inspect folder tree and mode stats
-> review operation plan
-> dry-run compress
-> confirm real compression
-> copy results or inspect failures
```

## Dangerous Actions

- `compress`, `full`, `single-pack`, and `gallery-pack` can create archives.
- `deleteAfter` can remove source folders or files after compression.
- Running without `dryRun` changes the filesystem.

Danger strategy:

- Default `dryRun` should stay on.
- Real compression requires confirmation.
- `deleteAfter` requires an extra visible risk indicator and confirmation copy.
- The confirmation dialog must show action, operation count, delete-after state, and target folder summary.
- Failure details must be copyable without hiding the current plan.

## Preview Data

The UI needs two structured previews:

- Folder tree:
  - folder name and path
  - depth
  - file count and total size
  - recursive size
  - compress mode
  - dominant file types
  - recommendation
- Operation plan:
  - mode
  - source path
  - target archive path
  - extension set
  - file count
  - status: `planned`, `success`, `error`, `skipped`
  - command and error when available

The operation plan should use a mature table component when the surface is large enough. The folder tree should use a file-tree/tree-view style component rather than text indentation.

## Runtime Focus

During a run, the user needs:

- current action
- current folder or archive
- progress percent
- planned/compressed/failed/skipped counts
- whether the run is dry-run or real
- whether source deletion is enabled

## Success Next Step

- After analyze: inspect mode distribution and run a dry-run plan.
- After dry-run: confirm real compression or adjust file types/min count.
- After real compression: review failed operations and copy logs.
- After gallery-pack: inspect gallery count and skipped archive-containing folders.

## Failure Help

- Show the latest error in the status strip.
- Keep the tree and operation plan visible after failure.
- Group errors by source path.
- Keep the generated command visible when available.
- Explain missing path, missing config, and compression command failures separately.

## Surface Layout

### Collapsed

Show:

- Repacku icon
- status badge
- one-line summary: path missing, analyzing, planned count, failed count, or dry-run result
- compact primary action

Do not show the full tree or operation table.

### Compact

Show:

- header with status, dry-run badge, and primary action
- path input
- action picker
- key switches: dry-run and delete-after
- result tabs: tree, plan, logs

Low-frequency controls such as target file types, min count, gallery marker, output path, and config path belong in a popover.

### Portrait

Show controls at the top, stats below, then tabs for tree/plan/logs. The tree or plan consumes the remaining height. Logs should not push controls off the first screen.

### Regular

Use two zones:

- left: action, paths, dry-run/delete-after, advanced options
- right: tree/plan/log tabs

Stats stay above the long result region.

### Expanded / Workspace

Use a three-zone layout:

- top toolbar: analyze, dry-run, compress, copy results
- left inspector: paths, modes, advanced options
- main area: tree and operation table, with logs as a secondary tab

The table/tree area scrolls locally. Primary action, dry-run state, delete-after state, and latest error remain visible.

## Component Choices

Use:

- shadcn Button, Badge, Tabs, Popover, Tooltip, AlertDialog, ScrollArea
- file-tree/tree-view component for `folderTree`
- Dice/TanStack DataTable for operation plan rows
- compact icon buttons with tooltip and accessible labels

Do not use:

- package-side React UI
- raw JSON as the primary preview
- text-only folder trees
- always-visible long advanced settings

## Split Points

Recommended structure:

```text
src/nodes/repacku/
  Component.tsx
  constants.ts
  controls.tsx
  FileTreePreview.tsx
  OperationPlanTable.tsx
  ResultPanels.tsx
  types.ts
  Component.test.tsx
```

`Component.tsx` should orchestrate state and surface branching. Tree, operation plan, controls, and result tabs should stay split.

## Tests

Package:

- `bun --filter @xiranite/node-repacku test`
- `bun --filter @xiranite/node-repacku build`

App:

- surface matrix for all node modes
- compact short-height collapsed branch
- dry-run default
- delete-after confirmation path
- tree result rendering
- operation plan table rendering
- progress events and failed response

QA:

```bash
bun run qa:card -- repacku matrix --screenshot
```

Acceptance:

- dry-run and delete-after are visible before execution
- tree and plan are structured, not raw text
- long operations/logs scroll locally
- large surfaces do not waste height on stacked result columns

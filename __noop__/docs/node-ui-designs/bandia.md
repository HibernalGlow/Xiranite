# Bandia Node UI Design Note

## Basic Judgment

Bandia is an archive extraction, compression, repack, and EFU export tool. Its UI should optimize for dense batch work: input archive paths, preview mappings/results, run safely, and inspect logs. It should not put each switch and input on its own row in medium-width cards.

The node package remains headless. The app UI owns path editing, dense switch layout, tabs, result tables, confirmation, and responsive information architecture.

## Core Tasks

1. Parse archive paths from pasted text.
2. Extract archives with auto or normal output mode.
3. Compress folders or mappings into archives.
4. Repack extracted folders back to archives.
5. Export EFU rows for Everything.
6. Stop a running batch.
7. Review per-item success, skip, failure, command, and duration.

## Common Path

```text
paste archive paths
-> preview parsed archives
-> choose extract/compress/repack/export
-> dry-run when available
-> confirm risky delete/overwrite settings
-> run
-> inspect result table and logs
```

## Dangerous Actions

- Extract can overwrite or rename existing files depending on overwrite mode.
- `deleteAfter` removes archive files after extraction.
- Compress/repack can delete source folders after successful archive creation.
- Parallel extraction can make failures harder to inspect.
- `stop` interrupts an in-flight batch.

Danger strategy:

- Show delete-after, delete-source, overwrite mode, and parallel state near the primary action.
- Confirm before real delete-after/delete-source runs.
- Use dry-run command previews where available.
- Keep per-item result rows visible after failure.
- Stop should be easy to reach while running.

## Preview Data

Bandia needs three structured preview areas:

- input/archive list:
  - archive path
  - parsed file name
  - archive extension
  - exists/unknown state when available
- path mappings:
  - archive path
  - extracted/source path
  - output archive path
- result rows:
  - kind: extract/compress/export
  - source path
  - archive/output path
  - success/skipped/failure
  - duration
  - file size
  - command
  - error

Result rows should use a mature table/list component when space allows. Logs are secondary.

## Runtime Focus

During a run, the user needs:

- current action
- current item index and total
- current file name
- progress percent
- success/failed/skipped counts
- whether delete-after/delete-source is active
- stop action

## Success Next Step

- After extract: copy mappings, export EFU, or compress/repack.
- After compress/repack: inspect output archive paths and failures.
- After EFU export: copy/open EFU path.
- After stop: inspect skipped rows and decide whether to resume manually.

## Failure Help

- Show latest failure in the status strip.
- Keep failed result rows filterable.
- Show the command and shortened stderr/stdout when available.
- Distinguish missing Bandizip, missing path, command failure, and deletion cleanup failure.

## Surface Layout

### Collapsed

Show:

- Bandia icon
- status badge
- one-line summary: parsed archive count, running progress, failed count, or EFU output
- compact run/stop action

Do not show full path text or every switch.

### Compact

Show:

- header with status and run/stop action
- action picker
- path input with paste button
- dense key switch row: dry-run, delete-after/delete-source, trash, parallel
- advanced options popover
- result tabs: inputs, mappings/results, logs

Controls should wrap into dense groups. Avoid one switch per row.

### Portrait

Show controls at the top, then a tabbed result area below:

- archives/input
- mappings/results
- logs

Auto-switch to logs while running and to results after completion.

### Regular

Use:

- left control column for action, paths, key switches, advanced popover
- right result tabs for archives/mappings/results/logs
- status strip above the result area

### Expanded / Workspace

Use:

- top toolbar with extract, compress, repack, EFU, stop, copy actions
- left batch input and key risk controls
- main structured table/list area
- logs in a secondary tab or bottom panel

Large height should benefit the result table, not create a long settings form.

## Component Choices

Use:

- shadcn Button, Badge, Tabs, Popover, Tooltip, AlertDialog, ScrollArea
- compact switch/checkbox groups
- Dice/TanStack DataTable for result rows when table-like
- local text area only for batch path input, not for result display

Do not use:

- one control per row in medium-width cards
- raw command/log text as the only result
- hidden delete-after/delete-source risk state
- package-side React UI

## Split Points

Recommended structure:

```text
src/nodes/bandia/
  Component.tsx
  constants.ts
  controls.tsx
  ResultPanels.tsx
  ResultTable.tsx
  types.ts
  Component.test.tsx
```

`controls.tsx` should own dense path and switch controls. `ResultPanels.tsx` should own tab selection and auto-switching. `ResultTable.tsx` should own structured results.

## Tests

Package:

- `bun --filter @xiranite/node-bandia test`
- `bun --filter @xiranite/node-bandia build`

App:

- surface matrix for all modes
- compact switch row does not degrade into one-control-per-row at medium widths
- paste path input
- compress mode backend input
- delete-after/delete-source confirmation
- stop button while running
- result rows and copy results
- progress events and failed response

QA:

```bash
bun run qa:card -- bandia matrix --screenshot
```

Acceptance:

- medium-width compact view keeps key switches dense
- result/log/input views are tabs, not separate stacked columns in height-limited layouts
- risky delete and overwrite states stay visible
- structured result rows are inspectable after failures

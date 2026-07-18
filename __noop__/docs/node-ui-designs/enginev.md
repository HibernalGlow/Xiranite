# EngineV Node UI Design Note

## Basic Judgment

EngineV is a Wallpaper Engine workshop scanner and batch organizer. The UI should feel like a gallery and operation queue, not a filesystem text report. The primary loop is scan, filter, inspect local previews, select items, then rename/copy/delete/export.

The node package remains headless. The app UI owns preview images, filtering controls, gallery density, destructive confirmations, and responsive layout.

## Core Tasks

1. Scan a Wallpaper Engine workshop directory.
2. Filter wallpapers by title, type, rating, and tags.
3. Sort by title, size, created time, or modified time.
4. Preview wallpaper thumbnails from local files.
5. Select workshop items.
6. Generate rename/copy plans from a template.
7. Delete selected items, optionally permanently.
8. Export filtered data as JSON or paths.

## Common Path

```text
paste workshop path
-> scan
-> filter gallery
-> inspect preview cards
-> select items
-> dry-run rename/copy
-> confirm real operation or export paths
```

## Dangerous Actions

- `rename` without `dryRun` moves or copies real folders.
- `delete` removes workshop folders; `permanent` bypasses trash.
- `copyMode` can create large duplicated folders.

Danger strategy:

- Default rename/delete to dry-run.
- Require confirmation for rename, delete, and permanent delete.
- Confirmation must show selected count, target path when copying, dry-run state, and permanent/trash state.
- Permanent delete should use destructive styling and explicit text.

## Preview Data

The primary preview is a visual gallery:

- preview image
- title
- workshop id
- wallpaper type
- content rating
- size
- tags
- path summary
- selection state

Secondary structured data:

- rename results
- delete results
- type/rating stats
- export path
- errors

Rename/delete results should use a mature table/list component when there are many rows. The gallery should stay visual and should not become text-only rows.

## Runtime Focus

During a run, the user needs:

- current action and percent
- current workshop folder
- total/filtered/selected counts
- success/failed counts
- latest error
- whether the operation is dry-run or real

## Success Next Step

- After scan: filter and select wallpaper items.
- After filter: export paths or prepare rename/delete.
- After dry-run rename: inspect planned names and confirm real rename/copy.
- After delete: inspect failures and copy logs.

## Failure Help

- Preserve scanned gallery after errors.
- Keep failed rename/delete rows visible.
- Show missing workshop path, template errors, and filesystem errors distinctly.
- Keep copy-path and open-path actions available for unaffected items.

## Surface Layout

### Collapsed

Show:

- EngineV icon
- status badge
- total/filtered count or progress
- compact primary scan/filter action

Do not show gallery cards.

### Compact

Show:

- status header and primary action
- workshop path input
- action picker
- compact filter controls
- gallery/log tabs

Advanced template, sort, export, and delete settings belong in a popover.

### Portrait

Show controls at the top, then a scrollable gallery, then result/log tabs. The gallery should keep useful image height; logs and operation results move below it.

### Regular

Use:

- left controls column: path, action, filters, risk switches
- right gallery and result tabs
- stats row above gallery

### Expanded / Workspace

Use:

- top toolbar for scan, filter, rename, delete, export
- left filter/operation inspector
- main gallery with adjustable density
- lower or side result/log tab set for rename/delete/export output

The gallery scrolls locally. Primary action, selected count, and dry-run/permanent state stay visible.

## Component Choices

Use:

- shadcn Button, Badge, Tabs, Popover, Tooltip, AlertDialog, ScrollArea
- local image URL handling through host APIs
- responsive gallery grid with density control
- Dice/TanStack DataTable for rename/delete/export result rows when table-like

Do not use:

- text-only wallpaper rows as the primary preview
- hidden destructive state
- package-side React UI
- oversized cards that make compact views unusable

## Split Points

Recommended structure:

```text
src/nodes/enginev/
  Component.tsx
  constants.ts
  controls.tsx
  WallpaperGallery.tsx
  OperationResultTable.tsx
  ResultPanels.tsx
  types.ts
  Component.test.tsx
```

`WallpaperGallery.tsx` owns image layout and selection. Result tables own batch operation output. `Component.tsx` stays focused on state and surface mode branching.

## Tests

Package:

- `bun --filter @xiranite/node-enginev test`
- `bun --filter @xiranite/node-enginev build`

App:

- surface matrix for all modes
- local preview URL resolution
- gallery selection and copy path
- filter controls
- dry-run rename confirmation
- delete confirmation and permanent delete warning
- export success/failure
- progress events and failed response

QA:

```bash
bun run qa:card -- enginev matrix --screenshot
```

Acceptance:

- gallery remains visual across compact/portrait/expanded modes
- long logs/results do not push filters and actions away
- destructive operations are impossible without confirmation
- image previews render without overlap or blank frames

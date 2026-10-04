# Czkawka Node UI Design Note

## Basic Judgment

Czkawka is an eleven-tool file-forensics workbench, not a single form. Its interface must keep scan sources, tool-specific algorithms, grouped results, media previews, selection rules, safe operations, analysis, and progress available without duplicating backend logic in React. Rust is limited to native scanning; TypeScript owns orchestration and every user-visible workflow.

## Core Tasks

1. Choose one of eleven scanners and configure shared sources and filters.
2. Run, monitor, pause through the host, or cancel a native scan.
3. Inspect virtualized grouped results with tool-specific columns.
4. Preview local images, videos, and audio through shared host URLs.
5. Filter, select, compare, and organize result groups.
6. Preview and execute safe delete, move/copy, extension correction, and export plans.
7. Reuse the same scan contract from GUI, CLI, and OpenTUI.

## Common Path

```text
choose scanner
-> add included/excluded directories and references
-> configure shared and tool-specific fields
-> run and watch native progress
-> filter grouped results and preview files
-> select with rules or manual controls
-> preview a safe operation
-> execute or export
```

## Dangerous Actions

- Delete defaults to the recycle bin; permanent deletion requires an explicit choice.
- Move, copy, and extension correction must expose a dry-run plan and collision policy.
- Empty-folder deletion rechecks the directory tree immediately before execution.
- A stopped scan may retain partial results, which must remain visibly marked as partial.

## Surface Layout

### Collapsed

Show the current scanner, phase/progress summary, result count, and one start/stop action. No configuration form is mounted.

### Compact

Use a three-tab workbench: conditions, results, and analysis. Scanner switching stays in the title selector, and the status bar remains reachable at the bottom.

### Portrait

Use the compact tab model with the same title selector and vertically scrollable condition cards. Avoid horizontal page scrolling; only the virtual result grid may scroll horizontally inside its own boundary.

### Regular

Use the full three-column workbench: source cards, grouped result grid, and analysis/operation cards, with an optional fixed preview panel. Keep the scanner selector and primary start/stop action in the header.

### Expanded / Workspace

Retain the regular structure and allow the bounded analysis panel, larger previews, and wider result columns. Do not stretch source controls into long empty rows.

## Component Choices

- Use shadcn buttons, badges, dialogs, menus, tabs, switches, tooltips, progress, and scroll areas.
- Use the Czkawka virtual result grid for fixed-row grouped virtualization, resizable columns, range selection, and context actions.
- Use shared local-media components for image, video, and audio preview.
- Use shared TS models for source lists, filters, selection history, card layout, operations, analysis, logs, and scan presets.
- Keep the workspace root transparent and let the Xiranite theme own the background.

## State and Persistence

- Scanner-specific results, filters, selections, preview widths, and panel state remain isolated by tool.
- Source fields, algorithm values, scan presets, card layout, and analysis panel geometry persist in node state.
- Versioned state migration must supply defaults for newly added fields without destroying existing presets.

## Accessibility

- Every icon-only action has an accessible name and tooltip where context is not obvious.
- Result rows support keyboard focus, checkbox selection, and menu semantics.
- Dialogs trap focus and expose descriptive titles.
- Start changes to Stop while running; cancellation feedback is announced in the visible status region.

## Split Points

```text
src/nodes/czkawka/
  Component.tsx             orchestration and surface branches
  source-inputs.tsx         directory/reference/token editors
  result-table.tsx          grouped virtual result grid
  media-preview.tsx         preview routing
  selection-assistant.tsx   selection UI
  analysis-panel.tsx        analysis presentation
  card-layout.tsx           movable card workspace
```

The package under `packages/nodes/czkawka` remains React-free and supplies all reusable domain logic to GUI, CLI, and OpenTUI.

## Tests

- Exercise collapsed, compact, portrait, regular, expanded, and workspace surfaces.
- Verify all eleven tool entries and the shared option schema.
- Verify native DTO mapping, progress, cancellation, and partial stopped results.
- Verify large virtual result windows, column resizing, range selection, context actions, and per-tool state restoration.
- Verify source picker/paste/reference/filter persistence and operation confirmation.
- Use Playwright for small-surface overflow, console health, and a real interaction chain; do not depend on manual in-app Browser steps.

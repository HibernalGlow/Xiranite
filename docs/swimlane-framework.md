# Xiranite swimlane framework

## Scope

Xiranite has five component-bearing workspace layouts: `cards`, `dockview`,
`flow`, `lane`, and `bento`. The project-level `lane` layout is a first-class
consumer of the same swimlane framework used by node-local workspaces.

Current consumers are:

- `src/components/workspace/lane/LaneView.tsx`: project workspace lane mode.
- `src/nodes/neoview/features/workspace/ReaderSwimlaneWorkspace.tsx`: NeoView
  lane mode, alongside its reversible four-edge mode.
- `src/nodes/czkawka/Component.tsx`: Czkawka source, results, and analysis
  workspace.

Shared code belongs in `src/components/workspace/swimlane`. A node must not
import another node's swimlane components.

## Shared contract

The framework provides controlled primitives. Consumers own persistence and
pass state changes back through their existing storage boundary.

- `model.ts`: order normalization, reordering, adjacent-lane lookup, focus and
  solo state, effective width, proportional viewport fitting, and preference
  normalization.
- `BarHandleGlyph.tsx`: shared `grip`, `groove`, `move`, `grab`, and `edge`
  handle visuals.
- `SwimlaneBarContent.tsx`: handle placement plus independently scrollable
  horizontal or vertical actions.
- `SwimlaneNavigatorBar.tsx`: movable lane or panel switcher with a shadcn
  context menu, title-bar docking, repeat-right-click close, pointer-cancel
  cleanup, and persisted percentage position.
- `SwimlaneBarAppearanceMenu.tsx`: native hover-open context submenu for the
  independently composable handle glyph and left/right position.
- `SwimlaneFitMenuItems.tsx`: shared one-shot and persistent proportional-fit
  menu actions.
- `SwimlaneInteractionSettings.tsx`: storage-agnostic controlled settings for
  focus-to-solo, navigator visibility while solo, edge reveal delay, hover
  focus, and hover-focus delay.
- `SwimlaneCollapseDragButton.tsx`: a lane fold button that becomes the lane
  reorder grip only while hovered or held.
- `LaneResizer.tsx`: shared accessible resize session with release, cancel,
  lost-capture, blur, and unmount cleanup.

All lanes remain in one horizontal strip. Solo changes a lane's effective
width to the viewport width and aligns the strip; it does not unmount or
overlay adjacent lanes. A solo lane retains that width while another lane is
active, so returning focus has no geometry jump.

Edge dwell scrolls the real strip to an adjacent lane without changing focus.
Click, wheel, focus, or configured hover activation changes the active lane.
Leaving a transient reveal restores the active solo lane.

The bar handle owns its right-click boundary (`data-context-menu-stop`), so a
workspace or node ancestor menu cannot flash before the bar menu. Menu
placement, collision avoidance, hover-open submenus, and keyboard navigation
are delegated to the installed shadcn/Radix context-menu primitives.

Proportional fitting preserves the current expanded-lane weights, reserves
collapsed-lane width, and respects each consumer's minimum and maximum widths.
The one-shot action performs one fit without changing preferences. Persistent
fit reruns after viewport or collapsed-lane geometry changes and after a lane
resize commits, using the resized lane as the new weight.

## Persistence boundaries

The framework does not write storage directly.

- Project `LaneView`: lane order, width, collapse, and card ownership remain in
  the workspace backend. Per-workspace active/solo lane, dwell delays, bar
  handle, and bar position use `laneWorkspacePreferences` in the existing UI
  preference store, including the persistent proportional-fit switch.
- NeoView: canonical state remains below `[nodes.neoview]` in
  `xiranite.config.toml`. Reader data remains in the legacy NeoView database.
  Persistent fit is stored as `auto_fit_to_viewport` under the swimlane table.
- Czkawka: state remains in the node's existing `workspaceLayout` object.
  Missing fields are normalized from the version 1 defaults.

Switching a consumer to the shared framework must not migrate data into a new
database or rewrite another presentation's geometry.

`SwimlaneInteractionSettings` always emits the same five camel-case values:
`soloOnFocus`, `showNavigatorInSolo`, `edgeRevealDelayMs`, `focusOnHover`, and
`focusDelayMs`. Project lane mode stores them directly in the active
workspace's `laneWorkspacePreferences`; Czkawka maps them to its existing
`workspaceLayout`; NeoView maps them to `readerSoloOnFocus`,
`showLaneNavigatorInReaderSolo`, `edgeRevealDelayMs`, `readerFocusOnHover`,
and `readerFocusHoverDelayMs` before writing its canonical TOML-backed
workspace patch. Labels may be consumer-specific, but the shared component
must not import or know any node DTO.

## Consumer-specific policy

NeoView keeps these policies in its adapter:

- reversible `edges | swimlane` presentation;
- consuming the first click that restores an inactive Reader;
- Reader input, radial menu, nine-grid, pointer-capture, and top/bottom edge
  boundaries;
- Reader-relative normal width and Reader chrome ownership.

The project lane view keeps dnd-kit card and lane reordering. Czkawka keeps its
scan state, result table, source and analysis panel internals, and compact
layout. These are not framework responsibilities.

## Adding a consumer

1. Normalize persisted order and interaction preferences with `model.ts`.
2. Render all lanes in a single horizontal overflow viewport.
3. Keep `activeLaneId` and `soloLaneId` independent.
4. Use the shared bar primitives for lane or panel switching.
5. Persist through the consumer's existing controlled callback.
6. Add unit coverage for normalization, focus, solo, and release cleanup.
7. Add Playwright coverage for real pointer drag, narrow-width bar scrolling,
   and solo focus transitions.

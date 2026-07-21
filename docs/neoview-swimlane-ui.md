# NeoView swimlane workspace

## Scope

NeoView exposes two runtime-selectable workspace presentations:

- `edges`: the existing top, right, bottom, and left edge shell.
- `swimlane`: a horizontally scrollable, single-plane lane strip.

Switching presentation must not reopen the current book, change the current
page, or rewrite the other presentation's geometry. The mode switch is
rendered inside the original Reader top chrome. Its state and persistence stay
independent of the edge and swimlane hosts even though the visible controls
are fused with Reader chrome.

The legacy `1920x1080` characterization in `migration/neoview/image.png` is the
visual reference for Reader chrome, panel density, colors, and icon semantics.
The swimlane presentation changes spatial behavior, not the Card visual
language.

## Layout contract

All lanes occupy one horizontal strip. Revealing a lane moves the strip; lanes
must never cover or float above another lane.

```text
World:       [ left panels ][ Reader ][ right panels ][ future lanes ... ]

Reader solo:             |----------- viewport -----------|
             [ left ][              Reader                ][ right ]

Reveal right:            |----------- viewport -----------|
                    [       Reader       ][ right panels ]
                         <- the complete strip moves left
```

The initial lane set is `left`, `reader`, and `right`. The persisted order is
generic and must be normalized so future lane identifiers can be introduced
without replacing the workspace model.

Panel lane widths are stored as absolute CSS pixels and are not clamped to the
current window width. Reader is the exception: its ordinary width is stored as
a viewport ratio, so changing between landscape and portrait cannot leave the
Reader wider than the workspace. When a panel lane is wider than the viewport,
focusing it aligns the nearest useful edge without changing its stored width.

## Reader solo contract

Reader solo is a property of the Reader lane, not a global workspace state.

- When the Reader lane is active and solo is enabled, its effective width is
  the workspace viewport width and the strip aligns it to the viewport.
- Activating another lane makes Reader inactive but does not clear solo.
- The first click on an inactive Reader lane activates Reader and restores its
  solo presentation. That click is consumed by the workspace and must not
  reach Reader area bindings, page navigation, video controls, or the radial
  menu.
- Once Reader is active, later input is dispatched normally.
- Turning solo off makes Reader an ordinary resizable lane using its persisted
  relative normal width.
- Resizing Reader updates its normal-width ratio. Entering solo never overwrites
  that ratio, and leaving solo terminates any stale resize gesture before the
  ordinary width is restored.
- An optional, configurable dwell inside an inactive Reader lane activates it
  and restores solo without requiring a click. Leaving Reader, horizontal
  panning, or starting another interaction cancels the dwell timer.

## Edge reveal and lane focus

While Reader is active and solo is enabled, dwelling at the horizontal edge
may reveal the adjacent lane by scrolling the real strip in the opposite
direction.

- Dwell alone is transient and does not change the active lane.
- Left and right reveal share a dedicated configurable dwell delay. Reader
  hover-focus has its own independent delay; neither uses the edge-shell show
  delay.
- Pointer, wheel, focus, context-menu, or drag interaction inside the revealed
  lane activates it and keeps the strip at that position.
- Leaving an unactivated reveal restores Reader after the configured delay.
- Panel input must not bubble into Reader pointer, wheel, area, gesture, or
  radial-menu routing.
- Reader pointer capture, an active drag, composition, a modal, or a floating
  menu suppresses edge reveal and automatic restoration.

Normal lane focus uses the minimum horizontal movement needed to make the lane
usable. When Reader solo remains enabled, focusing an adjacent lane keeps a
narrow portion of Reader visible where possible so a single Reader click can
restore the solo view. Manual horizontal panning may move Reader fully outside
the viewport.

## Panel lanes

The left and right panel lanes reuse the current `ReaderSidebar` panel registry,
icon rail, active-panel cache, Card components, and drag/drop contracts. Lane
presentation changes only the host geometry:

- the edge pin control and edge-only move/resize handles are hidden;
- the lane header owns collapse, reorder, focus, and width controls;
- each lane retains independent active-panel state;
- Card-to-panel membership remains shared with the edge presentation.

## Chrome ownership

- The workspace mode switch, edge actions, Reader solo action, settings action,
  window drag region, and native window controls are fused into the original
  Reader breadcrumb bar in edge mode and Reader solo.
- The mode switch and four edge-state buttons remain in the leading (left)
  group. Solo or top-pin, settings, and native window controls remain in the
  trailing (right) group.
- In ordinary swimlane mode, Reader actions continue to travel with the Reader
  lane. Native window controls alone remain at the node's top-right on a
  transparent layer, so the window remains operable while Reader is offscreen.
- Reader's lane header and lane drag handle are omitted while Reader solo is
  active. They return only when Reader becomes an ordinary resizable lane.
- Panel lane headers never own native window controls.
- Reader breadcrumb, page count, view toolbar, and bottom thumbnail strip stay
  inside the Reader lane.
- Reader top and bottom chrome remain Reader dock surfaces, not horizontal
  lanes.

## Persistence boundary

All settings are stored below `[nodes.neoview]` in `xiranite.config.toml`.

- Existing edge settings remain unchanged.
- Swimlane mode, order, panel widths, Reader width ratio, collapse state,
  active panels, active lane, Reader solo preference, and Reader hover-focus
  behavior and delays use a separate canonical swimlane group.
- The NeoView layout settings Card owns the default startup presentation,
  left/right reveal delay, Reader hover-focus toggle, and Reader focus delay.
- Transient edge reveal and live scroll offset are not persisted.
- Missing or invalid optional lane entries fall back to known defaults without
  modifying the edge layout.
- The first canonical swimlane state derives left and right widths from the
  current sidebar defaults; later mode switches do not synchronize geometry in
  either direction.

## Required verification

- Parser and TOML round-trip coverage for canonical, legacy-absent, mixed, and
  invalid swimlane configuration.
- Component tests for reversible mode switching, flat strip movement, lane
  focus, Reader solo restoration, click consumption, resize, collapse, reorder,
  panel switching, and panel-to-Reader input isolation.
- Playwright characterization at `1920x1080` plus a narrow viewport. Captures
  must include edge mode, Reader solo, adjacent-lane reveal, active side lane,
  and restored Reader solo.

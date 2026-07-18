# CardView GridStack Migration Plan

## Goal

Replace the hand-rolled Cards layout engine with a GridStack-backed layout while preserving the existing top-bar card layout controls:

- `grid`
- `stack`
- `split`
- `focus`

After the migration, these controls should generate GridStack layout presets. User drag/resize changes should become the source of truth and persist across reloads.

## Why This Migration Exists

The current Cards view is not a real dashboard layout system. It manually measures the canvas, computes absolute pixel rectangles, and applies them to each card:

- `src/components/workspace/CardView.tsx`
- `src/lib/workspaceLayout.ts`
- `src/components/workspace/ComponentCard.tsx`

This makes Cards sensitive to initial container measurement, reload timing, viewport changes, content differences, and hard-coded min sizes. The common symptom is that cards reload into basic/default-looking sizes instead of a stable adaptive dashboard layout.

The project already depends on `gridstack` and already has a working GridStack-based `BentoView`, so the safest path is to reuse that proven local pattern rather than introduce another layout library.

References:

- GridStack docs: https://gridstackjs.com/doc/html/classes/GridStack.html
- GridStack site: https://gridstackjs.com/
- Current local GridStack example: `src/components/workspace/BentoView.tsx`

## Non-Goals

- Do not redesign module internals.
- Do not remove `dockview`, `flow`, `lane`, or `bento`.
- Do not make Cards and Bento share persisted geometry unless the product decision is explicitly to merge those views.
- Do not keep `computeLayout` as the primary Cards layout engine.

## Current State

`CardView`:

- Filters visible components for `cards`.
- Measures canvas size with `ResizeObserver`.
- Calls `computeLayout`.
- Renders `ComponentCard` with `absolute` positioning.

`computeLayout`:

- Hard-codes `grid`, `stack`, `split`, and `focus`.
- Uses pixel sizes and constants such as `PAD`, `GAP`, `MIN_PANEL_W`, `MIN_PANEL_H`.
- Has no persisted per-card Cards layout.

`BentoView`:

- Uses GridStack.
- Persists layout through `component.bentoLayout`.
- Uses `setComponentBentoLayout`.

## Proposed Data Model

Add a Cards-specific GridStack layout field to `ComponentInstance`.

```ts
export interface ComponentInstance {
  // existing fields...

  /** GridStack-backed Cards layout in 12-column grid units. */
  cardsLayout?: { x: number; y: number; w: number; h: number }
}
```

Do not reuse `bentoLayout` unless Cards and Bento are intentionally merged. Reusing it would make resizing a card in Cards unexpectedly change Bento.

Add `cardsLayout` support anywhere component DTO conversion/hydration touches `bentoLayout`.

Likely files to inspect/update:

- `src/types/workspace.ts`
- `src/store/workspace/types.ts`
- `src/store/workspace/componentSlice.ts`
- `src/store/workspace/backendSlice.ts`
- `src/store/workspaceContext.tsx`
- shared DTO definitions under `packages/shared/src`

## Store Actions

Add an action parallel to `setComponentBentoLayout`.

```ts
setComponentCardsLayout(
  id: string,
  layout: { x: number; y: number; w: number; h: number },
): void
```

Implementation should mirror `setComponentBentoLayoutState`, but write `component.cardsLayout`.

Normalize cards layout with the same basic constraints:

```ts
function normalizeCardsLayout(layout: { x: number; y: number; w: number; h: number }) {
  const w = Math.max(2, Math.min(12, Math.round(layout.w)))
  const h = Math.max(2, Math.round(layout.h))
  const x = Math.max(0, Math.min(12 - w, Math.round(layout.x)))
  const y = Math.max(0, Math.round(layout.y))
  return { x, y, w, h }
}
```

## Deployment Defaults

When deploying a component into Cards, initialize `cardsLayout`.

```ts
deployComponent(moduleId, {
  viewMode: "cards",
  cardsLayout: defaultCardsLayout(instanceCounter, currentPreset),
})
```

If the deploy API should stay small, `deployComponentState` can always set a default `cardsLayout` alongside `bentoLayout`.

Recommended default:

- 12 columns.
- Standard card: `w: 4`, `h: 4`.
- Wider card every few items: `w: 6`, `h: 4`.
- Avoid overlapping by choosing `x/y` based on index.

## Preset Semantics

The top-bar buttons should no longer mean "render a different absolute-position algorithm forever." They should mean:

1. Generate a GridStack layout preset for currently visible Cards components.
2. Persist that generated layout into `component.cardsLayout`.
3. Let the user drag/resize from there.

Important behavior:

- Reload uses persisted `cardsLayout`.
- Drag/resize updates persisted `cardsLayout`.
- Pressing a preset button intentionally overwrites current Cards layout.
- New components get a default position based on the current preset.

## Preset Generators

Create a pure helper, for example:

```ts
type GridRect = { x: number; y: number; w: number; h: number }

function generateCardsPresetLayout(args: {
  components: ComponentInstance[]
  preset: CardLayout
  focusedId: string | null
}): Record<string, GridRect>
```

Suggested GridStack unit presets:

### grid

Auto-tile in 12 columns.

- 1 item: `w: 12`, `h: 6`
- 2 items: each `w: 6`, `h: 6`
- 3+ items: each `w: 4`, `h: 4`
- Continue rows by `y += h`

### split

Two columns.

- `w: 6`
- `h: 5`
- Alternate left/right by index.

### stack

GridStack is not ideal for overlapping cards. Use "stack" as a vertical dashboard stack rather than visual overlap.

- `x: 1`
- `w: 10`
- `h: 4`
- Increasing `y`

If visual overlap is mandatory, keep stack as a separate CSS mode outside GridStack, but that weakens the migration. Prefer non-overlapping GridStack stack.

### focus

Hero card plus right rail.

- Focused card: `x: 0`, `y: 0`, `w: 9`, `h: 8`
- Others: `x: 9`, `w: 3`, `h: 2`
- Others stack vertically in the right rail.

When a card header Focus button is clicked:

```ts
setCardLayout("focus")
focusComponent(comp.id)
applyCardsPreset("focus", comp.id)
```

## CardView Rewrite

Rewrite `CardView` to follow `BentoView`'s GridStack pattern.

Keep:

- `useWorkspaceVisibleComponents`
- Cards visibility filtering through `isComponentVisibleInView(component, "cards")`
- module drop target
- empty state
- hide/collapse/focus/fullscreen behaviors, if still desired

Remove from Cards primary path:

- `computeLayout`
- `ResizeObserver` canvas sizing
- absolute `ComponentCard` transform positioning

Skeleton:

```tsx
import { GridStack, type GridStackNode } from "gridstack"
import "gridstack/dist/gridstack.min.css"

const GRID_COLUMNS = 12
const GRID_CELL_HEIGHT = 92
const GRID_MARGIN = 10

export function CardView() {
  const gridRef = useRef<GridStack | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const cardComponents = useMemo(
    () => visibleComponents.filter((component) => isComponentVisibleInView(component, "cards")),
    [visibleComponents],
  )

  const persistGridLayout = useCallback((grid: GridStack) => {
    for (const node of grid.engine.nodes) {
      const id = node.id ? String(node.id) : node.el?.getAttribute("gs-id")
      if (!id) continue
      workspaceActions.setComponentCardsLayout(id, {
        x: node.x ?? 0,
        y: node.y ?? 0,
        w: node.w ?? 4,
        h: node.h ?? 4,
      })
    }
  }, [workspaceActions])

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container || cardComponents.length === 0) return undefined

    gridRef.current?.destroy(false)
    const grid = GridStack.init({
      acceptWidgets: false,
      animate: true,
      cellHeight: GRID_CELL_HEIGHT,
      column: GRID_COLUMNS,
      float: false,
      margin: GRID_MARGIN,
      draggable: { handle: ".xiranite-card-drag-handle" },
      resizable: { handles: "e,se,s,w" },
    }, container)

    gridRef.current = grid

    const syncLayout = () => persistGridLayout(grid)
    grid.on("change", syncLayout)
    grid.on("dragstop", syncLayout)
    grid.on("resizestop", syncLayout)

    return () => {
      syncLayout()
      grid.off("change")
      grid.off("dragstop")
      grid.off("resizestop")
      grid.destroy(false)
      if (gridRef.current === grid) gridRef.current = null
    }
  }, [cardComponents.length, componentIds, persistGridLayout])

  return (
    <div className="relative min-h-0 flex-1 overflow-auto ws-canvas-bg p-4">
      <div ref={containerRef} className="grid-stack xiranite-cards-grid mx-auto max-w-[1680px]">
        {cardComponents.map((component, index) => {
          const layout = layoutForCard(component, index)
          return (
            <div
              key={component.id}
              className="grid-stack-item"
              gs-id={component.id}
              gs-x={String(layout.x)}
              gs-y={String(layout.y)}
              gs-w={String(layout.w)}
              gs-h={String(layout.h)}
              gs-min-w="2"
              gs-min-h="2"
            >
              <div className="grid-stack-item-content">
                <CardWidget component={component} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

## ComponentCard Replacement

`ComponentCard` currently expects `ComputedLayout`. For GridStack-backed Cards, either:

1. Replace it with `CardWidget`, similar to `BentoWidget`.
2. Refactor `ComponentCard` so its chrome/body can be reused without layout props.

Recommended:

- Create `CardWidget` first for a clean migration.
- Later deduplicate `CardWidget` and `BentoWidget` into a shared dashboard widget chrome.

`CardWidget` should:

- Render a drag handle in the header: `.xiranite-card-drag-handle`.
- Keep module body mounted unless collapsed.
- Use `ModuleRenderer`.
- Keep hide/collapse/focus/fullscreen actions.
- Stop propagation on header buttons so GridStack drag does not start.

## Fullscreen Behavior

Two acceptable options:

### Option A: CSS overlay fullscreen

When `fullscreenComponentId` is set, render that component in an absolute overlay above the GridStack.

Pros:

- Simple.
- Does not mutate layout.
- Easy to exit.

Cons:

- Fullscreen is not represented in GridStack.

### Option B: GridStack temporary fullscreen

Save current layout, make target widget `x: 0, y: 0, w: 12, h: large`, hide or minimize others, then restore on exit.

Pros:

- GridStack owns all geometry.

Cons:

- More state complexity.

Recommended for first migration: Option A.

## Applying Presets From TopBar

Currently `TopBar` calls `workspaceActions.setCardLayout(key)`.

Update behavior so selecting a card layout also applies the preset.

Possible approaches:

### Minimal approach

In `CardView`, watch `cardLayout` and `focusedComponentId`; when they change because of a preset action, generate and persist layouts.

Risk:

- It may reapply a preset after reload if not guarded.

### Better approach

Add a dedicated action:

```ts
applyCardsLayoutPreset(preset: CardLayout, focusedId?: string | null): void
```

This action:

- Sets `state.cardLayout`.
- Generates layout for visible Cards components.
- Writes each component's `cardsLayout`.

Then change `TopBar` and card Focus button to call this action.

Recommended: Better approach.

## Persistence Rules

Use these rules to avoid the old "reload default size" problem:

- `cardsLayout` exists: always render from it.
- `cardsLayout` missing: generate a default layout once and persist it.
- User drag/resize: persist immediately on `change`, `dragstop`, and `resizestop`.
- Preset button: overwrite current `cardsLayout` intentionally.
- Reload: never recompute preset unless layout is missing.

## Migration Compatibility

Existing persisted components do not have `cardsLayout`.

On first Cards render:

1. For each visible Cards component missing `cardsLayout`, generate a default based on index.
2. Persist it with `setComponentCardsLayout`.
3. Avoid doing this on every render; compare existing layout first.

Do not delete legacy `position` or `size` yet. They are still noted as compatibility fields in `ComponentInstance`.

## CSS Notes

Import GridStack CSS in `CardView` or a shared workspace stylesheet:

```ts
import "gridstack/dist/gridstack.min.css"
```

Add Cards-specific styling:

```css
.xiranite-cards-grid .grid-stack-item-content {
  overflow: hidden;
}

.xiranite-card-drag-handle {
  cursor: grab;
}

.xiranite-card-drag-handle:active {
  cursor: grabbing;
}
```

Ensure module content uses `min-h-0` and `overflow-hidden` or `overflow-auto` deliberately. Some modules contain large tables; the widget body must not force GridStack height.

## Testing Checklist

Run:

```bash
bun run typecheck
bunx vite build
```

Manual/browser checks:

- Cards view loads with existing components.
- No card renders at a tiny/default fallback size after reload.
- Drag a card, reload, position persists.
- Resize a card, reload, size persists.
- Press `grid`, layout changes to tiled preset.
- Drag after `grid`, reload, dragged layout persists.
- Press `split`, layout changes to split preset.
- Press `stack`, layout changes to vertical stack preset.
- Press `focus`, selected/focused component becomes hero.
- Collapse a card; layout does not break.
- Hide a card in Cards; it disappears only from Cards.
- Bento layout remains unchanged after Cards drag/resize.
- Browser console has no invalid hook call or GridStack initialization errors.

## Suggested Implementation Order

1. Add `cardsLayout` type and DTO/hydration support.
2. Add `setComponentCardsLayout`.
3. Add `generateCardsPresetLayout`.
4. Rewrite `CardView` with GridStack, modeled on `BentoView`.
5. Add `CardWidget`.
6. Wire preset buttons through `applyCardsLayoutPreset`.
7. Remove Cards dependency on `computeLayout`.
8. Keep `computeLayout` only if other views still need it; otherwise delete it after tests pass.
9. Run typecheck, Vite build, and browser QA.

## Important Pitfalls

- Do not use `key={componentIds}` too broadly if it causes GridStack to destroy/recreate on every persisted layout change. It is acceptable during first migration, but watch for jitter.
- Do not persist layout continuously during initial GridStack hydration unless values actually changed.
- Do not let button clicks start GridStack drag; stop propagation on widget chrome buttons.
- Do not reuse `bentoLayout` accidentally.
- Do not recompute presets on every reload.
- Do not rely on pixel widths from `ResizeObserver`; GridStack should own layout sizing.

## Expected End State

Cards becomes a real persisted dashboard layout:

- GridStack owns placement and resize behavior.
- Preset buttons generate initial arrangements.
- User changes persist.
- Reload respects persisted Cards geometry.
- Bento remains independent.
- The old absolute-position `computeLayout` path is removed from Cards.

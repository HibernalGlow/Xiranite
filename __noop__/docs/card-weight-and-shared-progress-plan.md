# Cards Weight System and Shared Progress Surface Plan

## Goal

Evolve Cards into a distinct "smart overview / command deck" view instead of another freeform dashboard.

This plan has two parts:

1. Add a Cards weight system so Cards can automatically emphasize important components.
2. Add a shared component progress surface so Cards and Bento can show the same live progress bar around each component.

Important: do not implement the previous GridStack-backed Cards plan. The user has restored the original Cards code and does not want Cards to duplicate Bento.

## Product Direction

Current view boundaries should stay clear:

- `Dockview`: professional tabbed/split workbench.
- `Bento`: user-arranged dashboard widgets.
- `Cards`: automatically curated operational overview.

Cards should not become draggable/resizable like Bento. It should feel like a smart command deck:

- Active/running/error components become visually prominent.
- Idle components shrink.
- Recent/changed/pinned components stay discoverable.
- The system chooses sensible layout emphasis without requiring manual positioning.
- The user's explicit focus/collapse/hide choices still matter.

## Existing Local Context

Relevant files:

- `src/components/workspace/CardView.tsx`
- `src/lib/workspaceLayout.ts`
- `src/components/workspace/ComponentCard.tsx`
- `src/components/workspace/BentoView.tsx`
- `src/store/nodeOperations.ts`
- `src/types/workspace.ts`
- `packages/shared/src/index.ts`
- `src/nodes/shared/useNodeCardController.ts`

Current useful facts:

- `ComponentInstance.data` already exists and is shared by view modes.
- Many node components already write `phase`, `progress`, and `progressText` into component data.
- `useNodeOperations` tracks live node operations with `phase`, `lastProgress`, and `lastMessage`.
- `NodeRunEventDTO` already supports progress events: `{ type: "progress", progress?: number, message: string }`.
- `BentoView` and `ComponentCard` both render the same underlying `ModuleRenderer`, but each has separate chrome.

## Non-Goals

- Do not switch Cards to GridStack.
- Do not make Cards draggable/resizable.
- Do not merge Cards and Bento.
- Do not force every node component to be rewritten in one pass.
- Do not remove node-local progress bars inside components.
- Do not make progress UI depend only on backend operations; browser-only/mock/local component state should still work through `component.data`.

## Part 1: Shared Component Progress Surface

### UX Requirement

Cards and Bento should show a small live progress indicator on the component chrome, independent of each component's internal UI.

Recommended placement:

- Cards: bottom edge progress strip by default; top edge acceptable for compact cards.
- Bento: top or bottom edge inside the widget chrome, consistent with Cards.

Recommended visual behavior:

- `running`: animated/accent progress strip.
- `error`: destructive strip, keep visible until reset or next run.
- `completed`: briefly show 100%, then fade to subtle success state.
- `cancelled`: muted warning strip.
- `idle`: no strip, unless a last result should be subtly indicated.

### Canonical View Model

Create a small derived type for shared progress chrome.

Suggested file:

- `src/lib/componentSurfaceStatus.ts`

```ts
export type ComponentSurfacePhase =
  | "idle"
  | "queued"
  | "running"
  | "completed"
  | "error"
  | "cancelled"

export interface ComponentSurfaceStatus {
  phase: ComponentSurfacePhase
  progress: number | null
  label?: string
  message?: string
  updatedAt?: number
  operationId?: string
  source: "operation" | "component-data" | "none"
}
```

Keep this as a view-layer model. It should not replace node-specific state types.

### Progress Source Priority

When deriving progress for a component, use this priority:

1. Live node operation associated with the component.
2. `component.data.phase`, `component.data.progress`, `component.data.progressText`.
3. Terminal operation/result state if it is recent and associated with the component.
4. No status.

Pseudo-code:

```ts
function getComponentSurfaceStatus(args: {
  component: ComponentInstance
  operations: TrackedNodeOperation[]
  now?: number
}): ComponentSurfaceStatus {
  const operation = findBestOperationForComponent(args.component, args.operations)
  if (operation) return fromOperation(operation)
  return fromComponentData(args.component.data)
}
```

### Operation Association Gap

There is already a `NodeOperationContext` with `componentId` and `workspaceId` in service code, and run request schema has optional context. However, the shared `NodeOperationDTO` schema/interface currently does not expose `componentId` or `workspaceId`.

To make live operation progress reliable, add these optional fields to the shared DTO:

```ts
export const nodeOperationSchema = z.object({
  operationId: z.string().min(1),
  nodeId: z.string().min(1),
  componentId: z.string().optional(),
  workspaceId: z.string().optional(),
  phase: nodeOperationPhaseSchema,
  // ...
})

export interface NodeOperationDTO<TData = unknown> {
  operationId: string
  nodeId: string
  componentId?: string
  workspaceId?: string
  phase: NodeOperationPhaseDTO
  // ...
}
```

Then ensure `toOperationDTO` includes these fields.

This also makes `useNodeOperations` able to match by `componentId` without guessing by `nodeId`.

### Fallback For Existing Nodes

Until every operation has `componentId`, fallback to component data:

- `phase`
- `progress`
- `progressText`
- `result`

Many nodes already use this shape. Do not block the first implementation on perfect operation association.

### Hook API

Add a hook for components that render chrome:

```ts
export function useComponentSurfaceStatus(component: ComponentInstance): ComponentSurfaceStatus
```

Implementation:

- Subscribe to `useNodeOperations`.
- Filter operations by `component.id` first.
- Fallback to `component.data`.
- Return a memoized `ComponentSurfaceStatus`.

Keep selectors narrow so every progress event does not rerender the whole workspace more than necessary.

### Shared Progress Component

Suggested file:

- `src/components/workspace/ComponentProgressStrip.tsx`

Props:

```ts
interface ComponentProgressStripProps {
  status: ComponentSurfaceStatus
  placement?: "top" | "bottom"
  compact?: boolean
}
```

Behavior:

- Return `null` when `status.phase === "idle"` and no meaningful recent terminal state exists.
- Clamp progress to `0..100`.
- If progress is `null` but phase is `running`, render an indeterminate animated strip.
- Use semantic classes/tokens, not raw one-off colors where possible.
- Provide optional `title` text with message/progress for hover.

Recommended markup:

```tsx
export function ComponentProgressStrip({ status, placement = "bottom", compact = false }: ComponentProgressStripProps) {
  if (!shouldShowSurfaceStatus(status)) return null

  return (
    <div
      aria-label={status.message ?? status.label ?? "component progress"}
      className={cn("pointer-events-none absolute inset-x-0 z-30", placement === "top" ? "top-0" : "bottom-0")}
    >
      <div className="h-1 bg-muted/50">
        <div
          className={cn("h-full transition-[width,background-color] duration-200", phaseClass(status.phase))}
          style={status.progress == null ? undefined : { width: `${status.progress}%` }}
        />
      </div>
    </div>
  )
}
```

For indeterminate progress, use a CSS animation class instead of constantly updating width.

### Integration Points

In `ComponentCard`:

- Call `useComponentSurfaceStatus(comp)`.
- Render `ComponentProgressStrip` inside the outer card container.
- Put it near bottom unless the card is collapsed/compact.

In `BentoWidget`:

- Call `useComponentSurfaceStatus(component)`.
- Render the same `ComponentProgressStrip`.
- Use the same status mapping as Cards.

Do not put progress logic directly in both components. Keep the derivation central.

## Part 2: Cards Weight System

### UX Requirement

Cards should automatically decide card emphasis from component state.

Example behavior:

- Running component: large or hero.
- Error component: large and attention-colored.
- Focused component: hero.
- Recently completed component: large for a short time.
- Idle component: normal.
- Collapsed component: compact.

### Weight Types

Suggested type:

```ts
export type CardWeight = "hero" | "large" | "normal" | "compact"

export interface CardWeightMeta {
  weight: CardWeight
  score: number
  reasons: string[]
}
```

Suggested file:

- `src/lib/cardWeight.ts`

### Weight Rules

Use a scored system so rules can evolve without rewriting layout code.

Suggested scoring:

- `fullscreenComponentId === id`: handled separately by existing fullscreen flow.
- `focusedComponentId === id`: `+100`
- `phase === "error"`: `+90`
- `phase === "running"`: `+80`
- `phase === "queued"`: `+50`
- recent `completed`: `+35`
- `component.state === "focused"`: `+40`
- `component.z` recently raised or high relative z: `+10..20`
- `collapsed`: force `compact`
- hidden in Cards: excluded before scoring

Mapping:

- `score >= 100`: `hero`
- `score >= 70`: `large`
- `score >= 25`: `normal`
- collapsed or very low priority: `compact`

Pseudo-code:

```ts
export function getCardWeight(args: {
  component: ComponentInstance
  status: ComponentSurfaceStatus
  focusedComponentId: string | null
  now: number
}): CardWeightMeta {
  if (args.component.collapsed) return { weight: "compact", score: 0, reasons: ["collapsed"] }

  let score = 0
  const reasons: string[] = []

  if (args.focusedComponentId === args.component.id) {
    score += 100
    reasons.push("focused")
  }

  if (args.status.phase === "error") {
    score += 90
    reasons.push("error")
  } else if (args.status.phase === "running") {
    score += 80
    reasons.push("running")
  } else if (args.status.phase === "queued") {
    score += 50
    reasons.push("queued")
  }

  return { score, reasons, weight: score >= 100 ? "hero" : score >= 70 ? "large" : "normal" }
}
```

### Layout Semantics

Cards should keep existing top-bar layout modes, but each mode should use weights.

#### grid

Smart overview.

- Sort by score descending, then recency, then existing order.
- Hero card spans the largest available area.
- Large cards get more space.
- Normal cards tile.
- Compact cards become header strips or small cards.

#### stack

Activity deck.

- Sort by score/recency.
- Running/error/recent cards appear near the top.
- Compact idle cards can appear as a lower stack/list.
- Avoid manual overlap unless it is already visually reliable.

#### split

Operational split.

- Left side: active controls/running/error components.
- Right side: result-heavy or idle components.
- If there is a hero card, place it in the larger side.

#### focus

Hero plus rail.

- Focused card or highest-weight card becomes hero.
- Other components become right-side/bottom rail cards.
- Running/error cards in the rail should still show progress strips.

### Implementation Strategy For Existing `computeLayout`

Keep `computeLayout`, but make it weight-aware.

Change input:

```ts
export interface LayoutContext {
  components: ComponentInstance[]
  cardWeights?: Record<string, CardWeightMeta>
  layout: CardLayout
  focusedId: string | null
  fullscreenId: string | null
  W: number
  H: number
}
```

In `CardView`:

1. Derive `ComponentSurfaceStatus` for each card.
2. Derive `CardWeightMeta` for each card.
3. Pass weights into `computeLayout`.

If hook rules make deriving per-card status awkward inside a loop, create a single hook:

```ts
export function useComponentSurfaceStatusMap(components: ComponentInstance[]): Record<string, ComponentSurfaceStatus>
```

This hook can read `useNodeOperations` once, then derive a status map.

### Card Size Hints

Inside `computeLayout`, use weight to choose target sizes.

Suggested pixel/card ratios for the current absolute-position layout:

- `hero`: about 60-75% of available width or height depending on mode.
- `large`: at least 1.5x normal area.
- `normal`: current default tiled size.
- `compact`: header height or minimum readable strip.

Do not let compact cards render module bodies; collapsed handling already supports header-only rendering.

## Shared Metadata Contract For Nodes

To make progress and weights consistent, document a soft contract for component data:

```ts
interface ComponentRuntimeData {
  phase?: "idle" | "queued" | "running" | "completed" | "error" | "cancelled" | string
  progress?: number
  progressText?: string
  lastRunAt?: number
  lastCompletedAt?: number
  lastErrorAt?: number
}
```

This is not a hard replacement for node-specific data. It is a shared convention.

Existing nodes can keep their own fields. New shared chrome should only read the common fields if present.

## Node Operation Context Follow-Up

For best live progress, ensure node run calls pass component context.

Check:

- `src/backend/nodeRpcClient.ts`
- `src/nodes/shared/useNodeCardController.ts`
- any node-specific wrappers around `host.run`

The goal:

```ts
host.run(nodeId, input, onEvent, {
  componentId: compId,
  workspaceId,
})
```

Use whatever actual local API shape exists, but make sure backend operation state can identify the originating component.

## Files To Create

Suggested new files:

- `src/lib/componentSurfaceStatus.ts`
- `src/lib/cardWeight.ts`
- `src/components/workspace/ComponentProgressStrip.tsx`

Optional:

- `src/components/workspace/useComponentSurfaceStatusMap.ts`
- `src/components/workspace/CardWeightBadge.tsx` for QA/debug only

## Files To Modify

Likely:

- `src/components/workspace/CardView.tsx`
- `src/lib/workspaceLayout.ts`
- `src/components/workspace/ComponentCard.tsx`
- `src/components/workspace/BentoView.tsx`
- `src/store/nodeOperations.ts`
- `packages/shared/src/index.ts`
- `packages/services/src/index.ts`
- `src/nodes/shared/useNodeCardController.ts`

Avoid changing every node component at once. Use fallback extraction from `component.data`.

## Testing Plan

Automated:

```bash
bun run typecheck
bunx vite build
```

Add focused unit tests if feasible:

- `componentSurfaceStatus` derives running progress from live operation.
- `componentSurfaceStatus` falls back to component data.
- `cardWeight` maps running/error/focused/collapsed correctly.
- `computeLayout` produces larger geometry for hero/large cards.

Manual/browser checks:

- Running a node updates the internal node progress and the card chrome progress.
- The same component shows progress in Bento.
- Error state makes card visually prominent.
- Completed state reaches 100%.
- Collapsed cards do not show full module body but can still show a compact progress strip if running.
- Cards `grid` mode emphasizes active cards.
- Cards `focus` mode chooses focused card as hero.
- Bento layout behavior remains unchanged.
- Dockview remains unaffected.

## Suggested Implementation Order

1. Add `ComponentSurfaceStatus` derivation from `component.data`.
2. Render `ComponentProgressStrip` in `ComponentCard`.
3. Render `ComponentProgressStrip` in `BentoWidget`.
4. Add live operation matching via `componentId` if DTO/schema support is ready.
5. Add `CardWeight` derivation.
6. Pass weights into `computeLayout`.
7. Tune `grid/stack/split/focus` layouts with weights.
8. Add tests and browser QA.

## Design Notes

- Cards should feel automatic, not manually arranged.
- Progress strips should be ambient and useful, not noisy.
- Node-local progress UI remains valuable for details; shared chrome is for glanceability.
- If a component is not currently running and has no meaningful terminal state, do not show a progress strip.
- Prefer one shared derivation path over many per-node adapters.

## Expected End State

Cards becomes a differentiated view:

- It automatically surfaces active/error/recent work.
- It shows shared live progress across component cards.
- It stays distinct from Bento and Dockview.
- Bento gains progress visibility without changing its dashboard purpose.
- The existing Cards code path remains recognizable; no GridStack migration is required for Cards.

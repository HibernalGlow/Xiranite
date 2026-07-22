export type SwimlaneBarHandleStyle = "grip" | "groove" | "move" | "grab" | "edge"
export type SwimlaneBarHandlePosition = "left" | "right"
export type SwimlaneBarDock = "left" | "right" | "top" | "bottom" | "floating"

export interface SwimlaneGeometry {
  width: number
  collapsed: boolean
}

export interface SwimlaneInteractionState<Id extends string = string> {
  laneOrder: Id[]
  activeLaneId: Id
  soloLaneId?: Id
}

export interface SwimlaneWorkspacePreferences {
  activeLaneId?: string
  soloLaneId?: string | null
  focusOnHover: boolean
  focusDelayMs: number
  edgeRevealDelayMs: number
  barHandleStyle: SwimlaneBarHandleStyle
  barHandlePosition: SwimlaneBarHandlePosition
  navigatorPositionX: number
  navigatorPositionY: number
}

export const DEFAULT_SWIMLANE_WORKSPACE_PREFERENCES: SwimlaneWorkspacePreferences = {
  focusOnHover: false,
  focusDelayMs: 650,
  edgeRevealDelayMs: 250,
  barHandleStyle: "grip",
  barHandlePosition: "left",
  navigatorPositionX: 96,
  navigatorPositionY: 94,
}

export function normalizeSwimlanePreferences(value: Partial<SwimlaneWorkspacePreferences> | undefined): SwimlaneWorkspacePreferences {
  return {
    activeLaneId: typeof value?.activeLaneId === "string" ? value.activeLaneId : undefined,
    soloLaneId: typeof value?.soloLaneId === "string" || value?.soloLaneId === null ? value.soloLaneId : undefined,
    focusOnHover: value?.focusOnHover === true,
    focusDelayMs: clamp(value?.focusDelayMs, 200, 5000, DEFAULT_SWIMLANE_WORKSPACE_PREFERENCES.focusDelayMs),
    edgeRevealDelayMs: clamp(value?.edgeRevealDelayMs, 100, 5000, DEFAULT_SWIMLANE_WORKSPACE_PREFERENCES.edgeRevealDelayMs),
    barHandleStyle: value?.barHandleStyle === "groove" || value?.barHandleStyle === "move" || value?.barHandleStyle === "grab" || value?.barHandleStyle === "edge" ? value.barHandleStyle : "grip",
    barHandlePosition: value?.barHandlePosition === "right" ? "right" : "left",
    navigatorPositionX: clamp(value?.navigatorPositionX, 0, 100, DEFAULT_SWIMLANE_WORKSPACE_PREFERENCES.navigatorPositionX),
    navigatorPositionY: clamp(value?.navigatorPositionY, 0, 100, DEFAULT_SWIMLANE_WORKSPACE_PREFERENCES.navigatorPositionY),
  }
}

export function normalizeSwimlaneOrder<Id extends string>(
  value: readonly string[] | undefined,
  knownIds: readonly Id[],
): Id[] {
  const known = new Set<string>(knownIds)
  const next: Id[] = []
  for (const id of value ?? []) {
    if (!known.has(id) || next.includes(id as Id)) continue
    next.push(id as Id)
  }
  for (const id of knownIds) if (!next.includes(id)) next.push(id)
  return next
}

export function reorderSwimlanes<Id extends string>(
  laneOrder: readonly Id[],
  draggedLaneId: Id,
  targetLaneId: Id,
): Id[] {
  if (draggedLaneId === targetLaneId || !laneOrder.includes(draggedLaneId) || !laneOrder.includes(targetLaneId)) {
    return [...laneOrder]
  }
  const next = laneOrder.filter((id) => id !== draggedLaneId)
  next.splice(next.indexOf(targetLaneId), 0, draggedLaneId)
  return next
}

export function adjacentSwimlane<Id extends string>(
  laneOrder: readonly Id[],
  laneId: Id,
  edge: "left" | "right",
): Id | undefined {
  const index = laneOrder.indexOf(laneId)
  if (index < 0) return undefined
  return laneOrder[index + (edge === "left" ? -1 : 1)]
}

export function activateSwimlane<Id extends string>(
  state: SwimlaneInteractionState<Id>,
  laneId: Id,
  options: { soloOnFocus?: boolean } = {},
): SwimlaneInteractionState<Id> {
  return {
    ...state,
    activeLaneId: laneId,
    soloLaneId: options.soloOnFocus ? laneId : state.soloLaneId,
  }
}

export function effectiveSwimlaneWidth(
  width: number,
  collapsed: boolean,
  laneId: string,
  state: SwimlaneInteractionState,
  viewportWidth: number,
  collapsedWidth = 44,
): number {
  if (collapsed) return collapsedWidth
  if (state.soloLaneId === laneId) return Math.max(1, viewportWidth)
  return Math.max(1, width)
}

function clamp(value: number | undefined, minimum: number, maximum: number, fallback: number): number {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value! : fallback))
}

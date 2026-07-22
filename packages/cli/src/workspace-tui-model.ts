import type { ComponentDTO, LaneDTO, WorkspaceSnapshotDTO } from "@xiranite/shared"
import {
  DEFAULT_SWIMLANE_WORKSPACE_PREFERENCES,
  activateSwimlane,
  adjacentSwimlane,
  fitSwimlaneWidthsToViewport,
  normalizeSwimlaneOrder,
  reorderSwimlanes,
  type SwimlaneNavigatorDock,
} from "@xiranite/shared/swimlane"

export const BENTO_COLUMNS = 12

export function deployNode(snapshot: WorkspaceSnapshotDTO, workspaceId: string, moduleId: string, now = Date.now(), laneId?: string): { snapshot: WorkspaceSnapshotDTO; componentId: string } {
  const existing = snapshot.components.filter((item) => item.workspaceId === workspaceId)
  const componentId = `comp-tui-${now}-${existing.length + 1}`
  const component: ComponentDTO = {
    id: componentId,
    moduleId,
    workspaceId,
    ...(laneId ? { laneId } : {}),
    bentoLayout: nextLayout(existing),
    createdAt: now,
    updatedAt: now,
  }
  return { snapshot: { ...snapshot, components: [...snapshot.components, component] }, componentId }
}

export interface TerminalSwimlaneState {
  laneOrder: string[]
  activeLaneId?: string
  soloLaneId?: string
  navigatorDock: SwimlaneNavigatorDock
  navigatorVisible: boolean
  autoFitToViewport: boolean
}

export interface TerminalSwimlaneProjection {
  id: string
  label: string
  active: boolean
  solo: boolean
  collapsed: boolean
  terminalWidth: number
  components: ComponentDTO[]
}

export function createTerminalSwimlaneState(snapshot: WorkspaceSnapshotDTO, workspaceId: string, previous?: Partial<TerminalSwimlaneState>): TerminalSwimlaneState {
  const lanes = workspaceLanes(snapshot, workspaceId)
  const laneOrder = normalizeSwimlaneOrder(previous?.laneOrder, lanes.map((lane) => lane.id))
  const activeLaneId = laneOrder.includes(previous?.activeLaneId ?? "") ? previous?.activeLaneId : laneOrder[0]
  return {
    laneOrder,
    activeLaneId,
    ...(laneOrder.includes(previous?.soloLaneId ?? "") ? { soloLaneId: previous?.soloLaneId } : {}),
    navigatorDock: previous?.navigatorDock ?? DEFAULT_SWIMLANE_WORKSPACE_PREFERENCES.navigatorDock,
    navigatorVisible: previous?.navigatorVisible !== false,
    autoFitToViewport: previous?.autoFitToViewport === true,
  }
}

export function projectTerminalSwimlanes(snapshot: WorkspaceSnapshotDTO, workspaceId: string, availableColumns: number, state: TerminalSwimlaneState): TerminalSwimlaneProjection[] {
  const laneById = new Map(workspaceLanes(snapshot, workspaceId).map((lane) => [lane.id, lane]))
  const order = normalizeSwimlaneOrder(state.laneOrder, [...laneById.keys()])
  const visibleOrder = state.soloLaneId && laneById.has(state.soloLaneId) ? [state.soloLaneId] : order
  const constraints = visibleOrder.map((id) => {
    const lane = laneById.get(id)!
    return { id, width: lane.widthRatio, collapsed: lane.collapsed, collapsedWidth: 5, minimumWidth: 16 }
  })
  const widths = state.soloLaneId || state.autoFitToViewport
    ? fitSwimlaneWidthsToViewport(Math.max(16, availableColumns), constraints)
    : Object.fromEntries(constraints.filter((lane) => !lane.collapsed).map((lane) => [lane.id, Math.max(16, Math.round(lane.width * 24))])) as Record<string, number>
  return visibleOrder.map((id) => {
    const lane = laneById.get(id)!
    return {
      id,
      label: lane.label,
      active: state.activeLaneId === id,
      solo: state.soloLaneId === id,
      collapsed: lane.collapsed,
      terminalWidth: lane.collapsed ? 5 : Math.max(16, widths[id] ?? 16),
      components: orderedLaneComponents(snapshot, workspaceId, lane),
    }
  })
}

export function activateTerminalSwimlane(state: TerminalSwimlaneState, laneId: string, soloOnFocus = false): TerminalSwimlaneState {
  if (!state.laneOrder.includes(laneId)) return state
  const next = activateSwimlane({ laneOrder: state.laneOrder, activeLaneId: state.activeLaneId ?? laneId, soloLaneId: state.soloLaneId }, laneId, { soloOnFocus })
  return { ...state, activeLaneId: next.activeLaneId, soloLaneId: next.soloLaneId }
}

export function focusAdjacentTerminalSwimlane(state: TerminalSwimlaneState, edge: "left" | "right"): TerminalSwimlaneState {
  const active = state.activeLaneId ?? state.laneOrder[0]
  if (!active) return state
  const adjacent = adjacentSwimlane(state.laneOrder, active, edge)
  return adjacent ? activateTerminalSwimlane(state, adjacent) : state
}

export function toggleTerminalSwimlaneSolo(state: TerminalSwimlaneState): TerminalSwimlaneState {
  if (!state.activeLaneId) return state
  return { ...state, soloLaneId: state.soloLaneId === state.activeLaneId ? undefined : state.activeLaneId }
}

export function resetTerminalSwimlaneNavigator(state: TerminalSwimlaneState): TerminalSwimlaneState {
  return { ...state, navigatorDock: "floating", navigatorVisible: true }
}

export function patchWorkspaceLane(snapshot: WorkspaceSnapshotDTO, laneId: string, patch: { collapsed?: boolean; widthRatio?: number }, now = Date.now()): WorkspaceSnapshotDTO {
  return {
    ...snapshot,
    lanes: snapshot.lanes.map((lane) => lane.id === laneId ? {
      ...lane,
      ...(patch.collapsed === undefined ? {} : { collapsed: patch.collapsed }),
      ...(patch.widthRatio === undefined ? {} : { widthRatio: clamp(patch.widthRatio, 0.25, 4) }),
      updatedAt: now,
    } : lane),
  }
}

export function addWorkspaceLane(snapshot: WorkspaceSnapshotDTO, workspaceId: string, now = Date.now()): { snapshot: WorkspaceSnapshotDTO; laneId: string } {
  const existing = workspaceLanes(snapshot, workspaceId)
  const laneId = `lane-tui-${now}-${existing.length + 1}`
  const lane: LaneDTO = {
    id: laneId,
    label: `泳道 ${existing.length + 1}`,
    workspaceId,
    widthRatio: 1,
    collapsed: false,
    cardOrder: [],
    createdAt: now,
    updatedAt: now,
  }
  return { snapshot: { ...snapshot, lanes: [...snapshot.lanes, lane] }, laneId }
}

export function moveWorkspaceLane(snapshot: WorkspaceSnapshotDTO, workspaceId: string, laneId: string, edge: "left" | "right", now = Date.now()): WorkspaceSnapshotDTO {
  const ids = workspaceLanes(snapshot, workspaceId).map((lane) => lane.id)
  const target = adjacentSwimlane(ids, laneId, edge)
  if (!target) return snapshot
  const reordered = edge === "left" ? reorderSwimlanes(ids, laneId, target) : reorderSwimlanes(ids, target, laneId)
  const order = new Map(reordered.map((id, index) => [id, index]))
  const scoped = snapshot.lanes.filter((lane) => lane.workspaceId === workspaceId).sort((left, right) => order.get(left.id)! - order.get(right.id)!)
  let scopedIndex = 0
  return { ...snapshot, lanes: snapshot.lanes.map((lane) => lane.workspaceId === workspaceId ? { ...scoped[scopedIndex++]!, updatedAt: now } : lane) }
}

export function removeNode(snapshot: WorkspaceSnapshotDTO, componentId: string): WorkspaceSnapshotDTO {
  return {
    ...snapshot,
    components: snapshot.components.filter((item) => item.id !== componentId),
    lanes: snapshot.lanes.map((lane) => ({ ...lane, cardOrder: lane.cardOrder?.filter((id) => id !== componentId) })),
  }
}

export function patchNodeLayout(snapshot: WorkspaceSnapshotDTO, componentId: string, patch: Partial<NonNullable<ComponentDTO["bentoLayout"]>>, now = Date.now()): WorkspaceSnapshotDTO {
  return {
    ...snapshot,
    components: snapshot.components.map((component) => {
      if (component.id !== componentId) return component
      const current = component.bentoLayout ?? { x: 0, y: 0, w: 4, h: 4 }
      const w = clamp(Math.round(patch.w ?? current.w), 2, BENTO_COLUMNS)
      const h = Math.max(2, Math.round(patch.h ?? current.h))
      const x = clamp(Math.round(patch.x ?? current.x), 0, BENTO_COLUMNS - w)
      const y = Math.max(0, Math.round(patch.y ?? current.y))
      return { ...component, bentoLayout: { x, y, w, h }, updatedAt: now }
    }),
  }
}

export function projectTerminalLayout(components: readonly ComponentDTO[], availableColumns: number): Array<ComponentDTO & { terminalWidth: number; terminalHeight: number }> {
  const unit = Math.max(2, Math.floor(Math.max(24, availableColumns) / BENTO_COLUMNS))
  return [...components]
    .sort((left, right) => (left.bentoLayout?.y ?? 0) - (right.bentoLayout?.y ?? 0) || (left.bentoLayout?.x ?? 0) - (right.bentoLayout?.x ?? 0))
    .map((component) => ({
      ...component,
      terminalWidth: Math.max(14, Math.min(availableColumns, (component.bentoLayout?.w ?? 4) * unit)),
      terminalHeight: Math.max(4, Math.min(12, component.bentoLayout?.h ?? 4)),
    }))
}

function nextLayout(existing: readonly ComponentDTO[]) {
  const index = existing.length
  return { x: (index * 4) % BENTO_COLUMNS, y: Math.floor(index / 3) * 4, w: 4, h: 4 }
}

function workspaceLanes(snapshot: WorkspaceSnapshotDTO, workspaceId: string): LaneDTO[] {
  return snapshot.lanes.filter((lane) => lane.workspaceId === workspaceId && !lane.hidden)
}

function orderedLaneComponents(snapshot: WorkspaceSnapshotDTO, workspaceId: string, lane: LaneDTO): ComponentDTO[] {
  const order = new Map((lane.cardOrder ?? []).map((id, index) => [id, index]))
  return snapshot.components
    .filter((component) => component.workspaceId === workspaceId && component.laneId === lane.id && component.hiddenIn?.lane !== true)
    .sort((left, right) => (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.id) ?? Number.MAX_SAFE_INTEGER) || left.createdAt - right.createdAt)
}

function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)) }

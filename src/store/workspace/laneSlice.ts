import { nextLaneId } from "./idCounters"
import type { WorkspaceLaneActions, WorkspaceStoreUpdater, WSState } from "./types"

export function createLaneSlice(update: WorkspaceStoreUpdater): WorkspaceLaneActions {
  return {
    addLane: (workspaceId, label) => update("ADD_LANE", (state) => addLaneState(state, workspaceId, label)),
    removeLane: (id) => update("REMOVE_LANE", (state) => removeLaneState(state, id)),
    renameLane: (id, label) => update("RENAME_LANE", (state) => renameLaneState(state, id, label)),
    setLaneWidthRatio: (id, ratio) => update("SET_LANE_WIDTH_RATIO", (state) => setLaneWidthRatioState(state, id, ratio)),
    toggleLaneCollapse: (id) => update("TOGGLE_LANE_COLLAPSE", (state) => toggleLaneCollapseState(state, id)),
    toggleLaneVisibility: (id) => update("TOGGLE_LANE_VISIBILITY", (state) => toggleLaneVisibilityState(state, id)),
    reorderLane: (fromId, toId) => update("REORDER_LANE", (state) => reorderLaneState(state, fromId, toId)),
    setLaneCardOrder: (id, cardOrder) => update("SET_LANE_CARD_ORDER", (state) => setLaneCardOrderState(state, id, cardOrder)),
    setLaneBoardLayout: (workspaceId, laneOrder, cardOrderByLane) =>
      update("SET_LANE_BOARD_LAYOUT", (state) => setLaneBoardLayoutState(state, workspaceId, laneOrder, cardOrderByLane)),
    moveComponentToLane: (componentId, toLaneId, targetCardId, insertAfter) =>
      update("MOVE_COMPONENT_TO_LANE", (state) => moveComponentToLaneState(state, componentId, toLaneId, targetCardId, insertAfter)),
  }
}

function addLaneState(state: WSState, workspaceId?: string, label?: string): WSState {
  const now = Date.now()
  const nextWorkspaceId = workspaceId ?? state.activeWorkspaceId
  const lane = {
    id: nextLaneId(now),
    label: label ?? `LANE ${state.lanes.filter((item) => item.workspaceId === nextWorkspaceId).length + 1}`,
    workspaceId: nextWorkspaceId,
    widthRatio: 1,
    collapsed: false,
    hidden: false,
    cardOrder: [],
    createdAt: now,
    updatedAt: now,
  }
  return { ...state, lanes: [...state.lanes, lane] }
}

function removeLaneState(state: WSState, id: string): WSState {
  return {
    ...state,
    lanes: state.lanes.filter((lane) => lane.id !== id),
    components: state.components.map((component) =>
      component.laneId === id ? { ...component, laneId: undefined, updatedAt: Date.now() } : component,
    ),
  }
}

function renameLaneState(state: WSState, id: string, label: string): WSState {
  return {
    ...state,
    lanes: state.lanes.map((lane) => lane.id === id ? { ...lane, label, updatedAt: Date.now() } : lane),
  }
}

function setLaneWidthRatioState(state: WSState, id: string, ratio: number): WSState {
  return {
    ...state,
    lanes: state.lanes.map((lane) =>
      lane.id === id ? { ...lane, widthRatio: Math.max(0.25, Math.min(4, ratio)), updatedAt: Date.now() } : lane,
    ),
  }
}

function toggleLaneCollapseState(state: WSState, id: string): WSState {
  return {
    ...state,
    lanes: state.lanes.map((lane) => lane.id === id ? { ...lane, collapsed: !lane.collapsed, updatedAt: Date.now() } : lane),
  }
}

function toggleLaneVisibilityState(state: WSState, id: string): WSState {
  return {
    ...state,
    lanes: state.lanes.map((lane) => lane.id === id ? { ...lane, hidden: !lane.hidden, updatedAt: Date.now() } : lane),
  }
}

function reorderLaneState(state: WSState, fromId: string, toId: string): WSState {
  const fromIndex = state.lanes.findIndex((lane) => lane.id === fromId)
  const toIndex = state.lanes.findIndex((lane) => lane.id === toId)
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return state
  const next = [...state.lanes]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, { ...moved, updatedAt: Date.now() })
  return { ...state, lanes: next }
}

function setLaneCardOrderState(state: WSState, id: string, cardOrder: string[]): WSState {
  return {
    ...state,
    lanes: state.lanes.map((lane) => lane.id === id ? { ...lane, cardOrder, updatedAt: Date.now() } : lane),
  }
}

function setLaneBoardLayoutState(
  state: WSState,
  workspaceId: string | undefined,
  laneOrder: string[],
  cardOrderByLane: Record<string, string[]>,
): WSState {
  const now = Date.now()
  const targetWorkspaceId = workspaceId ?? state.activeWorkspaceId
  const orderedLaneIds = new Set(laneOrder)
  const lanesById = new Map(state.lanes.map((lane) => [lane.id, lane]))
  const orderedWorkspaceLanes = laneOrder
    .map((id) => lanesById.get(id))
    .filter((lane): lane is NonNullable<typeof lane> => !!lane && lane.workspaceId === targetWorkspaceId)

  const lanes = [
    ...state.lanes.filter((lane) => lane.workspaceId !== targetWorkspaceId),
    ...orderedWorkspaceLanes.map((lane) => ({
      ...lane,
      cardOrder: cardOrderByLane[lane.id] ?? lane.cardOrder ?? [],
      updatedAt: now,
    })),
    ...state.lanes.filter((lane) => lane.workspaceId === targetWorkspaceId && !orderedLaneIds.has(lane.id)),
  ]

  const componentLaneById = new Map<string, string>()
  for (const [laneId, cardIds] of Object.entries(cardOrderByLane)) {
    for (const cardId of cardIds) componentLaneById.set(cardId, laneId)
  }

  const components = state.components.map((component) => {
    const laneId = componentLaneById.get(component.id)
    if (!laneId || component.laneId === laneId) return component
    return { ...component, laneId, updatedAt: now }
  })

  return { ...state, lanes, components }
}

function moveComponentToLaneState(
  state: WSState,
  componentId: string,
  toLaneId: string,
  targetCardId?: string | null,
  insertAfter?: boolean,
): WSState {
  const component = state.components.find((item) => item.id === componentId)
  if (!component) return state

  const fromLaneId = component.laneId
  if (fromLaneId === toLaneId && !targetCardId) return state

  const now = Date.now()
  const components = state.components.map((item) =>
    item.id === componentId ? { ...item, laneId: toLaneId, updatedAt: now } : item,
  )

  let lanes = state.lanes.map((lane) => {
    if (lane.id !== fromLaneId) return lane
    return {
      ...lane,
      cardOrder: lane.cardOrder?.filter((id) => id !== componentId),
      updatedAt: now,
    }
  })

  lanes = lanes.map((lane) => {
    if (lane.id !== toLaneId) return lane
    const order = (lane.cardOrder ?? []).filter((id) => id !== componentId)
    if (!targetCardId) {
      order.push(componentId)
    } else {
      const index = order.indexOf(targetCardId)
      if (index < 0) order.push(componentId)
      else order.splice(insertAfter ? index + 1 : index, 0, componentId)
    }
    return { ...lane, collapsed: false, cardOrder: order, updatedAt: now }
  })

  return { ...state, components, lanes }
}

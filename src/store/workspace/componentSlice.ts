import type { ComponentInstance, ComponentState, DeployComponentOptions, Lane, ViewMode } from "@/types/workspace"
import { VIEW_MODES } from "./constants"
import { nextComponentCounter, nextLaneId } from "./idCounters"
import type { ComponentPatch, WorkspaceComponentActions, WorkspaceStoreUpdater, WSState } from "./types"

export function createComponentSlice(update: WorkspaceStoreUpdater): WorkspaceComponentActions {
  return {
    deployComponent: (moduleId, viewModeOrOptions) =>
      update("DEPLOY_COMPONENT", (state) => deployComponentState(state, moduleId, normalizeDeployOptions(viewModeOrOptions))),
    ensureComponent: (component) => update("ENSURE_COMPONENT", (state) => ensureComponentState(state, component)),
    removeComponent: (id) => update("REMOVE_COMPONENT", (state) => removeComponentState(state, id)),
    setComponentState: (id, state) => update("SET_COMPONENT_STATE", (store) => setComponentRuntimeState(store, id, state)),
    setComponentPosition: (id, x, y) => update("SET_COMPONENT_POSITION", (state) => setComponentPositionState(state, id, x, y)),
    moveComponent: (id, x, y) => update("MOVE_COMPONENT", (state) => setComponentPositionState(state, id, x, y)),
    setComponentFlowPos: (id, x, y) => update("SET_COMPONENT_FLOW_POS", (state) => setComponentFlowPosState(state, id, x, y)),
    setComponentFlowSize: (id, width, height) => update("SET_COMPONENT_FLOW_SIZE", (state) => setComponentFlowSizeState(state, id, width, height)),
    setComponentBentoLayout: (id, layout) => update("SET_COMPONENT_BENTO_LAYOUT", (state) => setComponentBentoLayoutState(state, id, layout)),
    setComponentLaneSize: (id, size) => update("SET_COMPONENT_LANE_SIZE", (state) => setComponentLaneSizeState(state, id, size)),
    setComponentData: (id, data) => update("SET_COMPONENT_DATA", (state) => setComponentDataState(state, id, data)),
    patchComponentData: (id, patch) => update("PATCH_COMPONENT_DATA", (state) => patchComponentDataState(state, id, patch)),
    updateComponent: (id, patch) => update("UPDATE_COMPONENT", (state) => updateComponentState(state, id, patch)),
    setComponentDockPanel: (id, panelId) => update("SET_COMPONENT_DOCK_PANEL", (state) => setComponentDockPanelState(state, id, panelId)),
    setComponentVisibility: (id, viewMode, visible) =>
      update("SET_COMPONENT_VISIBILITY", (state) => setComponentVisibilityState(state, id, viewMode, visible)),
    toggleComponentVisibility: (id, viewMode) =>
      update("TOGGLE_COMPONENT_VISIBILITY", (state) => toggleComponentVisibilityState(state, id, viewMode)),
    setComponentTags: (id, tags) => update("SET_COMPONENT_TAGS", (state) => setComponentTagsState(state, id, tags)),
    focusComponent: (id) => update("FOCUS_COMPONENT", () => ({ focusedComponentId: id })),
    setFullscreen: (id) => update("SET_FULLSCREEN", (state) => setFullscreenState(state, id)),
    raiseComponent: (id) => update("RAISE_COMPONENT", (state) => raiseComponentState(state, id)),
    toggleCollapse: (id) => update("TOGGLE_COLLAPSE", (state) => toggleCollapseState(state, id)),
    duplicateComponent: (id) => update("DUPLICATE_COMPONENT", (state) => duplicateComponentState(state, id)),
  }
}

function normalizeDeployOptions(viewModeOrOptions?: ViewMode | DeployComponentOptions): DeployComponentOptions {
  if (!viewModeOrOptions) return {}
  return typeof viewModeOrOptions === "string" ? { viewMode: viewModeOrOptions } : viewModeOrOptions
}

function deployComponentState(state: WSState, moduleId: string, options: DeployComponentOptions = {}): WSState {
  const workspace = state.workspaces.find((item) => item.id === state.activeWorkspaceId)
  if (!workspace) return state

  const instanceCounter = nextComponentCounter()
  const now = Date.now()
  const zCounter = state.zCounter + 1
  const visibleLanes = state.lanes.filter((lane) => lane.workspaceId === workspace.id && !lane.hidden)
  const laneId = visibleLanes.some((lane) => lane.id === options.laneId) ? options.laneId : visibleLanes[0]?.id
  const newComponent: ComponentInstance = {
    id: `comp-${instanceCounter}-${now}`,
    moduleId,
    state: "docked",
    position: options.position ?? { x: 20 + (instanceCounter % 5) * 20, y: 20 + (instanceCounter % 4) * 20 },
    size: { w: 340, h: 280 },
    z: zCounter,
    collapsed: false,
    workspaceId: workspace.id,
    laneId,
    flowPosition: options.flowPosition ?? { x: 100 + (instanceCounter % 4) * 280, y: 100 + Math.floor(instanceCounter / 4) * 200 },
    flowSize: { width: 384, height: 320 },
    bentoLayout: options.bentoLayout ?? defaultBentoLayout(instanceCounter),
    laneSize: { height: 420 },
    dockPanel: options.dockPanel ?? "default",
    hiddenIn: options.viewMode
      ? (Object.fromEntries(VIEW_MODES.map((mode) => [mode, mode !== options.viewMode])) as Record<ViewMode, boolean>)
      : undefined,
    tags: options.tags,
    createdAt: now,
    updatedAt: now,
  }

  let lanes = state.lanes
  if (visibleLanes.length === 0) {
    const defaultLane: Lane = {
      id: nextLaneId(now),
      label: "view:lane.defaultName",
      workspaceId: workspace.id,
      widthRatio: 1,
      collapsed: false,
      hidden: false,
      cardOrder: [newComponent.id],
      createdAt: now,
      updatedAt: now,
    }
    newComponent.laneId = defaultLane.id
    lanes = [...state.lanes, defaultLane]
  } else if (laneId) {
    lanes = state.lanes.map((lane) =>
      lane.id === laneId ? { ...lane, cardOrder: [...(lane.cardOrder ?? []), newComponent.id], updatedAt: now } : lane,
    )
  }

  return { ...state, components: [...state.components, newComponent], lanes, zCounter }
}

function ensureComponentState(state: WSState, component: ComponentInstance): WSState {
  if (state.components.some((item) => item.id === component.id)) return state
  return {
    ...state,
    components: [...state.components, component],
    zCounter: Math.max(state.zCounter, component.z ?? 0),
  }
}

function removeComponentState(state: WSState, id: string): WSState {
  const now = Date.now()
  return {
    ...state,
    components: state.components.filter((component) => component.id !== id),
    lanes: state.lanes.map((lane) => ({
      ...lane,
      cardOrder: lane.cardOrder?.filter((cardId) => cardId !== id),
      updatedAt: lane.cardOrder?.includes(id) ? now : lane.updatedAt,
    })),
    focusedComponentId: state.focusedComponentId === id ? null : state.focusedComponentId,
    fullscreenComponentId: state.fullscreenComponentId === id ? null : state.fullscreenComponentId,
  }
}

function setComponentRuntimeState(state: WSState, id: string, componentState: ComponentState): WSState {
  const component = state.components.find((item) => item.id === id)
  if (!component) return state
  const wasFullscreen = component.state === "fullscreen"
  return {
    ...state,
    components: state.components.map((item) =>
      item.id === id ? { ...item, state: componentState, updatedAt: Date.now() } : item,
    ),
    focusedComponentId: componentState === "focused" ? id : wasFullscreen ? null : state.focusedComponentId,
    fullscreenComponentId: componentState === "fullscreen" ? id : wasFullscreen ? null : state.fullscreenComponentId,
  }
}

function setComponentPositionState(state: WSState, id: string, x: number, y: number): WSState {
  return {
    ...state,
    components: state.components.map((component) =>
      component.id === id ? { ...component, position: { x, y }, updatedAt: Date.now() } : component,
    ),
  }
}

function setComponentFlowPosState(state: WSState, id: string, x: number, y: number): WSState {
  return {
    ...state,
    components: state.components.map((component) =>
      component.id === id ? { ...component, flowPosition: { x, y }, updatedAt: Date.now() } : component,
    ),
  }
}

function setComponentFlowSizeState(state: WSState, id: string, width: number, height: number): WSState {
  return {
    ...state,
    components: state.components.map((component) =>
      component.id === id ? { ...component, flowSize: { width, height }, updatedAt: Date.now() } : component,
    ),
  }
}

function setComponentBentoLayoutState(
  state: WSState,
  id: string,
  layout: { x: number; y: number; w: number; h: number },
): WSState {
  const nextLayout = normalizeBentoLayout(layout)
  let changed = false
  const components = state.components.map((component) => {
    if (component.id !== id) return component
    const current = component.bentoLayout
    if (
      current
      && current.x === nextLayout.x
      && current.y === nextLayout.y
      && current.w === nextLayout.w
      && current.h === nextLayout.h
    ) {
      return component
    }
    changed = true
    return { ...component, bentoLayout: nextLayout, updatedAt: Date.now() }
  })
  return changed ? { ...state, components } : state
}

function setComponentLaneSizeState(state: WSState, id: string, size: { height: number }): WSState {
  const nextSize = { height: Math.max(220, Math.min(1200, Math.round(size.height))) }
  let changed = false
  const components = state.components.map((component) => {
    if (component.id !== id) return component
    if (component.laneSize?.height === nextSize.height) return component
    changed = true
    return { ...component, laneSize: nextSize, updatedAt: Date.now() }
  })
  return changed ? { ...state, components } : state
}

function setComponentDataState(state: WSState, id: string, data: Record<string, unknown>): WSState {
  return {
    ...state,
    components: state.components.map((component) =>
      component.id === id ? { ...component, data, updatedAt: Date.now() } : component,
    ),
  }
}

function patchComponentDataState(state: WSState, id: string, patch: Record<string, unknown>): WSState {
  return {
    ...state,
    components: state.components.map((component) =>
      component.id === id
        ? { ...component, data: { ...component.data, ...patch }, updatedAt: Date.now() }
        : component,
    ),
  }
}

function updateComponentState(state: WSState, id: string, patch: ComponentPatch): WSState {
  let focusedComponentId = state.focusedComponentId
  let fullscreenComponentId = state.fullscreenComponentId
  let changed = false

  const components = state.components.map((component) => {
    if (component.id !== id) return component
    let next = component
    const now = Date.now()

    if (patch.data) {
      next = { ...next, data: { ...next.data, ...patch.data } }
      changed = true
    }
    if (patch.tags) {
      next = { ...next, tags: patch.tags }
      changed = true
    }
    if (patch.hiddenIn) {
      next = { ...next, hiddenIn: { ...next.hiddenIn, ...patch.hiddenIn } }
      changed = true
    }
    if (patch.state) {
      const wasFullscreen = next.state === "fullscreen"
      next = { ...next, state: patch.state }
      focusedComponentId = patch.state === "focused" ? id : wasFullscreen ? null : focusedComponentId
      fullscreenComponentId = patch.state === "fullscreen" ? id : wasFullscreen ? null : fullscreenComponentId
      changed = true
    }

    return changed ? { ...next, updatedAt: now } : component
  })

  return changed ? { ...state, components, focusedComponentId, fullscreenComponentId } : state
}

function setComponentDockPanelState(state: WSState, id: string, panelId: string): WSState {
  return {
    ...state,
    components: state.components.map((component) =>
      component.id === id ? { ...component, dockPanel: panelId, updatedAt: Date.now() } : component,
    ),
  }
}

function setComponentVisibilityState(state: WSState, id: string, viewMode: ViewMode, visible: boolean): WSState {
  let changed = false
  const components = state.components.map((component) => {
    if (component.id !== id) return component
    const current = component.hiddenIn ?? {}
    const nextHidden = !visible
    if (current[viewMode] === nextHidden) return component
    changed = true
    return { ...component, hiddenIn: { ...current, [viewMode]: nextHidden }, updatedAt: Date.now() }
  })
  return changed ? { ...state, components } : state
}

function toggleComponentVisibilityState(state: WSState, id: string, viewMode: ViewMode): WSState {
  return {
    ...state,
    components: state.components.map((component) => {
      if (component.id !== id) return component
      const current = component.hiddenIn ?? {}
      const currentlyVisible = current[viewMode] !== true
      return { ...component, hiddenIn: { ...current, [viewMode]: currentlyVisible }, updatedAt: Date.now() }
    }),
  }
}

function setComponentTagsState(state: WSState, id: string, tags: string[]): WSState {
  return {
    ...state,
    components: state.components.map((component) =>
      component.id === id ? { ...component, tags, updatedAt: Date.now() } : component,
    ),
  }
}

function setFullscreenState(state: WSState, id: string | null): WSState {
  return {
    ...state,
    components: state.components.map((component) => {
      if (id === null) {
        return component.state === "fullscreen" ? { ...component, state: "docked" as ComponentState, updatedAt: Date.now() } : component
      }
      if (component.id === id) return { ...component, state: "fullscreen" as ComponentState, updatedAt: Date.now() }
      return component.state === "fullscreen" ? { ...component, state: "docked" as ComponentState, updatedAt: Date.now() } : component
    }),
    fullscreenComponentId: id,
  }
}

function raiseComponentState(state: WSState, id: string): WSState {
  const zCounter = state.zCounter + 1
  return {
    ...state,
    zCounter,
    components: state.components.map((component) =>
      component.id === id ? { ...component, z: zCounter, updatedAt: Date.now() } : component,
    ),
  }
}

function toggleCollapseState(state: WSState, id: string): WSState {
  return {
    ...state,
    components: state.components.map((component) =>
      component.id === id ? { ...component, collapsed: !component.collapsed, updatedAt: Date.now() } : component,
    ),
  }
}

function defaultBentoLayout(instanceCounter: number): { x: number; y: number; w: number; h: number } {
  const index = Math.max(0, instanceCounter - 1)
  const wide = index % 5 === 0
  const tall = index % 7 === 2
  const w = wide ? 6 : 4
  const h = tall ? 5 : 4
  return {
    x: (index % 3) * 4,
    y: Math.floor(index / 3) * 4,
    w,
    h,
  }
}

function normalizeBentoLayout(layout: { x: number; y: number; w: number; h: number }) {
  const w = Math.max(2, Math.min(12, Math.round(layout.w)))
  const h = Math.max(2, Math.round(layout.h))
  const x = Math.max(0, Math.min(12 - w, Math.round(layout.x)))
  const y = Math.max(0, Math.round(layout.y))
  return { x, y, w, h }
}

function duplicateComponentState(state: WSState, id: string): WSState {
  const source = state.components.find((component) => component.id === id)
  if (!source) return state

  const now = Date.now()
  const instanceCounter = nextComponentCounter()
  const newId = `comp-${instanceCounter}-${now}`
  const zCounter = state.zCounter + 1

  // Offset positions to avoid full overlap with the source.
  const OFFSET = 24
  const newPosition = source.position
    ? { x: source.position.x + OFFSET, y: source.position.y + OFFSET }
    : { x: 20 + OFFSET, y: 20 + OFFSET }
  const newFlowPosition = source.flowPosition
    ? { x: source.flowPosition.x + OFFSET, y: source.flowPosition.y + OFFSET }
    : { x: 100 + OFFSET, y: 100 + OFFSET }

  const clone: ComponentInstance = {
    id: newId,
    moduleId: source.moduleId,
    // New components default to docked state, never copy fullscreen state.
    state: "docked",
    position: newPosition,
    size: source.size ? { ...source.size } : undefined,
    z: zCounter,
    collapsed: false,
    workspaceId: source.workspaceId,
    laneId: source.laneId,
    flowPosition: newFlowPosition,
    flowSize: source.flowSize ? { ...source.flowSize } : undefined,
    bentoLayout: source.bentoLayout ? { ...source.bentoLayout } : undefined,
    laneSize: source.laneSize ? { ...source.laneSize } : undefined,
    dockPanel: source.dockPanel,
    data: source.data ? structuredCloneSafe(source.data) : {},
    tags: source.tags ? [...source.tags] : undefined,
    hiddenIn: source.hiddenIn ? { ...source.hiddenIn } : undefined,
    createdAt: now,
    updatedAt: now,
  }

  // Insert into the same lane right after the source.
  let lanes = state.lanes
  if (source.laneId) {
    lanes = state.lanes.map((lane) => {
      if (lane.id !== source.laneId || !lane.cardOrder) return lane
      const idx = lane.cardOrder.indexOf(id)
      if (idx === -1) return lane
      const nextCardOrder = [...lane.cardOrder]
      nextCardOrder.splice(idx + 1, 0, newId)
      return { ...lane, cardOrder: nextCardOrder, updatedAt: now }
    })
  }

  return {
    ...state,
    components: [...state.components, clone],
    lanes,
    zCounter,
  }
}

// structuredClone is available in Node 17+ and modern browsers. Fall back to
// JSON-based cloning if unavailable (e.g. older test environments).
function structuredCloneSafe<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value)
  return JSON.parse(JSON.stringify(value)) as T
}

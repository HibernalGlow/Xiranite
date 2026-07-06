import { useEffect, useMemo, type Dispatch, type ReactNode } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { create } from "zustand"
import { devtools } from "zustand/middleware"
import type {
  AppTheme,
  CardLayout,
  ComponentInstance,
  ComponentState,
  Lane,
  OverlayKind,
  ViewMode,
  WorkspaceItem,
} from "@/types/workspace"
import { loadWorkspaceSnapshot as loadWorkspaceSnapshotRpc, persistWorkspaceSnapshot as persistWorkspaceSnapshotRpc } from "@/backend/workspaceRpcClient"
import type { WorkspaceDTO, LaneDTO, ComponentDTO, WorkspaceSnapshotDTO } from "@xiranite/shared"

interface WSState {
  theme: AppTheme
  viewMode: ViewMode
  cardLayout: CardLayout
  workspaces: WorkspaceItem[]
  activeWorkspaceId: string
  components: ComponentInstance[]
  lanes: Lane[]
  focusedComponentId: string | null
  fullscreenComponentId: string | null
  zCounter: number
  overlay: OverlayKind
  grainEnabled: boolean
  vignetteDepth: number
  grainIntensity: number
  actionGlow: boolean
  cardElevation: boolean
  backendReady: boolean
  bgMode: "grid" | "dot-grid" | "image" | "none"
  bgImageUrl: string
  bgOpacity: number
  bgBlur: number
}

type ComponentPatch = {
  data?: Record<string, unknown>
  tags?: string[]
  state?: ComponentState
  hiddenIn?: Partial<Record<ViewMode, boolean>>
}

type Action =
  | { type: "SET_THEME"; theme: AppTheme }
  | { type: "SET_VIEW_MODE"; mode: ViewMode }
  | { type: "SET_CARD_LAYOUT"; layout: CardLayout }
  | { type: "SET_ACTIVE_WORKSPACE"; id: string }
  | { type: "ADD_WORKSPACE" }
  | { type: "REMOVE_WORKSPACE"; id: string }
  | { type: "RENAME_WORKSPACE"; id: string; label: string }
  | { type: "DEPLOY_COMPONENT"; moduleId: string; viewMode?: ViewMode }
  | { type: "ENSURE_COMPONENT"; component: ComponentInstance }
  | { type: "REMOVE_COMPONENT"; id: string }
  | { type: "SET_COMPONENT_STATE"; id: string; state: ComponentState }
  | { type: "SET_COMPONENT_POSITION"; id: string; x: number; y: number }
  | { type: "MOVE_COMPONENT"; id: string; x: number; y: number }
  | { type: "SET_COMPONENT_FLOW_POS"; id: string; x: number; y: number }
  | { type: "SET_COMPONENT_FLOW_SIZE"; id: string; width: number; height: number }
  | { type: "SET_COMPONENT_DATA"; id: string; data: Record<string, unknown> }
  | { type: "PATCH_COMPONENT_DATA"; id: string; patch: Record<string, unknown> }
  | { type: "UPDATE_COMPONENT"; id: string; patch: ComponentPatch }
  | { type: "SET_COMPONENT_DOCK_PANEL"; id: string; panelId: string }
  | { type: "SET_COMPONENT_VISIBILITY"; id: string; viewMode: ViewMode; visible: boolean }
  | { type: "TOGGLE_COMPONENT_VISIBILITY"; id: string; viewMode: ViewMode }
  | { type: "SET_COMPONENT_TAGS"; id: string; tags: string[] }
  | { type: "FOCUS_COMPONENT"; id: string | null }
  | { type: "SET_FULLSCREEN"; id: string | null }
  | { type: "RAISE_COMPONENT"; id: string }
  | { type: "TOGGLE_COLLAPSE"; id: string }
  | { type: "SET_OVERLAY"; overlay: OverlayKind }
  | { type: "SET_GRAIN"; enabled: boolean }
  | { type: "SET_VIGNETTE"; depth: number }
  | { type: "SET_GRAIN_INTENSITY"; intensity: number }
  | { type: "SET_ACTION_GLOW"; enabled: boolean }
  | { type: "SET_CARD_ELEVATION"; enabled: boolean }
  | { type: "SET_BG_MODE"; mode: "grid" | "dot-grid" | "image" | "none" }
  | { type: "SET_BG_IMAGE_URL"; url: string }
  | { type: "SET_BG_OPACITY"; opacity: number }
  | { type: "SET_BG_BLUR"; blur: number }
  | { type: "BACKEND_READY"; ready: boolean }
  | { type: "HYDRATE"; workspaces: WorkspaceDTO[]; lanes: LaneDTO[]; components: ComponentDTO[] }
  | { type: "ADD_LANE"; workspaceId?: string; label?: string }
  | { type: "REMOVE_LANE"; id: string }
  | { type: "RENAME_LANE"; id: string; label: string }
  | { type: "SET_LANE_WIDTH_RATIO"; id: string; ratio: number }
  | { type: "TOGGLE_LANE_COLLAPSE"; id: string }
  | { type: "TOGGLE_LANE_VISIBILITY"; id: string }
  | { type: "REORDER_LANE"; fromId: string; toId: string }
  | { type: "SET_LANE_CARD_ORDER"; id: string; cardOrder: string[] }
  | { type: "MOVE_COMPONENT_TO_LANE"; componentId: string; toLaneId: string; targetCardId?: string | null; insertAfter?: boolean }

interface WSContextValue {
  state: WSState
  dispatch: Dispatch<Action>
  activeWorkspace: WorkspaceItem | undefined
  visibleComponents: ComponentInstance[]
}

type WSStore = WSState & {
  dispatch: Dispatch<Action>
}

type WorkspaceSnapshot = WorkspaceSnapshotDTO

const VIEW_MODES: ViewMode[] = ["cards", "dockview", "flow", "lane"]
const WORKSPACE_SNAPSHOT_QUERY_KEY = ["workspace", "snapshot"] as const

const storedBgMode = typeof localStorage !== "undefined" ? localStorage.getItem("xiranite-bg-mode") : null
const storedBgImageUrl = typeof localStorage !== "undefined" ? localStorage.getItem("xiranite-bg-image-url") : null
const storedBgOpacity = typeof localStorage !== "undefined" ? localStorage.getItem("xiranite-bg-opacity") : null
const storedBgBlur = typeof localStorage !== "undefined" ? localStorage.getItem("xiranite-bg-blur") : null

const INITIAL_STATE: WSState = {
  theme: "spatial",
  viewMode: "cards",
  cardLayout: "grid",
  workspaces: [
    { id: "ws-alpha", label: "topbar:workspace.defaults.alpha" },
    { id: "ws-grid", label: "topbar:workspace.defaults.grid" },
    { id: "ws-kern", label: "topbar:workspace.defaults.kern" },
    { id: "ws-net", label: "topbar:workspace.defaults.net" },
    { id: "ws-arch", label: "topbar:workspace.defaults.arch" },
  ],
  activeWorkspaceId: "ws-alpha",
  components: [],
  lanes: [],
  focusedComponentId: null,
  fullscreenComponentId: null,
  zCounter: 1,
  overlay: null,
  grainEnabled: true,
  vignetteDepth: 40,
  grainIntensity: 15,
  actionGlow: true,
  cardElevation: false,
  backendReady: false,
  bgMode: (storedBgMode as any) || "dot-grid",
  bgImageUrl: storedBgImageUrl || "",
  bgOpacity: storedBgOpacity ? parseInt(storedBgOpacity, 10) : 30,
  bgBlur: storedBgBlur ? parseInt(storedBgBlur, 10) : 5,
}

let instanceCounter = 0
let laneCounter = 0

const useWorkspaceStore = create<WSStore>()(
  devtools(
    (set) => ({
      ...INITIAL_STATE,
      dispatch: (action) => {
        set((state) => reducer(state, action), false, action.type)
      },
    }),
    { name: "xiranite-workspace" },
  ),
)

function reducer(state: WSState, action: Action): WSState {
  switch (action.type) {
    case "SET_THEME":
      return { ...state, theme: action.theme }
    case "SET_VIEW_MODE":
      return { ...state, viewMode: action.mode }
    case "SET_CARD_LAYOUT":
      return { ...state, cardLayout: action.layout }
    case "SET_ACTIVE_WORKSPACE":
      return { ...state, activeWorkspaceId: action.id }
    case "ADD_WORKSPACE": {
      const now = Date.now()
      const id = `ws-${now}`
      return {
        ...state,
        workspaces: [...state.workspaces, { id, label: `common:workspaceN:${state.workspaces.length + 1}`, createdAt: now, updatedAt: now }],
        activeWorkspaceId: id,
      }
    }
    case "REMOVE_WORKSPACE": {
      if (state.workspaces.length <= 1) return state
      const rest = state.workspaces.filter((workspace) => workspace.id !== action.id)
      return {
        ...state,
        workspaces: rest,
        activeWorkspaceId: state.activeWorkspaceId === action.id ? rest[0].id : state.activeWorkspaceId,
        components: state.components.filter((component) => component.workspaceId !== action.id),
        lanes: state.lanes.filter((lane) => lane.workspaceId !== action.id),
      }
    }
    case "RENAME_WORKSPACE":
      return {
        ...state,
        workspaces: state.workspaces.map((workspace) =>
          workspace.id === action.id ? { ...workspace, label: action.label, updatedAt: Date.now() } : workspace,
        ),
      }
    case "DEPLOY_COMPONENT": {
      const workspace = state.workspaces.find((item) => item.id === state.activeWorkspaceId)
      if (!workspace) return state

      instanceCounter += 1
      const now = Date.now()
      const zCounter = state.zCounter + 1
      const visibleLanes = state.lanes.filter((lane) => lane.workspaceId === workspace.id && !lane.hidden)
      const laneId = visibleLanes[0]?.id
      const newComponent: ComponentInstance = {
        id: `comp-${instanceCounter}-${now}`,
        moduleId: action.moduleId,
        state: "docked",
        position: { x: 20 + (instanceCounter % 5) * 20, y: 20 + (instanceCounter % 4) * 20 },
        size: { w: 340, h: 280 },
        z: zCounter,
        collapsed: false,
        workspaceId: workspace.id,
        laneId,
        flowPosition: { x: 100 + (instanceCounter % 4) * 280, y: 100 + Math.floor(instanceCounter / 4) * 200 },
        flowSize: { width: 384, height: 320 },
        dockPanel: "default",
        hiddenIn: action.viewMode
          ? Object.fromEntries(VIEW_MODES.map((mode) => [mode, mode !== action.viewMode])) as Record<ViewMode, boolean>
          : undefined,
        createdAt: now,
        updatedAt: now,
      }

      let lanes = state.lanes
      if (visibleLanes.length === 0) {
        laneCounter += 1
        const defaultLane: Lane = {
          id: `lane-${laneCounter}-${now}`,
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
    case "ENSURE_COMPONENT":
      if (state.components.some((component) => component.id === action.component.id)) return state
      return {
        ...state,
        components: [...state.components, action.component],
        zCounter: Math.max(state.zCounter, action.component.z ?? 0),
      }
    case "REMOVE_COMPONENT":
      return {
        ...state,
        components: state.components.filter((component) => component.id !== action.id),
        lanes: state.lanes.map((lane) => ({
          ...lane,
          cardOrder: lane.cardOrder?.filter((id) => id !== action.id),
          updatedAt: lane.cardOrder?.includes(action.id) ? Date.now() : lane.updatedAt,
        })),
        focusedComponentId: state.focusedComponentId === action.id ? null : state.focusedComponentId,
        fullscreenComponentId: state.fullscreenComponentId === action.id ? null : state.fullscreenComponentId,
      }
    case "SET_COMPONENT_STATE": {
      const component = state.components.find((item) => item.id === action.id)
      if (!component) return state
      const wasFullscreen = component.state === "fullscreen"
      return {
        ...state,
        components: state.components.map((item) =>
          item.id === action.id ? { ...item, state: action.state, updatedAt: Date.now() } : item,
        ),
        focusedComponentId: action.state === "focused" ? action.id : wasFullscreen ? null : state.focusedComponentId,
        fullscreenComponentId: action.state === "fullscreen" ? action.id : wasFullscreen ? null : state.fullscreenComponentId,
      }
    }
    case "SET_COMPONENT_POSITION":
    case "MOVE_COMPONENT":
      return {
        ...state,
        components: state.components.map((component) =>
          component.id === action.id ? { ...component, position: { x: action.x, y: action.y }, updatedAt: Date.now() } : component,
        ),
      }
    case "SET_COMPONENT_FLOW_POS":
      return {
        ...state,
        components: state.components.map((component) =>
          component.id === action.id ? { ...component, flowPosition: { x: action.x, y: action.y }, updatedAt: Date.now() } : component,
        ),
      }
    case "SET_COMPONENT_FLOW_SIZE":
      return {
        ...state,
        components: state.components.map((component) =>
          component.id === action.id ? { ...component, flowSize: { width: action.width, height: action.height }, updatedAt: Date.now() } : component,
        ),
      }
    case "SET_COMPONENT_DATA":
      return {
        ...state,
        components: state.components.map((component) =>
          component.id === action.id ? { ...component, data: action.data, updatedAt: Date.now() } : component,
        ),
      }
    case "PATCH_COMPONENT_DATA":
      return {
        ...state,
        components: state.components.map((component) =>
          component.id === action.id
            ? { ...component, data: { ...component.data, ...action.patch }, updatedAt: Date.now() }
            : component,
        ),
      }
    case "UPDATE_COMPONENT":
      return updateComponent(state, action.id, action.patch)
    case "SET_COMPONENT_DOCK_PANEL":
      return {
        ...state,
        components: state.components.map((component) =>
          component.id === action.id ? { ...component, dockPanel: action.panelId, updatedAt: Date.now() } : component,
        ),
      }
    case "SET_COMPONENT_VISIBILITY": {
      let changed = false
      const components = state.components.map((component) => {
        if (component.id !== action.id) return component
        const current = component.hiddenIn ?? {}
        const nextHidden = !action.visible
        if (current[action.viewMode] === nextHidden) return component
        changed = true
        return { ...component, hiddenIn: { ...current, [action.viewMode]: nextHidden }, updatedAt: Date.now() }
      })
      return changed ? { ...state, components } : state
    }
    case "TOGGLE_COMPONENT_VISIBILITY":
      return {
        ...state,
        components: state.components.map((component) => {
          if (component.id !== action.id) return component
          const current = component.hiddenIn ?? {}
          const currentlyVisible = current[action.viewMode] !== true
          return { ...component, hiddenIn: { ...current, [action.viewMode]: currentlyVisible }, updatedAt: Date.now() }
        }),
      }
    case "SET_COMPONENT_TAGS":
      return {
        ...state,
        components: state.components.map((component) =>
          component.id === action.id ? { ...component, tags: action.tags, updatedAt: Date.now() } : component,
        ),
      }
    case "FOCUS_COMPONENT":
      return { ...state, focusedComponentId: action.id }
    case "SET_FULLSCREEN":
      return {
        ...state,
        components: state.components.map((component) => {
          if (action.id === null) {
            return component.state === "fullscreen" ? { ...component, state: "docked" as ComponentState, updatedAt: Date.now() } : component
          }
          if (component.id === action.id) return { ...component, state: "fullscreen" as ComponentState, updatedAt: Date.now() }
          return component.state === "fullscreen" ? { ...component, state: "docked" as ComponentState, updatedAt: Date.now() } : component
        }),
        fullscreenComponentId: action.id,
      }
    case "RAISE_COMPONENT": {
      const zCounter = state.zCounter + 1
      return {
        ...state,
        zCounter,
        components: state.components.map((component) =>
          component.id === action.id ? { ...component, z: zCounter, updatedAt: Date.now() } : component,
        ),
      }
    }
    case "TOGGLE_COLLAPSE":
      return {
        ...state,
        components: state.components.map((component) =>
          component.id === action.id ? { ...component, collapsed: !component.collapsed, updatedAt: Date.now() } : component,
        ),
      }
    case "SET_OVERLAY":
      return { ...state, overlay: action.overlay }
    case "SET_GRAIN":
      return { ...state, grainEnabled: action.enabled }
    case "SET_VIGNETTE":
      return { ...state, vignetteDepth: action.depth }
    case "SET_GRAIN_INTENSITY":
      return { ...state, grainIntensity: action.intensity }
    case "SET_ACTION_GLOW":
      return { ...state, actionGlow: action.enabled }
    case "SET_CARD_ELEVATION":
      return { ...state, cardElevation: action.enabled }
    case "SET_BG_MODE":
      if (typeof localStorage !== "undefined") localStorage.setItem("xiranite-bg-mode", action.mode)
      return { ...state, bgMode: action.mode }
    case "SET_BG_IMAGE_URL":
      if (typeof localStorage !== "undefined") localStorage.setItem("xiranite-bg-image-url", action.url)
      return { ...state, bgImageUrl: action.url }
    case "SET_BG_OPACITY":
      if (typeof localStorage !== "undefined") localStorage.setItem("xiranite-bg-opacity", String(action.opacity))
      return { ...state, bgOpacity: action.opacity }
    case "SET_BG_BLUR":
      if (typeof localStorage !== "undefined") localStorage.setItem("xiranite-bg-blur", String(action.blur))
      return { ...state, bgBlur: action.blur }
    case "BACKEND_READY":
      return { ...state, backendReady: action.ready }
    case "HYDRATE":
      return hydrateState(state, action.workspaces, action.lanes, action.components)
    case "ADD_LANE": {
      const now = Date.now()
      const workspaceId = action.workspaceId ?? state.activeWorkspaceId
      laneCounter += 1
      const lane: Lane = {
        id: `lane-${laneCounter}-${now}`,
        label: action.label ?? `LANE ${state.lanes.filter((item) => item.workspaceId === workspaceId).length + 1}`,
        workspaceId,
        widthRatio: 1,
        collapsed: false,
        hidden: false,
        cardOrder: [],
        createdAt: now,
        updatedAt: now,
      }
      return { ...state, lanes: [...state.lanes, lane] }
    }
    case "REMOVE_LANE":
      return {
        ...state,
        lanes: state.lanes.filter((lane) => lane.id !== action.id),
        components: state.components.map((component) =>
          component.laneId === action.id ? { ...component, laneId: undefined, updatedAt: Date.now() } : component,
        ),
      }
    case "RENAME_LANE":
      return {
        ...state,
        lanes: state.lanes.map((lane) => lane.id === action.id ? { ...lane, label: action.label, updatedAt: Date.now() } : lane),
      }
    case "SET_LANE_WIDTH_RATIO":
      return {
        ...state,
        lanes: state.lanes.map((lane) =>
          lane.id === action.id ? { ...lane, widthRatio: Math.max(0.25, Math.min(4, action.ratio)), updatedAt: Date.now() } : lane,
        ),
      }
    case "TOGGLE_LANE_COLLAPSE":
      return {
        ...state,
        lanes: state.lanes.map((lane) => lane.id === action.id ? { ...lane, collapsed: !lane.collapsed, updatedAt: Date.now() } : lane),
      }
    case "TOGGLE_LANE_VISIBILITY":
      return {
        ...state,
        lanes: state.lanes.map((lane) => lane.id === action.id ? { ...lane, hidden: !lane.hidden, updatedAt: Date.now() } : lane),
      }
    case "REORDER_LANE": {
      const fromIndex = state.lanes.findIndex((lane) => lane.id === action.fromId)
      const toIndex = state.lanes.findIndex((lane) => lane.id === action.toId)
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return state
      const next = [...state.lanes]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, { ...moved, updatedAt: Date.now() })
      return { ...state, lanes: next }
    }
    case "SET_LANE_CARD_ORDER":
      return {
        ...state,
        lanes: state.lanes.map((lane) => lane.id === action.id ? { ...lane, cardOrder: action.cardOrder, updatedAt: Date.now() } : lane),
      }
    case "MOVE_COMPONENT_TO_LANE":
      return moveComponentToLane(state, action)
    default:
      return state
  }
}

function hydrateState(state: WSState, workspaces: WorkspaceDTO[], lanes: LaneDTO[], components: ComponentDTO[]): WSState {
  const nextWorkspaces: WorkspaceItem[] = workspaces.length
    ? workspaces.map((workspace) => ({
      id: workspace.id,
      label: workspace.label,
      icon: workspace.icon,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
    }))
    : INITIAL_STATE.workspaces

  const nextComponents: ComponentInstance[] = components.map((component) => ({
    id: component.id,
    moduleId: component.moduleId,
    state: "docked",
    workspaceId: component.workspaceId,
    data: component.data,
    flowPosition: component.flowPosition,
    flowSize: component.flowSize,
    dockPanel: component.dockPanel,
    laneId: component.laneId,
    hiddenIn: component.hiddenIn,
    tags: component.tags,
    z: component.z,
    collapsed: component.collapsed,
    position: { x: 20, y: 20 },
    size: { w: 340, h: 280 },
    createdAt: component.createdAt,
    updatedAt: component.updatedAt,
  }))

  const nextLanes: Lane[] = lanes.map((lane) => ({
    id: lane.id,
    label: lane.label,
    workspaceId: lane.workspaceId,
    widthRatio: lane.widthRatio,
    collapsed: lane.collapsed,
    hidden: lane.hidden,
    cardOrder: lane.cardOrder,
    createdAt: lane.createdAt,
    updatedAt: lane.updatedAt,
  }))

  return {
    ...state,
    workspaces: nextWorkspaces,
    lanes: nextLanes,
    components: nextComponents,
    activeWorkspaceId: nextWorkspaces[0]?.id ?? state.activeWorkspaceId,
    zCounter: Math.max(state.zCounter, ...nextComponents.map((component) => component.z ?? 0)),
  }
}

function updateComponent(state: WSState, id: string, patch: ComponentPatch): WSState {
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

function moveComponentToLane(
  state: WSState,
  action: Extract<Action, { type: "MOVE_COMPONENT_TO_LANE" }>,
): WSState {
  const component = state.components.find((item) => item.id === action.componentId)
  if (!component) return state

  const fromLaneId = component.laneId
  const toLaneId = action.toLaneId
  if (fromLaneId === toLaneId && !action.targetCardId) return state

  const now = Date.now()
  const components = state.components.map((item) =>
    item.id === action.componentId ? { ...item, laneId: toLaneId, updatedAt: now } : item,
  )

  let lanes = state.lanes.map((lane) => {
    if (lane.id !== fromLaneId) return lane
    return {
      ...lane,
      cardOrder: lane.cardOrder?.filter((id) => id !== action.componentId),
      updatedAt: now,
    }
  })

  lanes = lanes.map((lane) => {
    if (lane.id !== toLaneId) return lane
    const order = (lane.cardOrder ?? []).filter((id) => id !== action.componentId)
    if (!action.targetCardId) {
      order.push(action.componentId)
    } else {
      const index = order.indexOf(action.targetCardId)
      if (index < 0) order.push(action.componentId)
      else order.splice(action.insertAfter ? index + 1 : index, 0, action.componentId)
    }
    return { ...lane, cardOrder: order, updatedAt: now }
  })

  return { ...state, components, lanes }
}

function toWorkspaceDTO(workspace: WorkspaceItem, now: number): WorkspaceDTO {
  return {
    id: workspace.id,
    label: workspace.label,
    icon: workspace.icon,
    createdAt: workspace.createdAt ?? now,
    updatedAt: workspace.updatedAt ?? now,
  }
}

function toLaneDTO(lane: Lane, now: number): LaneDTO {
  return {
    id: lane.id,
    label: lane.label,
    workspaceId: lane.workspaceId,
    widthRatio: lane.widthRatio,
    collapsed: lane.collapsed,
    hidden: lane.hidden,
    cardOrder: lane.cardOrder,
    createdAt: lane.createdAt ?? now,
    updatedAt: lane.updatedAt ?? now,
  }
}

function toComponentDTO(component: ComponentInstance, now: number): ComponentDTO {
  return {
    id: component.id,
    moduleId: component.moduleId,
    workspaceId: component.workspaceId,
    data: component.data,
    flowPosition: component.flowPosition,
    flowSize: component.flowSize,
    dockPanel: component.dockPanel,
    laneId: component.laneId,
    hiddenIn: component.hiddenIn,
    tags: component.tags,
    z: component.z,
    collapsed: component.collapsed,
    createdAt: component.createdAt ?? now,
    updatedAt: component.updatedAt ?? now,
  }
}

async function loadWorkspaceSnapshot(): Promise<WorkspaceSnapshot> {
  return loadWorkspaceSnapshotRpc()
}

async function persistWorkspaceSnapshot(snapshot: WorkspaceSnapshot): Promise<void> {
  await persistWorkspaceSnapshotRpc(snapshot)
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const dispatch = useWorkspaceStore((state) => state.dispatch)
  const backendReady = useWorkspaceStore((state) => state.backendReady)
  const workspaces = useWorkspaceStore((state) => state.workspaces)
  const lanes = useWorkspaceStore((state) => state.lanes)
  const components = useWorkspaceStore((state) => state.components)

  const workspaceQuery = useQuery({
    queryKey: WORKSPACE_SNAPSHOT_QUERY_KEY,
    queryFn: loadWorkspaceSnapshot,
    staleTime: 5_000,
    retry: 1,
  })

  const { mutate: persistWorkspace } = useMutation({
    mutationFn: persistWorkspaceSnapshot,
    scope: { id: "workspace-persist" },
    onSuccess: (_result, snapshot) => {
      queryClient.setQueryData(WORKSPACE_SNAPSHOT_QUERY_KEY, snapshot)
    },
    onError: (error) => {
      console.error("[backend] persist failed:", error)
    },
  })

  useEffect(() => {
    if (!workspaceQuery.data) return

    dispatch({
      type: "HYDRATE",
      workspaces: workspaceQuery.data.workspaces,
      lanes: workspaceQuery.data.lanes,
      components: workspaceQuery.data.components,
    })
    dispatch({ type: "BACKEND_READY", ready: true })
  }, [dispatch, workspaceQuery.data])

  useEffect(() => {
    if (!workspaceQuery.error) return

    console.error("[backend] hydrate failed:", workspaceQuery.error)
    dispatch({ type: "BACKEND_READY", ready: false })
  }, [dispatch, workspaceQuery.error])

  useEffect(() => {
    if (!backendReady) return undefined

    const timer = setTimeout(() => {
      const now = Date.now()
      persistWorkspace({
        workspaces: workspaces.map((workspace) => toWorkspaceDTO(workspace, now)),
        lanes: lanes.map((lane) => toLaneDTO(lane, now)),
        components: components.map((component) => toComponentDTO(component, now)),
      })
    }, 500)

    return () => {
      clearTimeout(timer)
    }
  }, [workspaces, lanes, components, backendReady, persistWorkspace])

  return <>{children}</>
}

export function useWorkspace(): WSContextValue {
  const store = useWorkspaceStore()
  const { dispatch, ...state } = store

  const activeWorkspace = useMemo(
    () => state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId),
    [state.workspaces, state.activeWorkspaceId],
  )

  const visibleComponents = useMemo(
    () => state.components.filter((component) => component.workspaceId === state.activeWorkspaceId),
    [state.components, state.activeWorkspaceId],
  )

  return { state, dispatch, activeWorkspace, visibleComponents }
}

export function useWSDispatch() {
  return useWorkspaceStore((state) => state.dispatch)
}

export const actions = {
  setTheme: (theme: AppTheme): Action => ({ type: "SET_THEME", theme }),
  setViewMode: (mode: ViewMode): Action => ({ type: "SET_VIEW_MODE", mode }),
  setCardLayout: (layout: CardLayout): Action => ({ type: "SET_CARD_LAYOUT", layout }),
  setActiveWorkspace: (id: string): Action => ({ type: "SET_ACTIVE_WORKSPACE", id }),
  addWorkspace: (): Action => ({ type: "ADD_WORKSPACE" }),
  removeWorkspace: (id: string): Action => ({ type: "REMOVE_WORKSPACE", id }),
  renameWorkspace: (id: string, label: string): Action => ({ type: "RENAME_WORKSPACE", id, label }),
  deployComponent: (moduleId: string, viewMode?: ViewMode): Action => ({ type: "DEPLOY_COMPONENT", moduleId, viewMode }),
  ensureComponent: (component: ComponentInstance): Action => ({ type: "ENSURE_COMPONENT", component }),
  removeComponent: (id: string): Action => ({ type: "REMOVE_COMPONENT", id }),
  setComponentState: (id: string, state: ComponentState): Action => ({ type: "SET_COMPONENT_STATE", id, state }),
  setComponentPosition: (id: string, x: number, y: number): Action => ({ type: "SET_COMPONENT_POSITION", id, x, y }),
  moveComponent: (id: string, x: number, y: number): Action => ({ type: "MOVE_COMPONENT", id, x, y }),
  setComponentFlowPos: (id: string, x: number, y: number): Action => ({ type: "SET_COMPONENT_FLOW_POS", id, x, y }),
  setComponentFlowSize: (id: string, width: number, height: number): Action => ({ type: "SET_COMPONENT_FLOW_SIZE", id, width, height }),
  setComponentData: (id: string, data: Record<string, unknown>): Action => ({ type: "SET_COMPONENT_DATA", id, data }),
  patchComponentData: (id: string, patch: Record<string, unknown>): Action => ({ type: "PATCH_COMPONENT_DATA", id, patch }),
  updateComponent: (id: string, patch: ComponentPatch): Action => ({ type: "UPDATE_COMPONENT", id, patch }),
  setComponentDockPanel: (id: string, panelId: string): Action => ({ type: "SET_COMPONENT_DOCK_PANEL", id, panelId }),
  setComponentVisibility: (id: string, viewMode: ViewMode, visible: boolean): Action => ({ type: "SET_COMPONENT_VISIBILITY", id, viewMode, visible }),
  toggleComponentVisibility: (id: string, viewMode: ViewMode): Action => ({ type: "TOGGLE_COMPONENT_VISIBILITY", id, viewMode }),
  setComponentTags: (id: string, tags: string[]): Action => ({ type: "SET_COMPONENT_TAGS", id, tags }),
  focusComponent: (id: string | null): Action => ({ type: "FOCUS_COMPONENT", id }),
  setFullscreen: (id: string | null): Action => ({ type: "SET_FULLSCREEN", id }),
  raiseComponent: (id: string): Action => ({ type: "RAISE_COMPONENT", id }),
  toggleCollapse: (id: string): Action => ({ type: "TOGGLE_COLLAPSE", id }),
  setOverlay: (overlay: OverlayKind): Action => ({ type: "SET_OVERLAY", overlay }),
  setGrain: (enabled: boolean): Action => ({ type: "SET_GRAIN", enabled }),
  setVignette: (depth: number): Action => ({ type: "SET_VIGNETTE", depth }),
  setGrainIntensity: (intensity: number): Action => ({ type: "SET_GRAIN_INTENSITY", intensity }),
  setActionGlow: (enabled: boolean): Action => ({ type: "SET_ACTION_GLOW", enabled }),
  setCardElevation: (enabled: boolean): Action => ({ type: "SET_CARD_ELEVATION", enabled }),
  setBgMode: (mode: "grid" | "dot-grid" | "image" | "none"): Action => ({ type: "SET_BG_MODE", mode }),
  setBgImageUrl: (url: string): Action => ({ type: "SET_BG_IMAGE_URL", url }),
  setBgOpacity: (opacity: number): Action => ({ type: "SET_BG_OPACITY", opacity }),
  setBgBlur: (blur: number): Action => ({ type: "SET_BG_BLUR", blur }),
  addLane: (workspaceId?: string, label?: string): Action => ({ type: "ADD_LANE", workspaceId, label }),
  removeLane: (id: string): Action => ({ type: "REMOVE_LANE", id }),
  renameLane: (id: string, label: string): Action => ({ type: "RENAME_LANE", id, label }),
  setLaneWidthRatio: (id: string, ratio: number): Action => ({ type: "SET_LANE_WIDTH_RATIO", id, ratio }),
  toggleLaneCollapse: (id: string): Action => ({ type: "TOGGLE_LANE_COLLAPSE", id }),
  toggleLaneVisibility: (id: string): Action => ({ type: "TOGGLE_LANE_VISIBILITY", id }),
  reorderLane: (fromId: string, toId: string): Action => ({ type: "REORDER_LANE", fromId, toId }),
  setLaneCardOrder: (id: string, cardOrder: string[]): Action => ({ type: "SET_LANE_CARD_ORDER", id, cardOrder }),
  moveComponentToLane: (componentId: string, toLaneId: string, targetCardId?: string | null, insertAfter?: boolean): Action =>
    ({ type: "MOVE_COMPONENT_TO_LANE", componentId, toLaneId, targetCardId, insertAfter }),
}

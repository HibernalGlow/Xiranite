import React, { createContext, useContext, useEffect, useMemo, useReducer } from "react"
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
import { getBackend } from "@/backend/client"
import type { WorkspaceDTO, LaneDTO, ComponentDTO } from "@/backend/shared/types"

// ── State ───────────────────────────────────────────────────────────────────

interface WSState {
  theme: AppTheme
  /** 顶栏切换的四种主形态之一 — 四种形态共享同一份数据 */
  viewMode: ViewMode
  /** 仅 viewMode === "cards" 时生效的子布局 */
  cardLayout: CardLayout
  workspaces: WorkspaceItem[]
  activeWorkspaceId: string
  components: ComponentInstance[]
  /** lanes — 仅 viewMode=lane 时使用，每个 workspace 维护自己的 lane 列表 */
  lanes: Lane[]
  focusedComponentId: string | null
  fullscreenComponentId: string | null
  zCounter: number
  /** 取代被删除的侧栏：当前弹出的视图（registry/settings/deployment） */
  overlay: OverlayKind
  grainEnabled: boolean
  vignetteDepth: number
  grainIntensity: number
  actionGlow: boolean
  cardElevation: boolean
  /** 后端是否就绪 */
  backendReady: boolean
}

// ── Actions ──────────────────────────────────────────────────────────────────

type Action =
  | { type: "SET_THEME"; theme: AppTheme }
  | { type: "SET_VIEW_MODE"; mode: ViewMode }
  | { type: "SET_CARD_LAYOUT"; layout: CardLayout }
  | { type: "SET_ACTIVE_WORKSPACE"; id: string }
  | { type: "ADD_WORKSPACE" }
  | { type: "REMOVE_WORKSPACE"; id: string }
  | { type: "RENAME_WORKSPACE"; id: string; label: string }
  | { type: "DEPLOY_COMPONENT"; moduleId: string }
  | { type: "REMOVE_COMPONENT"; id: string }
  | { type: "SET_COMPONENT_STATE"; id: string; state: ComponentState }
  | { type: "SET_COMPONENT_POSITION"; id: string; x: number; y: number }
  | { type: "MOVE_COMPONENT"; id: string; x: number; y: number }
  | { type: "SET_COMPONENT_FLOW_POS"; id: string; x: number; y: number }
  | { type: "SET_COMPONENT_FLOW_SIZE"; id: string; width: number; height: number }
  | { type: "SET_COMPONENT_DATA"; id: string; data: Record<string, unknown> }
  | { type: "PATCH_COMPONENT_DATA"; id: string; patch: Record<string, unknown> }
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
  | { type: "BACKEND_READY"; ready: boolean }
  | { type: "HYDRATE"; workspaces: WorkspaceDTO[]; lanes: LaneDTO[]; components: ComponentDTO[] }
  // ── Lane actions ──
  | { type: "ADD_LANE"; workspaceId?: string; label?: string }
  | { type: "REMOVE_LANE"; id: string }
  | { type: "RENAME_LANE"; id: string; label: string }
  | { type: "SET_LANE_WIDTH_RATIO"; id: string; ratio: number }
  | { type: "TOGGLE_LANE_COLLAPSE"; id: string }
  | { type: "TOGGLE_LANE_VISIBILITY"; id: string }
  | { type: "REORDER_LANE"; fromId: string; toId: string }
  | { type: "SET_LANE_CARD_ORDER"; id: string; cardOrder: string[] }
  | { type: "MOVE_COMPONENT_TO_LANE"; componentId: string; toLaneId: string; targetCardId?: string | null; insertAfter?: boolean }

// ── Defaults ────────────────────────────────────────────────────────────────

const INITIAL_STATE: WSState = {
  theme: "spatial",
  viewMode: "cards",
  cardLayout: "grid",
  workspaces: [
    { id: "ws-alpha", label: "WORKSPACE ALPHA" },
    { id: "ws-grid",  label: "ANALYTICAL GRID" },
    { id: "ws-kern",  label: "SYSTEM KERNEL" },
    { id: "ws-net",   label: "NETWORK NODE" },
    { id: "ws-arch",  label: "ARCHIVE" },
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
}

// ── Reducer ──────────────────────────────────────────────────────────────────

let instanceCounter = 0
let laneCounter = 0

function reducer(state: WSState, action: Action): WSState {
  switch (action.type) {
    case "SET_THEME": return { ...state, theme: action.theme }
    case "SET_VIEW_MODE": return { ...state, viewMode: action.mode }
    case "SET_CARD_LAYOUT": return { ...state, cardLayout: action.layout }
    case "SET_ACTIVE_WORKSPACE": return { ...state, activeWorkspaceId: action.id }
    case "ADD_WORKSPACE": {
      const id = `ws-${Date.now()}`
      return {
        ...state,
        workspaces: [...state.workspaces, { id, label: `WORKSPACE ${state.workspaces.length + 1}` }],
        activeWorkspaceId: id,
      }
    }
    case "REMOVE_WORKSPACE": {
      if (state.workspaces.length <= 1) return state
      const rest = state.workspaces.filter(w => w.id !== action.id)
      return {
        ...state,
        workspaces: rest,
        activeWorkspaceId: state.activeWorkspaceId === action.id ? rest[0].id : state.activeWorkspaceId,
        components: state.components.filter(c => c.workspaceId !== action.id),
        lanes: state.lanes.filter(l => l.workspaceId !== action.id),
      }
    }
    case "RENAME_WORKSPACE":
      return { ...state, workspaces: state.workspaces.map(w => w.id === action.id ? { ...w, label: action.label } : w) }
    case "DEPLOY_COMPONENT": {
      const ws = state.workspaces.find(w => w.id === state.activeWorkspaceId)
      if (!ws) return state
      instanceCounter++
      const zCounter = state.zCounter + 1
      // 部署到 lane 模式时，自动归到当前 workspace 的第一个 lane（若没有则不归属，由 LaneView 兜底到默认 lane）
      let laneId: string | undefined
      const wsLanes = state.lanes.filter(l => l.workspaceId === ws.id && !l.hidden)
      if (wsLanes.length > 0) laneId = wsLanes[0].id
      const newComp: ComponentInstance = {
        id: `comp-${instanceCounter}-${Date.now()}`,
        moduleId: action.moduleId,
        state: "docked",
        position: { x: 20 + (instanceCounter % 5) * 20, y: 20 + (instanceCounter % 4) * 20 },
        size: { w: 340, h: 280 },
        z: zCounter,
        collapsed: false,
        workspaceId: ws.id,
        laneId,
        flowPosition: { x: 100 + (instanceCounter % 4) * 280, y: 100 + Math.floor(instanceCounter / 4) * 200 },
        flowSize: { width: 384, height: 320 },
        dockPanel: "default",
      }
      let lanes = state.lanes
      // 若当前 workspace 还没有任何 lane，自动建一个默认 lane 容纳新组件
      if (wsLanes.length === 0) {
        laneCounter++
        const defaultLane: Lane = {
          id: `lane-${laneCounter}-${Date.now()}`,
          label: "DEFAULT LANE",
          workspaceId: ws.id,
          widthRatio: 1,
          collapsed: false,
          hidden: false,
          cardOrder: [newComp.id],
        }
        newComp.laneId = defaultLane.id
        lanes = [...state.lanes, defaultLane]
      } else if (laneId) {
        // 把新组件追加到目标 lane 的 cardOrder 末尾
        lanes = state.lanes.map(l => l.id === laneId ? { ...l, cardOrder: [...(l.cardOrder ?? []), newComp.id] } : l)
      }
      return { ...state, components: [...state.components, newComp], lanes, zCounter }
    }
    case "REMOVE_COMPONENT":
      return {
        ...state,
        components: state.components.filter(c => c.id !== action.id),
        lanes: state.lanes.map(l => ({
          ...l,
          cardOrder: l.cardOrder?.filter(id => id !== action.id),
        })),
        focusedComponentId: state.focusedComponentId === action.id ? null : state.focusedComponentId,
        fullscreenComponentId: state.fullscreenComponentId === action.id ? null : state.fullscreenComponentId,
      }
    case "SET_COMPONENT_STATE": {
      const comp = state.components.find(c => c.id === action.id)
      if (!comp) return state
      const wasFullscreen = comp.state === "fullscreen"
      return {
        ...state,
        components: state.components.map(c => c.id === action.id ? { ...c, state: action.state } : c),
        focusedComponentId: action.state === "focused" ? action.id : (wasFullscreen ? null : state.focusedComponentId),
        fullscreenComponentId: action.state === "fullscreen" ? action.id : (wasFullscreen ? null : state.fullscreenComponentId),
      }
    }
    case "SET_COMPONENT_POSITION":
    case "MOVE_COMPONENT":
      return { ...state, components: state.components.map(c => c.id === action.id ? { ...c, position: { x: action.x, y: action.y } } : c) }
    case "SET_COMPONENT_FLOW_POS":
      return { ...state, components: state.components.map(c => c.id === action.id ? { ...c, flowPosition: { x: action.x, y: action.y } } : c) }
    case "SET_COMPONENT_FLOW_SIZE":
      return { ...state, components: state.components.map(c => c.id === action.id ? { ...c, flowSize: { width: action.width, height: action.height } } : c) }
    case "SET_COMPONENT_DATA":
      return { ...state, components: state.components.map(c => c.id === action.id ? { ...c, data: action.data } : c) }
    case "PATCH_COMPONENT_DATA":
      // 浅合并：模块用 setField(key, value) 写入，不会覆盖其他字段。
      // 这样切换 viewMode 时模块状态保留在 store，重新挂载后能恢复。
      return {
        ...state,
        components: state.components.map(c =>
          c.id === action.id ? { ...c, data: { ...c.data, ...action.patch } } : c
        ),
      }
    case "SET_COMPONENT_DOCK_PANEL":
      return { ...state, components: state.components.map(c => c.id === action.id ? { ...c, dockPanel: action.panelId } : c) }
    case "SET_COMPONENT_VISIBILITY": {
      let changed = false
      const components = state.components.map(c => {
        if (c.id !== action.id) return c
        const cur = c.hiddenIn ?? {}
        const nextHidden = !action.visible
        if (!!cur[action.viewMode] === nextHidden) return c
        changed = true
        return { ...c, hiddenIn: { ...cur, [action.viewMode]: nextHidden } }
      })
      return changed ? { ...state, components } : state
    }
    case "TOGGLE_COMPONENT_VISIBILITY":
      return {
        ...state,
        components: state.components.map(c => {
          if (c.id !== action.id) return c
          const cur = c.hiddenIn ?? {}
          const next = !cur[action.viewMode]
          // 关闭时记录 hiddenIn[viewMode]=true；重新打开时设为 false（不删 key，保持对象形状稳定）
          return { ...c, hiddenIn: { ...cur, [action.viewMode]: next } }
        }),
      }
    case "SET_COMPONENT_TAGS":
      // Database 模块维护的标签 — 直接挂到 ComponentInstance 上，
      // 与所有 viewMode 共享同一份数据源（不存到 comp.data，避免冗余映射）。
      return {
        ...state,
        components: state.components.map(c =>
          c.id === action.id ? { ...c, tags: action.tags } : c
        ),
      }
    case "FOCUS_COMPONENT":
      return { ...state, focusedComponentId: action.id }
    case "SET_FULLSCREEN":
      return {
        ...state,
        components: state.components.map(c => {
          if (action.id === null) return c.state === "fullscreen" ? { ...c, state: "docked" as ComponentState } : c
          return c.id === action.id ? { ...c, state: "fullscreen" as ComponentState } : c.state === "fullscreen" ? { ...c, state: "docked" as ComponentState } : c
        }),
        fullscreenComponentId: action.id,
      }
    case "RAISE_COMPONENT": {
      const zCounter = state.zCounter + 1
      return {
        ...state,
        zCounter,
        components: state.components.map(c => c.id === action.id ? { ...c, z: zCounter } : c),
      }
    }
    case "TOGGLE_COLLAPSE":
      return {
        ...state,
        components: state.components.map(c => c.id === action.id ? { ...c, collapsed: !c.collapsed } : c),
      }
    case "SET_OVERLAY":
      return { ...state, overlay: action.overlay }
    case "SET_GRAIN": return { ...state, grainEnabled: action.enabled }
    case "SET_VIGNETTE": return { ...state, vignetteDepth: action.depth }
    case "SET_GRAIN_INTENSITY": return { ...state, grainIntensity: action.intensity }
    case "SET_ACTION_GLOW": return { ...state, actionGlow: action.enabled }
    case "SET_CARD_ELEVATION": return { ...state, cardElevation: action.enabled }
    case "BACKEND_READY": return { ...state, backendReady: action.ready }
    case "HYDRATE": {
      const workspaces: WorkspaceItem[] = action.workspaces.length
        ? action.workspaces.map(w => ({ id: w.id, label: w.label, icon: w.icon }))
        : INITIAL_STATE.workspaces
      const components: ComponentInstance[] = action.components.map(c => ({
        id: c.id,
        moduleId: c.moduleId,
        state: "docked",
        workspaceId: c.workspaceId,
        data: c.data,
        flowPosition: c.flowPosition,
        flowSize: c.flowSize,
        dockPanel: c.dockPanel,
        laneId: c.laneId,
        hiddenIn: c.hiddenIn,
        tags: c.tags,
        z: c.z,
        collapsed: c.collapsed,
        position: { x: 20, y: 20 },
        size: { w: 340, h: 280 },
      }))
      const lanes: Lane[] = action.lanes.map(l => ({
        id: l.id,
        label: l.label,
        workspaceId: l.workspaceId,
        widthRatio: l.widthRatio,
        collapsed: l.collapsed,
        hidden: l.hidden,
        cardOrder: l.cardOrder,
      }))
      return {
        ...state,
        workspaces,
        lanes,
        components,
        activeWorkspaceId: workspaces[0]?.id ?? state.activeWorkspaceId,
      }
    }
    // ── Lane actions ──
    case "ADD_LANE": {
      const wsId = action.workspaceId ?? state.activeWorkspaceId
      laneCounter++
      const newLane: Lane = {
        id: `lane-${laneCounter}-${Date.now()}`,
        label: action.label ?? `LANE ${state.lanes.filter(l => l.workspaceId === wsId).length + 1}`,
        workspaceId: wsId,
        widthRatio: 1,
        collapsed: false,
        hidden: false,
        cardOrder: [],
      }
      return { ...state, lanes: [...state.lanes, newLane] }
    }
    case "REMOVE_LANE":
      return {
        ...state,
        lanes: state.lanes.filter(l => l.id !== action.id),
        // 级联：把该 lane 下组件的 laneId 清空（会落到默认 lane）
        components: state.components.map(c => c.laneId === action.id ? { ...c, laneId: undefined } : c),
      }
    case "RENAME_LANE":
      return { ...state, lanes: state.lanes.map(l => l.id === action.id ? { ...l, label: action.label } : l) }
    case "SET_LANE_WIDTH_RATIO":
      return { ...state, lanes: state.lanes.map(l => l.id === action.id ? { ...l, widthRatio: Math.max(0.25, Math.min(4, action.ratio)) } : l) }
    case "TOGGLE_LANE_COLLAPSE":
      return { ...state, lanes: state.lanes.map(l => l.id === action.id ? { ...l, collapsed: !l.collapsed } : l) }
    case "TOGGLE_LANE_VISIBILITY":
      return { ...state, lanes: state.lanes.map(l => l.id === action.id ? { ...l, hidden: !l.hidden } : l) }
    case "REORDER_LANE": {
      const idx = state.lanes.findIndex(l => l.id === action.fromId)
      const toIdx = state.lanes.findIndex(l => l.id === action.toId)
      if (idx < 0 || toIdx < 0 || idx === toIdx) return state
      const next = [...state.lanes]
      const [moved] = next.splice(idx, 1)
      next.splice(toIdx, 0, moved)
      return { ...state, lanes: next }
    }
    case "SET_LANE_CARD_ORDER":
      return { ...state, lanes: state.lanes.map(l => l.id === action.id ? { ...l, cardOrder: action.cardOrder } : l) }
    case "MOVE_COMPONENT_TO_LANE": {
      const comp = state.components.find(c => c.id === action.componentId)
      if (!comp) return state
      const fromLaneId = comp.laneId
      const toLaneId = action.toLaneId
      if (fromLaneId === toLaneId && !action.targetCardId) return state
      // 1. 更新 component.laneId
      const components = state.components.map(c =>
        c.id === action.componentId ? { ...c, laneId: toLaneId } : c
      )
      // 2. 从源 lane 的 cardOrder 中移除
      let lanes = state.lanes.map(l => {
        if (l.id !== fromLaneId) return l
        return { ...l, cardOrder: l.cardOrder?.filter(id => id !== action.componentId) }
      })
      // 3. 在目标 lane 的 cardOrder 中插入
      lanes = lanes.map(l => {
        if (l.id !== toLaneId) return l
        const order = [...(l.cardOrder ?? [])]
        if (!action.targetCardId) {
          order.push(action.componentId)
        } else {
          const idx = order.indexOf(action.targetCardId)
          if (idx < 0) order.push(action.componentId)
          else order.splice(action.insertAfter ? idx + 1 : idx, 0, action.componentId)
        }
        return { ...l, cardOrder: order }
      })
      return { ...state, components, lanes }
    }
    default: return state
  }
}

// ── Context ──────────────────────────────────────────────────────────────────

interface WSContextValue {
  state: WSState
  dispatch: React.Dispatch<Action>
  activeWorkspace: WorkspaceItem | undefined
  visibleComponents: ComponentInstance[]
}

const WSContext = createContext<WSContextValue | undefined>(undefined)

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE)

  const activeWorkspace = useMemo(
    () => state.workspaces.find(w => w.id === state.activeWorkspaceId),
    [state.workspaces, state.activeWorkspaceId]
  )

  const visibleComponents = useMemo(
    () => state.components.filter(c => c.workspaceId === state.activeWorkspaceId),
    [state.components, state.activeWorkspaceId]
  )

  // 启动时拉取后端持久化数据 — 四种 viewMode 共享这同一份数据
  useEffect(() => {
    let cancelled = false
    getBackend().then(async backend => {
      if (cancelled) return
      try {
        const [workspaces, lanes, components] = await Promise.all([
          backend.workspace.listWorkspaces(),
          backend.workspace.listLanes(),
          backend.workspace.listComponents(),
        ])
        dispatch({ type: "HYDRATE", workspaces, lanes, components })
        dispatch({ type: "BACKEND_READY", ready: true })
      } catch (e) {
        console.error("[backend] hydrate failed:", e)
        dispatch({ type: "BACKEND_READY", ready: true })
      }
    })
    return () => { cancelled = true }
  }, [])

  // 自动落盘：workspaces / lanes / components 变化后 debounce 写回后端。
  // 这是"后端落盘"的核心：在 web runtime 下走 localStorage，
  // 在 Electbun runtime 下走真实文件系统（userData/storage.json）。
  useEffect(() => {
    if (!state.backendReady) return
    let timer: ReturnType<typeof setTimeout> | null = null
    timer = setTimeout(async () => {
      try {
        const backend = await getBackend()
        await Promise.all([
          Promise.all(state.workspaces.map(w => backend.workspace.saveWorkspace({
            id: w.id,
            label: w.label,
            icon: w.icon,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }))),
          Promise.all(state.lanes.map(l => backend.workspace.saveLane({
            id: l.id,
            label: l.label,
            workspaceId: l.workspaceId,
            widthRatio: l.widthRatio,
            collapsed: l.collapsed,
            hidden: l.hidden,
            cardOrder: l.cardOrder,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }))),
          Promise.all(state.components.map(c => backend.workspace.saveComponent({
            id: c.id,
            moduleId: c.moduleId,
            workspaceId: c.workspaceId,
            data: c.data,
            flowPosition: c.flowPosition,
            flowSize: c.flowSize,
            dockPanel: c.dockPanel,
            laneId: c.laneId,
            hiddenIn: c.hiddenIn,
            tags: c.tags,
            z: c.z,
            collapsed: c.collapsed,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }))),
        ])
      } catch (e) {
        console.error("[backend] persist failed:", e)
      }
    }, 500)
    return () => { if (timer) clearTimeout(timer) }
  }, [state.workspaces, state.lanes, state.components, state.backendReady])

  const value = useMemo(() => ({ state, dispatch, activeWorkspace, visibleComponents }), [
    state, dispatch, activeWorkspace, visibleComponents,
  ])

  return <WSContext.Provider value={value}>{children}</WSContext.Provider>
}

export function useWorkspace() {
  const ctx = useContext(WSContext)
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider")
  return ctx
}

export function useWSDispatch() {
  return useWorkspace().dispatch
}

// Convenience action creators
export const actions = {
  setTheme: (theme: AppTheme): Action => ({ type: "SET_THEME", theme }),
  setViewMode: (mode: ViewMode): Action => ({ type: "SET_VIEW_MODE", mode }),
  setCardLayout: (layout: CardLayout): Action => ({ type: "SET_CARD_LAYOUT", layout }),
  setActiveWorkspace: (id: string): Action => ({ type: "SET_ACTIVE_WORKSPACE", id }),
  addWorkspace: (): Action => ({ type: "ADD_WORKSPACE" }),
  removeWorkspace: (id: string): Action => ({ type: "REMOVE_WORKSPACE", id }),
  renameWorkspace: (id: string, label: string): Action => ({ type: "RENAME_WORKSPACE", id, label }),
  deployComponent: (moduleId: string): Action => ({ type: "DEPLOY_COMPONENT", moduleId }),
  removeComponent: (id: string): Action => ({ type: "REMOVE_COMPONENT", id }),
  setComponentState: (id: string, state: ComponentState): Action => ({ type: "SET_COMPONENT_STATE", id, state }),
  setComponentPosition: (id: string, x: number, y: number): Action => ({ type: "SET_COMPONENT_POSITION", id, x, y }),
  moveComponent: (id: string, x: number, y: number): Action => ({ type: "MOVE_COMPONENT", id, x, y }),
  setComponentFlowPos: (id: string, x: number, y: number): Action => ({ type: "SET_COMPONENT_FLOW_POS", id, x, y }),
  setComponentFlowSize: (id: string, width: number, height: number): Action => ({ type: "SET_COMPONENT_FLOW_SIZE", id, width, height }),
  setComponentData: (id: string, data: Record<string, unknown>): Action => ({ type: "SET_COMPONENT_DATA", id, data }),
  patchComponentData: (id: string, patch: Record<string, unknown>): Action => ({ type: "PATCH_COMPONENT_DATA", id, patch }),
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
  // ── Lane ──
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

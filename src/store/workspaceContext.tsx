import React, { createContext, useContext, useMemo, useReducer } from "react"
import type {
  AppTheme,
  ComponentInstance,
  ComponentState,
  LayoutMode,
  WorkspaceItem,
  WorkspaceTab,
} from "@/types/workspace"

// ── State ───────────────────────────────────────────────────────────────────

interface WSState {
  theme: AppTheme
  layoutMode: LayoutMode
  workspaces: WorkspaceItem[]
  activeWorkspaceId: string
  components: ComponentInstance[]
  focusedComponentId: string | null
  fullscreenComponentId: string | null
  zCounter: number
  sidebarView: "workspaces" | "registry" | "settings" | "deployment"
  grainEnabled: boolean
  vignetteDepth: number
  grainIntensity: number
  actionGlow: boolean
  cardElevation: boolean
}

// ── Actions ──────────────────────────────────────────────────────────────────

type Action =
  | { type: "SET_THEME"; theme: AppTheme }
  | { type: "SET_LAYOUT"; mode: LayoutMode }
  | { type: "SET_ACTIVE_WORKSPACE"; id: string }
  | { type: "ADD_WORKSPACE" }
  | { type: "REMOVE_WORKSPACE"; id: string }
  | { type: "RENAME_WORKSPACE"; id: string; label: string }
  | { type: "ADD_TAB"; workspaceId: string }
  | { type: "REMOVE_TAB"; workspaceId: string; tabId: string }
  | { type: "SET_ACTIVE_TAB"; workspaceId: string; tabId: string }
  | { type: "RENAME_TAB"; workspaceId: string; tabId: string; label: string }
  | { type: "DEPLOY_COMPONENT"; moduleId: string }
  | { type: "REMOVE_COMPONENT"; id: string }
  | { type: "SET_COMPONENT_STATE"; id: string; state: ComponentState }
  | { type: "SET_COMPONENT_POSITION"; id: string; x: number; y: number }
  | { type: "MOVE_COMPONENT"; id: string; x: number; y: number }
  | { type: "FOCUS_COMPONENT"; id: string | null }
  | { type: "SET_FULLSCREEN"; id: string | null }
  | { type: "RAISE_COMPONENT"; id: string }
  | { type: "TOGGLE_COLLAPSE"; id: string }
  | { type: "SET_SIDEBAR_VIEW"; view: WSState["sidebarView"] }
  | { type: "SET_GRAIN"; enabled: boolean }
  | { type: "SET_VIGNETTE"; depth: number }
  | { type: "SET_GRAIN_INTENSITY"; intensity: number }
  | { type: "SET_ACTION_GLOW"; enabled: boolean }
  | { type: "SET_CARD_ELEVATION"; enabled: boolean }

// ── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_TABS: WorkspaceTab[] = [
  { id: "t-main", label: "TACTICAL_GRID", workspaceId: "ws-alpha" },
  { id: "t-ops",  label: "OPERATOR_LIST", workspaceId: "ws-alpha" },
]

const INITIAL_STATE: WSState = {
  theme: "spatial",
  layoutMode: "grid",
  workspaces: [
    { id: "ws-alpha", label: "WORKSPACE ALPHA", tabs: DEFAULT_TABS, activeTabId: "t-main" },
    { id: "ws-grid",  label: "ANALYTICAL GRID", tabs: [{ id: "t-g1", label: "MAIN", workspaceId: "ws-grid" }], activeTabId: "t-g1" },
    { id: "ws-kern",  label: "SYSTEM KERNEL",   tabs: [{ id: "t-k1", label: "MAIN", workspaceId: "ws-kern" }], activeTabId: "t-k1" },
    { id: "ws-net",   label: "NETWORK NODE",    tabs: [{ id: "t-n1", label: "MAIN", workspaceId: "ws-net"  }], activeTabId: "t-n1" },
    { id: "ws-arch",  label: "ARCHIVE",         tabs: [{ id: "t-a1", label: "MAIN", workspaceId: "ws-arch" }], activeTabId: "t-a1" },
  ],
  activeWorkspaceId: "ws-alpha",
  components: [],
  focusedComponentId: null,
  fullscreenComponentId: null,
  zCounter: 1,
  sidebarView: "workspaces",
  grainEnabled: true,
  vignetteDepth: 40,
  grainIntensity: 15,
  actionGlow: true,
  cardElevation: false,
}

// ── Reducer ──────────────────────────────────────────────────────────────────

let instanceCounter = 0

function reducer(state: WSState, action: Action): WSState {
  switch (action.type) {
    case "SET_THEME": return { ...state, theme: action.theme }
    case "SET_LAYOUT": return { ...state, layoutMode: action.mode }
    case "SET_ACTIVE_WORKSPACE": return { ...state, activeWorkspaceId: action.id }
    case "ADD_WORKSPACE": {
      const id = `ws-${Date.now()}`
      const tabId = `t-${Date.now()}`
      return {
        ...state,
        workspaces: [
          ...state.workspaces,
          { id, label: `WORKSPACE ${state.workspaces.length + 1}`, tabs: [{ id: tabId, label: "MAIN", workspaceId: id }], activeTabId: tabId },
        ],
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
      }
    }
    case "RENAME_WORKSPACE":
      return { ...state, workspaces: state.workspaces.map(w => w.id === action.id ? { ...w, label: action.label } : w) }
    case "ADD_TAB": {
      const tabId = `t-${Date.now()}`
      return {
        ...state,
        workspaces: state.workspaces.map(w =>
          w.id === action.workspaceId
            ? { ...w, tabs: [...w.tabs, { id: tabId, label: `TAB_${w.tabs.length + 1}`, workspaceId: w.id }], activeTabId: tabId }
            : w
        ),
      }
    }
    case "REMOVE_TAB": {
      return {
        ...state,
        workspaces: state.workspaces.map(w => {
          if (w.id !== action.workspaceId || w.tabs.length <= 1) return w
          const tabs = w.tabs.filter(t => t.id !== action.tabId)
          return { ...w, tabs, activeTabId: w.activeTabId === action.tabId ? tabs[0].id : w.activeTabId }
        }),
        components: state.components.filter(c => !(c.workspaceId === action.workspaceId && c.tabId === action.tabId)),
      }
    }
    case "SET_ACTIVE_TAB":
      return { ...state, workspaces: state.workspaces.map(w => w.id === action.workspaceId ? { ...w, activeTabId: action.tabId } : w) }
    case "RENAME_TAB":
      return {
        ...state,
        workspaces: state.workspaces.map(w =>
          w.id !== action.workspaceId ? w : { ...w, tabs: w.tabs.map(t => t.id === action.tabId ? { ...t, label: action.label } : t) }
        ),
      }
    case "DEPLOY_COMPONENT": {
      const ws = state.workspaces.find(w => w.id === state.activeWorkspaceId)
      if (!ws) return state
      instanceCounter++
      const zCounter = state.zCounter + 1
      const newComp: ComponentInstance = {
        id: `comp-${instanceCounter}-${Date.now()}`,
        moduleId: action.moduleId,
        state: "docked",
        position: { x: 20 + (instanceCounter % 5) * 20, y: 20 + (instanceCounter % 4) * 20 },
        size: { w: 340, h: 280 },
        z: zCounter,
        collapsed: false,
        tabId: ws.activeTabId,
        workspaceId: ws.id,
      }
      return { ...state, components: [...state.components, newComp], zCounter, sidebarView: "workspaces" }
    }
    case "REMOVE_COMPONENT":
      return {
        ...state,
        components: state.components.filter(c => c.id !== action.id),
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
    case "SET_SIDEBAR_VIEW":
      return { ...state, sidebarView: action.view }
    case "SET_GRAIN": return { ...state, grainEnabled: action.enabled }
    case "SET_VIGNETTE": return { ...state, vignetteDepth: action.depth }
    case "SET_GRAIN_INTENSITY": return { ...state, grainIntensity: action.intensity }
    case "SET_ACTION_GLOW": return { ...state, actionGlow: action.enabled }
    case "SET_CARD_ELEVATION": return { ...state, cardElevation: action.enabled }
    default: return state
  }
}

// ── Context ──────────────────────────────────────────────────────────────────

interface WSContextValue {
  state: WSState
  dispatch: React.Dispatch<Action>
  activeWorkspace: WorkspaceItem | undefined
  activeTab: WorkspaceTab | undefined
  visibleComponents: ComponentInstance[]
}

const WSContext = createContext<WSContextValue | undefined>(undefined)

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE)

  const activeWorkspace = useMemo(
    () => state.workspaces.find(w => w.id === state.activeWorkspaceId),
    [state.workspaces, state.activeWorkspaceId]
  )

  const activeTab = useMemo(
    () => activeWorkspace?.tabs.find(t => t.id === activeWorkspace.activeTabId),
    [activeWorkspace]
  )

  const visibleComponents = useMemo(
    () => state.components.filter(c => c.workspaceId === state.activeWorkspaceId && c.tabId === activeWorkspace?.activeTabId),
    [state.components, state.activeWorkspaceId, activeWorkspace?.activeTabId]
  )

  const value = useMemo(() => ({ state, dispatch, activeWorkspace, activeTab, visibleComponents }), [
    state, dispatch, activeWorkspace, activeTab, visibleComponents,
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
  setLayout: (mode: LayoutMode): Action => ({ type: "SET_LAYOUT", mode }),
  setActiveWorkspace: (id: string): Action => ({ type: "SET_ACTIVE_WORKSPACE", id }),
  addWorkspace: (): Action => ({ type: "ADD_WORKSPACE" }),
  removeWorkspace: (id: string): Action => ({ type: "REMOVE_WORKSPACE", id }),
  addTab: (workspaceId: string): Action => ({ type: "ADD_TAB", workspaceId }),
  removeTab: (workspaceId: string, tabId: string): Action => ({ type: "REMOVE_TAB", workspaceId, tabId }),
  setActiveTab: (workspaceId: string, tabId: string): Action => ({ type: "SET_ACTIVE_TAB", workspaceId, tabId }),
  renameTab: (workspaceId: string, tabId: string, label: string): Action => ({ type: "RENAME_TAB", workspaceId, tabId, label }),
  deployComponent: (moduleId: string): Action => ({ type: "DEPLOY_COMPONENT", moduleId }),
  removeComponent: (id: string): Action => ({ type: "REMOVE_COMPONENT", id }),
  setComponentState: (id: string, state: ComponentState): Action => ({ type: "SET_COMPONENT_STATE", id, state }),
  setComponentPosition: (id: string, x: number, y: number): Action => ({ type: "SET_COMPONENT_POSITION", id, x, y }),
  moveComponent: (id: string, x: number, y: number): Action => ({ type: "MOVE_COMPONENT", id, x, y }),
  focusComponent: (id: string | null): Action => ({ type: "FOCUS_COMPONENT", id }),
  setFullscreen: (id: string | null): Action => ({ type: "SET_FULLSCREEN", id }),
  raiseComponent: (id: string): Action => ({ type: "RAISE_COMPONENT", id }),
  toggleCollapse: (id: string): Action => ({ type: "TOGGLE_COLLAPSE", id }),
  setSidebarView: (view: WSState["sidebarView"]): Action => ({ type: "SET_SIDEBAR_VIEW", view }),
  setGrain: (enabled: boolean): Action => ({ type: "SET_GRAIN", enabled }),
  setVignette: (depth: number): Action => ({ type: "SET_VIGNETTE", depth }),
  setGrainIntensity: (intensity: number): Action => ({ type: "SET_GRAIN_INTENSITY", intensity }),
  setActionGlow: (enabled: boolean): Action => ({ type: "SET_ACTION_GLOW", enabled }),
  setCardElevation: (enabled: boolean): Action => ({ type: "SET_CARD_ELEVATION", enabled }),
}

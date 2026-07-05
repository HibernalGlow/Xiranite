import { createContext, useContext, useReducer, type ReactNode } from "react";
import type { LayoutMode, Panel, Rect } from "./types";

export interface Tab {
  id: string;
  name: string;
  panels: Panel[];
  mode: LayoutMode;
  focusedId: string | null;
  fullscreenId: string | null;
  zCounter: number;
}

interface AppState {
  tabs: Tab[];
  activeTabId: string;
}

type Action =
  | { type: "ADD"; kind: string; title: string }
  | { type: "REMOVE"; id: string }
  | { type: "SET_MODE"; mode: LayoutMode }
  | { type: "TOGGLE_COLLAPSE"; id: string }
  | { type: "FOCUS"; id: string | null }
  | { type: "FULLSCREEN"; id: string | null }
  | { type: "RAISE"; id: string }
  | { type: "MOVE"; id: string; rect: Partial<Rect> }
  | { type: "ADD_TAB" }
  | { type: "CLOSE_TAB"; id: string }
  | { type: "RENAME_TAB"; id: string; name: string }
  | { type: "SET_TAB"; id: string }
  | { type: "ENTER_FREE"; rects: Record<string, Rect> };

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

function scatter(index: number): Rect {
  const cols = 3;
  const c = index % cols;
  const r = Math.floor(index / cols);
  return { x: 40 + c * 360, y: 40 + r * 300, w: 340, h: 260 };
}

function emptyTab(name: string): Tab {
  return {
    id: nextId("tab"),
    name,
    panels: [],
    mode: "grid",
    focusedId: null,
    fullscreenId: null,
    zCounter: 0,
  };
}

function mapActive(state: AppState, fn: (t: Tab) => Tab): AppState {
  return {
    ...state,
    tabs: state.tabs.map((t) => (t.id === state.activeTabId ? fn(t) : t)),
  };
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "ADD":
      return mapActive(state, (t) => {
        const z = t.zCounter + 1;
        const panel: Panel = {
          id: nextId("panel"),
          kind: action.kind,
          title: action.title,
          collapsed: false,
          free: scatter(t.panels.length),
          z,
        };
        return { ...t, panels: [...t.panels, panel], zCounter: z };
      });
    case "REMOVE":
      return mapActive(state, (t) => ({
        ...t,
        panels: t.panels.filter((p) => p.id !== action.id),
        focusedId: t.focusedId === action.id ? null : t.focusedId,
        fullscreenId: t.fullscreenId === action.id ? null : t.fullscreenId,
      }));
    case "SET_MODE":
      return mapActive(state, (t) => ({ ...t, mode: action.mode, fullscreenId: null }));
    case "TOGGLE_COLLAPSE":
      return mapActive(state, (t) => ({
        ...t,
        panels: t.panels.map((p) => (p.id === action.id ? { ...p, collapsed: !p.collapsed } : p)),
      }));
    case "FOCUS":
      return mapActive(state, (t) => ({ ...t, focusedId: action.id }));
    case "FULLSCREEN":
      return mapActive(state, (t) => ({ ...t, fullscreenId: action.id }));
    case "RAISE":
      return mapActive(state, (t) => {
        const z = t.zCounter + 1;
        return { ...t, zCounter: z, panels: t.panels.map((p) => (p.id === action.id ? { ...p, z } : p)) };
      });
    case "MOVE":
      return mapActive(state, (t) => ({
        ...t,
        panels: t.panels.map((p) => (p.id === action.id ? { ...p, free: { ...p.free, ...action.rect } } : p)),
      }));
    case "ADD_TAB": {
      const tab = emptyTab(`SPACE ${state.tabs.length + 1}`);
      return { ...state, tabs: [...state.tabs, tab], activeTabId: tab.id };
    }
    case "CLOSE_TAB": {
      if (state.tabs.length <= 1) return state;
      const idx = state.tabs.findIndex((t) => t.id === action.id);
      const tabs = state.tabs.filter((t) => t.id !== action.id);
      const activeTabId =
        state.activeTabId === action.id ? tabs[Math.max(0, idx - 1)].id : state.activeTabId;
      return { tabs, activeTabId };
    }
    case "RENAME_TAB":
      return {
        ...state,
        tabs: state.tabs.map((t) => (t.id === action.id ? { ...t, name: action.name || t.name } : t)),
      };
    case "SET_TAB":
      return { ...state, activeTabId: action.id };
    case "ENTER_FREE":
      return mapActive(state, (t) => ({
        ...t,
        mode: "free",
        fullscreenId: null,
        panels: t.panels.map((p) =>
          action.rects[p.id] ? { ...p, free: action.rects[p.id] } : p,
        ),
      }));
    default:
      return state;
  }
}

interface WorkspaceApi {
  // active-tab flattened state
  panels: Panel[];
  mode: LayoutMode;
  focusedId: string | null;
  fullscreenId: string | null;
  // tabs
  tabs: Tab[];
  activeTabId: string;
  // panel actions (act on active tab)
  add: (kind: string, title: string) => void;
  remove: (id: string) => void;
  setMode: (mode: LayoutMode) => void;
  enterFree: (rects: Record<string, Rect>) => void;
  toggleCollapse: (id: string) => void;
  focus: (id: string | null) => void;
  setFullscreen: (id: string | null) => void;
  raise: (id: string) => void;
  move: (id: string, rect: Partial<Rect>) => void;
  // tab actions
  addTab: () => void;
  closeTab: (id: string) => void;
  renameTab: (id: string, name: string) => void;
  setActiveTab: (id: string) => void;
}

const WorkspaceContext = createContext<WorkspaceApi | null>(null);

export function WorkspaceProvider({
  children,
  seed,
}: {
  children: ReactNode;
  seed?: { kind: string; title: string }[];
}) {
  const [state, dispatch] = useReducer(reducer, undefined, (): AppState => {
    const tab = emptyTab("MAIN");
    if (seed) {
      let z = 0;
      tab.zCounter = seed.length;
      tab.panels = seed.map((e, i) => ({
        id: nextId("panel"),
        kind: e.kind,
        title: e.title,
        collapsed: false,
        free: scatter(i),
        z: ++z,
      }));
    }
    return { tabs: [tab], activeTabId: tab.id };
  });

  const active = state.tabs.find((t) => t.id === state.activeTabId) ?? state.tabs[0];

  const api: WorkspaceApi = {
    panels: active.panels,
    mode: active.mode,
    focusedId: active.focusedId,
    fullscreenId: active.fullscreenId,
    tabs: state.tabs,
    activeTabId: state.activeTabId,
    add: (kind, title) => dispatch({ type: "ADD", kind, title }),
    remove: (id) => dispatch({ type: "REMOVE", id }),
    setMode: (mode) => dispatch({ type: "SET_MODE", mode }),
    enterFree: (rects) => dispatch({ type: "ENTER_FREE", rects }),
    toggleCollapse: (id) => dispatch({ type: "TOGGLE_COLLAPSE", id }),
    focus: (id) => dispatch({ type: "FOCUS", id }),
    setFullscreen: (id) => dispatch({ type: "FULLSCREEN", id }),
    raise: (id) => dispatch({ type: "RAISE", id }),
    move: (id, rect) => dispatch({ type: "MOVE", id, rect }),
    addTab: () => dispatch({ type: "ADD_TAB" }),
    closeTab: (id) => dispatch({ type: "CLOSE_TAB", id }),
    renameTab: (id, name) => dispatch({ type: "RENAME_TAB", id, name }),
    setActiveTab: (id) => dispatch({ type: "SET_TAB", id }),
  };

  return <WorkspaceContext.Provider value={api}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}

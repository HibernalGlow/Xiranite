export type ViewMode = "dashboard" | "cards" | "dockview" | "flow" | "lane" | "bento"

export type CardLayout = "grid" | "stack" | "split" | "focus"

/** 卡片点击/双击触发的动作。 */
export type CardClickAction = "none" | "focus" | "fullscreen"

export type OverlayKind = "registry" | "settings" | "operations" | "history" | null

/** 侧栏面板的展现模式：docked 为推开式固定侧栏，floating 为悬浮遮罩。 */
export type OverlayMode = "docked" | "floating"

export type FlowCanvasSnapshot = Record<string, unknown>
export interface FlowCanvasCamera {
  x: number
  y: number
  z: number
}

export type ComponentState = "docked" | "floating" | "focused" | "fullscreen" | "compact"
export type AppTheme = "spatial" | "endfield" | "wuling" | "onlook" | "tori" | "conductor" | "hilden" | "aperture" | "noomo" | "excalidraw" | "astro" | "svelte" | "bun" | "storybook" | "supabase" | "penpot" | "vite"
export type AppThemeScheme = "light" | "dark"
export type AppThemeSelection =
  | { kind: "preset"; name: AppTheme }
  | { kind: "custom"; name: string }
export type AppThemeSelections = Record<AppThemeScheme, AppThemeSelection>
export type AppFontPreset = "xiranite" | "system" | "aestivus" | "industrial" | "display" | "editorial" | "poster" | "terminal" | "machina" | "sketch" | "workshop" | "canvas" | "serif" | "mono"

export interface AppCustomTheme {
  name: string
  description?: string
  cssVars: {
    theme?: Record<string, string>
    light: Record<string, string>
    dark?: Record<string, string>
  }
}

export interface WorkspaceItem {
  id: string
  label: string
  icon?: string
  flowCanvas?: FlowCanvasSnapshot
  flowCamera?: FlowCanvasCamera
  createdAt?: number
  updatedAt?: number
}

export interface Lane {
  id: string
  label: string
  workspaceId: string
  createdAt?: number
  updatedAt?: number
  /** Flex-grow width ratio. */
  widthRatio: number
  /** When collapsed, only the lane header is shown. */
  collapsed: boolean
  /** Lane-view specific visibility. */
  hidden?: boolean
  /** Card ordering inside this lane. */
  cardOrder?: string[]
}

export interface ComponentInstance {
  id: string
  moduleId: string
  state: ComponentState
  createdAt?: number
  updatedAt?: number
  /** Legacy free-layout position retained for persisted data compatibility. */
  position?: { x: number; y: number }
  /** Legacy free-layout size retained for persisted data compatibility. */
  size?: { w: number; h: number }
  /** Stacking order. */
  z?: number
  /** When true the panel only renders its header. */
  collapsed?: boolean
  workspaceId: string
  /** Persisted module data shared by all view modes. */
  data?: Record<string, unknown>
  /** React Flow node position. */
  flowPosition?: { x: number; y: number }
  /** React Flow node size, produced by NodeResizer. */
  flowSize?: { width: number; height: number }
  /** GridStack-backed Bento layout in 12-column grid units. */
  bentoLayout?: { x: number; y: number; w: number; h: number }
  /** Lane-view card dimensions. */
  laneSize?: { height: number }
  /** Dockview tab area. */
  dockPanel?: string
  /** Owning lane id. */
  laneId?: string
  /**
   * Per-view visibility flags. Closing a tab in dock mode, for example, sets
   * hiddenIn.dockview without deleting the component from other view modes.
   */
  hiddenIn?: Partial<Record<ViewMode, boolean>>
  /** User-defined tags maintained by database-like modules. */
  tags?: string[]
}

export interface DeployComponentOptions {
  viewMode?: ViewMode
  laneId?: string
  flowPosition?: { x: number; y: number }
  bentoLayout?: { x: number; y: number; w: number; h: number }
  position?: { x: number; y: number }
  dockPanel?: string
  tags?: string[]
}

export interface ModuleDef {
  id: string
  name: string
  version: string
  category: string
  description: string
  icon: string
}

export interface ComputedLayout {
  x: number
  y: number
  w: number
  h: number
  scale: number
  opacity: number
  z: number
  state: ComponentState
  interactive: boolean
}

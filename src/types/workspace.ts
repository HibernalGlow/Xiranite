export type LayoutMode = "grid" | "stack" | "free" | "split" | "focus"
export type ComponentState = "docked" | "floating" | "focused" | "fullscreen" | "compact"
export type AppTheme = "spatial" | "endfield" | "wuling"

export interface WorkspaceTab {
  id: string
  label: string
  icon?: string
  workspaceId: string
}

export interface WorkspaceItem {
  id: string
  label: string
  tabs: WorkspaceTab[]
  activeTabId: string
}

export interface ComponentInstance {
  id: string
  moduleId: string
  state: ComponentState
  /** free-layout position (px relative to canvas) */
  position?: { x: number; y: number }
  /** free-layout size */
  size?: { w: number; h: number }
  /** stacking order used by free/stack modes */
  z?: number
  /** collapsed flag — when true the panel only renders its header */
  collapsed?: boolean
  tabId: string
  workspaceId: string
}

export interface ModuleDef {
  id: string
  name: string
  version: string
  category: string
  description: string
  icon: string
}

/** Geometry a panel should adopt on the canvas — produced by the layout engine. */
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

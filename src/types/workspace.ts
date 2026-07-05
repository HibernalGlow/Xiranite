// ── View modes (顶栏切换的三种主形态) ────────────────────────────────────
// 三种形态共享同一份 workspace/components 数据，互不隔离。
// 切换 viewMode 只换渲染器，不动数据。
export type ViewMode = "cards" | "dockview" | "flow"

// ── Cards 子布局（仅 viewMode === "cards" 时生效） ──────────────────────────
// free 模式已删除：无法持久化卡片位置的 bug 修不好，干脆移除。
export type CardLayout = "grid" | "stack" | "split" | "focus"

// ── 弹出层（取代被删除的侧栏） ──────────────────────────────────────────────
export type OverlayKind = "registry" | "settings" | "deployment" | null

// ── 组件状态 ──────────────────────────────────────────────────────────────
export type ComponentState = "docked" | "floating" | "focused" | "fullscreen" | "compact"
export type AppTheme = "spatial" | "endfield" | "wuling"

// ── 数据模型 ──────────────────────────────────────────────────────────────
// 一个 workspace 直接对应一组组件（不再有 tab 层级）。
export interface WorkspaceItem {
  id: string
  label: string
  icon?: string
}

export interface ComponentInstance {
  id: string
  moduleId: string
  state: ComponentState
  /** free-layout position (px relative to canvas) — 仅 viewMode=cards & layout=free 时用，已废弃保留 */
  position?: { x: number; y: number }
  /** free-layout size */
  size?: { w: number; h: number }
  /** stacking order */
  z?: number
  /** collapsed flag — when true the panel only renders its header */
  collapsed?: boolean
  workspaceId: string
  /** 持久化数据 — 三种 viewMode 共享 */
  data?: Record<string, unknown>
  /** React-Flow 节点坐标（仅 viewMode=flow 时用） */
  flowPosition?: { x: number; y: number }
  /** React-Flow 节点尺寸 — 由 NodeResizer 拖拽产生，跨 viewMode 持久 */
  flowSize?: { width: number; height: number }
  /** Dockview tab 区域（仅 viewMode=dockview 时用） */
  dockPanel?: string
  /**
   * 各 viewMode 下独立的可见性开关 — 三种模式共享同一份 component 数据，
   * 但每个模式可以独立"关闭"某个组件，不影响其他模式。
   * 例如：dock 模式下关闭 tab → 仅 hiddenIn.dockview=true，
   * 切到 cards 模式仍然显示。
   */
  hiddenIn?: Partial<Record<ViewMode, boolean>>
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

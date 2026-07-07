/**
 * Backend shared types — 前后端共享的数据契约。
 *
 * 这个文件是「事实之源」：
 * - 前端 src/types/workspace.ts 的领域类型用于 UI 状态
 * - 后端 src/backend/shared/types.ts 的 DTO 用于跨进程传输
 * 二者解耦：UI 状态可以加临时字段，DTO 只保留持久化与传输所需。
 */

// ── Workspace ──────────────────────────────────────────────────────────────
export interface WorkspaceDTO {
  id: string
  label: string
  icon?: string
  createdAt: number
  updatedAt: number
}

// ── Lane ───────────────────────────────────────────────────────────────────
/** 泳道 DTO — 仅在 viewMode=lane 时持久化 */
export interface LaneDTO {
  id: string
  label: string
  workspaceId: string
  widthRatio: number
  collapsed: boolean
  hidden?: boolean
  cardOrder?: string[]
  createdAt: number
  updatedAt: number
}

// ── Component ───────────────────────────────────────────────────────────────
export interface ComponentDTO {
  id: string
  moduleId: string
  workspaceId: string
  /** 持久化的组件状态数据（每种模块自己定义结构） */
  data?: Record<string, unknown>
  /** React-Flow 节点坐标 */
  flowPosition?: { x: number; y: number }
  /** React-Flow 节点尺寸 */
  flowSize?: { width: number; height: number }
  /** GridStack 便当视图布局 */
  bentoLayout?: { x: number; y: number; w: number; h: number }
  /** Dockview 面板 id */
  dockPanel?: string
  /** 归属的 Lane id（仅 viewMode=lane 时用） */
  laneId?: string
  /** 各 viewMode 下独立的可见性开关 */
  hiddenIn?: { cards?: boolean; dockview?: boolean; flow?: boolean; lane?: boolean; bento?: boolean }
  /** 用户自定义标签 — Database 模块维护，与所有 viewMode 共享 */
  tags?: string[]
  /** Cards 模式层级 */
  z?: number
  collapsed?: boolean
  createdAt: number
  updatedAt: number
}

// ── 通用 Result ─────────────────────────────────────────────────────────────
export interface Result<T> {
  success: boolean
  message: string
  data?: T
  error?: string
}

export interface ProgressEvent {
  taskId: string
  percent: number
  message: string
  timestamp: number
}

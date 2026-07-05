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
  /** Dockview 面板 id */
  dockPanel?: string
  /** 各 viewMode 下独立的可见性开关 */
  hiddenIn?: { cards?: boolean; dockview?: boolean; flow?: boolean }
  /** Cards 模式层级 */
  z?: number
  collapsed?: boolean
  createdAt: number
  updatedAt: number
}

// ── EngineV (示例服务) ──────────────────────────────────────────────────────
/** Wallpaper Engine 工坊壁纸 — 由 EngineVService.scan 产出 */
export interface WallpaperDTO {
  workshopId: string
  title: string
  description?: string
  type: string
  contentRating?: string
  folderName: string
  sizeBytes: number
  lastModified: number
}

export interface EngineVScanResult {
  wallpapers: WallpaperDTO[]
  totalCount: number
  typeStats: Record<string, number>
  ratingStats: Record<string, number>
}

export interface EngineVFilterInput {
  wallpapers: WallpaperDTO[]
  filters: {
    type?: string[]
    contentRating?: string[]
    titleContains?: string
    minSize?: number
    maxSize?: number
  }
}

export interface EngineVRenameInput {
  wallpapers: WallpaperDTO[]
  template: string
  dryRun: boolean
  copyMode?: boolean
  targetPath?: string
}

export interface EngineVRenameResult {
  results: Array<{
    workshopId: string
    oldName: string
    newName: string
    status: "renamed" | "copied" | "planned" | "error"
    error?: string
  }>
  successCount: number
  failedCount: number
}

export interface EngineVExportInput {
  wallpapers: WallpaperDTO[]
  format: "json" | "paths"
  exportPath: string
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

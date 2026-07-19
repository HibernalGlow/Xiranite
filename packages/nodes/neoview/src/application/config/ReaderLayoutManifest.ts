export type ReaderPanelPosition = "left" | "right" | "bottom" | "floating"

export interface ReaderPanelManifestEntry {
  id: string
  title: string
  emoji: string
  defaultPosition: ReaderPanelPosition
  defaultVisible: boolean
  defaultOrder: number
  canMove: boolean
  canHide: boolean
  acceptsCards: boolean
}

export type ReaderSettingsSectionId =
  | "general"
  | "system"
  | "image"
  | "view"
  | "notifications"
  | "books"
  | "appearance"
  | "performance"
  | "layout"
  | "bindings"
  | "data"
  | "about"

export interface ReaderCardManifestEntry {
  id: string
  title: string
  defaultPanelId: string
  exclusivePanel: boolean
  defaultVisible: boolean
  defaultExpanded: boolean
  defaultOrder: number
  canHide: boolean
  requiresSession: boolean
  settingsSectionId?: ReaderSettingsSectionId
}

export const READER_PANEL_MANIFEST = [
  panel("folder", "文件夹", "📁", "left", true, 0, true, false),
  panel("history", "历史记录", "📚", "left", true, 1),
  panel("bookmark", "书签", "🔖", "left", true, 2),
  panel("pageList", "页面列表", "📄", "left", true, 3),
  panel("playlist", "播放列表", "📝", "left", false, 4),
  panel("settings", "设置", "⚙️", "left", true, 99),
  panel("info", "信息", "📋", "right", true, 0),
  panel("properties", "属性", "📑", "right", true, 1),
  panel("upscale", "超分", "✨", "right", true, 2),
  panel("insights", "洞察", "📊", "right", true, 3),
  panel("control", "控制", "🎛️", "right", true, 4),
  panel("ai", "AI", "🤖", "right", true, 5),
  panel("benchmark", "基准测试", "⏱️", "right", false, 10),
  panel("cardwindow", "卡片窗口", "🪟", "floating", false, 100, false, false, false),
] as const satisfies readonly ReaderPanelManifestEntry[]

export const READER_CARD_MANIFEST = [
  exclusiveCard("folder-main", "文件浏览", "folder", true, true, 0, false, false),
  exclusiveCard("history-list", "历史记录", "history", true, true, 0, false, false),
  exclusiveCard("bookmark-list", "书签列表", "bookmark", true, true, 0, true, false),
  exclusiveCard("page-navigation", "页面导航", "pageList", true, true, 0, false, true),
  card("book-information", "书籍信息", "info", true, true, 0, false, true),
  card("image-information", "图像信息", "info", true, true, 1, true, true),
  card("storage-information", "存储信息", "info", true, true, 2, true, true),
  card("time-information", "时间信息", "info", true, true, 3, true, true),
  card("slideshow-settings", "幻灯片", "settings", true, true, 0, true, false, "general"),
  card("media-settings", "影像", "settings", true, true, 1, true, false, "image"),
  card("view-defaults-settings", "视图默认值", "settings", true, true, 2, true, false, "view"),
  card("reader-material-settings", "界面材质", "settings", true, true, 3, true, false, "appearance"),
  card("board-layout-settings", "布局看板", "settings", true, true, 4, true, false, "layout"),
  card("input-bindings-settings", "操作绑定", "settings", true, true, 5, true, false, "bindings"),
  card("data-migration-settings", "数据迁移", "settings", true, true, 6, true, false, "data"),
  card("about-settings", "关于", "settings", true, true, 7, true, false, "about"),
  card("preload-status", "预加载状态", "info", true, true, 4, true, true),
  card("progressive-upscale", "递进超分", "upscale", true, true, 0, true, false),
  card("upscale-model", "模型选择", "upscale", true, true, 1, true, false),
  card("upscale-status", "处理状态", "upscale", true, true, 2, true, true),
  card("upscale-cache", "缓存管理", "upscale", true, true, 3, true, true),
  card("upscale-conditions", "条件超分", "upscale", true, true, 4, true, false),
  card("info-overlay", "信息悬浮窗", "info", true, true, 5, true, false),
  card("book-settings", "本书设置", "properties", true, true, 0, true, true),
  card("switch-toast", "切换提示", "control", true, true, 0, true, false),
  card("sidebar-control", "侧栏控制", "control", true, true, 1, true, false),
  card("color-filter", "颜色滤镜", "control", true, true, 2, true, false),
  card("page-transition", "翻页动画", "control", true, true, 3, true, false),
  card("thumbnail-maintenance", "缩略图维护", "control", false, true, 2, true, false),
  card("sidebar-height", "侧边栏高度", "control", true, true, 4, true, false),
  card("image-trim", "图像裁剪", "control", true, true, 5, true, false),
  card("animated-video-mode", "动图视频模式", "control", true, true, 6, true, false),
] as const satisfies readonly ReaderCardManifestEntry[]

export type ReaderPanelId = typeof READER_PANEL_MANIFEST[number]["id"]
export type ReaderCardId = typeof READER_CARD_MANIFEST[number]["id"]

export function readerPanelAcceptsCards(panelId: string): boolean {
  const panelEntry = READER_PANEL_MANIFEST.find((entry) => entry.id === panelId)
  return panelEntry?.acceptsCards ?? true
}

export function readerCardCanMoveTo(cardId: string, panelId: string): boolean {
  const cardEntry = READER_CARD_MANIFEST.find((entry) => entry.id === cardId)
  if (!cardEntry) return true
  const panelEntry = READER_PANEL_MANIFEST.find((entry) => entry.id === panelId)
  return panelEntry?.acceptsCards === true && (panelEntry.defaultPosition === "left" || panelEntry.defaultPosition === "right")
}

function panel<const Id extends string>(
  id: Id,
  title: string,
  emoji: string,
  defaultPosition: ReaderPanelPosition,
  defaultVisible: boolean,
  defaultOrder: number,
  canMove = true,
  canHide = true,
  acceptsCards = true,
): ReaderPanelManifestEntry & { id: Id } {
  return { id, title, emoji, defaultPosition, defaultVisible, defaultOrder, canMove, canHide, acceptsCards }
}

function card<const Id extends string, const PanelId extends string>(
  id: Id,
  title: string,
  defaultPanelId: PanelId,
  defaultVisible: boolean,
  defaultExpanded: boolean,
  defaultOrder: number,
  canHide: boolean,
  requiresSession: boolean,
  settingsSectionId?: ReaderSettingsSectionId,
): ReaderCardManifestEntry & { id: Id; defaultPanelId: PanelId } {
  return {
    id,
    title,
    defaultPanelId,
    exclusivePanel: false,
    defaultVisible,
    defaultExpanded,
    defaultOrder,
    canHide,
    requiresSession,
    ...(settingsSectionId ? { settingsSectionId } : {}),
  }
}

function exclusiveCard<const Id extends string, const PanelId extends string>(
  id: Id,
  title: string,
  defaultPanelId: PanelId,
  defaultVisible: boolean,
  defaultExpanded: boolean,
  defaultOrder: number,
  canHide: boolean,
  requiresSession: boolean,
): ReaderCardManifestEntry & { id: Id; defaultPanelId: PanelId } {
  return {
    ...card(id, title, defaultPanelId, defaultVisible, defaultExpanded, defaultOrder, canHide, requiresSession),
    exclusivePanel: true,
  }
}

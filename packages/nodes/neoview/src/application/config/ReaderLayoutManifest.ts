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

export interface ReaderCardManifestEntry {
  id: string
  title: string
  defaultPanelId: string
  defaultVisible: boolean
  defaultExpanded: boolean
  defaultOrder: number
  canHide: boolean
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
  card("page-navigation", "页面导航", "pageList", true, true, 0, false),
  card("book-information", "书籍信息", "info", true, true, 0, false),
  card("panel-layout-settings", "面板布局设置", "settings", false, true, 0, true),
  card("sidebar-management-settings", "边栏管理设置", "settings", false, true, 1, true),
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
): ReaderCardManifestEntry & { id: Id; defaultPanelId: PanelId } {
  return { id, title, defaultPanelId, defaultVisible, defaultExpanded, defaultOrder, canHide }
}

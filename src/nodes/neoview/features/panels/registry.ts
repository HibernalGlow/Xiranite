/**
 * @migrated-from src/lib/stores/sidebarConfig.svelte.ts
 * @source-hash sha256:1680afb71b6e283189094e52657164937d1b8fafb080183b361091af883ee20a
 * @migrated-from src/lib/cards/registry.ts
 * @source-hash sha256:ab8c2e45a48e4b9cfcea9ce68e2ce9ba0d63dbd0e4581e74d9a516ab92a3d3a3
 * @features panels-toolbar-shell,card-windows-tabs
 * @migration-status adapted
 */
import { lazy, type ComponentType, type LazyExoticComponent } from "react"

import type { ReaderHttpClient, ReaderSessionDto, ReaderShellConfigDto } from "../../adapters/reader-http-client"

export type ReaderPanelSide = "left" | "right"
export type LegacyPanelId = "folder" | "history" | "bookmark" | "pageList" | "playlist" | "info" | "properties" | "upscale" | "insights" | "settings" | "benchmark" | "ai" | "control" | "cardwindow"

export interface ReaderPanelContext {
  session: ReaderSessionDto
  client: ReaderHttpClient
  disabled: boolean
  onGoTo(pageIndex: number): void | Promise<void>
}

export interface ReaderPanelDefinition {
  id: LegacyPanelId
  title: string
  emoji: string
  defaultSide: ReaderPanelSide | "floating"
  defaultVisible: boolean
  defaultOrder: number
  canMove: boolean
  canHide: boolean
}

export interface ReaderCardDefinition {
  id: string
  title: string
  defaultPanel: LegacyPanelId
  canHide: boolean
  load(): Promise<{ default: ComponentType<ReaderPanelContext> }>
}

export interface LegacyPanelConfig {
  id: string
  visible?: boolean
  order?: number
  position?: ReaderPanelSide | "bottom" | "floating"
}

export interface ResolvedPanelConfig extends LegacyPanelConfig {
  definition?: ReaderPanelDefinition
  unknown: boolean
}

export const PANEL_DEFINITIONS: readonly ReaderPanelDefinition[] = [
  panel("folder", "文件夹", "📁", "left", true, 0, false),
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
  panel("cardwindow", "卡片窗口", "🪟", "floating", false, 100, false, false),
]

export const CARD_DEFINITIONS: readonly ReaderCardDefinition[] = [
  {
    id: "page-navigation",
    title: "页面导航",
    defaultPanel: "pageList",
    canHide: false,
    load: () => import("./cards/PageNavigationCard"),
  },
  {
    id: "book-information",
    title: "书籍信息",
    defaultPanel: "info",
    canHide: false,
    load: () => import("./cards/BookInformationCard"),
  },
]

const panelById = new Map(PANEL_DEFINITIONS.map((definition) => [definition.id, definition]))
const cardById = new Map(CARD_DEFINITIONS.map((definition) => [definition.id, definition]))
const lazyCards = new Map<string, LazyExoticComponent<ComponentType<ReaderPanelContext>>>()

export function availablePanels(side: ReaderPanelSide, shell?: ReaderShellConfigDto): ReaderPanelDefinition[] {
  const panelsWithCards = new Set(CARD_DEFINITIONS.map((card) => card.defaultPanel))
  return PANEL_DEFINITIONS
    .filter((definition) => {
      const config = shell?.panelLayout[definition.id]
      return (config?.position ?? definition.defaultSide) === side
        && (config?.visible ?? definition.defaultVisible)
        && panelsWithCards.has(definition.id)
    })
    .toSorted((left, right) => (shell?.panelLayout[left.id]?.order ?? left.defaultOrder) - (shell?.panelLayout[right.id]?.order ?? right.defaultOrder))
}

export function visiblePanelIds(side: ReaderPanelSide, shell?: ReaderShellConfigDto): readonly LegacyPanelId[] {
  return availablePanels(side, shell).map((panel) => panel.id)
}

export function cardsForPanel(panelId: LegacyPanelId, shell?: ReaderShellConfigDto): ReaderCardDefinition[] {
  return CARD_DEFINITIONS
    .filter((definition) => {
      const config = shell?.cardLayout[definition.id]
      return (config?.panelId ?? definition.defaultPanel) === panelId && (config?.visible ?? true)
    })
    .toSorted((left, right) => (shell?.cardLayout[left.id]?.order ?? 0) - (shell?.cardLayout[right.id]?.order ?? 0))
}

export function lazyReaderCard(cardId: string): LazyExoticComponent<ComponentType<ReaderPanelContext>> | undefined {
  const existing = lazyCards.get(cardId)
  if (existing) return existing
  const definition = cardById.get(cardId)
  if (!definition) return undefined
  const component = lazy(definition.load)
  lazyCards.set(cardId, component)
  return component
}

export function resolveLegacyPanels(configs: readonly LegacyPanelConfig[]): ResolvedPanelConfig[] {
  return configs.map((config) => {
    const definition = panelById.get(config.id as LegacyPanelId)
    return { ...config, definition, unknown: !definition }
  })
}

function panel(
  id: LegacyPanelId,
  title: string,
  emoji: string,
  defaultSide: ReaderPanelDefinition["defaultSide"],
  defaultVisible: boolean,
  defaultOrder: number,
  canHide = true,
  canMove = true,
): ReaderPanelDefinition {
  return { id, title, emoji, defaultSide, defaultVisible, defaultOrder, canHide, canMove }
}

/**
 * @migrated-from src/lib/stores/sidebarConfig.svelte.ts
 * @source-hash sha256:1680afb71b6e283189094e52657164937d1b8fafb080183b361091af883ee20a
 * @migrated-from src/lib/cards/registry.ts
 * @source-hash sha256:ab8c2e45a48e4b9cfcea9ce68e2ce9ba0d63dbd0e4581e74d9a516ab92a3d3a3
 * @features panels-toolbar-shell,card-windows-tabs
 * @migration-status adapted
 */
import {
  READER_CARD_MANIFEST,
  READER_PANEL_MANIFEST,
  type ReaderCardId,
  type ReaderPanelId,
} from "@xiranite/node-neoview/core"
import { lazy, type ComponentType, type LazyExoticComponent } from "react"

import type { ReaderBoardLayoutPatch, ReaderHttpClient, ReaderSessionDto, ReaderShellConfigDto } from "../../adapters/reader-http-client"

export type ReaderPanelSide = "left" | "right"
export type LegacyPanelId = ReaderPanelId

export interface ReaderPanelContext {
  session: ReaderSessionDto
  client: ReaderHttpClient
  disabled: boolean
  onGoTo(pageIndex: number): void | Promise<void>
  shell?: ReaderShellConfigDto
  onBoardLayout?(patch: ReaderBoardLayoutPatch): Promise<void>
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
  acceptsCards: boolean
}

export interface ReaderCardDefinition {
  id: string
  title: string
  defaultPanel: LegacyPanelId
  canHide: boolean
  defaultSidebarVisible?: boolean
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

export const PANEL_DEFINITIONS: readonly ReaderPanelDefinition[] = READER_PANEL_MANIFEST.map((definition) => ({
  id: definition.id,
  title: definition.title,
  emoji: definition.emoji,
  defaultSide: definition.defaultPosition,
  defaultVisible: definition.defaultVisible,
  defaultOrder: definition.defaultOrder,
  canMove: definition.canMove,
  canHide: definition.canHide,
  acceptsCards: definition.acceptsCards,
}))

const CARD_LOADERS: Record<ReaderCardId, ReaderCardDefinition["load"]> = {
  "page-navigation": () => import("./cards/PageNavigationCard"),
  "book-information": () => import("./cards/BookInformationCard"),
  "panel-layout-settings": () => import("../settings/cards/PanelLayoutSettingsCard"),
  "sidebar-management-settings": () => import("../settings/cards/SidebarManagementSettingsCard"),
}

export const CARD_DEFINITIONS: readonly ReaderCardDefinition[] = READER_CARD_MANIFEST.map((definition) => ({
  id: definition.id,
  title: definition.title,
  defaultPanel: definition.defaultPanelId as LegacyPanelId,
  canHide: definition.canHide,
  defaultSidebarVisible: definition.defaultVisible,
  load: CARD_LOADERS[definition.id],
}))

const panelById = new Map(PANEL_DEFINITIONS.map((definition) => [definition.id, definition]))
const cardById = new Map(CARD_DEFINITIONS.map((definition) => [definition.id, definition]))
const lazyCards = new Map<string, LazyExoticComponent<ComponentType<ReaderPanelContext>>>()

export function availablePanels(side: ReaderPanelSide, shell?: ReaderShellConfigDto): ReaderPanelDefinition[] {
  return PANEL_DEFINITIONS
    .filter((definition) => {
      const config = shell?.panelLayout[definition.id]
      return (config?.position ?? definition.defaultSide) === side
        && (config?.visible ?? definition.defaultVisible)
        && cardsForPanel(definition.id, shell).length > 0
    })
    .toSorted((left, right) => (shell?.panelLayout[left.id]?.order ?? left.defaultOrder) - (shell?.panelLayout[right.id]?.order ?? right.defaultOrder))
}

export function visiblePanelIds(side: ReaderPanelSide, shell?: ReaderShellConfigDto): readonly LegacyPanelId[] {
  return availablePanels(side, shell).map((panel) => panel.id)
}

export function cardsForPanel(panelId: LegacyPanelId, shell?: ReaderShellConfigDto): ReaderCardDefinition[] {
  return CARD_DEFINITIONS
    .filter((definition) => {
      const config = shell?.cardLayout?.[definition.id]
      return (config?.panelId ?? definition.defaultPanel) === panelId && (config?.visible ?? definition.defaultSidebarVisible ?? true)
    })
    .toSorted((left, right) => (shell?.cardLayout?.[left.id]?.order ?? 0) - (shell?.cardLayout?.[right.id]?.order ?? 0))
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

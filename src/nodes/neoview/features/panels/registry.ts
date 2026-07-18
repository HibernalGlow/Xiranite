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
  type FrameSnapshot,
  type ReaderCardId,
  type ReaderPanelId,
  type ReaderPresentation,
} from "@xiranite/node-neoview/ui-core"
import { lazy, type ComponentType, type LazyExoticComponent } from "react"
import { Loader, type LucideIcon } from "lucide-react"

import type {
  ReaderBoardLayoutPatch,
  ReaderBookmarkListPreferencesDto,
  ReaderBookSettingsUpdateDto,
  ReaderHistoryListPreferencesDto,
  ReaderHttpClient,
  ReaderPageListPreferencesDto,
  ReaderPreloadActionResultDto,
  ReaderRuntimeConfigDto,
  ReaderSessionDto,
  ReaderShellConfigDto,
  ReaderViewDefaultsPatch,
  ReaderFolderViewPatch,
} from "../../adapters/reader-http-client"
import type { ReaderShellControlPort } from "../shell/ReaderShellControlPort"

export type ReaderPanelSide = "left" | "right"
export type LegacyPanelId = ReaderPanelId

export interface ReaderPanelContext {
  session?: ReaderSessionDto
  client: ReaderHttpClient
  disabled: boolean
  panelActive?: boolean
  onGoTo(pageIndex: number): void | Promise<void>
  onBookSettingsUpdated?(sessionId: string, update: ReaderBookSettingsUpdateDto): void
  bookmarkListPreferences?: ReaderBookmarkListPreferencesDto
  onBookmarkListPreferences?(patch: Partial<ReaderBookmarkListPreferencesDto>): Promise<ReaderBookmarkListPreferencesDto>
  historyListPreferences?: ReaderHistoryListPreferencesDto
  onHistoryListPreferences?(patch: Partial<ReaderHistoryListPreferencesDto>): Promise<ReaderHistoryListPreferencesDto>
  pageListPreferences?: ReaderPageListPreferencesDto
  onPageListPreferences?(patch: Partial<ReaderPageListPreferencesDto>): Promise<void>
  onPageModeChange?(pageMode: "single" | "double"): void | Promise<void>
  onReadingDirectionChange?(direction: FrameSnapshot["direction"]): void | Promise<void>
  onPreloadAction?(action: "cancel-speculative" | "release-retained", signal?: AbortSignal): Promise<ReaderPreloadActionResultDto>
  sourcePath?: string
  onOpen?(path: string): void | Promise<void>
  pickDirectory?: () => Promise<string | undefined>
  systemActions?: {
    copyText?(text: string): Promise<void>
    copyFiles?(paths: string[]): Promise<void>
    revealPath?(path: string, signal?: AbortSignal): Promise<void>
  }
  shell?: ReaderShellConfigDto
  onBoardLayout?(patch: ReaderBoardLayoutPatch): Promise<void>
  viewDefaults?: ReaderRuntimeConfigDto["viewDefaults"]
  onViewDefaults?(patch: ReaderViewDefaultsPatch["viewDefaults"]): Promise<void>
  folderView?: ReaderRuntimeConfigDto["folderView"]
  onFolderView?(patch: ReaderFolderViewPatch["folderView"]): Promise<void>
  presentation?: ReaderPresentation
  shellControl?: ReaderShellControlPort
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
  requiresSession: boolean
  icon?: LucideIcon
  settingsSectionId?: "view" | "sidebar" | "cards" | "bindings"
  defaultSidebarVisible?: boolean
  load(): Promise<{ default: ComponentType<ReaderPanelContext> }>
  loadSettings?(): Promise<{ default: ComponentType<ReaderSettingsCardContext> }>
}

export interface ReaderSettingsCardContext {
  shell: ReaderShellConfigDto
  onSave(patch: ReaderBoardLayoutPatch): Promise<void>
  viewDefaults?: ReaderRuntimeConfigDto["viewDefaults"]
  onViewDefaults?(patch: ReaderViewDefaultsPatch["viewDefaults"]): Promise<void>
  inputBindings?: ReaderRuntimeConfigDto["inputBindings"]
  onInputBindings?(patch: { bindings?: ReaderRuntimeConfigDto["inputBindings"]["bindings"]; reset?: "defaults" }): Promise<ReaderRuntimeConfigDto["inputBindings"]>
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
  "folder-main": () => import("./cards/FolderMainCard"),
  "history-list": () => import("./cards/HistoryListCard"),
  "bookmark-list": () => import("./cards/BookmarkListCard"),
  "page-navigation": () => import("./cards/PageNavigationCard"),
  "book-information": () => import("./cards/BookInformationCard"),
  "image-information": () => import("./cards/ImageInformationCard"),
  "storage-information": () => import("./cards/StorageInformationCard"),
  "time-information": () => import("./cards/TimeInformationCard"),
  "preload-status": () => import("./cards/PreloadStatusCard"),
  "book-settings": () => import("./cards/BookSettingsCard"),
  "sidebar-control": () => import("./cards/SidebarControlCard"),
  "thumbnail-maintenance": () => import("./cards/ThumbnailMaintenanceCard"),
  "view-defaults-settings": () => import("../settings/cards/ViewDefaultsSettingsCard"),
  "panel-layout-settings": () => import("../settings/cards/PanelLayoutSettingsCard"),
  "sidebar-management-settings": () => import("../settings/cards/SidebarManagementSettingsCard"),
  "input-bindings-settings": () => import("../settings/cards/InputBindingsSettingsCard"),
}

const CARD_ICONS: Partial<Record<ReaderCardId, LucideIcon>> = {
  "preload-status": Loader,
}

const SETTINGS_CARD_LOADERS: Partial<Record<ReaderCardId, NonNullable<ReaderCardDefinition["loadSettings"]>>> = {
  "view-defaults-settings": async () => ({ default: (await import("../settings/cards/ViewDefaultsSettingsCard")).SettingsViewDefaultsCard }),
  "panel-layout-settings": async () => ({ default: (await import("../settings/cards/PanelLayoutSettingsCard")).PanelLayoutSettingsCard }),
  "sidebar-management-settings": async () => ({ default: (await import("../settings/cards/SidebarManagementSettingsCard")).SidebarManagementSettingsCard }),
  "input-bindings-settings": async () => ({ default: (await import("../settings/cards/InputBindingsSettingsCard")).InputBindingsSettingsCard }),
}

export const CARD_DEFINITIONS: readonly ReaderCardDefinition[] = READER_CARD_MANIFEST.map((definition) => ({
  id: definition.id,
  title: definition.title,
  defaultPanel: definition.defaultPanelId as LegacyPanelId,
  canHide: definition.canHide,
  requiresSession: definition.requiresSession,
  ...(CARD_ICONS[definition.id] ? { icon: CARD_ICONS[definition.id] } : {}),
  defaultSidebarVisible: definition.defaultVisible,
  load: CARD_LOADERS[definition.id],
  ...(definition.settingsSectionId ? { settingsSectionId: definition.settingsSectionId } : {}),
  ...(SETTINGS_CARD_LOADERS[definition.id] ? { loadSettings: SETTINGS_CARD_LOADERS[definition.id] } : {}),
}))

const panelById = new Map(PANEL_DEFINITIONS.map((definition) => [definition.id, definition]))
const cardById = new Map(CARD_DEFINITIONS.map((definition) => [definition.id, definition]))
const lazyCards = new Map<string, LazyExoticComponent<ComponentType<ReaderPanelContext>>>()
const lazySettingsCards = new Map<string, LazyExoticComponent<ComponentType<ReaderSettingsCardContext>>>()

export function availablePanels(side: ReaderPanelSide, shell?: ReaderShellConfigDto, hasSession = true): ReaderPanelDefinition[] {
  return PANEL_DEFINITIONS
    .filter((definition) => {
      const config = shell?.panelLayout[definition.id]
      return (config?.position ?? definition.defaultSide) === side
        && (config?.visible ?? definition.defaultVisible)
        && cardsForPanel(definition.id, shell, hasSession).length > 0
    })
    .toSorted((left, right) => (shell?.panelLayout[left.id]?.order ?? left.defaultOrder) - (shell?.panelLayout[right.id]?.order ?? right.defaultOrder))
}

export function visiblePanelIds(side: ReaderPanelSide, shell?: ReaderShellConfigDto, hasSession = true): readonly LegacyPanelId[] {
  return availablePanels(side, shell, hasSession).map((panel) => panel.id)
}

export function cardsForPanel(panelId: LegacyPanelId, shell?: ReaderShellConfigDto, hasSession = true): ReaderCardDefinition[] {
  return CARD_DEFINITIONS
    .filter((definition) => {
      const config = shell?.cardLayout?.[definition.id]
      return (!definition.requiresSession || hasSession)
        && (config?.panelId ?? definition.defaultPanel) === panelId
        && (config?.visible ?? definition.defaultSidebarVisible ?? true)
    })
    .toSorted((left, right) => (shell?.cardLayout?.[left.id]?.order ?? 0) - (shell?.cardLayout?.[right.id]?.order ?? 0))
}

export function settingsCardsForSection(sectionId: string): ReaderCardDefinition[] {
  return CARD_DEFINITIONS.filter((definition) => definition.settingsSectionId === sectionId && definition.loadSettings)
}

export function lazyReaderSettingsCard(cardId: string): LazyExoticComponent<ComponentType<ReaderSettingsCardContext>> | undefined {
  const existing = lazySettingsCards.get(cardId)
  if (existing) return existing
  const definition = cardById.get(cardId)
  if (!definition?.loadSettings) return undefined
  const component = lazy(definition.loadSettings)
  lazySettingsCards.set(cardId, component)
  return component
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

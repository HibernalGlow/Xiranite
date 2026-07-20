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
import { Activity, Bell, BookMarked, BookOpen, BookOpenCheck, Clock3, Cpu, Crop, DatabaseBackup, Eye, Film, FolderOpen, Gauge, HardDrive, Image, Info, Keyboard, LayoutDashboard, ListFilter, ListTree, Loader, Monitor, Palette, PanelLeft, Play, Sparkles, SlidersHorizontal, Tags, Trash2, Video, type LucideIcon } from "lucide-react"

import type {
  ReaderBoardLayoutPatch,
  ReaderBookmarkListPreferencesDto,
  ReaderBookSettingsUpdateDto,
  ReaderHistoryListPreferencesDto,
  ReaderRadialMenuPatch,
  ReaderHttpClient,
  ReaderPageListPreferencesDto,
  ReaderPreloadActionResultDto,
  ReaderRuntimeConfigDto,
  ReaderSuperResolutionConfigDto,
  ReaderSuperResolutionPatchDto,
  ReaderSuperResolutionPreferencesDto,
  ReaderMediaConfigDto,
  ReaderMediaPatchDto,
  ReaderSettingsMigrationImportResult,
  ReaderSettingsMigrationInspection,
  ReaderSessionDto,
  ReaderShellConfigDto,
  ReaderShellMaterialPatch,
  ReaderSidebarLayoutPatch,
  ReaderSlideshowConfig,
  ReaderSlideshowPatch,
  ReaderViewDefaultsPatch,
  ReaderFolderViewPatch,
} from "../../adapters/reader-http-client"
import type { ReaderShellControlPort } from "../shell/ReaderShellControlPort"
import type { ReaderColorFilterPort } from "../color-filter/ReaderColorFilterStore"
import type { ReaderPageTransitionPort } from "../page-transition/ReaderPageTransitionStore"
import type { ReaderSwitchToastPort } from "../switch-toast/ReaderSwitchToastStore"
import type { InfoOverlayPort } from "./cards/InfoOverlayCard"
import type { ReaderImageTrimPort } from "../image-trim/ReaderImageTrimStore"

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
  onSidebarLayout?(patch: ReaderSidebarLayoutPatch): Promise<void>
  onBoardLayout?(patch: ReaderBoardLayoutPatch): Promise<void>
  viewDefaults?: ReaderRuntimeConfigDto["viewDefaults"]
  onViewDefaults?(patch: ReaderViewDefaultsPatch["viewDefaults"]): Promise<void>
  folderView?: ReaderRuntimeConfigDto["folderView"]
  onFolderView?(patch: ReaderFolderViewPatch["folderView"]): Promise<void>
  presentation?: ReaderPresentation
  shellControl?: ReaderShellControlPort
  colorFilter?: ReaderColorFilterPort
  pageTransition?: ReaderPageTransitionPort
  switchToast?: ReaderSwitchToastPort
  infoOverlay?: InfoOverlayPort
  imageTrim?: ReaderImageTrimPort
  media?: ReaderMediaConfigDto
  onMediaChange?(patch: ReaderMediaPatchDto["media"]): Promise<ReaderMediaConfigDto>
  slideshow?: ReaderSlideshowConfig
  onSlideshow?(patch: ReaderSlideshowPatch["slideshow"]): Promise<void>
  inputBindings?: ReaderRuntimeConfigDto["inputBindings"]
  onInputBindings?(patch: { bindings?: ReaderRuntimeConfigDto["inputBindings"]["bindings"]; reset?: "defaults" }): Promise<ReaderRuntimeConfigDto["inputBindings"]>
  radialMenu?: ReaderRuntimeConfigDto["radialMenu"]
  onRadialMenu?(patch: ReaderRadialMenuPatch["radialMenu"]): Promise<ReaderRuntimeConfigDto["radialMenu"]>
  onMaterial?(patch: ReaderShellMaterialPatch): Promise<ReaderShellConfigDto>
  onLegacySettingsInspect?(content: string, modules?: readonly string[]): Promise<ReaderSettingsMigrationInspection>
  onLegacySettingsImport?(content: string, strategy?: "merge" | "overwrite", modules?: readonly string[]): Promise<ReaderSettingsMigrationImportResult>
  superResolution?: ReaderSuperResolutionConfigDto
  onSuperResolutionChange?(patch: ReaderSuperResolutionPreferencesDto): Promise<ReaderSuperResolutionConfigDto>
  onSuperResolutionConfigChange?(patch: ReaderSuperResolutionPatchDto["superResolution"]): Promise<ReaderSuperResolutionConfigDto>
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
  exclusivePanel: boolean
  canHide: boolean
  requiresSession: boolean
  icon?: LucideIcon
  settingsSectionId?: ReaderCardDefinitionSettingsSectionId
  defaultSidebarVisible?: boolean
  load(): Promise<{ default: ComponentType<ReaderPanelContext> }>
  loadSettings?(): Promise<{ default: ComponentType<ReaderSettingsCardContext> }>
}

export type ReaderCardDefinitionSettingsSectionId =
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

export interface ReaderSettingsCardContext {
  shell: ReaderShellConfigDto
  onSave(patch: ReaderBoardLayoutPatch): Promise<void>
  viewDefaults?: ReaderRuntimeConfigDto["viewDefaults"]
  onViewDefaults?(patch: ReaderViewDefaultsPatch["viewDefaults"]): Promise<void>
  slideshow?: ReaderSlideshowConfig
  onSlideshow?(patch: ReaderSlideshowPatch["slideshow"]): Promise<void>
  media?: ReaderMediaConfigDto
  onMedia?(patch: ReaderMediaPatchDto["media"]): Promise<ReaderMediaConfigDto>
  inputBindings?: ReaderRuntimeConfigDto["inputBindings"]
  onInputBindings?(patch: { bindings?: ReaderRuntimeConfigDto["inputBindings"]["bindings"]; reset?: "defaults" }): Promise<ReaderRuntimeConfigDto["inputBindings"]>
  radialMenu?: ReaderRuntimeConfigDto["radialMenu"]
  onRadialMenu?(patch: ReaderRadialMenuPatch["radialMenu"]): Promise<ReaderRuntimeConfigDto["radialMenu"]>
  onMaterial?(patch: ReaderShellMaterialPatch): Promise<ReaderShellConfigDto>
  onLegacySettingsInspect?(content: string, modules?: readonly string[]): Promise<ReaderSettingsMigrationInspection>
  onLegacySettingsImport?(content: string, strategy?: "merge" | "overwrite", modules?: readonly string[]): Promise<ReaderSettingsMigrationImportResult>
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
  "progressive-upscale": () => import("./cards/ProgressiveUpscaleCard"),
  "upscale-model": () => import("./cards/UpscaleModelCard"),
  "upscale-status": () => import("./cards/UpscaleStatusCard"),
  "upscale-cache": () => import("./cards/UpscaleCacheCard"),
  "upscale-conditions": () => import("./cards/UpscaleConditionsCard"),
  "emm-tags": () => import("./cards/EmmTagsCard"),
  "book-settings": () => import("./cards/BookSettingsCard"),
  "thumbnail-architecture-metrics": () => import("./cards/ThumbnailArchitectureMetricsCard"),
  "sidebar-control": () => import("./cards/SidebarControlCard"),
  "sidebar-height": () => import("./cards/SidebarHeightCard"),
  "color-filter": () => import("./cards/ColorFilterCard"),
  "page-transition": () => import("./cards/PageTransitionCard"),
  "switch-toast": () => import("./cards/SwitchToastCard"),
  "info-overlay": () => import("./cards/InfoOverlayCard"),
  "image-trim": () => import("./cards/ImageTrimCard"),
  "animated-video-mode": () => import("./cards/AnimatedVideoModeCard"),
  "thumbnail-maintenance": () => import("./cards/ThumbnailMaintenanceCard"),
  "system-monitor": () => import("./cards/SystemMonitorCard"),
  "slideshow-settings": () => import("../settings/cards/SlideshowSettingsCard"),
  "media-settings": () => import("../settings/cards/MediaSettingsCard"),
  "view-defaults-settings": () => import("../settings/cards/ViewDefaultsSettingsCard"),
  "reader-material-settings": () => import("../settings/cards/ReaderMaterialSettingsCard"),
  "board-layout-settings": () => import("../settings/cards/BoardLayoutSettingsCard"),
  "input-bindings-settings": () => import("../settings/cards/InputBindingsSettingsCard"),
  "data-migration-settings": () => import("../settings/cards/DataMigrationSettingsCard"),
  "about-settings": () => import("../settings/cards/AboutSettingsCard"),
}

const CARD_ICONS = {
  "folder-main": FolderOpen,
  "history-list": Clock3,
  "bookmark-list": BookMarked,
  "page-navigation": ListTree,
  "book-information": BookOpen,
  "image-information": Image,
  "storage-information": HardDrive,
  "time-information": Clock3,
  "slideshow-settings": Play,
  "media-settings": Film,
  "view-defaults-settings": Eye,
  "reader-material-settings": Palette,
  "board-layout-settings": LayoutDashboard,
  "input-bindings-settings": Keyboard,
  "data-migration-settings": DatabaseBackup,
  "about-settings": Info,
  "preload-status": Loader,
  "progressive-upscale": Sparkles,
  "upscale-model": Cpu,
  "upscale-status": Activity,
  "upscale-cache": HardDrive,
  "upscale-conditions": ListFilter,
  "info-overlay": Info,
  "emm-tags": Tags,
  "book-settings": BookOpenCheck,
  "thumbnail-architecture-metrics": Gauge,
  "switch-toast": Bell,
  "sidebar-control": PanelLeft,
  "color-filter": Palette,
  "page-transition": Play,
  "thumbnail-maintenance": Trash2,
  "sidebar-height": SlidersHorizontal,
  "image-trim": Crop,
  "animated-video-mode": Video,
  "system-monitor": Monitor,
} satisfies Record<ReaderCardId, LucideIcon>

const SETTINGS_CARD_LOADERS: Partial<Record<ReaderCardId, NonNullable<ReaderCardDefinition["loadSettings"]>>> = {
  "slideshow-settings": async () => ({ default: (await import("../settings/cards/SlideshowSettingsCard")).SettingsSlideshowCard }),
  "media-settings": async () => ({ default: (await import("../settings/cards/MediaSettingsCard")).SettingsMediaCard }),
  "view-defaults-settings": async () => ({ default: (await import("../settings/cards/ViewDefaultsSettingsCard")).SettingsViewDefaultsCard }),
  "reader-material-settings": async () => ({ default: (await import("../settings/cards/ReaderMaterialSettingsCard")).SettingsReaderMaterialCard }),
  "board-layout-settings": async () => ({ default: (await import("../settings/cards/BoardLayoutSettingsCard")).SettingsBoardLayoutCard }),
  "input-bindings-settings": async () => ({ default: (await import("../settings/cards/InputBindingsSettingsCard")).InputBindingsSettingsCard }),
  "data-migration-settings": async () => ({ default: (await import("../settings/cards/DataMigrationSettingsCard")).SettingsDataMigrationCard }),
  "about-settings": async () => ({ default: (await import("../settings/cards/AboutSettingsCard")).SettingsAboutCard }),
}

export const CARD_DEFINITIONS: readonly ReaderCardDefinition[] = READER_CARD_MANIFEST.map((definition) => ({
  id: definition.id,
  title: definition.title,
  defaultPanel: definition.defaultPanelId as LegacyPanelId,
  exclusivePanel: definition.exclusivePanel,
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

export function availablePanels(side: ReaderPanelSide, shell?: ReaderShellConfigDto, _hasSession = true): ReaderPanelDefinition[] {
  return PANEL_DEFINITIONS
    .filter((definition) => {
      const config = shell?.panelLayout[definition.id]
      return (config?.position ?? definition.defaultSide) === side
        && (config?.visible ?? definition.defaultVisible)
        && cardsForPanel(definition.id, shell).length > 0
    })
    .toSorted((left, right) => (shell?.panelLayout[left.id]?.order ?? left.defaultOrder) - (shell?.panelLayout[right.id]?.order ?? right.defaultOrder))
}

export function visiblePanelIds(side: ReaderPanelSide, shell?: ReaderShellConfigDto, hasSession = true): readonly LegacyPanelId[] {
  return availablePanels(side, shell, hasSession).map((panel) => panel.id)
}

export function cardsForPanel(panelId: LegacyPanelId, shell?: ReaderShellConfigDto, _hasSession = true): ReaderCardDefinition[] {
  return CARD_DEFINITIONS
    .filter((definition) => {
      const config = shell?.cardLayout?.[definition.id]
      return (config?.panelId ?? definition.defaultPanel) === panelId
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

import { Bell, BookOpen, Database, Gauge, Image, Info, Keyboard, LayoutGrid, Monitor, PanelLeft, Palette, Settings2, SlidersHorizontal } from "lucide-react"
import { Suspense, useState, type ComponentType } from "react"

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type {
  ReaderBoardLayoutPatch,
  ReaderInputBindingsPatch,
  ReaderMediaConfigDto,
  ReaderMediaPatchDto,
  ReaderRadialMenuPatch,
  ReaderRuntimeConfigDto,
  ReaderSettingsMigrationImportResult,
  ReaderSettingsMigrationInspection,
  ReaderShellConfigDto,
  ReaderShellMaterialPatch,
  ReaderSlideshowConfig,
  ReaderSlideshowPatch,
  ReaderViewDefaultsPatch,
} from "../../adapters/reader-http-client"
import { lazyReaderSettingsCard, settingsCardsForSection } from "../panels/registry"
import { SettingsUnavailableNote } from "./SettingsCardShell"

export function ReaderSettingsWindow({
  shell,
  viewDefaults,
  slideshow,
  media,
  onClose,
  onBoardLayout,
  onViewDefaults,
  onSlideshow,
  onMedia,
  inputBindings,
  onInputBindings,
  radialMenu,
  onRadialMenu,
  onLegacySettingsInspect,
  onLegacySettingsImport,
  onMaterial,
}: {
  shell: ReaderShellConfigDto
  viewDefaults: ReaderRuntimeConfigDto["viewDefaults"]
  slideshow?: ReaderSlideshowConfig
  media?: ReaderMediaConfigDto
  onClose(): void
  onBoardLayout(patch: ReaderBoardLayoutPatch): Promise<void>
  onViewDefaults(patch: ReaderViewDefaultsPatch["viewDefaults"]): Promise<void>
  onSlideshow?(patch: ReaderSlideshowPatch["slideshow"]): Promise<void>
  onMedia?(patch: ReaderMediaPatchDto["media"]): Promise<ReaderMediaConfigDto>
  inputBindings: ReaderRuntimeConfigDto["inputBindings"]
  onInputBindings(patch: ReaderInputBindingsPatch["inputBindings"]): Promise<ReaderRuntimeConfigDto["inputBindings"]>
  radialMenu: ReaderRuntimeConfigDto["radialMenu"]
  onRadialMenu(patch: ReaderRadialMenuPatch["radialMenu"]): Promise<ReaderRuntimeConfigDto["radialMenu"]>
  onLegacySettingsInspect?(content: string, modules?: readonly string[]): Promise<ReaderSettingsMigrationInspection>
  onLegacySettingsImport?(content: string, strategy?: "merge" | "overwrite", modules?: readonly string[]): Promise<ReaderSettingsMigrationImportResult>
  onMaterial(patch: ReaderShellMaterialPatch): Promise<ReaderShellConfigDto>
}) {
  const [active, setActive] = useState<SettingsSectionId>("sidebar")
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent
        className="z-[91] gap-0 overflow-hidden p-0 sm:max-w-none"
        overlayClassName="z-[90]"
        style={{ width: "min(64rem, calc(100vw - 2rem))", maxWidth: "none", height: "min(70rem, calc(100vh - 2rem))", maxHeight: "calc(100vh - 2rem)" }}
      >
        <DialogHeader className="shrink-0 space-y-0 border-b px-4 py-3 text-left">
          <DialogTitle className="flex items-center gap-2"><Settings2 className="size-4" />设置</DialogTitle>
          <DialogDescription className="sr-only">NeoView 节点设置</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] sm:grid-cols-[10rem_minmax(0,1fr)] sm:grid-rows-1" style={{ height: "calc(100% - 3.25rem)" }}>
          <nav className="flex min-w-0 overflow-x-auto border-b bg-muted/15 p-2 sm:block sm:min-h-0 sm:overflow-y-auto sm:border-b-0 sm:border-r" aria-label="NeoView 设置分类">
            {SETTINGS_SECTIONS.map((section) => {
              const Icon = section.icon
              return (
                <button
                  key={section.id}
                  type="button"
                  className={`flex shrink-0 items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs sm:w-full ${active === section.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                  onClick={() => setActive(section.id)}
                >
                  <Icon className="size-3.5" />{section.label}
                </button>
              )
            })}
          </nav>
          <div className="min-h-0 overflow-y-auto p-4">
            <div className="grid gap-4">
              <SettingsSection
                sectionId={active}
                shell={shell}
                viewDefaults={viewDefaults}
                slideshow={slideshow}
                media={media}
                inputBindings={inputBindings}
                radialMenu={radialMenu}
                onSave={onBoardLayout}
                onViewDefaults={onViewDefaults}
                onSlideshow={onSlideshow}
                onMedia={onMedia}
                onInputBindings={onInputBindings}
                onRadialMenu={onRadialMenu}
                onLegacySettingsInspect={onLegacySettingsInspect}
                onLegacySettingsImport={onLegacySettingsImport}
                onMaterial={onMaterial}
              />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SettingsSection({
  sectionId,
  shell,
  viewDefaults,
  slideshow,
  media,
  onSave,
  onViewDefaults,
  onSlideshow,
  onMedia,
  inputBindings,
  onInputBindings,
  radialMenu,
  onRadialMenu,
  onLegacySettingsInspect,
  onLegacySettingsImport,
  onMaterial,
}: {
  sectionId: SettingsSectionId
  shell: ReaderShellConfigDto
  viewDefaults: ReaderRuntimeConfigDto["viewDefaults"]
  slideshow?: ReaderSlideshowConfig
  media?: ReaderMediaConfigDto
  onSave(patch: ReaderBoardLayoutPatch): Promise<void>
  onViewDefaults(patch: ReaderViewDefaultsPatch["viewDefaults"]): Promise<void>
  onSlideshow?(patch: ReaderSlideshowPatch["slideshow"]): Promise<void>
  onMedia?(patch: ReaderMediaPatchDto["media"]): Promise<ReaderMediaConfigDto>
  inputBindings: ReaderRuntimeConfigDto["inputBindings"]
  onInputBindings(patch: ReaderInputBindingsPatch["inputBindings"]): Promise<ReaderRuntimeConfigDto["inputBindings"]>
  radialMenu: ReaderRuntimeConfigDto["radialMenu"]
  onRadialMenu(patch: ReaderRadialMenuPatch["radialMenu"]): Promise<ReaderRuntimeConfigDto["radialMenu"]>
  onLegacySettingsInspect?(content: string, modules?: readonly string[]): Promise<ReaderSettingsMigrationInspection>
  onLegacySettingsImport?(content: string, strategy?: "merge" | "overwrite", modules?: readonly string[]): Promise<ReaderSettingsMigrationImportResult>
  onMaterial(patch: ReaderShellMaterialPatch): Promise<ReaderShellConfigDto>
}) {
  const definitions = settingsCardsForSection(sectionId)
  if (!definitions.length) {
    const unavailable = UNAVAILABLE_SECTIONS[sectionId]
    if (unavailable) return <SettingsUnavailableNote title={unavailable.title} reason={unavailable.reason} />
    return <SettingsUnavailableNote title={SETTINGS_SECTIONS.find((section) => section.id === sectionId)?.label ?? "设置"} reason="该分类尚未接入 XR 配置面。" />
  }
  return definitions.map((definition) => {
    const Card = lazyReaderSettingsCard(definition.id)
    return Card ? (
      <Suspense key={definition.id} fallback={<div className="h-24 animate-pulse rounded-md bg-muted/35" aria-label={`正在加载${definition.title}`} />}>
        <Card
          shell={shell}
          viewDefaults={viewDefaults}
          slideshow={slideshow}
          media={media}
          inputBindings={inputBindings}
          radialMenu={radialMenu}
          onSave={onSave}
          onViewDefaults={onViewDefaults}
          onSlideshow={onSlideshow}
          onMedia={onMedia}
          onInputBindings={onInputBindings}
          onRadialMenu={onRadialMenu}
          onLegacySettingsInspect={onLegacySettingsInspect}
          onLegacySettingsImport={onLegacySettingsImport}
          onMaterial={onMaterial}
        />
      </Suspense>
    ) : null
  })
}

type SettingsSectionId = "general" | "system" | "image" | "view" | "notifications" | "books" | "appearance" | "performance" | "sidebar" | "cards" | "bindings" | "data" | "about"

const SETTINGS_SECTIONS: Array<{ id: SettingsSectionId; label: string; icon: ComponentType<{ className?: string }> }> = [
  { id: "general", label: "通用", icon: Settings2 },
  { id: "system", label: "系统", icon: Monitor },
  { id: "image", label: "影像", icon: Image },
  { id: "view", label: "视图", icon: SlidersHorizontal },
  { id: "notifications", label: "通知", icon: Bell },
  { id: "books", label: "书籍", icon: BookOpen },
  { id: "appearance", label: "外观", icon: Palette },
  { id: "performance", label: "性能", icon: Gauge },
  { id: "sidebar", label: "边栏管理", icon: PanelLeft },
  { id: "cards", label: "卡片管理", icon: LayoutGrid },
  { id: "bindings", label: "操作绑定", icon: Keyboard },
  { id: "data", label: "数据", icon: Database },
  { id: "about", label: "关于", icon: Info },
]

const UNAVAILABLE_SECTIONS: Partial<Record<SettingsSectionId, { title: string; reason: string }>> = {
  system: {
    title: "系统",
    reason: "排除路径等系统项由文件树配置与 CLI 管理；完整设置卡待 fileTree DTO/PATCH 暴露后接入。",
  },
  notifications: {
    title: "通知",
    reason: "切换提示已在右侧栏「切换提示」卡片中配置，设置窗口不再重复提供全局通知页。",
  },
  books: {
    title: "书籍",
    reason: "本书方向/单双页等设置在右侧栏「本书设置」中按会话编辑；全局书籍默认值尚未单独成卡。",
  },
  performance: {
    title: "性能",
    reason: "呈现缓存与预加载阈值目前由节点配置/诊断链路管理，设置窗口可编辑面尚未开放。",
  },
}

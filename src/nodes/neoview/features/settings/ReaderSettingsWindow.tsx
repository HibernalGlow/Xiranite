import { Bell, BookOpen, Database, Gauge, Image, Info, Keyboard, LayoutGrid, Monitor, Palette, Settings2, SlidersHorizontal } from "lucide-react"
import { Suspense, useState, type ComponentType, type ReactNode } from "react"

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import type {
  ReaderBoardLayoutPatch,
  ReaderInputBindingsPatch,
  ReaderMediaConfigDto,
  ReaderMediaPatchDto,
  ReaderImageProcessingConfigDto,
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
import type { ReaderWorkspacePatch } from "../workspace/ReaderWorkspaceLayout"
import { SettingsUnavailableNote } from "./SettingsCardShell"

export function ReaderSettingsWindow({
  shell,
  viewDefaults,
  slideshow,
  media,
  imageProcessing,
  onClose,
  onBoardLayout,
  onViewDefaults,
  onSlideshow,
  onMedia,
  onImageProcessing,
  inputBindings,
  onInputBindings,
  radialMenu,
  onRadialMenu,
  onLegacySettingsInspect,
  onLegacySettingsImport,
  onMaterial,
  onWorkspace,
}: {
  shell: ReaderShellConfigDto
  viewDefaults: ReaderRuntimeConfigDto["viewDefaults"]
  slideshow?: ReaderSlideshowConfig
  media?: ReaderMediaConfigDto
  imageProcessing?: ReaderImageProcessingConfigDto
  onClose(): void
  onBoardLayout(patch: ReaderBoardLayoutPatch): Promise<void>
  onViewDefaults(patch: ReaderViewDefaultsPatch["viewDefaults"]): Promise<void>
  onSlideshow?(patch: ReaderSlideshowPatch["slideshow"]): Promise<void>
  onMedia?(patch: ReaderMediaPatchDto["media"]): Promise<ReaderMediaConfigDto>
  onImageProcessing?(patch: Partial<ReaderImageProcessingConfigDto>): Promise<ReaderImageProcessingConfigDto>
  inputBindings: ReaderRuntimeConfigDto["inputBindings"]
  onInputBindings(patch: ReaderInputBindingsPatch["inputBindings"]): Promise<ReaderRuntimeConfigDto["inputBindings"]>
  radialMenu: ReaderRuntimeConfigDto["radialMenu"]
  onRadialMenu(patch: ReaderRadialMenuPatch["radialMenu"]): Promise<ReaderRuntimeConfigDto["radialMenu"]>
  onLegacySettingsInspect?(content: string, modules?: readonly string[]): Promise<ReaderSettingsMigrationInspection>
  onLegacySettingsImport?(content: string, strategy?: "merge" | "overwrite", modules?: readonly string[]): Promise<ReaderSettingsMigrationImportResult>
  onMaterial(patch: ReaderShellMaterialPatch): Promise<ReaderShellConfigDto>
  onWorkspace?(patch: ReaderWorkspacePatch): void
}) {
  const [active, setActive] = useState<SettingsSectionId>("layout")
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent
        bare
        aria-describedby={undefined}
        className="z-[91] !flex !gap-0 !p-0 h-[min(70rem,calc(100vh-2rem))] max-h-[calc(100vh-2rem)] w-[min(64rem,calc(100vw-2rem))] max-w-none flex-col overflow-hidden"
        overlayClassName="z-[90]"
        style={{ display: "flex", flexDirection: "column", gap: 0, padding: 0 }}
      >
        <div className="shrink-0 border-b px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-base leading-none font-semibold">
            <Settings2 className="size-4" />
            设置
          </DialogTitle>
        </div>
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <nav
            className="flex shrink-0 overflow-x-auto border-b bg-muted/15 p-2 sm:w-40 sm:flex-col sm:overflow-y-auto sm:border-b-0 sm:border-r"
            aria-label="NeoView 设置分类"
          >
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
          <div key={active} className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 [&>*]:mt-0">
            <SettingsSection
              sectionId={active}
              shell={shell}
              viewDefaults={viewDefaults}
              slideshow={slideshow}
              media={media}
              imageProcessing={imageProcessing}
              inputBindings={inputBindings}
              radialMenu={radialMenu}
              onSave={onBoardLayout}
              onViewDefaults={onViewDefaults}
              onSlideshow={onSlideshow}
              onMedia={onMedia}
              onImageProcessing={onImageProcessing}
              onInputBindings={onInputBindings}
              onRadialMenu={onRadialMenu}
              onLegacySettingsInspect={onLegacySettingsInspect}
              onLegacySettingsImport={onLegacySettingsImport}
              onMaterial={onMaterial}
              onWorkspace={onWorkspace}
            />
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
  imageProcessing,
  onSave,
  onViewDefaults,
  onSlideshow,
  onMedia,
  onImageProcessing,
  inputBindings,
  onInputBindings,
  radialMenu,
  onRadialMenu,
  onLegacySettingsInspect,
  onLegacySettingsImport,
  onMaterial,
  onWorkspace,
}: {
  sectionId: SettingsSectionId
  shell: ReaderShellConfigDto
  viewDefaults: ReaderRuntimeConfigDto["viewDefaults"]
  slideshow?: ReaderSlideshowConfig
  media?: ReaderMediaConfigDto
  imageProcessing?: ReaderImageProcessingConfigDto
  onSave(patch: ReaderBoardLayoutPatch): Promise<void>
  onViewDefaults(patch: ReaderViewDefaultsPatch["viewDefaults"]): Promise<void>
  onSlideshow?(patch: ReaderSlideshowPatch["slideshow"]): Promise<void>
  onMedia?(patch: ReaderMediaPatchDto["media"]): Promise<ReaderMediaConfigDto>
  onImageProcessing?(patch: Partial<ReaderImageProcessingConfigDto>): Promise<ReaderImageProcessingConfigDto>
  inputBindings: ReaderRuntimeConfigDto["inputBindings"]
  onInputBindings(patch: ReaderInputBindingsPatch["inputBindings"]): Promise<ReaderRuntimeConfigDto["inputBindings"]>
  radialMenu: ReaderRuntimeConfigDto["radialMenu"]
  onRadialMenu(patch: ReaderRadialMenuPatch["radialMenu"]): Promise<ReaderRuntimeConfigDto["radialMenu"]>
  onLegacySettingsInspect?(content: string, modules?: readonly string[]): Promise<ReaderSettingsMigrationInspection>
  onLegacySettingsImport?(content: string, strategy?: "merge" | "overwrite", modules?: readonly string[]): Promise<ReaderSettingsMigrationImportResult>
  onMaterial(patch: ReaderShellMaterialPatch): Promise<ReaderShellConfigDto>
  onWorkspace?(patch: ReaderWorkspacePatch): void
}) {
  const definitions = settingsCardsForSection(sectionId)
  if (!definitions.length) {
    const unavailable = UNAVAILABLE_SECTIONS[sectionId]
    if (unavailable) return <SettingsUnavailableNote title={unavailable.title} reason={unavailable.reason} />
    return <SettingsUnavailableNote title={SETTINGS_SECTIONS.find((section) => section.id === sectionId)?.label ?? "设置"} reason="该分类尚未接入 XR 配置面。" />
  }

  const cards: ReactNode[] = []
  for (const definition of definitions) {
    const Card = lazyReaderSettingsCard(definition.id)
    if (!Card) continue
    // Skip cards that would render null for missing runtime props — empty Suspense
    // fallbacks previously left a blank band above the real content.
    if (definition.id === "slideshow-settings" && (!slideshow || !onSlideshow)) continue
    if (definition.id === "media-settings" && (!media || !onMedia)) continue
    if (definition.id === "view-defaults-settings" && (!viewDefaults || !onViewDefaults)) continue
    if (definition.id === "input-bindings-settings" && (!inputBindings || !onInputBindings)) continue
    if (definition.id === "radial-menu-settings" && (!radialMenu || !onRadialMenu)) continue
    if (definition.id === "reader-material-settings" && !onMaterial) continue
    if (definition.id === "board-layout-settings" && !onSave) continue
    cards.push(
      <Suspense key={definition.id} fallback={null}>
        <Card
          shell={shell}
          viewDefaults={viewDefaults}
          slideshow={slideshow}
          media={media}
          imageProcessing={imageProcessing}
          inputBindings={inputBindings}
          radialMenu={radialMenu}
          onSave={onSave}
          onViewDefaults={onViewDefaults}
          onSlideshow={onSlideshow}
          onMedia={onMedia}
          onImageProcessing={onImageProcessing}
          onInputBindings={onInputBindings}
          onRadialMenu={onRadialMenu}
          onLegacySettingsInspect={onLegacySettingsInspect}
          onLegacySettingsImport={onLegacySettingsImport}
          onMaterial={onMaterial}
          onWorkspace={onWorkspace}
        />
      </Suspense>,
    )
  }

  if (!cards.length) {
    const unavailable = UNAVAILABLE_SECTIONS[sectionId]
    if (unavailable) return <SettingsUnavailableNote title={unavailable.title} reason={unavailable.reason} />
    return <SettingsUnavailableNote title={SETTINGS_SECTIONS.find((section) => section.id === sectionId)?.label ?? "设置"} reason="该分类的运行时配置尚未加载完成。" />
  }

  return <div className="flex flex-col gap-4">{cards}</div>
}

type SettingsSectionId = "general" | "system" | "image" | "view" | "notifications" | "books" | "appearance" | "performance" | "layout" | "bindings" | "data" | "about"

const SETTINGS_SECTIONS: Array<{ id: SettingsSectionId; label: string; icon: ComponentType<{ className?: string }> }> = [
  { id: "general", label: "通用", icon: Settings2 },
  { id: "system", label: "系统", icon: Monitor },
  { id: "image", label: "影像", icon: Image },
  { id: "view", label: "视图", icon: SlidersHorizontal },
  { id: "notifications", label: "通知", icon: Bell },
  { id: "books", label: "书籍", icon: BookOpen },
  { id: "appearance", label: "外观", icon: Palette },
  { id: "performance", label: "性能", icon: Gauge },
  { id: "layout", label: "布局", icon: LayoutGrid },
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

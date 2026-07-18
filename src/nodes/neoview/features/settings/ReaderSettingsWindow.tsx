import { Bell, BookOpen, Database, Gauge, Image, Info, Keyboard, LayoutGrid, Monitor, PanelLeft, Palette, Settings2, SlidersHorizontal } from "lucide-react"
import { Suspense, useState, type ComponentType } from "react"

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { ReaderBoardLayoutPatch, ReaderInputBindingsPatch, ReaderRadialMenuPatch, ReaderRuntimeConfigDto, ReaderShellConfigDto, ReaderViewDefaultsPatch } from "../../adapters/reader-http-client"
import { lazyReaderSettingsCard, settingsCardsForSection } from "../panels/registry"

export function ReaderSettingsWindow({
  shell,
  viewDefaults,
  onClose,
  onBoardLayout,
  onViewDefaults,
  inputBindings,
  onInputBindings,
  radialMenu,
  onRadialMenu,
}: {
  shell: ReaderShellConfigDto
  viewDefaults: ReaderRuntimeConfigDto["viewDefaults"]
  onClose(): void
  onBoardLayout(patch: ReaderBoardLayoutPatch): Promise<void>
  onViewDefaults(patch: ReaderViewDefaultsPatch["viewDefaults"]): Promise<void>
  inputBindings: ReaderRuntimeConfigDto["inputBindings"]
  onInputBindings(patch: ReaderInputBindingsPatch["inputBindings"]): Promise<ReaderRuntimeConfigDto["inputBindings"]>
  radialMenu: ReaderRuntimeConfigDto["radialMenu"]
  onRadialMenu(patch: ReaderRadialMenuPatch["radialMenu"]): Promise<ReaderRuntimeConfigDto["radialMenu"]>
}) {
  const [active, setActive] = useState<SettingsSectionId>("sidebar")
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent
        className="overflow-hidden p-0"
        style={{ width: "min(64rem, calc(100vw - 2rem))", maxWidth: "none", height: "min(70rem, calc(100vh - 2rem))", maxHeight: "calc(100vh - 2rem)" }}
      >
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="flex items-center gap-2"><Settings2 className="size-4" />设置</DialogTitle>
          <DialogDescription className="sr-only">NeoView 节点设置</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 grid-cols-[10rem_minmax(0,1fr)]">
          <nav className="min-h-0 overflow-y-auto border-r bg-muted/15 p-2" aria-label="NeoView 设置分类">
            {SETTINGS_SECTIONS.map((section) => {
              const Icon = section.icon
              return (
                <button
                  key={section.id}
                  type="button"
                  className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs ${active === section.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                  onClick={() => setActive(section.id)}
                >
                  <Icon className="size-3.5" />{section.label}
                </button>
              )
            })}
          </nav>
          <div className="min-h-0 overflow-y-auto p-4">
            <SettingsSection sectionId={active} shell={shell} viewDefaults={viewDefaults} inputBindings={inputBindings} radialMenu={radialMenu} onSave={onBoardLayout} onViewDefaults={onViewDefaults} onInputBindings={onInputBindings} onRadialMenu={onRadialMenu} />
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
  onSave,
  onViewDefaults,
  inputBindings,
  onInputBindings,
  radialMenu,
  onRadialMenu,
}: {
  sectionId: SettingsSectionId
  shell: ReaderShellConfigDto
  viewDefaults: ReaderRuntimeConfigDto["viewDefaults"]
  onSave(patch: ReaderBoardLayoutPatch): Promise<void>
  onViewDefaults(patch: ReaderViewDefaultsPatch["viewDefaults"]): Promise<void>
  inputBindings: ReaderRuntimeConfigDto["inputBindings"]
  onInputBindings(patch: ReaderInputBindingsPatch["inputBindings"]): Promise<ReaderRuntimeConfigDto["inputBindings"]>
  radialMenu: ReaderRuntimeConfigDto["radialMenu"]
  onRadialMenu(patch: ReaderRadialMenuPatch["radialMenu"]): Promise<ReaderRuntimeConfigDto["radialMenu"]>
}) {
  const definitions = settingsCardsForSection(sectionId)
  if (!definitions.length) return <SettingsPlaceholder title={SETTINGS_SECTIONS.find((section) => section.id === sectionId)?.label ?? "设置"} />
  return definitions.map((definition) => {
    const Card = lazyReaderSettingsCard(definition.id)
    return Card ? (
      <Suspense key={definition.id} fallback={<div className="h-24 animate-pulse rounded-md bg-muted/35" aria-label={`正在加载${definition.title}`} />}>
        <Card shell={shell} viewDefaults={viewDefaults} inputBindings={inputBindings} radialMenu={radialMenu} onSave={onSave} onViewDefaults={onViewDefaults} onInputBindings={onInputBindings} onRadialMenu={onRadialMenu} />
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

function SettingsPlaceholder({ title }: { title: string }) {
  return <section className="rounded-md border bg-card/50 p-4"><h2 className="text-lg font-semibold">{title}</h2></section>
}

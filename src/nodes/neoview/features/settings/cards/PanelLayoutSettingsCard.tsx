import { lazy, Suspense } from "react"
import { LayoutPanelTop } from "lucide-react"

import type { ReaderBoardLayoutPatch, ReaderShellConfigDto } from "../../../adapters/reader-http-client"
import type { ReaderPanelContext } from "../../panels/registry"

const PanelLayoutEditor = lazy(() => import("./PanelLayoutEditor"))

export function PanelLayoutSettingsCard({
  shell,
  onSave,
}: {
  shell: ReaderShellConfigDto
  onSave(patch: ReaderBoardLayoutPatch): Promise<void>
}) {
  return (
    <section className="grid gap-4" data-neoview-settings-card="panel-layout">
      <header className="flex items-center justify-between gap-3 border-b px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <LayoutPanelTop className="size-4 shrink-0 text-muted-foreground" />
          <h2 className="truncate text-sm font-medium">面板布局</h2>
        </div>
      </header>
      <Suspense fallback={<div className="h-72 animate-pulse bg-muted/35" aria-label="正在加载面板布局编辑器" />}>
        <PanelLayoutEditor key={shell.revision ?? 0} shell={shell} onSave={onSave} />
      </Suspense>
    </section>
  )
}

export default function DockedPanelLayoutSettingsCard({ shell, onBoardLayout }: ReaderPanelContext) {
  if (!shell || !onBoardLayout) return null
  return <PanelLayoutSettingsCard shell={shell} onSave={onBoardLayout} />
}

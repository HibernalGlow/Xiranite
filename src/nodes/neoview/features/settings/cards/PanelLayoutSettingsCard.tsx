import { lazy, Suspense } from "react"
import { LayoutPanelTop } from "lucide-react"

import type { ReaderBoardLayoutPatch, ReaderShellConfigDto } from "../../../adapters/reader-http-client"
import type { ReaderPanelContext } from "../../panels/registry"
import { SettingsCardShell } from "../SettingsCardShell"

const PanelLayoutEditor = lazy(() => import("./PanelLayoutEditor"))

export function PanelLayoutSettingsCard({
  shell,
  onSave,
}: {
  shell: ReaderShellConfigDto
  onSave(patch: ReaderBoardLayoutPatch): Promise<void>
}) {
  return (
    <SettingsCardShell id="panel-layout" title="面板布局" description="拖放调整卡片所属面板、顺序与显隐。" icon={LayoutPanelTop}>
      <Suspense fallback={null}>
        <PanelLayoutEditor key={shell.revision ?? 0} shell={shell} onSave={onSave} />
      </Suspense>
    </SettingsCardShell>
  )
}

export default function DockedPanelLayoutSettingsCard({ shell, onBoardLayout }: ReaderPanelContext) {
  if (!shell || !onBoardLayout) return null
  return <PanelLayoutSettingsCard shell={shell} onSave={onBoardLayout} />
}

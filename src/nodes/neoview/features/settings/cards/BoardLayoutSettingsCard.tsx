/**
 * Unified board layout settings: left / right / hidden swimlanes.
 * Replaces the separate sidebar-management + panel-layout cards.
 */
import { lazy, Suspense } from "react"
import type { ReaderBoardLayoutPatch, ReaderShellConfigDto } from "../../../adapters/reader-http-client"
import type { ReaderPanelContext, ReaderSettingsCardContext } from "../../panels/registry"

const BoardSwimlaneEditor = lazy(() => import("./BoardSwimlaneEditor"))

export function BoardLayoutSettingsCard({
  shell,
  onSave,
}: {
  shell: ReaderShellConfigDto
  onSave(patch: ReaderBoardLayoutPatch): Promise<void>
}) {
  return (
    <Suspense fallback={null}>
      <BoardSwimlaneEditor key={shell.revision ?? 0} shell={shell} onSave={onSave} />
    </Suspense>
  )
}

export function SettingsBoardLayoutCard({ shell, onSave }: ReaderSettingsCardContext) {
  if (!shell || !onSave) return null
  return <BoardLayoutSettingsCard shell={shell} onSave={onSave} />
}

export default function DockedBoardLayoutSettingsCard({ shell, onBoardLayout }: ReaderPanelContext) {
  if (!shell || !onBoardLayout) return null
  return <BoardLayoutSettingsCard shell={shell} onSave={onBoardLayout} />
}

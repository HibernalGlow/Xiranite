/**
 * @migrated-from src/lib/components/panels/SidebarManagementPanel.svelte
 * @source-hash sha256:8fb6ac4471ae33561d43b3d32a4adf55089384c0eb401bfd5d33496a7df5879c
 * @migrated-from src/lib/cards/settings/PanelManagementCard.svelte
 * @source-hash sha256:af9a4933961ccdb132ed67f2bed675cd19ac16f67bea31de9a5bd20940e9a416
 * @features panels-toolbar-shell,settings-import-export-backup
 * @migration-status adapted
 */
import { ArrowDown, ArrowUp, CircleHelp, PanelLeft, RotateCcw, Save, Search, type LucideIcon } from "lucide-react"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { ReaderBoardLayoutPatch, ReaderShellConfigDto } from "../../../adapters/reader-http-client"
import { PANEL_DEFINITIONS, type ReaderPanelContext } from "../../panels/registry"
import { SettingsCardShell } from "../SettingsCardShell"

type PanelPosition = ReaderShellConfigDto["panelLayout"][string]["position"]
type PanelDestination = "left" | "right" | "hidden" | "floating"

interface PanelDraft {
  id: string
  title: string
  icon: LucideIcon
  visible: boolean
  order: number
  position: PanelPosition
  defaultPosition: PanelPosition
  defaultVisible: boolean
  defaultOrder: number
  canMove: boolean
  canHide: boolean
  managed: boolean
}

export function SidebarManagementSettingsCard({
  shell,
  onSave,
}: {
  shell: ReaderShellConfigDto
  onSave(patch: ReaderBoardLayoutPatch): Promise<void>
}) {
  const [draft, setDraft] = useState<PanelDraft[]>(() => createSidebarPanelDraft(shell))
  const [query, setQuery] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => setDraft(createSidebarPanelDraft(shell)), [shell])

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filtered = draft
    .filter((panel) => !normalizedQuery || panel.title.toLocaleLowerCase().includes(normalizedQuery) || panel.id.toLocaleLowerCase().includes(normalizedQuery))
    .toSorted(compareDraftPanels)

  async function save() {
    if (saving) return
    setSaving(true)
    setError(undefined)
    try {
      await onSave(createSidebarBoardPatch(shell, draft))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  function updateDraft(updater: (current: PanelDraft[]) => PanelDraft[]) {
    setError(undefined)
    setDraft(updater)
  }

  return (
    <SettingsCardShell
      id="sidebar-management"
      title="边栏布局"
      description="管理左右边栏的面板位置、顺序和可见性。"
      icon={PanelLeft}
      actions={
        <>
          <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => updateDraft(resetSidebarPanelDraft)}><RotateCcw />重置</Button>
          <Button type="button" size="sm" disabled={saving} onClick={() => void save()}><Save />保存边栏布局</Button>
        </>
      }
    >
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input aria-label="搜索边栏面板" disabled={saving} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索面板..." className="h-9 pl-8" />
      </div>

      {error ? <p role="alert" className="text-sm text-destructive">保存失败：{error}</p> : null}
      <div className="overflow-hidden rounded-md border bg-card/50">
        <div className="hidden grid-cols-[minmax(8rem,1fr)_7rem_5.5rem] gap-2 border-b bg-muted/25 px-3 py-2 text-xs font-medium sm:grid">
          <span>名称</span><span>位置</span><span className="text-right">顺序</span>
        </div>
        {filtered.map((panel) => {
          const PanelIcon = panel.icon
          const destination = panel.visible ? panel.position : "hidden"
          const siblings = draft.filter((candidate) => panelGroup(candidate) === panelGroup(panel)).toSorted(compareDraftPanels)
          const siblingIndex = siblings.findIndex((candidate) => candidate.id === panel.id)
          return (
            <div key={panel.id} className="grid gap-2 border-b px-3 py-3 last:border-b-0 sm:grid-cols-[minmax(8rem,1fr)_7rem_5.5rem] sm:items-center" data-sidebar-panel-draft={panel.id}>
              <div className="flex min-w-0 items-center gap-2">
                <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted" aria-hidden="true"><PanelIcon className="size-4" /></span>
                <div className="min-w-0"><div className="truncate text-sm">{panel.title}</div><div className="truncate text-[10px] uppercase text-muted-foreground">{panel.id}</div></div>
              </div>
              <select
                aria-label={`${panel.title}位置`}
                className="h-8 rounded-md border bg-background px-2 text-xs disabled:opacity-50"
                value={destination}
                disabled={saving || (!panel.canMove && !panel.canHide)}
                onChange={(event) => {
                  updateDraft((current) => assignSidebarPanel(current, panel.id, event.target.value as PanelDestination))
                }}
              >
                <option value="left">左侧栏</option>
                <option value="right">右侧栏</option>
                {panel.canHide ? <option value="hidden">隐藏</option> : null}
                {panel.defaultPosition === "floating" ? <option value="floating">浮动</option> : null}
              </select>
              <div className="flex justify-end gap-1">
                <Button type="button" size="icon-sm" variant="ghost" aria-label={`上移${panel.title}`} disabled={saving || !panel.visible || siblingIndex <= 0} onClick={() => updateDraft((current) => moveSidebarPanel(current, panel.id, -1))}><ArrowUp /></Button>
                <Button type="button" size="icon-sm" variant="ghost" aria-label={`下移${panel.title}`} disabled={saving || !panel.visible || siblingIndex < 0 || siblingIndex >= siblings.length - 1} onClick={() => updateDraft((current) => moveSidebarPanel(current, panel.id, 1))}><ArrowDown /></Button>
              </div>
            </div>
          )
        })}
        {filtered.length === 0 ? <div className="px-3 py-10 text-center text-xs text-muted-foreground">未找到匹配的面板</div> : null}
      </div>
    </SettingsCardShell>
  )
}

export default function DockedSidebarManagementSettingsCard({ shell, onBoardLayout }: ReaderPanelContext) {
  if (!shell || !onBoardLayout) return null
  return <SidebarManagementSettingsCard shell={shell} onSave={onBoardLayout} />
}

export function createSidebarPanelDraft(shell: ReaderShellConfigDto): PanelDraft[] {
  const knownIds = new Set(PANEL_DEFINITIONS.map((panel) => panel.id))
  const known = PANEL_DEFINITIONS.map((panel) => {
    const current = shell.panelLayout[panel.id]
    return {
      id: panel.id,
      title: panel.title,
      icon: panel.icon,
      visible: current?.visible ?? panel.defaultVisible,
      order: current?.order ?? panel.defaultOrder,
      position: current?.position ?? panel.defaultSide,
      defaultPosition: panel.defaultSide,
      defaultVisible: panel.defaultVisible,
      defaultOrder: panel.defaultOrder,
      canMove: panel.canMove,
      canHide: panel.canHide,
      managed: true,
    }
  })
  const unknown = Object.entries(shell.panelLayout)
    .filter(([id]) => !knownIds.has(id as never))
    .map(([id, current]) => ({
      id,
      title: id,
      icon: CircleHelp,
      ...current,
      defaultPosition: current.position,
      defaultVisible: current.visible,
      defaultOrder: current.order,
      canMove: true,
      canHide: true,
      managed: false,
    }))
  return [...known, ...unknown]
}

export function assignSidebarPanel(draft: PanelDraft[], panelId: string, destination: PanelDestination): PanelDraft[] {
  const destinationOrder = destination === "hidden"
    ? undefined
    : Math.max(-1, ...draft.filter((panel) => panel.visible && panel.position === destination && panel.id !== panelId).map((panel) => panel.order)) + 1
  return draft.map((panel) => {
    if (panel.id !== panelId) return panel
    if (destination === "hidden") return { ...panel, visible: false }
    return { ...panel, visible: true, position: destination, order: destinationOrder! }
  })
}

export function moveSidebarPanel(draft: PanelDraft[], panelId: string, delta: -1 | 1): PanelDraft[] {
  const panel = draft.find((candidate) => candidate.id === panelId)
  if (!panel || !panel.visible) return draft
  const group = draft.filter((candidate) => panelGroup(candidate) === panelGroup(panel)).toSorted(compareDraftPanels)
  const index = group.findIndex((candidate) => candidate.id === panelId)
  const target = group[index + delta]
  if (!target) return draft
  return draft.map((candidate) => {
    if (candidate.id === panel.id) return { ...candidate, order: target.order }
    if (candidate.id === target.id) return { ...candidate, order: panel.order }
    return candidate
  })
}

export function resetSidebarPanelDraft(draft: PanelDraft[]): PanelDraft[] {
  return draft.map((panel) => panel.managed ? {
    ...panel,
    visible: panel.defaultVisible,
    order: panel.defaultOrder,
    position: panel.defaultPosition,
  } : panel)
}

export function createSidebarBoardPatch(shell: ReaderShellConfigDto, draft: PanelDraft[]): ReaderBoardLayoutPatch {
  return {
    expectedRevision: shell.revision ?? 0,
    board: {
      panels: draft.map(({ id, visible, order, position }) => ({ id, visible, order, position })),
      cards: Object.entries(shell.cardLayout).map(([cardId, card]) => ({ cardId, panelId: card.panelId, visible: card.visible, order: card.order })),
    },
  }
}

function panelGroup(panel: PanelDraft): PanelDestination {
  return panel.visible ? panel.position : "hidden"
}

function compareDraftPanels(left: PanelDraft, right: PanelDraft): number {
  return panelGroup(left).localeCompare(panelGroup(right)) || left.order - right.order || left.id.localeCompare(right.id)
}

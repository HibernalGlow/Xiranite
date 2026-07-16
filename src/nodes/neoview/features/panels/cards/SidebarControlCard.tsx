/**
 * @migrated-from src/lib/cards/info/SidebarControlCard.svelte
 * @source-hash sha256:737c9fb67ae59a5c9e33bdb04f910aa68fe814377dcd368464a66d82a050bffa
 * @features panels-toolbar-shell
 * @migration-status adapted
 */
import { PanelBottom, PanelLeft, PanelRight, PanelTop, Pin, PinOff, RotateCcw } from "lucide-react"
import { useSyncExternalStore, type MouseEvent as ReactMouseEvent } from "react"

import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"

import type { ReaderPanelContext } from "../registry"

export type SidebarControlEdge = "top" | "right" | "bottom" | "left"
export type SidebarControlLockMode = "auto" | "locked-open" | "locked-hidden"

export interface SidebarControlEdgeState {
  pinned: boolean
  open: boolean
  enabled: boolean
  triggerSize: number
  lockMode: SidebarControlLockMode
}

export interface SidebarFloatingControlState {
  enabled: boolean
  position: { x: number; y: number }
}

export interface SidebarControlCardProps {
  edges: Record<SidebarControlEdge, SidebarControlEdgeState>
  floatingControl: SidebarFloatingControlState
  disabled?: boolean
  onFloatingControlChange(patch: Partial<SidebarFloatingControlState>): void
  onPinnedChange(edge: SidebarControlEdge, pinned: boolean): void
  onOpenChange(edge: "left" | "right", open: boolean): void
  onLockModeChange(edge: SidebarControlEdge, lockMode: SidebarControlLockMode): void
  onTriggerSizeChange(edge: SidebarControlEdge, triggerSize: number): void
  onReset(): void
}

export const DEFAULT_FLOATING_POSITION = { x: 100, y: 100 } as const
const EDGE_ORDER: readonly SidebarControlEdge[] = ["top", "right", "bottom", "left"]
const EDGE_LABELS: Record<SidebarControlEdge, string> = { top: "上", right: "右", bottom: "下", left: "左" }

export function SidebarControlCard({
  edges,
  floatingControl,
  disabled = false,
  onFloatingControlChange,
  onPinnedChange,
  onOpenChange,
  onLockModeChange,
  onTriggerSizeChange,
  onReset,
}: SidebarControlCardProps) {
  return (
    <section className="grid gap-3 text-xs text-muted-foreground" data-neoview-card="sidebar-control">
      <div className="flex items-center justify-between gap-2">
        <span>启用浮动控制器</span>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6"
            disabled={disabled}
            title="重置控制器位置"
            aria-label="重置控制器位置"
            onClick={() => onFloatingControlChange({ position: DEFAULT_FLOATING_POSITION })}
          >
            <RotateCcw className="size-3" />
          </Button>
          <Switch
            size="sm"
            checked={floatingControl.enabled}
            disabled={disabled}
            aria-label="启用浮动控制器"
            onCheckedChange={(enabled) => onFloatingControlChange({ enabled })}
          />
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground/70">
        浮动控制器可拖动，并可快速切换四边工具栏和侧栏。
      </p>

      <hr className="border-border/50" />

      <div className="grid grid-cols-2 gap-2" aria-label="边栏状态">
        {EDGE_ORDER.map((edge) => (
          <EdgeControlButton
            key={edge}
            edge={edge}
            label={EDGE_LABELS[edge]}
            state={edges[edge]}
            disabled={disabled}
            onPinnedChange={onPinnedChange}
            onOpenChange={onOpenChange}
          />
        ))}
      </div>

      <div className="grid gap-2" aria-label="边栏自动隐藏设置">
        {EDGE_ORDER.map((edge) => (
          <div key={edge} className="grid grid-cols-[1.5rem_minmax(0,1fr)_4.5rem] items-center gap-2">
            <span aria-hidden="true">{EDGE_LABELS[edge]}</span>
            <select
              className="h-7 min-w-0 rounded border border-input bg-background px-1 text-[11px] text-foreground"
              aria-label={`${EDGE_LABELS[edge]}边锁定模式`}
              value={edges[edge].lockMode}
              disabled={disabled || !edges[edge].enabled}
              onChange={(event) => onLockModeChange(edge, event.currentTarget.value as SidebarControlLockMode)}
            >
              <option value="auto">自动</option>
              <option value="locked-open">锁定展开</option>
              <option value="locked-hidden">锁定隐藏</option>
            </select>
            <input
              type="number"
              min={1}
              max={128}
              className="h-7 w-full rounded border border-input bg-background px-1 text-[11px] text-foreground"
              aria-label={`${EDGE_LABELS[edge]}边触发区大小`}
              value={edges[edge].triggerSize}
              disabled={disabled || !edges[edge].enabled}
              onChange={(event) => {
                const value = event.currentTarget.valueAsNumber
                if (Number.isInteger(value) && value >= 1 && value <= 128) onTriggerSizeChange(edge, value)
              }}
            />
          </div>
        ))}
      </div>

      <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={onReset}>
        <RotateCcw className="size-3" />
        恢复边栏默认布局
      </Button>

      <p className="text-[10px] text-muted-foreground/70">
        点击切换显示或隐藏；左右边栏也可右键切换固定状态。锁定模式可通过上方菜单完整操作。
      </p>
    </section>
  )
}

function EdgeControlButton({
  edge,
  label,
  state,
  disabled,
  onPinnedChange,
  onOpenChange,
}: {
  edge: SidebarControlEdge
  label: string
  state: SidebarControlEdgeState
  disabled: boolean
  onPinnedChange(edge: SidebarControlEdge, pinned: boolean): void
  onOpenChange(edge: "left" | "right", open: boolean): void
}) {
  const isSidebar = edge === "left" || edge === "right"
  const Icon = edge === "top" ? PanelTop : edge === "bottom" ? PanelBottom : edge === "left" ? PanelLeft : PanelRight

  function handleClick() {
    if (edge === "left" || edge === "right") onOpenChange(edge, !state.open)
    else onPinnedChange(edge, !state.pinned)
  }

  function handleContextMenu(event: ReactMouseEvent<HTMLButtonElement>) {
    if (!isSidebar || disabled) return
    event.preventDefault()
    onPinnedChange(edge, !state.pinned)
  }

  return (
    <Button
      type="button"
      variant={state.pinned ? "default" : isSidebar && state.open ? "secondary" : "outline"}
      size="sm"
      className="h-8 gap-1 text-xs"
      disabled={disabled || !state.enabled}
      aria-label={`${label}边栏`}
      aria-pressed={isSidebar ? state.open : state.pinned}
      data-edge={edge}
      data-open={state.open ? "true" : "false"}
      data-pinned={state.pinned ? "true" : "false"}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    >
      <Icon className="size-3" />
      <span>{label}</span>
      {state.pinned ? (
        <Pin className="size-2.5" />
      ) : isSidebar && state.open ? (
        <span className="text-[10px] opacity-70">开</span>
      ) : (
        <PinOff className="size-2.5 opacity-50" />
      )}
    </Button>
  )
}

export default function DockedSidebarControlCard({ disabled, shell, shellControl }: ReaderPanelContext) {
  if (!shell || !shellControl) return <p className="text-xs text-muted-foreground">侧栏控制尚未就绪。</p>
  return <ConnectedSidebarControlCard disabled={disabled} shell={shell} control={shellControl} />
}

function ConnectedSidebarControlCard({ disabled, shell, control }: {
  disabled: boolean
  shell: NonNullable<ReaderPanelContext["shell"]>
  control: NonNullable<ReaderPanelContext["shellControl"]>
}) {
  const snapshot = useSyncExternalStore(control.store.subscribe, control.store.getSnapshot, control.store.getSnapshot)
  const edges = Object.fromEntries((Object.keys(snapshot.edges) as SidebarControlEdge[]).map((edge) => [edge, {
    ...snapshot.edges[edge],
    enabled: shell.edges[edge].enabled,
    triggerSize: shell.edges[edge].triggerSize,
  }])) as SidebarControlCardProps["edges"]
  return (
    <SidebarControlCard
      edges={edges}
      floatingControl={snapshot.floating}
      disabled={disabled}
      onFloatingControlChange={control.setFloating}
      onPinnedChange={control.setPinned}
      onOpenChange={control.requestOpen}
      onLockModeChange={control.setLock}
      onTriggerSizeChange={control.setTriggerSize}
      onReset={control.reset}
    />
  )
}

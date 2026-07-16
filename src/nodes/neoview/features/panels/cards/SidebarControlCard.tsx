/**
 * @migrated-from src/lib/cards/info/SidebarControlCard.svelte
 * @source-hash sha256:737c9fb67ae59a5c9e33bdb04f910aa68fe814377dcd368464a66d82a050bffa
 * @features panels-toolbar-shell
 * @migration-status adapted
 */
import { PanelBottom, PanelLeft, PanelRight, PanelTop, Pin, PinOff, RotateCcw } from "lucide-react"
import type { MouseEvent as ReactMouseEvent } from "react"

import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"

export type SidebarControlEdge = "top" | "right" | "bottom" | "left"

export interface SidebarControlEdgeState {
  pinned: boolean
  open: boolean
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
}

const DEFAULT_FLOATING_POSITION = { x: 100, y: 100 } as const

export function SidebarControlCard({
  edges,
  floatingControl,
  disabled = false,
  onFloatingControlChange,
  onPinnedChange,
  onOpenChange,
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
        启用后会在画面上显示一个可拖动的控制器，用于快速控制边栏显示。
      </p>

      <hr className="border-border/50" />

      <div className="grid grid-cols-2 gap-2" aria-label="边栏状态">
        <EdgeControlButton
          edge="top"
          label="上"
          state={edges.top}
          disabled={disabled}
          onPinnedChange={onPinnedChange}
        />
        <EdgeControlButton
          edge="bottom"
          label="下"
          state={edges.bottom}
          disabled={disabled}
          onPinnedChange={onPinnedChange}
        />
        <EdgeControlButton
          edge="left"
          label="左"
          state={edges.left}
          disabled={disabled}
          onPinnedChange={onPinnedChange}
          onOpenChange={onOpenChange}
        />
        <EdgeControlButton
          edge="right"
          label="右"
          state={edges.right}
          disabled={disabled}
          onPinnedChange={onPinnedChange}
          onOpenChange={onOpenChange}
        />
      </div>

      <p className="text-[10px] text-muted-foreground/70">
        点击切换显示或隐藏，右键切换锁定状态。锁定后边栏不会自动隐藏。
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
  onOpenChange?(edge: "left" | "right", open: boolean): void
}) {
  const isSidebar = edge === "left" || edge === "right"
  const Icon = edge === "top" ? PanelTop : edge === "bottom" ? PanelBottom : edge === "left" ? PanelLeft : PanelRight

  function handleClick() {
    if (edge === "left" || edge === "right") onOpenChange?.(edge, !state.open)
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
      disabled={disabled}
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

export default SidebarControlCard

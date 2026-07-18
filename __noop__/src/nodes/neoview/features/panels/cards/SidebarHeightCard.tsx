/**
 * @migrated-from src/lib/cards/info/SidebarHeightCard.svelte
 * @source-hash sha256:f2c99617bdd104a04a2d495d4edc1e96454d7ba8e45de604410e87e2638f3978
 * @migrated-from src/lib/stores/sidebarConfig.svelte.ts
 * @source-hash sha256:1680afb71b6e283189094e52657164937d1b8fafb080183b361091af883ee20a
 * @features panels-toolbar-shell
 * @migration-status adapted
 */
import { Maximize2, MousePointer2, MoveHorizontal, MoveVertical, PanelLeft, PanelRight } from "lucide-react"
import { useEffect, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

import type { ReaderShellConfigDto, ReaderShellEdge, ReaderSidebarLayoutPatch } from "../../../adapters/reader-http-client"
import type { ReaderPanelContext } from "../registry"

type SidebarSide = "left" | "right"
type SidebarLayout = ReaderShellConfigDto["sidebars"][SidebarSide]

export default function SidebarHeightCard({ shell, shellControl, onSidebarLayout }: ReaderPanelContext) {
  if (!shell || !shellControl || !onSidebarLayout) {
    return <p className="text-xs text-muted-foreground">侧边栏布局控制尚未就绪。</p>
  }
  return (
    <SidebarHeightEditor
      shell={shell}
      onSidebarLayout={onSidebarLayout}
      onTriggerSize={(edge, value) => shellControl.setTriggerSize(edge, value)}
      onInteraction={(patch) => shellControl.persist({ sidebarInteraction: patch })}
    />
  )
}

export function SidebarHeightEditor({ shell, disabled = false, onSidebarLayout, onTriggerSize, onInteraction }: {
  shell: ReaderShellConfigDto
  disabled?: boolean
  onSidebarLayout(patch: ReaderSidebarLayoutPatch): void | Promise<void>
  onTriggerSize(edge: ReaderShellEdge, value: number): void
  onInteraction(patch: Partial<NonNullable<ReaderShellConfigDto["sidebarInteraction"]>>): void
}) {
  const [left, setLeft] = useState(() => shell.sidebars.left)
  const [right, setRight] = useState(() => shell.sidebars.right)
  const [triggers, setTriggers] = useState(() => triggerSnapshot(shell))
  const [interaction, setInteraction] = useState(() => shell.sidebarInteraction ?? DEFAULT_INTERACTION)

  useEffect(() => setLeft(shell.sidebars.left), [shell.sidebars.left])
  useEffect(() => setRight(shell.sidebars.right), [shell.sidebars.right])
  useEffect(() => setTriggers(triggerSnapshot(shell)), [shell.edges])
  useEffect(() => setInteraction(shell.sidebarInteraction ?? DEFAULT_INTERACTION), [shell.sidebarInteraction])

  return (
    <section className="@container space-y-5 text-xs text-muted-foreground" data-neoview-card="sidebar-height">
      <div className="flex items-start justify-between gap-3 pb-1">
        <p className="max-w-[34rem] text-[10px] leading-relaxed text-muted-foreground/70">
          自由调整侧边栏的尺寸与位置。高度 100% 时位置控制禁用。
        </p>
        <label className="flex shrink-0 cursor-pointer items-center gap-2 text-[10px]">
          <span>显示拖拽手柄</span>
          <Switch
            checked={interaction.showDragHandle}
            disabled={disabled}
            aria-label="显示拖拽手柄"
            onCheckedChange={(checked) => {
              setInteraction((current) => ({ ...current, showDragHandle: checked }))
              onInteraction({ showDragHandle: checked })
            }}
          />
        </label>
      </div>

      <div className="space-y-2 rounded-md border border-border/40 bg-accent/10 p-2.5">
        <label className="flex cursor-pointer items-center justify-between gap-2 text-[10px]">
          <span>空白区点击收回侧边栏</span>
          <Switch
            checked={interaction.enableBlankAreaCollapse}
            disabled={disabled}
            aria-label="空白区点击收回侧边栏"
            onCheckedChange={(checked) => {
              setInteraction((current) => ({ ...current, enableBlankAreaCollapse: checked }))
              onInteraction({ enableBlankAreaCollapse: checked })
            }}
          />
        </label>
        <div className={cn("flex items-center gap-1.5", !interaction.enableBlankAreaCollapse && "opacity-40")}>
          {(["single", "double"] as const).map((mode) => (
            <Button
              key={mode}
              type="button"
              variant={interaction.blankAreaCollapseMode === mode ? "default" : "outline"}
              size="sm"
              className="h-6 px-2 text-[10px]"
              disabled={disabled || !interaction.enableBlankAreaCollapse}
              aria-pressed={interaction.blankAreaCollapseMode === mode}
              onClick={() => {
                setInteraction((current) => ({ ...current, blankAreaCollapseMode: mode }))
                onInteraction({ blankAreaCollapseMode: mode })
              }}
            >
              {mode === "single" ? "单击" : "双击"}
            </Button>
          ))}
        </div>
        <p className="text-[9px] text-muted-foreground/70">仅点击侧边栏空白区域生效，点击图标或控件不会触发收回。</p>
      </div>

      <div className="grid grid-cols-1 gap-x-6 gap-y-5 @[34rem]:grid-cols-2">
        <SidebarGeometry
          side="left"
          value={left}
          disabled={disabled}
          onPreview={setLeft}
          onCommit={(patch) => onSidebarLayout({ side: "left", ...patch })}
        />
        <SidebarGeometry
          side="right"
          value={right}
          disabled={disabled}
          onPreview={setRight}
          onCommit={(patch) => onSidebarLayout({ side: "right", ...patch })}
        />
      </div>

      <div className="space-y-3 border-t border-border/40 pt-4">
        <div className="space-y-3 rounded-md border border-border/40 bg-accent/10 p-2.5">
          <div className="flex items-center gap-1.5 text-foreground">
            <MousePointer2 className="size-3 text-primary" />
            <span className="text-[10px] font-medium">触控区域 (px)</span>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {TRIGGER_FIELDS.map((field) => (
              <RangeField
                key={field.edge}
                label={field.label}
                value={triggers[field.edge]}
                min={field.min}
                max={field.max}
                disabled={disabled}
                compact
                onPreview={(value) => setTriggers((current) => ({ ...current, [field.edge]: value }))}
                onCommit={() => onTriggerSize(field.edge, triggers[field.edge])}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function SidebarGeometry({ side, value, disabled, onPreview, onCommit }: {
  side: SidebarSide
  value: SidebarLayout
  disabled: boolean
  onPreview(value: SidebarLayout): void
  onCommit(patch: Partial<SidebarLayout>): void | Promise<void>
}) {
  const left = side === "left"
  const height = sidebarHeightPercent(value)
  const accent = left ? "text-blue-500 border-blue-500/30" : "text-green-500 border-green-500/30"
  const output = left ? "text-blue-400" : "text-green-400"
  return (
    <section className="space-y-3" data-sidebar-geometry={side}>
      <div className={cn("mb-2 flex items-center gap-1.5 border-b pb-1", accent)}>
        {left ? <PanelLeft className="size-3.5" /> : <PanelRight className="size-3.5" />}
        <h3 className="text-[11px] font-bold text-foreground">{left ? "左侧边栏" : "右侧边栏"}</h3>
      </div>
      <RangeField
        label="高度"
        icon={<Maximize2 className="size-2.5" />}
        value={height}
        min={10}
        max={100}
        outputClassName={output}
        disabled={disabled}
        onPreview={(next) => onPreview({ ...value, height: next >= 100 ? "full" : "custom", customHeight: next })}
        onCommit={() => onCommit({ height: height >= 100 ? "full" : "custom", customHeight: height })}
      />
      <RangeField
        label="Y轴"
        icon={<MoveVertical className="size-2.5" />}
        value={value.verticalAlign}
        min={0}
        max={100}
        outputClassName={output}
        disabled={disabled || value.height === "full"}
        onPreview={(next) => onPreview({ ...value, verticalAlign: next })}
        onCommit={() => onCommit({ verticalAlign: value.verticalAlign })}
      />
      <RangeField
        label="X轴"
        icon={<MoveHorizontal className="size-2.5" />}
        value={value.horizontalPosition}
        min={0}
        max={100}
        outputClassName={output}
        disabled={disabled}
        footer={<><span>贴边</span><span>居中</span></>}
        onPreview={(next) => onPreview({ ...value, horizontalPosition: next })}
        onCommit={() => onCommit({ horizontalPosition: value.horizontalPosition })}
      />
    </section>
  )
}

function RangeField({ label, icon, value, min, max, disabled, compact = false, outputClassName, footer, onPreview, onCommit }: {
  label: string
  icon?: ReactNode
  value: number
  min: number
  max: number
  disabled: boolean
  compact?: boolean
  outputClassName?: string
  footer?: ReactNode
  onPreview(value: number): void
  onCommit(): void
}) {
  return (
    <label className={cn("block space-y-1", disabled && "opacity-30")}>
      <span className={cn("flex items-center justify-between", compact ? "text-[9px]" : "text-[10px]")}>
        <span className="flex items-center gap-1">{icon}{label}</span>
        <output className={cn("font-mono tabular-nums", outputClassName)}>{value}{compact ? "" : "%"}</output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        disabled={disabled}
        aria-label={label}
        className={cn("w-full cursor-pointer accent-primary", compact ? "h-3" : "h-4")}
        onChange={(event) => onPreview(event.currentTarget.valueAsNumber)}
        onPointerUp={(event) => finishPointer(event, onCommit)}
        onPointerCancel={(event) => finishPointer(event, onCommit)}
        onKeyUp={(event) => finishKey(event, onCommit)}
      />
      {footer ? <span className="flex justify-between px-0.5 text-[8px] text-muted-foreground/50">{footer}</span> : null}
    </label>
  )
}

const DEFAULT_INTERACTION = {
  showDragHandle: false,
  enableBlankAreaCollapse: true,
  blankAreaCollapseMode: "single" as const,
}

const TRIGGER_FIELDS = [
  { edge: "left", label: "左边缘", min: 4, max: 64 },
  { edge: "right", label: "右边缘", min: 4, max: 64 },
  { edge: "top", label: "顶边缘", min: 2, max: 48 },
  { edge: "bottom", label: "底边缘", min: 2, max: 48 },
] as const

function triggerSnapshot(shell: ReaderShellConfigDto): Record<ReaderShellEdge, number> {
  return {
    top: shell.edges.top.triggerSize,
    right: shell.edges.right.triggerSize,
    bottom: shell.edges.bottom.triggerSize,
    left: shell.edges.left.triggerSize,
  }
}

function sidebarHeightPercent(value: SidebarLayout): number {
  if (value.height === "full") return 100
  if (value.height === "two-thirds") return 67
  if (value.height === "half") return 50
  if (value.height === "one-third") return 33
  return value.customHeight
}

function finishPointer(event: PointerEvent<HTMLInputElement>, commit: () => void): void {
  if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  commit()
}

function finishKey(event: KeyboardEvent<HTMLInputElement>, commit: () => void): void {
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) commit()
}

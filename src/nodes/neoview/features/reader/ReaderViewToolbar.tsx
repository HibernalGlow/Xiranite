/**
 * @migrated-from src/lib/components/layout/TopToolbar/TopToolbar.svelte
 * @source-hash sha256:993aa8bc696d9f362ae66bd759f2da2a66128b6010c371036e705b42dc302fea
 * @migrated-from src/lib/components/layout/TopToolbar/ZoomPanel.svelte
 * @source-hash sha256:c099c03c7b5ea915f60bd4aad42a9919776bf8f136001552fea4680068337b9a
 * @migrated-from src/lib/components/layout/TopToolbar/RotatePanel.svelte
 * @source-hash sha256:c823ae6af0f8659ac7cccdaaa2eedfbbb8c8be5088b5148288bb57f3caf4acb5
 * @migration-status adapted
 */
import { useEffect, useRef, useState } from "react"
import {
  AlignHorizontalSpaceAround,
  AlignVerticalSpaceAround,
  AlignLeft,
  AlignRight,
  ArrowDownUp,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Ban,
  Columns2,
  Equal,
  Expand,
  Frame,
  Maximize,
  MousePointer2,
  PanelsTopLeft,
  Play,
  RectangleVertical,
  RotateCcw,
  RotateCw,
  Search,
  SplitSquareHorizontal,
  StretchHorizontal,
  StretchVertical,
  Smartphone,
  SquareChevronLeft,
  SquareChevronRight,
  ZoomIn,
  ZoomOut,
  Rows2,
} from "lucide-react"
import {
  DEFAULT_READER_PRESENTATION,
  rotateReaderPresentation,
  stepReaderManualScale,
  type ReaderAutoRotation,
  type ReaderFitMode,
  type ReaderLayout,
  type ReaderPresentation,
  type ReaderSlideshow,
  type ReadingDirection,
} from "@xiranite/node-neoview/ui-core"

import { Button } from "@/components/ui/button"
import type { ReaderSlideshowPatch } from "../../adapters/reader-http-client"
import { ReaderSlideshowToolbar } from "./ReaderSlideshowToolbar"

const FIT_MODES: Array<{ value: ReaderFitMode; label: string }> = [
  { value: "fit", label: "适应窗口" },
  { value: "fill", label: "铺满整个窗口" },
  { value: "fit-width", label: "适应宽度" },
  { value: "fit-height", label: "适应高度" },
  { value: "original", label: "原始大小" },
  { value: "fit-left", label: "居左适应窗口" },
  { value: "fit-right", label: "居右适应窗口" },
]

const FIT_MODE_ICONS = {
  fit: Maximize,
  fill: Expand,
  "fit-width": StretchHorizontal,
  "fit-height": StretchVertical,
  original: Frame,
  "fit-left": AlignLeft,
  "fit-right": AlignRight,
} as const

type ExpandedPanel = "zoom" | "rotate" | "hover-scroll" | "slideshow"

export function ReaderViewToolbar({
  disabled,
  layout,
  direction,
  presentation,
  onChange,
  onLayoutChange,
  onDirectionChange,
  hoverScrollEnabled = true,
  hoverScrollSpeed = 2,
  onHoverScrollChange,
  slideshow,
  onSlideshowChange,
}: {
  disabled?: boolean
  layout: ReaderLayout
  direction: ReadingDirection
  presentation: ReaderPresentation
  onChange(presentation: ReaderPresentation): void
  onLayoutChange(patch: Partial<ReaderLayout>): void
  onDirectionChange(direction: ReadingDirection): void
  hoverScrollEnabled?: boolean
  hoverScrollSpeed?: number
  onHoverScrollChange?(patch: { enabled?: boolean; speed?: number }): void | Promise<void>
  slideshow: ReaderSlideshow
  onSlideshowChange(patch: ReaderSlideshowPatch["slideshow"]): void | Promise<void>
}) {
  const [expanded, setExpanded] = useState<ExpandedPanel | null>(null)
  const [zoomInput, setZoomInput] = useState<string>()
  const longPressRef = useRef<ReturnType<typeof setTimeout>>()

  function toggle(panel: ExpandedPanel) {
    setExpanded((current) => current === panel ? null : panel)
  }

  function beginZoomInput() {
    longPressRef.current = setTimeout(() => {
      longPressRef.current = undefined
      setZoomInput(String(Math.round(presentation.manualScale * 100)))
    }, 500)
  }

  function finishZoomInput() {
    if (!longPressRef.current) return
    clearTimeout(longPressRef.current)
    longPressRef.current = undefined
    onChange({ ...presentation, manualScale: 1 })
  }

  function commitZoomInput() {
    const percent = Math.min(1000, Math.max(10, Number.parseInt(zoomInput ?? "100", 10) || 100))
    onChange({ ...presentation, manualScale: percent / 100 })
    setZoomInput(undefined)
  }

  const CurrentFitIcon = FIT_MODE_ICONS[presentation.fitMode]

  return (
    <div className="xiranite-app-region-no-drag min-w-0" data-reader-view-toolbar="true">
      <div className="flex min-h-12 min-w-0 flex-wrap items-center justify-start gap-1 px-3 py-1.5 lg:justify-center" data-reader-toolbar-row="primary">
        <Button title="页面排序尚待迁移" aria-label="页面排序" type="button" size="icon-sm" variant="ghost" disabled><ArrowDownUp /></Button>
        <Separator />
        <Button title="缩小" aria-label="缩小" type="button" size="icon-sm" variant="ghost" disabled={disabled} onClick={() => onChange({ ...presentation, manualScale: stepReaderManualScale(presentation.manualScale, -1) })}><ZoomOut /></Button>
        {zoomInput === undefined ? (
          <Button title="单击重置 100%，长按输入数值" aria-label="缩放百分比" type="button" size="sm" variant="ghost" disabled={disabled} onPointerDown={beginZoomInput} onPointerUp={finishZoomInput} onPointerLeave={finishZoomInput}><span className="w-10 text-[11px] tabular-nums">{Math.round(presentation.manualScale * 100)}%</span></Button>
        ) : (
          <input autoFocus aria-label="缩放百分比" className="h-8 w-16 rounded border border-border bg-background px-1 text-center text-xs tabular-nums" min={10} max={1000} type="number" value={zoomInput} onChange={(event) => setZoomInput(event.currentTarget.value)} onBlur={commitZoomInput} onKeyDown={(event) => { if (event.key === "Enter") commitZoomInput(); if (event.key === "Escape") setZoomInput(undefined) }} />
        )}
        <Button title="放大" aria-label="放大" type="button" size="icon-sm" variant="ghost" disabled={disabled} onClick={() => onChange({ ...presentation, manualScale: stepReaderManualScale(presentation.manualScale, 1) })}><ZoomIn /></Button>
        <Button title={`缩放模式：${FIT_MODES.find((mode) => mode.value === presentation.fitMode)?.label}`} aria-label="展开缩放设置" aria-expanded={expanded === "zoom"} type="button" size="icon-sm" variant={expanded === "zoom" ? "default" : "ghost"} disabled={disabled} onClick={() => toggle("zoom")}><CurrentFitIcon /></Button>
        <Separator />
        <div className="flex shrink-0 items-center rounded-full bg-muted/35 p-0.5" aria-label="页面布局">
          <Button title="全景模式" aria-label="全景模式" aria-pressed={layout.panorama} type="button" size="icon-sm" className="rounded-full" variant={layout.panorama ? "default" : "ghost"} disabled={disabled} onClick={() => onLayoutChange({ panorama: !layout.panorama })}><PanelsTopLeft /></Button>
          <Button title={presentation.orientation === "horizontal" ? "横向布局" : "纵向布局"} aria-label="切换横向或纵向布局" aria-pressed={presentation.orientation === "vertical"} type="button" size="icon-sm" className="rounded-full" variant={presentation.orientation === "vertical" ? "default" : "ghost"} disabled={disabled} onClick={() => onChange({ ...presentation, orientation: presentation.orientation === "horizontal" ? "vertical" : "horizontal" })}>{presentation.orientation === "horizontal" ? <ArrowLeftRight /> : <ArrowDownUp />}</Button>
          <Button title={layout.pageMode === "double" ? "双页模式（点击切换为单页）" : "单页模式（点击切换为双页）"} aria-label={layout.pageMode === "double" ? "双页模式" : "单页模式"} aria-pressed={layout.pageMode === "double"} type="button" size="icon-sm" className="rounded-full" variant={layout.pageMode === "double" ? "default" : "ghost"} disabled={disabled} onClick={() => onLayoutChange({ pageMode: layout.pageMode === "double" ? "single" : "double" })}>{layout.pageMode === "double" ? <Columns2 /> : <RectangleVertical />}</Button>
        </div>
        <Button title={direction === "left-to-right" ? "从左到右" : "从右到左"} aria-label="切换阅读方向" aria-pressed={direction === "right-to-left"} type="button" size="icon-sm" variant="ghost" disabled={disabled} onClick={() => onDirectionChange(direction === "left-to-right" ? "right-to-left" : "left-to-right")}>{direction === "left-to-right" ? <ArrowRight /> : <ArrowLeft />}</Button>
        <Button title="旋转设置" aria-label="展开旋转设置" aria-expanded={expanded === "rotate"} type="button" size="icon-sm" variant={expanded === "rotate" ? "default" : "ghost"} disabled={disabled} onClick={() => toggle("rotate")}><RotateCw /></Button>
        <Button
          title={`悬停滚动：${hoverScrollEnabled ? "开" : "关"}（右键设置）`}
          aria-label="悬停滚动"
          aria-pressed={hoverScrollEnabled}
          aria-expanded={expanded === "hover-scroll"}
          type="button"
          size="icon-sm"
          variant={hoverScrollEnabled || expanded === "hover-scroll" ? "default" : "ghost"}
          disabled={disabled || !onHoverScrollChange}
          onClick={() => void onHoverScrollChange?.({ enabled: !hoverScrollEnabled })}
          onContextMenu={(event) => { event.preventDefault(); toggle("hover-scroll") }}
        ><MousePointer2 /></Button>
        <Button title="幻灯片设置" aria-label="展开幻灯片设置" aria-expanded={expanded === "slideshow"} type="button" size="icon-sm" variant={expanded === "slideshow" ? "default" : "ghost"} disabled={disabled} onClick={() => toggle("slideshow")}><Play /></Button>
        <Button title="放大镜尚待迁移" aria-label="放大镜" type="button" size="icon-sm" variant="ghost" disabled><Search /></Button>
      </div>
      {expanded ? (
        <div className="flex min-h-12 flex-wrap items-center justify-center gap-1 overflow-x-auto border-t border-border/50 bg-muted/18 px-3 py-2" data-reader-toolbar-row="expanded" data-reader-toolbar-panel={expanded}>
          {expanded === "zoom" ? <ZoomPanel disabled={disabled} layout={layout} presentation={presentation} onChange={onChange} onLayoutChange={onLayoutChange} /> : null}
          {expanded === "rotate" ? <RotatePanel disabled={disabled} presentation={presentation} onChange={onChange} /> : null}
          {expanded === "hover-scroll" ? <HoverScrollPanel disabled={disabled} enabled={hoverScrollEnabled} speed={hoverScrollSpeed} onChange={onHoverScrollChange} /> : null}
          {expanded === "slideshow" ? <ReaderSlideshowToolbar slideshow={slideshow} disabled={disabled} onChange={onSlideshowChange} /> : null}
        </div>
      ) : null}
    </div>
  )
}

function HoverScrollPanel({ disabled, enabled, speed, onChange }: { disabled?: boolean; enabled: boolean; speed: number; onChange?(patch: { enabled?: boolean; speed?: number }): void | Promise<void> }) {
  const [draftSpeed, setDraftSpeed] = useState(speed)
  const committedSpeedRef = useRef(speed)
  useEffect(() => {
    committedSpeedRef.current = speed
    setDraftSpeed(speed)
  }, [speed])
  const commitSpeed = () => {
    const clamped = Math.max(0.5, Math.min(10, draftSpeed))
    setDraftSpeed(clamped)
    if (clamped !== committedSpeedRef.current) {
      committedSpeedRef.current = clamped
      void onChange?.({ speed: clamped })
    }
  }
  return <>
    <span className="mr-2 text-xs text-muted-foreground">悬停滚动</span>
    <Button type="button" size="sm" className="h-7 px-3" variant={enabled ? "default" : "outline"} aria-pressed={enabled} disabled={disabled || !onChange} onClick={() => void onChange?.({ enabled: !enabled })}>{enabled ? "已启用" : "已禁用"}</Button>
    <Separator />
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      <span>倍率</span>
      <input aria-label="悬停滚动倍率" className="h-1 w-20 cursor-pointer appearance-none rounded-full bg-muted" type="range" min={0.5} max={10} step={0.5} value={draftSpeed} disabled={disabled || !onChange} onChange={(event) => setDraftSpeed(Number(event.currentTarget.value))} onPointerUp={commitSpeed} onKeyUp={commitSpeed} onBlur={commitSpeed} />
      <span className="w-10 text-center tabular-nums">{draftSpeed.toFixed(1)}x</span>
    </label>
  </>
}

function ZoomPanel({ disabled, layout, presentation, onChange, onLayoutChange }: { disabled?: boolean; layout: ReaderLayout; presentation: ReaderPresentation; onChange(value: ReaderPresentation): void; onLayoutChange(patch: Partial<ReaderLayout>): void }) {
  return <>
    <span className="mr-1 text-xs text-muted-foreground">缩放模式</span>
    <div className="flex items-center rounded-full bg-muted/35 p-0.5">{FIT_MODES.map((mode) => {
      const Icon = FIT_MODE_ICONS[mode.value]
      return <Button key={mode.value} title={mode.label} aria-label={mode.label} aria-pressed={presentation.fitMode === mode.value} type="button" size="icon-sm" className="rounded-full" variant={presentation.fitMode === mode.value ? "default" : "ghost"} disabled={disabled} onClick={() => onChange({ ...presentation, fitMode: mode.value, manualScale: 1 })}><Icon /></Button>
    })}</div>
    <Separator />
    <span className="mr-1 text-xs text-muted-foreground">页面布局</span>
    <Button title={`自动分割横向页${layout.splitWidePages ? "（开）" : "（关）"}`} aria-label="自动分割横向页" aria-pressed={layout.splitWidePages ?? false} type="button" size="icon-sm" variant={layout.splitWidePages ? "default" : "ghost"} disabled={disabled} onClick={() => onLayoutChange({ splitWidePages: !(layout.splitWidePages ?? false) })}><SplitSquareHorizontal /></Button>
    <Button title="横向页视为双页" aria-label="横向页视为双页" aria-pressed={layout.treatWidePageAsSingle} type="button" size="icon-sm" variant={layout.treatWidePageAsSingle ? "default" : "ghost"} disabled={disabled} onClick={() => onLayoutChange({ treatWidePageAsSingle: !layout.treatWidePageAsSingle })}><Rows2 /></Button>
    <Separator />
    <span className="mr-1 text-xs text-muted-foreground">双页独立</span>
    <Button title="首页独立显示" aria-label="首页独立显示" aria-pressed={layout.singleFirstPage} type="button" size="icon-sm" variant={layout.singleFirstPage ? "default" : "ghost"} disabled={disabled} onClick={() => onLayoutChange({ singleFirstPage: !layout.singleFirstPage })}><SquareChevronLeft /></Button>
    <Button title="尾页独立显示" aria-label="尾页独立显示" aria-pressed={layout.singleLastPage} type="button" size="icon-sm" variant={layout.singleLastPage ? "default" : "ghost"} disabled={disabled} onClick={() => onLayoutChange({ singleLastPage: !layout.singleLastPage })}><SquareChevronRight /></Button>
    <Separator />
    <span className="mr-1 text-xs text-muted-foreground">宽页策略</span>
    <Button title="无对齐（保持原始比例）" aria-label="无对齐" aria-pressed={presentation.widePageStretch === "none"} type="button" size="icon-sm" variant={presentation.widePageStretch === "none" ? "default" : "ghost"} disabled={disabled} onClick={() => onChange({ ...presentation, widePageStretch: "none" })}><Equal /></Button>
    <Button title="高度对齐（双页高度统一）" aria-label="双页高度统一" aria-pressed={presentation.widePageStretch === "uniform-height"} type="button" size="icon-sm" variant={presentation.widePageStretch === "uniform-height" ? "default" : "ghost"} disabled={disabled} onClick={() => onChange({ ...presentation, widePageStretch: "uniform-height" })}><AlignVerticalSpaceAround /></Button>
    <Button title="宽度对齐（双页宽度统一）" aria-label="双页宽度统一" aria-pressed={presentation.widePageStretch === "uniform-width"} type="button" size="icon-sm" variant={presentation.widePageStretch === "uniform-width" ? "default" : "ghost"} disabled={disabled} onClick={() => onChange({ ...presentation, widePageStretch: "uniform-width" })}><AlignHorizontalSpaceAround /></Button>
    <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => onChange({ ...DEFAULT_READER_PRESENTATION })}>重置视图</Button>
  </>
}

const AUTO_ROTATIONS: Array<{ value: ReaderAutoRotation; label: string; icon: "ban" | "left" | "right" }> = [
  { value: "none", label: "关闭自动旋转", icon: "ban" },
  { value: "left", label: "纵向页左旋", icon: "left" },
  { value: "right", label: "纵向页右旋", icon: "right" },
]

const LANDSCAPE_ROTATIONS: Array<{ value: ReaderAutoRotation; label: string; className: string }> = [
  { value: "horizontal-left", label: "横屏左旋 90°", className: "-rotate-90" },
  { value: "horizontal-right", label: "横屏右旋 90°", className: "rotate-90" },
]

const FORCED_ROTATIONS: Array<{ value: ReaderAutoRotation; label: string; icon: typeof RotateCw }> = [
  { value: "forced-left", label: "始终左旋 90°", icon: RotateCcw },
  { value: "forced-right", label: "始终右旋 90°", icon: RotateCw },
]

function RotatePanel({ disabled, presentation, onChange }: { disabled?: boolean; presentation: ReaderPresentation; onChange(value: ReaderPresentation): void }) {
  return <>
    <span className="mr-1 text-xs text-muted-foreground">手动旋转 {presentation.rotation}°</span>
    <Button title="顺时针旋转 90°" aria-label="顺时针旋转 90°" type="button" size="icon-sm" variant="ghost" disabled={disabled} onClick={() => onChange({ ...presentation, rotation: rotateReaderPresentation(presentation.rotation, 1) })}><RotateCw /></Button>
    <Separator />
    <span className="mr-1 text-xs text-muted-foreground">自动旋转</span>
    <div className="flex items-center rounded-full bg-muted/35 p-0.5">{AUTO_ROTATIONS.map((mode) => <Button key={mode.value} title={mode.label} aria-label={mode.label} aria-pressed={presentation.autoRotation === mode.value} type="button" size="icon-sm" className="rounded-full" variant={presentation.autoRotation === mode.value ? "default" : "ghost"} disabled={disabled} onClick={() => onChange({ ...presentation, autoRotation: mode.value })}>{mode.icon === "ban" ? <Ban /> : mode.icon === "left" ? <RotateCcw /> : <RotateCw />}</Button>)}</div>
    <Separator />
    <span className="mr-1 text-xs text-muted-foreground">横屏</span>
    <div className="flex items-center rounded-full bg-muted/35 p-0.5">{LANDSCAPE_ROTATIONS.map((mode) => <Button key={mode.value} title={mode.label} aria-label={mode.label} aria-pressed={presentation.autoRotation === mode.value} type="button" size="icon-sm" className="rounded-full" variant={presentation.autoRotation === mode.value ? "default" : "ghost"} disabled={disabled} onClick={() => onChange({ ...presentation, autoRotation: mode.value })}><Smartphone className={mode.className} /></Button>)}</div>
    <Separator />
    <span className="mr-1 text-xs text-muted-foreground">强制</span>
    <div className="flex items-center rounded-full bg-muted/35 p-0.5">{FORCED_ROTATIONS.map((mode) => { const Icon = mode.icon; return <Button key={mode.value} title={mode.label} aria-label={mode.label} aria-pressed={presentation.autoRotation === mode.value} type="button" size="icon-sm" className="rounded-full" variant={presentation.autoRotation === mode.value ? "default" : "ghost"} disabled={disabled} onClick={() => onChange({ ...presentation, autoRotation: mode.value })}><Icon /></Button> })}</div>
  </>
}

function Separator() {
  return <span className="mx-1 h-5 w-px shrink-0 bg-border/70" aria-hidden="true" />
}

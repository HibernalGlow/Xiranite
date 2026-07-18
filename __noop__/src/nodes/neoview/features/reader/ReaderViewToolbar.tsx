/**
 * @migrated-from src/lib/components/layout/TopToolbar/ZoomPanel.svelte
 * @source-hash sha256:c099c03c7b5ea915f60bd4aad42a9919776bf8f136001552fea4680068337b9a
 * @migrated-from src/lib/components/layout/TopToolbar/RotatePanel.svelte
 * @source-hash sha256:c823ae6af0f8659ac7cccdaaa2eedfbbb8c8be5088b5148288bb57f3caf4acb5
 * @features panels-toolbar-shell
 * @migration-status adapted
 */
import { useState } from "react"
import { ArrowDownUp, Columns2, Maximize2, MousePointer2, Play, RotateCcw, RotateCw, Search, Square, ZoomIn, ZoomOut } from "lucide-react"
import {
  DEFAULT_READER_PRESENTATION,
  rotateReaderPresentation,
  stepReaderManualScale,
  type ReaderFitMode,
  type ReaderPresentation,
  type ReaderSlideshow,
} from "@xiranite/node-neoview/ui-core"

import { Button } from "@/components/ui/button"
import type { ReaderSlideshowPatch } from "../../adapters/reader-http-client"
import { ReaderSlideshowToolbar } from "./ReaderSlideshowToolbar"

const FIT_MODES: Array<{ value: ReaderFitMode; label: string }> = [
  { value: "fit", label: "适应窗口" },
  { value: "fill", label: "填满窗口" },
  { value: "fit-width", label: "适应宽度" },
  { value: "fit-height", label: "适应高度" },
  { value: "original", label: "原始大小" },
]

export function ReaderViewToolbar({
  disabled,
  pageMode,
  presentation,
  onChange,
  onPageModeChange,
  slideshow,
  onSlideshowChange,
}: {
  disabled?: boolean
  pageMode: "single" | "double"
  presentation: ReaderPresentation
  onChange(presentation: ReaderPresentation): void
  onPageModeChange(pageMode: "single" | "double"): void
  slideshow: ReaderSlideshow
  onSlideshowChange(patch: ReaderSlideshowPatch["slideshow"]): void | Promise<void>
}) {
  const [expanded, setExpanded] = useState<"zoom" | "rotate" | "slideshow" | null>(null)

  function toggle(panel: NonNullable<typeof expanded>) {
    setExpanded((current) => current === panel ? null : panel)
  }

  return (
    <div className="xiranite-app-region-no-drag min-w-0" data-reader-view-toolbar="true">
      <div className="flex min-h-12 min-w-0 items-center justify-start gap-1 overflow-x-auto px-3 py-1.5 sm:justify-center" data-reader-toolbar-row="primary">
        <Button title="页面排序尚待共享契约" aria-label="页面排序" type="button" size="icon-sm" variant="ghost" disabled><ArrowDownUp /></Button>
        <span className="mx-1 h-5 w-px shrink-0 bg-border/70" aria-hidden="true" />
        <Button title="缩小" aria-label="缩小" type="button" size="icon-sm" variant="ghost" disabled={disabled} onClick={() => onChange({ ...presentation, manualScale: stepReaderManualScale(presentation.manualScale, -1) })}><ZoomOut /></Button>
        <Button title="重置为 100%" aria-label="重置为 100%" type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => onChange({ ...presentation, manualScale: 1 })}><span className="w-10 text-[11px] tabular-nums">{Math.round(presentation.manualScale * 100)}%</span></Button>
        <Button title="放大" aria-label="放大" type="button" size="icon-sm" variant="ghost" disabled={disabled} onClick={() => onChange({ ...presentation, manualScale: stepReaderManualScale(presentation.manualScale, 1) })}><ZoomIn /></Button>
        <Button title="缩放模式" aria-label="展开缩放设置" aria-expanded={expanded === "zoom"} type="button" size="icon-sm" variant={expanded === "zoom" ? "default" : "ghost"} disabled={disabled} onClick={() => toggle("zoom")}><Maximize2 /></Button>
        <span className="mx-1 h-5 w-px shrink-0 bg-border/70" aria-hidden="true" />
        <div className="flex shrink-0 items-center rounded-full bg-muted/35 p-0.5" aria-label="页面模式">
          <Button title="单页模式" aria-label="单页模式" aria-pressed={pageMode === "single"} type="button" size="icon-sm" className="rounded-full" variant={pageMode === "single" ? "default" : "ghost"} disabled={disabled} onClick={() => onPageModeChange("single")}><Square /></Button>
          <Button title="双页模式" aria-label="双页模式" aria-pressed={pageMode === "double"} type="button" size="icon-sm" className="rounded-full" variant={pageMode === "double" ? "default" : "ghost"} disabled={disabled} onClick={() => onPageModeChange("double")}><Columns2 /></Button>
        </div>
        <Button title="旋转设置" aria-label="展开旋转设置" aria-expanded={expanded === "rotate"} type="button" size="icon-sm" variant={expanded === "rotate" ? "default" : "ghost"} disabled={disabled} onClick={() => toggle("rotate")}><RotateCw /></Button>
        <Button title="悬停滚动尚待共享契约" aria-label="悬停滚动" type="button" size="icon-sm" variant="ghost" disabled><MousePointer2 /></Button>
        <Button title="幻灯片设置" aria-label="展开幻灯片设置" aria-expanded={expanded === "slideshow"} type="button" size="icon-sm" variant={expanded === "slideshow" ? "default" : "ghost"} disabled={disabled} onClick={() => toggle("slideshow")}><Play /></Button>
        <Button title="放大镜尚待共享契约" aria-label="放大镜" type="button" size="icon-sm" variant="ghost" disabled><Search /></Button>
      </div>
      {expanded ? (
        <div className="flex min-h-12 items-center justify-center gap-2 overflow-x-auto border-t border-border/50 bg-muted/18 px-3 py-2" data-reader-toolbar-row="expanded" data-reader-toolbar-panel={expanded}>
          {expanded === "zoom" ? (
            <>
              <span className="shrink-0 text-xs text-muted-foreground">缩放模式</span>
              <label className="sr-only" htmlFor="neoview-fit-mode">缩放模式</label>
              <select id="neoview-fit-mode" aria-label="缩放模式" className="h-8 w-28 shrink-0 rounded-md border border-border/65 bg-background px-2 text-xs" disabled={disabled} value={presentation.fitMode} onChange={(event) => onChange({ ...presentation, fitMode: event.currentTarget.value as ReaderFitMode, manualScale: 1 })}>
                {FIT_MODES.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
              </select>
              <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => onChange({ ...DEFAULT_READER_PRESENTATION })}>重置视图</Button>
            </>
          ) : null}
          {expanded === "rotate" ? (
            <>
              <span className="shrink-0 text-xs text-muted-foreground">旋转 {presentation.rotation}°</span>
              <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => onChange({ ...presentation, rotation: rotateReaderPresentation(presentation.rotation, -1) })}><RotateCcw />逆时针</Button>
              <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => onChange({ ...presentation, rotation: rotateReaderPresentation(presentation.rotation, 1) })}><RotateCw />顺时针</Button>
              <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => onChange({ ...presentation, rotation: 0 })}>归零</Button>
            </>
          ) : null}
          {expanded === "slideshow" ? <ReaderSlideshowToolbar slideshow={slideshow} disabled={disabled} onChange={onSlideshowChange} /> : null}
        </div>
      ) : null}
    </div>
  )
}

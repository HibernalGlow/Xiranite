/**
 * @migrated-from src/lib/components/layout/TopToolbar/ZoomPanel.svelte
 * @source-hash sha256:c099c03c7b5ea915f60bd4aad42a9919776bf8f136001552fea4680068337b9a
 * @migrated-from src/lib/components/layout/TopToolbar/RotatePanel.svelte
 * @source-hash sha256:c823ae6af0f8659ac7cccdaaa2eedfbbb8c8be5088b5148288bb57f3caf4acb5
 * @features panels-toolbar-shell
 * @migration-status adapted
 */
import { Columns2, Maximize2, RotateCcw, RotateCw, Square, ZoomIn, ZoomOut } from "lucide-react"
import {
  DEFAULT_READER_PRESENTATION,
  rotateReaderPresentation,
  stepReaderManualScale,
  type ReaderFitMode,
  type ReaderPresentation,
  type ReaderSlideshow,
} from "@xiranite/node-neoview/core"

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
  return (
    <div className="xiranite-app-region-no-drag flex min-w-0 items-center gap-1 overflow-x-auto border-t border-border/60 px-3 py-1.5" data-reader-view-toolbar="true">
      <label className="sr-only" htmlFor="neoview-fit-mode">缩放模式</label>
      <select
        id="neoview-fit-mode"
        aria-label="缩放模式"
        className="h-7 w-24 shrink-0 rounded border border-border bg-background px-1.5 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        disabled={disabled}
        value={presentation.fitMode}
        onChange={(event) => onChange({ ...presentation, fitMode: event.currentTarget.value as ReaderFitMode, manualScale: 1 })}
      >
        {FIT_MODES.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
      </select>
      <Button title="缩小" aria-label="缩小" type="button" size="icon-xs" variant="ghost" disabled={disabled} onClick={() => onChange({ ...presentation, manualScale: stepReaderManualScale(presentation.manualScale, -1) })}><ZoomOut /></Button>
      <output className="w-11 shrink-0 text-center text-[11px] tabular-nums text-muted-foreground" aria-label="手动缩放比例">{Math.round(presentation.manualScale * 100)}%</output>
      <Button title="放大" aria-label="放大" type="button" size="icon-xs" variant="ghost" disabled={disabled} onClick={() => onChange({ ...presentation, manualScale: stepReaderManualScale(presentation.manualScale, 1) })}><ZoomIn /></Button>
      <span className="mx-1 h-4 w-px shrink-0 bg-border" aria-hidden="true" />
      <Button title="逆时针旋转 90 度" aria-label="逆时针旋转 90 度" type="button" size="icon-xs" variant="ghost" disabled={disabled} onClick={() => onChange({ ...presentation, rotation: rotateReaderPresentation(presentation.rotation, -1) })}><RotateCcw /></Button>
      <Button title="顺时针旋转 90 度" aria-label="顺时针旋转 90 度" type="button" size="icon-xs" variant="ghost" disabled={disabled} onClick={() => onChange({ ...presentation, rotation: rotateReaderPresentation(presentation.rotation, 1) })}><RotateCw /></Button>
      <Button title="重置视图" aria-label="重置视图" type="button" size="icon-xs" variant="ghost" disabled={disabled} onClick={() => onChange({ ...DEFAULT_READER_PRESENTATION })}><Maximize2 /></Button>
      <span className="mx-1 h-4 w-px shrink-0 bg-border" aria-hidden="true" />
      <div className="flex shrink-0 items-center rounded border border-border bg-muted/45 p-0.5" aria-label="页面模式">
        <Button title="单页模式" aria-label="单页模式" aria-pressed={pageMode === "single"} type="button" size="icon-xs" variant={pageMode === "single" ? "default" : "ghost"} disabled={disabled} onClick={() => onPageModeChange("single")}><Square /></Button>
        <Button title="双页模式" aria-label="双页模式" aria-pressed={pageMode === "double"} type="button" size="icon-xs" variant={pageMode === "double" ? "default" : "ghost"} disabled={disabled} onClick={() => onPageModeChange("double")}><Columns2 /></Button>
      </div>
      <span className="mx-1 h-4 w-px shrink-0 bg-border" aria-hidden="true" />
      <ReaderSlideshowToolbar slideshow={slideshow} disabled={disabled} onChange={onSlideshowChange} />
    </div>
  )
}

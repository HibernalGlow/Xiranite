import { Gauge, Maximize, Pause, Pin, PinOff, Play, Repeat, Repeat1 } from "lucide-react"
import { useEffect, useState, type RefObject } from "react"

import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Slider } from "@/components/ui/slider"
import { cn } from "@/lib/utils"
import type { ReaderVideoController, ReaderVideoSnapshot } from "./ReaderVideoController"
import { formatVideoTime } from "./ReaderVideoPlayerUtils"

export function ReaderAnimatedImageControlOverlay({
  controller,
  snapshot,
  containerRef,
  visible,
  pinned,
  onPinnedChange,
  onOpenChange,
}: {
  controller: ReaderVideoController
  snapshot: ReaderVideoSnapshot
  containerRef: RefObject<HTMLElement | null>
  visible: boolean
  pinned: boolean
  onPinnedChange(pinned: boolean): void
  onOpenChange(open: boolean): void
}) {
  const [rateOpen, setRateOpen] = useState(false)
  const shown = visible || rateOpen
  const loopLabel = snapshot.loopMode === "single" ? "单个循环" : snapshot.loopMode === "list" ? "列表循环" : "不循环"
  const duration = Math.max(0, snapshot.duration)
  const currentTime = Math.min(snapshot.currentTime, duration || snapshot.currentTime)

  useEffect(() => onOpenChange(rateOpen), [onOpenChange, rateOpen])

  async function toggleFullscreen(): Promise<void> {
    const container = containerRef.current
    if (!container) return
    if (document.fullscreenElement) await document.exitFullscreen()
    else await container.requestFullscreen()
  }

  return (
    <div
      className={cn(
        "absolute inset-x-0 bottom-0 z-50 bg-gradient-to-t from-black/90 via-black/65 to-transparent p-3 text-white transition-opacity sm:p-4 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100",
        shown ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
      )}
      data-reader-animated-video-controls="true"
      data-reader-edge-trigger-exclusion={shown ? "bottom" : undefined}
      role="group"
      aria-label="动图视频控制栏"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <Slider
        aria-label="动图进度"
        value={[currentTime]}
        min={0}
        max={Math.max(0.01, duration)}
        step={0.01}
        onValueChange={([value]) => controller.seekTo(value ?? 0)}
        className="mb-3 [&_[data-slot=slider-track]]:bg-white/30"
      />
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:gap-2">
        <ControlButton label={snapshot.playing ? "暂停" : "播放"} onClick={() => controller.playPause()}>
          {snapshot.playing ? <Pause /> : <Play />}
        </ControlButton>
        <ControlButton label={loopLabel} active={snapshot.loopMode !== "none"} onClick={() => controller.cycleLoopMode()}>
          {snapshot.loopMode === "single" ? <Repeat1 /> : <Repeat />}
        </ControlButton>
        <span className="px-1 text-xs tabular-nums text-white/85">
          {formatVideoTime(currentTime)} / {formatVideoTime(duration)}
        </span>
        <span className="min-w-0 flex-1" />
        <Popover open={rateOpen} onOpenChange={setRateOpen}>
          <PopoverTrigger asChild>
            <Button type="button" size="sm" variant="ghost" className="gap-1 text-white hover:bg-white/20 hover:text-white" aria-label="倍速控制">
              <Gauge /><span className="text-xs tabular-nums">{snapshot.playbackRate.toFixed(2)}x</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent side="top" align="end" className="w-64">
            <div className="flex flex-col gap-3">
              <Slider
                aria-label="视频倍速"
                value={[snapshot.playbackRate]}
                min={snapshot.minimumPlaybackRate}
                max={snapshot.maximumPlaybackRate}
                step={snapshot.playbackRateStep}
                onValueChange={([value]) => controller.setPlaybackRate(value ?? 1)}
              />
            </div>
          </PopoverContent>
        </Popover>
        <ControlButton label={pinned ? "取消固定控件" : "固定控件"} active={pinned} onClick={() => onPinnedChange(!pinned)}>
          {pinned ? <Pin /> : <PinOff />}
        </ControlButton>
        <ControlButton label="全屏" onClick={() => void toggleFullscreen()}><Maximize /></ControlButton>
      </div>
    </div>
  )
}

function ControlButton({ label, active = false, onClick, children }: {
  label: string
  active?: boolean
  onClick(): void
  children: React.ReactNode
}) {
  return <Button type="button" size="icon-sm" variant={active ? "secondary" : "ghost"} className="shrink-0 text-white hover:bg-white/20 hover:text-white" aria-label={label} title={label} onClick={onClick}>{children}</Button>
}

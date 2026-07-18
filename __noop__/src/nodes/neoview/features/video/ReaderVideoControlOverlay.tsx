import {
  Camera,
  Captions,
  CaptionsOff,
  FastForward,
  Gauge,
  Maximize,
  MoreVertical,
  Pause,
  PictureInPicture2,
  Pin,
  PinOff,
  Play,
  Repeat,
  Repeat1,
  RotateCcw,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react"
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react"

import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Slider } from "@/components/ui/slider"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"
import type { ReaderSubtitleConfigDto, ReaderSubtitleTrackDto } from "../../adapters/reader-http-client"
import type { ReaderVideoController, ReaderVideoSnapshot } from "./ReaderVideoController"
import {
  captureVideoScreenshot,
  downloadVideoScreenshot,
  formatVideoTime,
  ReaderVideoFrameCache,
} from "./ReaderVideoPlayerUtils"

interface VideoFilterState {
  brightness: number
  contrast: number
  saturation: number
}

export function ReaderVideoControlOverlay({
  controller,
  snapshot,
  videoRef,
  pageName,
  sourceUrl,
  subtitleTracks,
  selectedSubtitleId,
  onSelectedSubtitleId,
  subtitleConfig,
  onSubtitleConfigChange,
  visible,
  pinned,
  onPinnedChange,
  onOpenChange,
}: {
  controller: ReaderVideoController
  snapshot: ReaderVideoSnapshot
  videoRef: RefObject<HTMLVideoElement | null>
  pageName: string
  sourceUrl: string
  subtitleTracks: readonly ReaderSubtitleTrackDto[]
  selectedSubtitleId?: string
  onSelectedSubtitleId(id: string | undefined): void
  subtitleConfig: ReaderSubtitleConfigDto
  onSubtitleConfigChange?: (patch: Partial<ReaderSubtitleConfigDto>) => Promise<void>
  visible: boolean
  pinned: boolean
  onPinnedChange(pinned: boolean): void
  onOpenChange(open: boolean): void
}) {
  const [volumeOpen, setVolumeOpen] = useState(false)
  const [rateOpen, setRateOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [subtitleOpen, setSubtitleOpen] = useState(false)
  const [subtitleDraft, setSubtitleDraft] = useState(subtitleConfig)
  const [previewVisible, setPreviewVisible] = useState(false)
  const [previewTime, setPreviewTime] = useState(0)
  const [previewLeft, setPreviewLeft] = useState(0)
  const [abLoop, setAbLoop] = useState<{ a?: number; b?: number }>({})
  const [filter, setFilter] = useState<VideoFilterState>({ brightness: 100, contrast: 100, saturation: 100 })
  const progressRef = useRef<HTMLDivElement>(null)
  const previewCanvasRef = useRef<HTMLCanvasElement>(null)
  const [frameCache] = useState(() => new ReaderVideoFrameCache())
  const anyPanelOpen = volumeOpen || rateOpen || moreOpen || subtitleOpen
  const shown = visible || anyPanelOpen

  useEffect(() => onOpenChange(anyPanelOpen), [anyPanelOpen, onOpenChange])
  useEffect(() => { if (!subtitleOpen) setSubtitleDraft(subtitleConfig) }, [subtitleConfig, subtitleOpen])
  useEffect(() => () => frameCache.clear(), [frameCache, sourceUrl])
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const loop = () => {
      if (abLoop.a !== undefined && abLoop.b !== undefined && video.currentTime >= abLoop.b) {
        video.currentTime = abLoop.a
      }
    }
    video.addEventListener("timeupdate", loop)
    return () => video.removeEventListener("timeupdate", loop)
  }, [abLoop.a, abLoop.b, videoRef])
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.style.filter = `brightness(${filter.brightness}%) contrast(${filter.contrast}%) saturate(${filter.saturation}%)`
    return () => { video.style.filter = "" }
  }, [filter, videoRef])

  const duration = Math.max(0, snapshot.duration)
  const currentTime = Math.min(snapshot.currentTime, duration || snapshot.currentTime)
  const loopLabel = snapshot.loopMode === "single" ? "单个循环" : snapshot.loopMode === "list" ? "列表循环" : "不循环"

  function preview(event: ReactPointerEvent<HTMLDivElement>): void {
    const progress = progressRef.current
    const canvas = previewCanvasRef.current
    if (!progress || !canvas || duration <= 0) return
    const rect = progress.getBoundingClientRect()
    const left = Math.max(0, Math.min(rect.width, event.clientX - rect.left))
    const time = left / Math.max(1, rect.width) * duration
    setPreviewLeft(left)
    setPreviewTime(time)
    setPreviewVisible(true)
    frameCache.generate(time, sourceUrl, canvas)
  }

  async function screenshot(): Promise<void> {
    const video = videoRef.current
    if (!video) return
    const blob = await captureVideoScreenshot(video)
    if (blob) downloadVideoScreenshot(blob, video.currentTime)
  }

  async function togglePictureInPicture(): Promise<void> {
    const video = videoRef.current
    if (!video || !document.pictureInPictureEnabled) return
    if (document.pictureInPictureElement) await document.exitPictureInPicture()
    else await video.requestPictureInPicture()
  }

  async function toggleFullscreen(): Promise<void> {
    const video = videoRef.current
    if (!video) return
    if (document.fullscreenElement) await document.exitFullscreen()
    else await video.requestFullscreen()
  }

  return (
    <div
      className={cn(
        "absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/65 to-transparent p-3 text-white transition-opacity sm:p-4 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100",
        shown ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
      )}
      data-reader-video-controls="true"
      role="group"
      aria-label="视频控制栏"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div
        ref={progressRef}
        className="relative mb-3"
        onPointerMove={preview}
        onPointerLeave={() => setPreviewVisible(false)}
      >
        <Slider
          aria-label="视频进度"
          value={[currentTime]}
          min={0}
          max={Math.max(0.1, duration)}
          step={0.1}
          onValueChange={([value]) => controller.seekTo(value ?? 0)}
          className="[&_[data-slot=slider-track]]:bg-white/30"
        />
        {previewVisible && duration > 0 ? (
          <div
            className="pointer-events-none absolute bottom-full mb-3 -translate-x-1/2"
            style={{ left: Math.max(80, Math.min(previewLeft, (progressRef.current?.clientWidth ?? 160) - 80)) }}
          >
            <canvas ref={previewCanvasRef} width={160} height={90} className="block min-h-16 w-40 rounded border border-white/20 bg-black shadow-lg" />
            <div className="mt-1 rounded bg-black/80 px-2 py-0.5 text-center text-xs">{formatVideoTime(previewTime)}</div>
          </div>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:gap-2">
        <ControlButton label={snapshot.playing ? "暂停" : "播放"} onClick={() => controller.playPause()}>
          {snapshot.playing ? <Pause /> : <Play />}
        </ControlButton>
        <ControlButton label="后退10秒" onClick={() => controller.seek(-1)}><SkipBack /></ControlButton>
        <ControlButton label="前进10秒" onClick={() => controller.seek(1)}><SkipForward /></ControlButton>
        <ControlButton label={loopLabel} active={snapshot.loopMode !== "none"} onClick={() => controller.cycleLoopMode()}>
          {snapshot.loopMode === "single" ? <Repeat1 /> : <Repeat />}
        </ControlButton>

        <Popover open={moreOpen} onOpenChange={setMoreOpen}>
          <PopoverTrigger asChild><Button type="button" size="icon-sm" variant="ghost" className="shrink-0 text-white hover:bg-white/20 hover:text-white" aria-label="更多视频操作"><MoreVertical /></Button></PopoverTrigger>
          <PopoverContent side="top" align="start" className="w-72">
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => void screenshot()}><Camera data-icon="inline-start" />截图</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setFilter({ brightness: 100, contrast: 100, saturation: 100 })}><RotateCcw data-icon="inline-start" />重置滤镜</Button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Button type="button" size="sm" variant={abLoop.a === undefined ? "outline" : "secondary"} onClick={() => setAbLoop((current) => ({ ...current, a: snapshot.currentTime, b: current.b && current.b > snapshot.currentTime ? current.b : undefined }))}>A{abLoop.a === undefined ? "" : ` ${formatVideoTime(abLoop.a)}`}</Button>
                <Button type="button" size="sm" variant={abLoop.b === undefined ? "outline" : "secondary"} disabled={abLoop.a === undefined || snapshot.currentTime <= abLoop.a} onClick={() => setAbLoop((current) => ({ ...current, b: snapshot.currentTime }))}>B{abLoop.b === undefined ? "" : ` ${formatVideoTime(abLoop.b)}`}</Button>
                <Button type="button" size="sm" variant="ghost" disabled={abLoop.a === undefined && abLoop.b === undefined} onClick={() => setAbLoop({})}>清除</Button>
              </div>
              <div className="flex flex-col gap-3 border-t pt-3">
                <SliderField label="亮度" value={filter.brightness} onChange={(brightness) => setFilter((current) => ({ ...current, brightness }))} />
                <SliderField label="对比度" value={filter.contrast} onChange={(contrast) => setFilter((current) => ({ ...current, contrast }))} />
                <SliderField label="饱和度" value={filter.saturation} onChange={(saturation) => setFilter((current) => ({ ...current, saturation }))} />
              </div>
              <div className="border-t pt-3 text-xs text-muted-foreground">
                <p className="truncate text-foreground">{pageName}</p>
                <p>{formatVideoTime(duration)} · {videoRef.current?.videoWidth ?? 0}×{videoRef.current?.videoHeight ?? 0} · {snapshot.playbackRate.toFixed(2)}x</p>
              </div>
            </div>
          </PopoverContent>
        </Popover>

        <span className="px-1 text-xs tabular-nums text-white/85">
          {formatVideoTime(currentTime)} / {formatVideoTime(duration)}
        </span>
        <span className="min-w-0 flex-1" />

        <Popover open={volumeOpen} onOpenChange={setVolumeOpen}>
          <PopoverTrigger asChild>
            <Button type="button" size="sm" variant="ghost" className="gap-1 text-white hover:bg-white/20 hover:text-white" aria-label="音量控制">
              {snapshot.muted || snapshot.volume === 0 ? <VolumeX /> : <Volume2 />}
              <span className="text-xs tabular-nums">{Math.round(snapshot.volume * 100)}%</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent side="top" align="end" className="w-52">
            <div className="flex items-center gap-3">
              <Button type="button" size="icon-sm" variant="ghost" aria-label={snapshot.muted ? "取消静音" : "静音"} onClick={() => controller.toggleMute()}>
                {snapshot.muted ? <VolumeX /> : <Volume2 />}
              </Button>
              <Slider aria-label="视频音量" value={[snapshot.volume]} min={0} max={1} step={0.05} onValueChange={([value]) => controller.setVolume(value ?? 0)} />
            </div>
          </PopoverContent>
        </Popover>

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
              <ToggleGroup type="single" value={String(snapshot.playbackRate)} onValueChange={(value) => value && controller.setPlaybackRate(Number(value))} size="sm" className="grid grid-cols-4">
                {[0.5, 1, 1.5, 2].map((rate) => <ToggleGroupItem key={rate} value={String(rate)}>{rate}x</ToggleGroupItem>)}
              </ToggleGroup>
            </div>
          </PopoverContent>
        </Popover>

        <ControlButton label={snapshot.seekMode ? "关闭快进模式" : "开启快进模式"} active={snapshot.seekMode} onClick={() => controller.toggleSeekMode()}><FastForward /></ControlButton>
        <Popover open={subtitleOpen} onOpenChange={setSubtitleOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              variant={selectedSubtitleId ? "secondary" : "ghost"}
              className="shrink-0 text-white hover:bg-white/20 hover:text-white"
              aria-label={selectedSubtitleId ? "更换字幕" : "选择字幕"}
              title={selectedSubtitleId ? `字幕: ${subtitleTracks.find((track) => track.id === selectedSubtitleId)?.name ?? "自动"}` : "选择字幕"}
            >
              {selectedSubtitleId ? <Captions /> : <CaptionsOff />}
            </Button>
          </PopoverTrigger>
          <PopoverContent side="top" align="end" className="w-72">
            <div className="flex flex-col gap-3" role="dialog" aria-label="字幕设置">
              <div className="text-sm font-medium">字幕设置</div>
              <ToggleGroup type="single" value={selectedSubtitleId ?? "off"} onValueChange={(value) => onSelectedSubtitleId(value && value !== "off" ? value : undefined)} size="sm" className="flex flex-wrap justify-start">
                <ToggleGroupItem value="off">关闭</ToggleGroupItem>
                {subtitleTracks.map((track) => <ToggleGroupItem key={track.id} value={track.id} className="max-w-full truncate">{track.name}</ToggleGroupItem>)}
              </ToggleGroup>
              {!subtitleTracks.length ? <p className="text-xs text-muted-foreground">未发现同名字幕</p> : null}
              <SubtitleSlider label="字体大小" value={subtitleDraft.fontSize} min={0.5} max={3} step={0.1} suffix="em" onChange={(fontSize) => setSubtitleDraft((current) => ({ ...current, fontSize }))} />
              <SubtitleSlider label="底部距离" value={subtitleDraft.bottomPercent} min={0} max={30} step={1} suffix="%" onChange={(bottomPercent) => setSubtitleDraft((current) => ({ ...current, bottomPercent }))} />
              <div className="flex flex-col gap-2">
                <span className="text-xs text-muted-foreground">字幕颜色</span>
                <div className="flex gap-2">
                  {["#ffffff", "#ffff00", "#00ff00", "#00ffff", "#ff9900"].map((color) => (
                    <button key={color} type="button" className={cn("size-6 rounded border-2", subtitleDraft.color === color ? "border-primary" : "border-transparent")} style={{ backgroundColor: color }} aria-label={`字幕颜色 ${color}`} onClick={() => setSubtitleDraft((current) => ({ ...current, color }))} />
                  ))}
                </div>
              </div>
              <SubtitleSlider label="背景透明度" value={subtitleDraft.backgroundOpacity} min={0} max={1} step={0.1} suffix="%" display={(value) => Math.round(value * 100)} onChange={(backgroundOpacity) => setSubtitleDraft((current) => ({ ...current, backgroundOpacity }))} />
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => setSubtitleDraft({ fontSize: 1, color: "#ffffff", backgroundOpacity: 0.7, bottomPercent: 5 })}>重置</Button>
                <Button type="button" size="sm" onClick={() => { void onSubtitleConfigChange?.(subtitleDraft); setSubtitleOpen(false) }}>保存</Button>
              </div>
              <Button type="button" size="sm" variant="outline" onClick={() => setSubtitleDraft({ fontSize: 1.5, color: "#ffff00", backgroundOpacity: 0.8, bottomPercent: 8 })}>大号黄色</Button>
            </div>
          </PopoverContent>
        </Popover>
        <ControlButton label={pinned ? "取消固定控件" : "固定控件"} active={pinned} onClick={() => onPinnedChange(!pinned)}>
          {pinned ? <Pin /> : <PinOff />}
        </ControlButton>
        <ControlButton label="画中画" onClick={() => void togglePictureInPicture()}><PictureInPicture2 /></ControlButton>
        <ControlButton label="全屏" onClick={() => void toggleFullscreen()}><Maximize /></ControlButton>

      </div>
    </div>
  )
}

function ControlButton({ label, active = false, disabled = false, onClick, children }: {
  label: string
  active?: boolean
  disabled?: boolean
  onClick?: () => void
  children: ReactNode
}) {
  return <Button type="button" size="icon-sm" variant={active ? "secondary" : "ghost"} disabled={disabled} className={cn("shrink-0 text-white hover:bg-white/20 hover:text-white", disabled && "opacity-45")} aria-label={label} title={label} onClick={onClick}>{children}</Button>
}

function SliderField({ label, value, onChange }: { label: string; value: number; onChange(value: number): void }) {
  return (
    <label className="grid grid-cols-[4rem_minmax(0,1fr)_3rem] items-center gap-2 text-xs">
      <span>{label}</span>
      <Slider aria-label={label} value={[value]} min={0} max={200} step={5} onValueChange={([next]) => onChange(next ?? 100)} />
      <span className="text-right tabular-nums text-muted-foreground">{value}%</span>
    </label>
  )
}

function SubtitleSlider({ label, value, min, max, step, suffix, display = (current) => current, onChange }: {
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix: string
  display?: (value: number) => number
  onChange(value: number): void
}) {
  return (
    <label className="grid grid-cols-[5rem_minmax(0,1fr)_3.5rem] items-center gap-2 text-xs">
      <span>{label}</span>
      <Slider aria-label={label} value={[value]} min={min} max={max} step={step} onValueChange={([next]) => onChange(next ?? value)} />
      <span className="text-right tabular-nums text-muted-foreground">{display(value)}{suffix}</span>
    </label>
  )
}

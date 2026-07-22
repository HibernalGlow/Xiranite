import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react"
import { motion, useDragControls, type PanInfo } from "motion/react"
import { Disc3, GripHorizontal, Maximize2, Minimize2, PanelBottom, Pause, PictureInPicture2, Play, SkipBack, SkipForward, X } from "lucide-react"
import type { MusicPlaybackControls, MusicPlaybackState, PersistedTrack } from "@/components/modules/musicPlayer/MusicPlayerSurface"
import type { MusicVisualizerStyle } from "@/components/modules/musicPlayer/visualizerStyles"
import { DynamicIsland, DynamicIslandProvider } from "@/components/ui/dynamic-island"
import { useDynamicIslandSize } from "@/components/ui/dynamic-island-context"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { useLocalBackendStatus } from "@/hooks/useLocalBackendStatus"
import { cn } from "@/lib/utils"
import {
  DEFAULT_MELODECK_CONFIG,
  loadMelodeckConfig,
  MELODECK_CONFIG_CHANGED_EVENT,
  saveMelodeckConfig,
} from "@/nodes/melodeck/config"

type DockMode = "bottom" | "floating" | "fullscreen"

interface FloatingOffset {
  x: number
  y: number
}

type MelodeckIslandVariant = "full" | "mini"

interface MelodeckContextValue {
  collapsed: boolean
  mode: DockMode
  audioRef: RefObject<HTMLAudioElement | null>
  playbackControlsRef: RefObject<MusicPlaybackControls | null>
  playback: MusicPlaybackState
  visualizerStyle: MusicVisualizerStyle
  surfaceMounted: boolean
  savedTracks: PersistedTrack[]
  sourcePath: string
  floatingOffset: FloatingOffset
  setCollapsed(collapsed: boolean): void
  setMode(mode: DockMode): void
  setPlaybackControls(controls: MusicPlaybackControls | null): void
  setPlaybackState(state: MusicPlaybackState): void
  setVisualizerStyle(style: MusicVisualizerStyle): void
  setSurfaceMounted(mounted: boolean): void
  setSavedTracks(tracks: PersistedTrack[]): void
  setSourcePath(path: string): void
  setFloatingOffset(offset: FloatingOffset): void
}

const MELODECK_GLASS_SHADOW_CLASS = "shadow-[0_14px_44px_rgba(0,0,0,0.16)] dark:shadow-[0_20px_64px_rgba(0,0,0,0.34)]"
const EMPTY_PLAYBACK_STATE: MusicPlaybackState = {
  hasTrack: false,
  isPlaying: false,
  trackCount: 0,
}
const MusicPlayerSurface = lazy(() =>
  import("@/components/modules/musicPlayer/MusicPlayerSurface").then((module) => ({
    default: module.MusicPlayerSurface,
  })),
)
const MusicVisualizerIcon = lazy(() =>
  import("@/components/modules/musicPlayer/MusicVisualizerIcon").then((module) => ({
    default: module.MusicVisualizerIcon,
  })),
)
const MelodeckContext = createContext<MelodeckContextValue | null>(null)

export function WorkspaceMelodeckProvider({ children }: { children: ReactNode }) {
  const backendStatus = useLocalBackendStatus()
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const playbackControlsRef = useRef<MusicPlaybackControls | null>(null)
  const applyingConfigRef = useRef(false)
  const [collapsed, setCollapsed] = useState(true)
  const [mode, setMode] = useState<DockMode>(DEFAULT_MELODECK_CONFIG.mode)
  const [playback, setPlaybackState] = useState<MusicPlaybackState>(EMPTY_PLAYBACK_STATE)
  const [visualizerStyle, setVisualizerStyle] = useState<MusicVisualizerStyle>(DEFAULT_MELODECK_CONFIG.visualizer_style)
  const [surfaceMounted, setSurfaceMounted] = useState(false)
  const [savedTracks, setSavedTracks] = useState<PersistedTrack[]>([])
  const [sourcePath, setSourcePath] = useState("")
  const [floatingOffset, setFloatingOffset] = useState<FloatingOffset>(DEFAULT_MELODECK_CONFIG.floating_offset)
  const [configLoaded, setConfigLoaded] = useState(false)
  const backendKey = backendStatus.data?.status === "ready" && backendStatus.data.config
    ? `${backendStatus.data.config.baseUrl}\n${backendStatus.data.config.token ?? ""}`
    : ""
  const setPlaybackControls = useCallback((controls: MusicPlaybackControls | null) => {
    playbackControlsRef.current = controls
  }, [])

  useEffect(() => {
    if (!backendKey) return
    let cancelled = false

    const refreshMelodeckConfig = () => {
      applyingConfigRef.current = true
      loadMelodeckConfig().then((config) => {
        if (cancelled) return
        setMode(config.mode ?? DEFAULT_MELODECK_CONFIG.mode)
        setSavedTracks(config.saved_tracks ?? [])
        setSourcePath(config.source_path ?? "")
        setFloatingOffset(clampFloatingOffset(config.floating_offset ?? DEFAULT_MELODECK_CONFIG.floating_offset))
        setVisualizerStyle(config.visualizer_style ?? DEFAULT_MELODECK_CONFIG.visualizer_style)
        setConfigLoaded(true)
        queueMicrotask(() => {
          applyingConfigRef.current = false
        })
      }).catch((error) => {
        applyingConfigRef.current = false
        console.warn("[melodeck] config load failed:", error)
      })
    }

    refreshMelodeckConfig()
    window.addEventListener(MELODECK_CONFIG_CHANGED_EVENT, refreshMelodeckConfig)
    return () => {
      cancelled = true
      window.removeEventListener(MELODECK_CONFIG_CHANGED_EVENT, refreshMelodeckConfig)
    }
  }, [backendKey])

  useEffect(() => {
    if (!backendKey || !configLoaded || applyingConfigRef.current) return
    const timer = window.setTimeout(() => {
      saveMelodeckConfig({
        mode,
        saved_tracks: savedTracks,
        source_path: sourcePath,
        floating_offset: floatingOffset,
        visualizer_style: visualizerStyle,
      }).catch((error) => {
        console.warn("[melodeck] config save failed:", error)
      })
    }, 400)
    return () => window.clearTimeout(timer)
  }, [backendKey, configLoaded, floatingOffset, mode, savedTracks, sourcePath, visualizerStyle])

  return (
    <MelodeckContext.Provider
      value={{
        collapsed,
        mode,
        audioRef,
        playbackControlsRef,
        playback,
        visualizerStyle,
        surfaceMounted,
        savedTracks,
        sourcePath,
        floatingOffset,
        setCollapsed,
        setMode,
        setPlaybackControls,
        setPlaybackState,
        setVisualizerStyle,
        setSurfaceMounted,
        setSavedTracks,
        setSourcePath,
        setFloatingOffset,
      }}
    >
      {children}
    </MelodeckContext.Provider>
  )
}

export function WorkspaceMelodeckTopBarSlot() {
  const variant = useTopBarMusicIslandVariant()

  if (variant === "full") {
    return (
      <div data-melodeck="topbar-slot-full" className="xiranite-app-region-no-drag relative z-[2400] h-12 w-[206px] shrink-0 overflow-visible">
        <DynamicIslandProvider
          initialSize="minimalLeading"
          presets={{
            minimalLeading: { width: 206, aspectRatio: 34 / 206, borderRadius: 17 },
            compact: { width: 396, aspectRatio: 156 / 396, borderRadius: 28 },
          }}
        >
          <MelodeckIsland variant="full" />
        </DynamicIslandProvider>
      </div>
    )
  }

  return (
    <div data-melodeck="topbar-slot-mini" className="xiranite-app-region-no-drag relative z-[2400] h-12 w-[64px] shrink-0 overflow-visible">
      <DynamicIslandProvider
        initialSize="minimalLeading"
        presets={{
          minimalLeading: { width: 64, aspectRatio: 36 / 64, borderRadius: 18 },
          compact: { width: 320, aspectRatio: 156 / 320, borderRadius: 28 },
        }}
      >
        <MelodeckIsland variant="mini" />
      </DynamicIslandProvider>
    </div>
  )
}

function useTopBarMusicIslandVariant(): MelodeckIslandVariant {
  const [variant, setVariant] = useState<MelodeckIslandVariant>(() => (
    typeof window !== "undefined" && window.matchMedia("(min-width: 1280px)").matches ? "full" : "mini"
  ))

  useEffect(() => {
    const query = window.matchMedia("(min-width: 1280px)")
    const updateVariant = () => setVariant(query.matches ? "full" : "mini")
    updateVariant()
    query.addEventListener("change", updateVariant)
    return () => query.removeEventListener("change", updateVariant)
  }, [])

  return variant
}

function MelodeckIsland({ variant }: { variant: MelodeckIslandVariant }) {
  const dock = useMelodeck()
  const islandRef = useRef<HTMLDivElement>(null)
  const { state, setSize } = useDynamicIslandSize()
  const expanded = state.size === "compact"
  const collapsedMini = variant === "mini" && !expanded
  const showSpectrum = dock.playback.isPlaying
  const primaryTrack = dock.playback.trackName ?? dock.savedTracks[0]?.name
  const trackLabel = primaryTrack ?? "音乐播放器"
  const fallbackStateLabel = dock.playback.isPlaying
    ? (dock.collapsed ? "后台播放" : "正在播放")
    : dock.collapsed
      ? "后台待机"
      : dock.mode === "bottom" ? "底栏显示" : dock.mode === "fullscreen" ? "全屏 dock" : "浮窗显示"
  const stateLabel = dock.playback.supportLine?.trim() || fallbackStateLabel

  useEffect(() => {
    if (!expanded) return

    function collapseFromOutside(event: PointerEvent) {
      const target = event.target
      if (target instanceof Node && islandRef.current?.contains(target)) return
      setSize("minimalLeading")
    }

    window.addEventListener("pointerdown", collapseFromOutside, true)
    return () => window.removeEventListener("pointerdown", collapseFromOutside, true)
  }, [expanded, setSize])

  function showInMode(mode: DockMode) {
    dock.setMode(mode)
    dock.setSurfaceMounted(true)
    dock.setCollapsed(false)
    setSize("minimalLeading")
  }

  function hidePanel() {
    dock.setSurfaceMounted(true)
    dock.setCollapsed(true)
    setSize("minimalLeading")
  }

  return (
    <DynamicIsland
      id={`melodeck-topbar-island-${variant}`}
      className={cn(
        "absolute right-0 top-[7px] mx-0 max-w-[calc(100vw-9rem)] border border-border/55 bg-background/78 text-foreground shadow-[0_8px_24px_color-mix(in_oklch,var(--foreground)_12%,transparent)] ring-1 ring-border/25 backdrop-blur-xl backdrop-saturate-150",
        "supports-[backdrop-filter]:bg-background/62",
        expanded && "border-border/70 bg-popover/90 shadow-[0_18px_48px_color-mix(in_oklch,var(--foreground)_18%,transparent)] ring-primary/12 supports-[backdrop-filter]:bg-popover/82",
        !dock.collapsed && "ring-primary/16",
      )}
    >
      <div
        ref={islandRef}
        data-melodeck-island-state={expanded ? "expanded" : "collapsed"}
        data-melodeck-island-variant={variant}
        className={cn(
          "flex h-full w-full min-w-0 flex-col overflow-hidden",
          collapsedMini ? "p-1" : expanded ? "px-3 py-2.5" : "px-2 py-1",
        )}
      >
        <button
          type="button"
          className={cn(
            "flex min-w-0 items-center rounded-full text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            collapsedMini
              ? cn("size-full gap-1 px-1 hover:bg-muted/45", showSpectrum ? "justify-between" : "justify-center")
              : expanded
                ? "h-12 w-full gap-2 px-1.5 hover:bg-accent/45"
                : "h-full w-full gap-1.5 px-1 hover:bg-muted/35",
          )}
          onClick={() => {
            if (!expanded) setSize("compact")
          }}
          aria-expanded={expanded}
          title={expanded ? "音乐 dock" : "展开音乐灵动岛"}
          aria-label={expanded ? "音乐 dock" : "展开音乐灵动岛"}
        >
          <MusicIslandArtwork artworkUrl={dock.playback.artworkUrl} trackLabel={trackLabel} size={collapsedMini ? "lg" : "md"} />
          {collapsedMini ? (
            showSpectrum && (
              <MusicIslandSpectrum
                compact
                isPlaying={dock.playback.isPlaying}
                style={dock.visualizerStyle}
              />
            )
          ) : (
            <>
              <div className="min-w-0 flex-1">
                <span className={cn("block truncate font-semibold leading-none", expanded ? "text-sm" : "text-[10.5px]")}>
                  {trackLabel}
                </span>
                <span className={cn("mt-0.5 block truncate leading-none text-muted-foreground", expanded ? "text-[11px]" : "text-[8.5px]")}>
                  {stateLabel}
                </span>
              </div>
              {showSpectrum && (
                <MusicIslandSpectrum
                  isPlaying={dock.playback.isPlaying}
                  style={dock.visualizerStyle}
                />
              )}
            </>
          )}
        </button>

        <MusicIslandExpandedPlayer
          expanded={expanded}
          onHidePanel={hidePanel}
          onShowInMode={showInMode}
        />
      </div>
    </DynamicIsland>
  )
}

function MusicIslandArtwork({
  artworkUrl,
  trackLabel,
  size = "md",
}: {
  artworkUrl?: string
  trackLabel: string
  size?: "md" | "lg"
}) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center overflow-hidden border border-border/45 bg-muted/55 text-primary shadow-[0_4px_14px_color-mix(in_oklch,var(--foreground)_16%,transparent)]",
        size === "lg" ? "size-7 rounded-[0.75rem]" : "size-6 rounded-[0.625rem]",
      )}
    >
      {artworkUrl ? (
        <img src={artworkUrl} alt={trackLabel} className="size-full object-cover" draggable={false} />
      ) : (
        <Disc3 className={cn("text-primary-foreground/85", size === "lg" ? "size-4" : "size-3.5")} />
      )}
    </span>
  )
}

function MusicIslandSpectrum({
  compact = false,
  isPlaying,
  style,
}: {
  compact?: boolean
  isPlaying: boolean
  style: MusicVisualizerStyle
}) {
  return (
    <span
      className={cn(
        "relative grid shrink-0 place-items-center overflow-hidden rounded-full border border-border/45 bg-muted/35 text-primary shadow-inner backdrop-blur-md",
        compact ? "h-6 w-8" : "h-6 w-11",
      )}
    >
      <Suspense fallback={null}>
        <MusicVisualizerIcon compact={compact} isPlaying={isPlaying} style={style} />
      </Suspense>
    </span>
  )
}

function MusicIslandExpandedPlayer({
  expanded,
  onHidePanel,
  onShowInMode,
}: {
  expanded: boolean
  onHidePanel(): void
  onShowInMode(mode: DockMode): void
}) {
  const dock = useMelodeck()

  if (!expanded) return null

  const duration = safePlaybackTime(dock.playback.duration)
  const currentTime = clamp(safePlaybackTime(dock.playback.currentTime), 0, duration || Number.MAX_SAFE_INTEGER)
  const canSeek = dock.playback.hasTrack && duration > 0
  const sliderMax = canSeek ? duration : 100
  const sliderValue = canSeek ? currentTime : 0

  function runPlaybackControl(action: (controls: MusicPlaybackControls) => void) {
    const controls = dock.playbackControlsRef.current
    if (!dock.playback.hasTrack || !controls) {
      onShowInMode("bottom")
      return
    }
    action(controls)
  }

  function handleTogglePlayback() {
    runPlaybackControl((controls) => controls.togglePlay())
  }

  return (
    <div className="mt-2 flex min-h-0 flex-1 flex-col gap-2" onClick={(event) => event.stopPropagation()}>
      <div className="flex min-w-0 items-center justify-center gap-8">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="rounded-full"
          onClick={() => runPlaybackControl((controls) => controls.playPrevious())}
          title="上一首"
          aria-label="上一首"
        >
          <SkipBack />
        </Button>
        <Button
          type="button"
          size="icon-lg"
          className="rounded-full shadow-sm"
          onClick={handleTogglePlayback}
          title={dock.playback.isPlaying ? "暂停" : "播放"}
          aria-label={dock.playback.isPlaying ? "暂停" : "播放"}
        >
          {dock.playback.isPlaying ? <Pause /> : <Play className="fill-current" />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="rounded-full"
          onClick={() => runPlaybackControl((controls) => controls.playNext())}
          title="下一首"
          aria-label="下一首"
        >
          <SkipForward />
        </Button>
      </div>

      <div className="grid grid-cols-[2.4rem_minmax(0,1fr)_2.4rem] items-center gap-2">
        <span className="text-right text-[10px] tabular-nums text-muted-foreground">
          {formatIslandTime(currentTime)}
        </span>
        <Slider
          aria-label="音乐播放进度"
          disabled={!canSeek}
          min={0}
          max={sliderMax}
          step={1}
          value={[sliderValue]}
          onValueChange={(value) => {
            if (!canSeek) return
            runPlaybackControl((controls) => controls.seekTo(value[0] ?? 0))
          }}
          className="min-w-0"
        />
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {formatIslandTime(duration)}
        </span>
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        <MusicIslandAction
          active={!dock.collapsed && dock.mode === "bottom"}
          icon={<PanelBottom className="size-3.5" />}
          label="底栏"
          onClick={() => onShowInMode("bottom")}
        />
        <MusicIslandAction
          active={!dock.collapsed && dock.mode === "floating"}
          icon={<PictureInPicture2 className="size-3.5" />}
          label="浮窗"
          onClick={() => onShowInMode("floating")}
        />
        <MusicIslandAction
          active={!dock.collapsed && dock.mode === "fullscreen"}
          icon={<Maximize2 className="size-3.5" />}
          label="全屏"
          onClick={() => onShowInMode("fullscreen")}
        />
        <MusicIslandAction
          icon={<X className="size-3.5" />}
          label="隐藏"
          onClick={onHidePanel}
        />
      </div>
    </div>
  )
}

function MusicIslandAction({
  active,
  icon,
  label,
  onClick,
}: {
  active?: boolean
  icon: ReactNode
  label: string
  onClick(): void
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-full border border-transparent px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent/70 hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        active && "border-primary/25 bg-primary/12 text-primary",
      )}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      aria-pressed={active}
      title={label}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  )
}

export function WorkspaceMelodeckPanel() {
  const dock = useMelodeck()
  const dragControls = useDragControls()
  const dragBoundsRef = useRef<HTMLDivElement>(null)
  const backgroundMode = dock.collapsed

  useEffect(() => {
    if (!dock.collapsed) dock.setSurfaceMounted(true)
  }, [dock.collapsed, dock.setSurfaceMounted])

  function handleDragStart(event: ReactPointerEvent<HTMLDivElement>) {
    if (dock.mode !== "floating") return
    event.preventDefault()
    dragControls.start(event)
  }

  function handleDragEnd(_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) {
    if (dock.mode !== "floating") return
    dock.setFloatingOffset(clampFloatingOffset({
      x: dock.floatingOffset.x + info.offset.x,
      y: dock.floatingOffset.y + info.offset.y,
    }))
  }

  const dockModeLabel = dock.mode === "bottom" ? "底栏 dock" : dock.mode === "fullscreen" ? "全屏 dock" : "浮动窗口"
  const bottomActions = dock.mode === "bottom" ? (
    <div className="flex shrink-0 items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={() => dock.setMode("floating")}
        title="切换为浮动窗口"
        aria-label="切换为浮动窗口"
      >
        <PictureInPicture2 />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={() => dock.setMode("fullscreen")}
        title="切换为全屏 dock"
        aria-label="切换为全屏 dock"
      >
        <Maximize2 />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="hover:text-destructive"
        onClick={() => dock.setCollapsed(true)}
        title="隐藏音乐 dock，继续后台播放"
        aria-label="隐藏音乐 dock，继续后台播放"
      >
        <X />
      </Button>
    </div>
  ) : undefined

  if (backgroundMode && !dock.surfaceMounted) return null

  return (
    <div
      ref={dragBoundsRef}
      className={cn(
        "pointer-events-none fixed z-[1300]",
        backgroundMode ? "left-0 top-0 size-px overflow-hidden" : "inset-3",
      )}
      aria-hidden={backgroundMode}
    >
      <motion.div
        layout
        drag={!backgroundMode && dock.mode === "floating"}
        dragControls={dragControls}
        dragListener={false}
        dragMomentum={false}
        dragElastic={0.02}
        dragConstraints={dragBoundsRef}
        onDragEnd={handleDragEnd}
        animate={!backgroundMode && dock.mode !== "floating" ? { x: 0, y: 0 } : undefined}
        style={!backgroundMode && dock.mode === "floating" ? dock.floatingOffset : undefined}
        transition={{ type: "spring", stiffness: 380, damping: 34 }}
        data-melodeck="panel"
        data-melodeck-mode={dock.mode}
        className={cn(
          "absolute bottom-0 overflow-hidden",
          backgroundMode
            ? "pointer-events-none left-0 top-0 size-px opacity-0"
            : cn(
              "pointer-events-auto opacity-100 transition-opacity duration-200",
              dock.mode === "bottom"
                ? "left-0 right-0 mx-auto h-[clamp(112px,14vh,132px)] max-w-5xl"
                : dock.mode === "fullscreen"
                  ? "inset-0"
                  : "right-0 h-[min(520px,calc(100vh-1.5rem))] w-[calc(100vw-1.5rem)] max-w-[760px]",
            ),
        )}
      >
        <div className={cn(
          "xiranite-app-region-no-drag relative isolate flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border/50 bg-card/[0.16] backdrop-blur-2xl backdrop-saturate-150",
          MELODECK_GLASS_SHADOW_CLASS,
          dock.mode !== "bottom" && "border-border/65 shadow-[0_26px_90px_rgba(0,0,0,0.26)] dark:shadow-[0_30px_96px_rgba(0,0,0,0.52)]"
        )}>
          <MelodeckAmbientLayer />
          {dock.mode !== "bottom" && (
            <div className="relative z-10 flex h-9 shrink-0 items-center gap-2 border-b border-border/30 bg-background/[0.14] px-2 text-muted-foreground backdrop-blur-2xl backdrop-saturate-150">
              <div
                data-melodeck-part="drag-handle"
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1",
                  dock.mode === "floating" && "cursor-grab touch-none active:cursor-grabbing",
                )}
                onPointerDown={handleDragStart}
              >
                <GripHorizontal className="size-4 shrink-0" />
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold leading-none text-foreground">音乐播放器</p>
                  <p className="mt-0.5 truncate text-[10px] leading-none">{dockModeLabel} · 后端文件服务</p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1" onPointerDown={(event) => event.stopPropagation()}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => dock.setMode("bottom")}
                  title="固定到底栏"
                  aria-label="固定到底栏"
                >
                  <PanelBottom />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => dock.setMode(dock.mode === "fullscreen" ? "floating" : "fullscreen")}
                  title={dock.mode === "fullscreen" ? "切换为浮动窗口" : "切换为全屏 dock"}
                  aria-label={dock.mode === "fullscreen" ? "切换为浮动窗口" : "切换为全屏 dock"}
                >
                  {dock.mode === "fullscreen" ? <Minimize2 /> : <Maximize2 />}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="hover:text-destructive"
                  onClick={() => dock.setCollapsed(true)}
                  title="隐藏音乐 dock，继续后台播放"
                  aria-label="隐藏音乐 dock，继续后台播放"
                >
                  <X />
                </Button>
              </div>
            </div>
          )}

          <Suspense fallback={<MelodeckSurfaceFallback />}>
            <MusicPlayerSurface
              audioRef={dock.audioRef}
              savedTracks={dock.savedTracks}
              savedSourcePath={dock.sourcePath}
              onSavedTracksChange={dock.setSavedTracks}
              onSourcePathChange={dock.setSourcePath}
              onPlaybackControlsChange={dock.setPlaybackControls}
              onPlaybackStateChange={dock.setPlaybackState}
              visualizerStyle={dock.visualizerStyle}
              onVisualizerStyleChange={dock.setVisualizerStyle}
              variant={dock.mode === "bottom" ? "dock" : "module"}
              actions={bottomActions}
              className="relative z-10 flex-1"
            />
          </Suspense>
        </div>
      </motion.div>
    </div>
  )
}

function MelodeckSurfaceFallback() {
  return (
    <div className="relative z-10 grid min-h-0 flex-1 place-items-center p-4 text-xs text-muted-foreground">
      Loading music player...
    </div>
  )
}

function MelodeckAmbientLayer() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      <div className="absolute inset-0 bg-[linear-gradient(145deg,hsl(var(--card)/0.20),transparent_55%,hsl(var(--muted)/0.14)),linear-gradient(90deg,hsl(var(--primary)/0.07),transparent_42%,hsl(var(--accent)/0.07))]" />
      <div className="absolute inset-0 bg-[repeating-linear-gradient(115deg,transparent_0,transparent_22px,hsl(var(--foreground)/0.018)_22px,hsl(var(--foreground)/0.018)_23px)] opacity-45 dark:opacity-30" />
      <div className="absolute inset-0 bg-white/[0.03] backdrop-blur-[22px] backdrop-saturate-150 dark:bg-white/[0.02]" />
      <div className="absolute inset-x-0 top-0 h-px bg-white/55 dark:bg-white/12" />
    </div>
  )
}

function useMelodeck(): MelodeckContextValue {
  const context = useContext(MelodeckContext)
  if (!context) throw new Error("WorkspaceMelodeck components must be rendered inside WorkspaceMelodeckProvider.")
  return context
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function safePlaybackTime(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0
}

function formatIslandTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00"
  const minutes = Math.floor(seconds / 60)
  const rest = Math.floor(seconds % 60)
  return `${minutes}:${String(rest).padStart(2, "0")}`
}

function clampFloatingOffset(offset: FloatingOffset): FloatingOffset {
  if (typeof window === "undefined") {
    return {
      x: clamp(offset.x, -900, 0),
      y: clamp(offset.y, -720, 0),
    }
  }

  const inset = 12
  const panelWidth = Math.min(760, Math.max(0, window.innerWidth - inset * 2))
  const panelHeight = Math.min(520, Math.max(0, window.innerHeight - inset * 2))
  const baseLeft = window.innerWidth - inset - panelWidth
  const baseTop = window.innerHeight - inset - panelHeight

  return {
    x: clamp(offset.x, inset - baseLeft, 0),
    y: clamp(offset.y, inset - baseTop, 0),
  }
}

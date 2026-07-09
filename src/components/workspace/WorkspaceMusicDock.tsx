import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react"
import { motion, useDragControls, type PanInfo } from "motion/react"
import { AudioLines, GripHorizontal, Maximize2, PanelBottom, X } from "lucide-react"
import { MusicPlayerSurface, type MusicPlaybackState, type PersistedTrack } from "@/components/modules/musicPlayer/MusicPlayerSurface"
import { DynamicIsland, DynamicIslandProvider } from "@/components/ui/dynamic-island"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type DockMode = "bottom" | "floating"

interface FloatingOffset {
  x: number
  y: number
}

interface MusicDockContextValue {
  collapsed: boolean
  mode: DockMode
  playback: MusicPlaybackState
  surfaceMounted: boolean
  savedTracks: PersistedTrack[]
  sourcePath: string
  floatingOffset: FloatingOffset
  setCollapsed(collapsed: boolean): void
  setMode(mode: DockMode): void
  setPlaybackState(state: MusicPlaybackState): void
  setSurfaceMounted(mounted: boolean): void
  setSavedTracks(tracks: PersistedTrack[]): void
  setSourcePath(path: string): void
  setFloatingOffset(offset: FloatingOffset): void
}

const MUSIC_DOCK_MODE_STORAGE_KEY = "xiranite.musicDock.mode"
const MUSIC_DOCK_TRACKS_STORAGE_KEY = "xiranite.musicDock.savedTracks"
const MUSIC_DOCK_SOURCE_STORAGE_KEY = "xiranite.musicDock.sourcePath"
const MUSIC_DOCK_FLOATING_OFFSET_STORAGE_KEY = "xiranite.musicDock.floatingOffset"
const LEGACY_CONFIG_CHANGED_EVENT = "xiranite:legacy-config-changed"
const MUSIC_DOCK_GLASS_SHADOW_CLASS = "shadow-[0_14px_44px_rgba(0,0,0,0.16)] dark:shadow-[0_20px_64px_rgba(0,0,0,0.34)]"
const EMPTY_PLAYBACK_STATE: MusicPlaybackState = {
  hasTrack: false,
  isPlaying: false,
  trackCount: 0,
}
const MusicDockContext = createContext<MusicDockContextValue | null>(null)

export function WorkspaceMusicDockProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(true)
  const [mode, setMode] = useState<DockMode>(() => readDockMode())
  const [playback, setPlaybackState] = useState<MusicPlaybackState>(EMPTY_PLAYBACK_STATE)
  const [surfaceMounted, setSurfaceMounted] = useState(false)
  const [savedTracks, setSavedTracks] = useState<PersistedTrack[]>(() => readSavedTracks())
  const [sourcePath, setSourcePath] = useState(() => readSourcePath())
  const [floatingOffset, setFloatingOffset] = useState<FloatingOffset>(() => readFloatingOffset())

  useEffect(() => {
    writeDockMode(mode)
  }, [mode])

  useEffect(() => {
    writeSavedTracks(savedTracks)
  }, [savedTracks])

  useEffect(() => {
    writeSourcePath(sourcePath)
  }, [sourcePath])

  useEffect(() => {
    writeFloatingOffset(floatingOffset)
  }, [floatingOffset])

  useEffect(() => {
    const refreshMusicDockConfig = () => {
      setMode(readDockMode())
      setSavedTracks((current) => {
        const next = readSavedTracks()
        return areSavedTracksEqual(current, next) ? current : next
      })
      setSourcePath(readSourcePath())
      setFloatingOffset((current) => {
        const next = readFloatingOffset()
        return areFloatingOffsetsEqual(current, next) ? current : next
      })
    }

    window.addEventListener(LEGACY_CONFIG_CHANGED_EVENT, refreshMusicDockConfig)
    return () => window.removeEventListener(LEGACY_CONFIG_CHANGED_EVENT, refreshMusicDockConfig)
  }, [])

  return (
    <MusicDockContext.Provider
      value={{
        collapsed,
        mode,
        playback,
        surfaceMounted,
        savedTracks,
        sourcePath,
        floatingOffset,
        setCollapsed,
        setMode,
        setPlaybackState,
        setSurfaceMounted,
        setSavedTracks,
        setSourcePath,
        setFloatingOffset,
      }}
    >
      {children}
    </MusicDockContext.Provider>
  )
}

export function WorkspaceMusicDockTopBarSlot() {
  const dock = useMusicDock()
  const primaryTrack = dock.playback.trackName ?? dock.savedTracks[0]?.name
  const trackLabel = primaryTrack ?? "音乐"
  const stateLabel = dock.playback.isPlaying
    ? (dock.collapsed ? "后台播放" : "正在播放")
    : dock.collapsed
      ? "后台待机"
      : dock.mode === "bottom" ? "底栏显示" : "浮窗显示"

  function showInMode(mode: DockMode) {
    dock.setMode(mode)
    dock.setSurfaceMounted(true)
    dock.setCollapsed(false)
  }

  return (
    <DynamicIslandProvider
      initialSize="compact"
      presets={{
        minimalLeading: { width: 48, aspectRatio: 36 / 48, borderRadius: 18 },
        compact: { width: 286, aspectRatio: 36 / 286, borderRadius: 18 },
      }}
    >
      <DynamicIsland
        id="music-dock-topbar-island"
        data-music-dock="topbar-slot"
        className={cn(
          "xiranite-app-region-no-drag hidden mx-0 border border-border/55 bg-foreground text-background shadow-lg shadow-black/10 backdrop-blur-2xl backdrop-saturate-150 xl:flex",
          !dock.collapsed && "border-primary/45 shadow-primary/10",
        )}
      >
        <div className="flex h-full w-full items-center gap-1 px-1.5">
          <button
            type="button"
            className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-full px-2 text-left transition-colors hover:bg-background/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-background/30"
            onClick={() => {
              if (dock.collapsed) dock.setSurfaceMounted(true)
              dock.setCollapsed(!dock.collapsed)
            }}
            title={dock.collapsed ? "打开音乐面板" : "隐藏音乐面板，继续后台播放"}
            aria-label={dock.collapsed ? "打开音乐面板" : "隐藏音乐面板，继续后台播放"}
          >
            <AudioLines
              className={cn(
                "size-4 shrink-0",
                dock.playback.isPlaying ? "text-background" : "text-background/62",
              )}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[11px] font-semibold leading-none">{trackLabel}</span>
              <span className="mt-0.5 block truncate text-[9px] leading-none text-background/60">{stateLabel}</span>
            </span>
          </button>

          <span aria-hidden className="h-4 w-px shrink-0 bg-background/18" />

          <button
            type="button"
            className={cn(
              "grid size-7 shrink-0 place-items-center rounded-full text-background/65 transition-colors hover:bg-background/10 hover:text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-background/30",
              !dock.collapsed && dock.mode === "bottom" && "bg-background/14 text-background",
            )}
            onClick={() => showInMode("bottom")}
            title="以底栏模式打开"
            aria-label="以底栏模式打开"
            aria-pressed={!dock.collapsed && dock.mode === "bottom"}
          >
            <PanelBottom className="size-3.5" />
          </button>
          <button
            type="button"
            className={cn(
              "grid size-7 shrink-0 place-items-center rounded-full text-background/65 transition-colors hover:bg-background/10 hover:text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-background/30",
              !dock.collapsed && dock.mode === "floating" && "bg-background/14 text-background",
            )}
            onClick={() => showInMode("floating")}
            title="以浮窗模式打开"
            aria-label="以浮窗模式打开"
            aria-pressed={!dock.collapsed && dock.mode === "floating"}
          >
            <Maximize2 className="size-3.5" />
          </button>
          <button
            type="button"
            className="grid size-7 shrink-0 place-items-center rounded-full text-background/55 transition-colors hover:bg-background/10 hover:text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-background/30"
            onClick={() => dock.setCollapsed(true)}
            title="隐藏面板，继续后台播放"
            aria-label="隐藏面板，继续后台播放"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </DynamicIsland>
    </DynamicIslandProvider>
  )
}

export function WorkspaceMusicDockPanel() {
  const dock = useMusicDock()
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

  const dockModeLabel = dock.mode === "bottom" ? "底栏 dock" : "浮动窗口"
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
        "pointer-events-none fixed z-[71]",
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
        animate={!backgroundMode && dock.mode === "bottom" ? { x: 0, y: 0 } : undefined}
        style={!backgroundMode && dock.mode === "floating" ? dock.floatingOffset : undefined}
        transition={{ type: "spring", stiffness: 380, damping: 34 }}
        data-music-dock="panel"
        data-music-dock-mode={dock.mode}
        className={cn(
          "absolute bottom-0 overflow-hidden",
          backgroundMode
            ? "pointer-events-none left-0 top-0 size-px opacity-0"
            : cn(
              "pointer-events-auto opacity-100 transition-opacity duration-200",
              dock.mode === "bottom"
                ? "left-0 right-0 mx-auto h-[clamp(112px,14vh,132px)] max-w-5xl"
                : "right-0 h-[min(520px,calc(100vh-1.5rem))] w-[calc(100vw-1.5rem)] max-w-[760px]",
            ),
        )}
      >
        <div className={cn(
          "xiranite-app-region-no-drag relative isolate flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border/50 bg-card/[0.16] backdrop-blur-2xl backdrop-saturate-150",
          MUSIC_DOCK_GLASS_SHADOW_CLASS,
          dock.mode === "floating" && "border-border/65 shadow-[0_26px_90px_rgba(0,0,0,0.26)] dark:shadow-[0_30px_96px_rgba(0,0,0,0.52)]"
        )}>
          <MusicDockAmbientLayer />
          {dock.mode === "floating" && (
            <div className="relative z-10 flex h-9 shrink-0 items-center gap-2 border-b border-border/30 bg-background/[0.14] px-2 text-muted-foreground backdrop-blur-2xl backdrop-saturate-150">
              <div
                data-music-dock-part="drag-handle"
                className="flex min-w-0 flex-1 cursor-grab touch-none items-center gap-2 rounded-md px-1.5 py-1 active:cursor-grabbing"
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

          <MusicPlayerSurface
            savedTracks={dock.savedTracks}
            savedSourcePath={dock.sourcePath}
            onSavedTracksChange={dock.setSavedTracks}
            onSourcePathChange={dock.setSourcePath}
            onPlaybackStateChange={dock.setPlaybackState}
            variant={dock.mode === "bottom" ? "dock" : "module"}
            actions={bottomActions}
            className="relative z-10 flex-1"
          />
        </div>
      </motion.div>
    </div>
  )
}

function MusicDockAmbientLayer() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      <div className="absolute inset-0 bg-[linear-gradient(145deg,hsl(var(--card)/0.20),transparent_55%,hsl(var(--muted)/0.14)),linear-gradient(90deg,hsl(var(--primary)/0.07),transparent_42%,hsl(var(--accent)/0.07))]" />
      <div className="absolute inset-0 bg-[repeating-linear-gradient(115deg,transparent_0,transparent_22px,hsl(var(--foreground)/0.018)_22px,hsl(var(--foreground)/0.018)_23px)] opacity-45 dark:opacity-30" />
      <div className="absolute inset-0 bg-white/[0.03] backdrop-blur-[22px] backdrop-saturate-150 dark:bg-white/[0.02]" />
      <div className="absolute inset-x-0 top-0 h-px bg-white/55 dark:bg-white/12" />
    </div>
  )
}

function useMusicDock(): MusicDockContextValue {
  const context = useContext(MusicDockContext)
  if (!context) throw new Error("WorkspaceMusicDock components must be rendered inside WorkspaceMusicDockProvider.")
  return context
}

function readDockMode(): DockMode {
  if (typeof window === "undefined") return "bottom"
  const stored = window.localStorage.getItem(MUSIC_DOCK_MODE_STORAGE_KEY)
  return stored === "floating" ? "floating" : "bottom"
}

function writeDockMode(mode: DockMode) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(MUSIC_DOCK_MODE_STORAGE_KEY, mode)
  dispatchLegacyConfigChanged()
}

function readSavedTracks(): PersistedTrack[] {
  if (typeof window === "undefined") return []

  try {
    const value = window.localStorage.getItem(MUSIC_DOCK_TRACKS_STORAGE_KEY)
    if (!value) return []
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isPersistedTrack)
  } catch {
    return []
  }
}

function writeSavedTracks(tracks: PersistedTrack[]) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(MUSIC_DOCK_TRACKS_STORAGE_KEY, JSON.stringify(tracks))
  dispatchLegacyConfigChanged()
}

function readSourcePath(): string {
  if (typeof window === "undefined") return ""
  return window.localStorage.getItem(MUSIC_DOCK_SOURCE_STORAGE_KEY) ?? ""
}

function writeSourcePath(path: string) {
  if (typeof window === "undefined") return
  if (path) window.localStorage.setItem(MUSIC_DOCK_SOURCE_STORAGE_KEY, path)
  else window.localStorage.removeItem(MUSIC_DOCK_SOURCE_STORAGE_KEY)
  dispatchLegacyConfigChanged()
}

function readFloatingOffset(): FloatingOffset {
  if (typeof window === "undefined") return { x: 0, y: 0 }

  try {
    const value = window.localStorage.getItem(MUSIC_DOCK_FLOATING_OFFSET_STORAGE_KEY)
    if (!value) return { x: 0, y: 0 }
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== "object") return { x: 0, y: 0 }
    const offset = parsed as FloatingOffset
    return clampFloatingOffset({
      x: Number.isFinite(offset.x) ? offset.x : 0,
      y: Number.isFinite(offset.y) ? offset.y : 0,
    })
  } catch {
    return { x: 0, y: 0 }
  }
}

function writeFloatingOffset(offset: FloatingOffset) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(MUSIC_DOCK_FLOATING_OFFSET_STORAGE_KEY, JSON.stringify(offset))
  dispatchLegacyConfigChanged()
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
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

function isPersistedTrack(value: unknown): value is PersistedTrack {
  if (!value || typeof value !== "object") return false
  const track = value as PersistedTrack
  return typeof track.name === "string" && (track.path === undefined || typeof track.path === "string")
}

function areSavedTracksEqual(left: PersistedTrack[], right: PersistedTrack[]): boolean {
  if (left.length !== right.length) return false
  return left.every((track, index) => track.name === right[index]?.name && track.path === right[index]?.path)
}

function areFloatingOffsetsEqual(left: FloatingOffset, right: FloatingOffset): boolean {
  return left.x === right.x && left.y === right.y
}

function dispatchLegacyConfigChanged() {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(LEGACY_CONFIG_CHANGED_EVENT))
}

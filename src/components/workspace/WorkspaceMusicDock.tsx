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
import { GripHorizontal, Maximize2, Music2, PanelBottom, X } from "lucide-react"
import { MusicPlayerSurface, type PersistedTrack } from "@/components/modules/musicPlayer/MusicPlayerSurface"
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
  savedTracks: PersistedTrack[]
  sourcePath: string
  floatingOffset: FloatingOffset
  setCollapsed(collapsed: boolean): void
  setMode(mode: DockMode): void
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
const MusicDockContext = createContext<MusicDockContextValue | null>(null)

export function WorkspaceMusicDockProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(true)
  const [mode, setMode] = useState<DockMode>(() => readDockMode())
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
        savedTracks,
        sourcePath,
        floatingOffset,
        setCollapsed,
        setMode,
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
  const primaryTrack = dock.savedTracks[0]?.name
  const countLabel = dock.savedTracks.length > 0 ? `${dock.savedTracks.length} 首` : dock.mode === "bottom" ? "底栏" : "浮动"

  return (
    <div
      data-music-dock="topbar-slot"
      className={cn(
        "xiranite-app-region-no-drag hidden h-8 w-60 min-w-0 items-center overflow-hidden rounded border border-border/[0.45] bg-card/[0.18] text-xs text-muted-foreground backdrop-blur-2xl backdrop-saturate-150 transition-colors xl:flex",
        MUSIC_DOCK_GLASS_SHADOW_CLASS,
        !dock.collapsed && "border-primary/40 bg-primary/[0.15] text-primary"
      )}
    >
      <button
        type="button"
        className="flex h-full min-w-0 flex-1 items-center gap-2 px-2 text-left transition-colors hover:text-foreground"
        onClick={() => dock.setCollapsed(false)}
        title="打开音乐播放器"
        aria-label="打开音乐播放器"
      >
        <Music2 className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate font-medium">{primaryTrack ?? "音乐播放器"}</span>
        <span className="shrink-0 rounded bg-background/[0.24] px-1.5 py-0.5 text-[9px] leading-none text-muted-foreground backdrop-blur-xl">
          {countLabel}
        </span>
      </button>
      <button
        type="button"
        className="grid h-full w-8 shrink-0 place-items-center border-l border-border/[0.45] transition-colors hover:bg-background/[0.24] hover:text-foreground"
        onClick={() => {
          dock.setCollapsed(false)
          dock.setMode(dock.mode === "bottom" ? "floating" : "bottom")
        }}
        title={dock.mode === "bottom" ? "切换为浮动窗口" : "固定到底栏"}
        aria-label={dock.mode === "bottom" ? "切换为浮动窗口" : "固定到底栏"}
      >
        {dock.mode === "bottom" ? <Maximize2 className="size-3.5" /> : <PanelBottom className="size-3.5" />}
      </button>
    </div>
  )
}

export function WorkspaceMusicDockPanel() {
  const dock = useMusicDock()
  const dragControls = useDragControls()
  const dragBoundsRef = useRef<HTMLDivElement>(null)

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
        title="收起音乐 dock"
        aria-label="收起音乐 dock"
      >
        <X />
      </Button>
    </div>
  ) : undefined

  if (dock.collapsed) return null

  return (
    <div ref={dragBoundsRef} className="pointer-events-none fixed inset-3 z-[71]">
      <motion.div
        layout
        drag={dock.mode === "floating"}
        dragControls={dragControls}
        dragListener={false}
        dragMomentum={false}
        dragElastic={0.02}
        dragConstraints={dragBoundsRef}
        onDragEnd={handleDragEnd}
        animate={dock.mode === "bottom" ? { x: 0, y: 0 } : undefined}
        style={dock.mode === "floating" ? dock.floatingOffset : undefined}
        transition={{ type: "spring", stiffness: 380, damping: 34 }}
        data-music-dock="panel"
        data-music-dock-mode={dock.mode}
        className={cn(
          "pointer-events-auto absolute bottom-0 overflow-hidden",
          dock.mode === "bottom"
            ? "left-0 right-0 mx-auto h-[clamp(112px,14vh,132px)] max-w-5xl"
            : "right-0 h-[min(520px,calc(100vh-1.5rem))] w-[calc(100vw-1.5rem)] max-w-[760px]",
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
                  title="收起音乐 dock"
                  aria-label="收起音乐 dock"
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

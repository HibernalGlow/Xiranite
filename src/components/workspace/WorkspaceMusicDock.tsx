import { createContext, useContext, useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react"
import { motion, useDragControls } from "motion/react"
import { GripHorizontal, Maximize2, Music2, PanelBottom, X } from "lucide-react"
import { MusicPlayerSurface, type PersistedTrack } from "@/components/modules/musicPlayer/MusicPlayerSurface"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type DockMode = "bottom" | "floating"

interface MusicDockContextValue {
  collapsed: boolean
  mode: DockMode
  savedTracks: PersistedTrack[]
  sourcePath: string
  setCollapsed(collapsed: boolean): void
  setMode(mode: DockMode): void
  setSavedTracks(tracks: PersistedTrack[]): void
  setSourcePath(path: string): void
}

const MUSIC_DOCK_MODE_STORAGE_KEY = "xiranite.musicDock.mode"
const MUSIC_DOCK_TRACKS_STORAGE_KEY = "xiranite.musicDock.savedTracks"
const MUSIC_DOCK_SOURCE_STORAGE_KEY = "xiranite.musicDock.sourcePath"
const MusicDockContext = createContext<MusicDockContextValue | null>(null)

export function WorkspaceMusicDockProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(true)
  const [mode, setMode] = useState<DockMode>(() => readDockMode())
  const [savedTracks, setSavedTracks] = useState<PersistedTrack[]>(() => readSavedTracks())
  const [sourcePath, setSourcePath] = useState(() => readSourcePath())

  useEffect(() => {
    writeDockMode(mode)
  }, [mode])

  useEffect(() => {
    writeSavedTracks(savedTracks)
  }, [savedTracks])

  useEffect(() => {
    writeSourcePath(sourcePath)
  }, [sourcePath])

  return (
    <MusicDockContext.Provider
      value={{
        collapsed,
        mode,
        savedTracks,
        sourcePath,
        setCollapsed,
        setMode,
        setSavedTracks,
        setSourcePath,
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
        "xiranite-app-region-no-drag hidden h-8 w-56 min-w-0 items-center overflow-hidden rounded border border-border/60 bg-muted/30 text-xs text-muted-foreground transition-colors xl:flex",
        !dock.collapsed && "border-primary/40 bg-primary/10 text-primary"
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
        <span className="shrink-0 rounded bg-background/70 px-1.5 py-0.5 text-[9px] leading-none text-muted-foreground">
          {countLabel}
        </span>
      </button>
      <button
        type="button"
        className="grid h-full w-8 shrink-0 place-items-center border-l border-border/60 transition-colors hover:bg-background/70 hover:text-foreground"
        onClick={() => {
          dock.setCollapsed(false)
          dock.setMode(dock.mode === "bottom" ? "floating" : "bottom")
        }}
        title={dock.mode === "bottom" ? "切换为浮动 dock" : "固定到底栏"}
        aria-label={dock.mode === "bottom" ? "切换为浮动 dock" : "固定到底栏"}
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

  function handleDragStart(event: PointerEvent<HTMLDivElement>) {
    if (dock.mode !== "floating") return
    dragControls.start(event)
  }

  const dockModeLabel = dock.mode === "bottom" ? "底栏 dock" : "浮动 dock"

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
        animate={dock.mode === "bottom" ? { x: 0, y: 0 } : undefined}
        transition={{ type: "spring", stiffness: 380, damping: 34 }}
        data-music-dock="panel"
        data-music-dock-mode={dock.mode}
        aria-hidden={dock.collapsed}
        className={cn(
          "pointer-events-auto absolute bottom-0 overflow-hidden",
          dock.mode === "bottom"
            ? "left-0 right-0 mx-auto h-[clamp(168px,25vh,208px)] max-w-6xl"
            : "right-0 h-[280px] w-[calc(100vw-1.5rem)] max-w-[600px]",
          dock.collapsed && "pointer-events-none translate-y-3 opacity-0"
        )}
      >
        <div className="xiranite-app-region-no-drag flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border/70 bg-background/95 shadow-2xl shadow-black/30 backdrop-blur-xl">
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border/60 px-2 text-muted-foreground">
            <div
              className={cn(
                "flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1",
                dock.mode === "floating" && "cursor-grab active:cursor-grabbing"
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
                onClick={() => dock.setMode(dock.mode === "bottom" ? "floating" : "bottom")}
                title={dock.mode === "bottom" ? "切换为浮动 dock" : "固定到底栏"}
                aria-label={dock.mode === "bottom" ? "切换为浮动 dock" : "固定到底栏"}
              >
                {dock.mode === "bottom" ? <Maximize2 /> : <PanelBottom />}
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

          <MusicPlayerSurface
            savedTracks={dock.savedTracks}
            savedSourcePath={dock.sourcePath}
            onSavedTracksChange={dock.setSavedTracks}
            onSourcePathChange={dock.setSourcePath}
            variant="dock"
            className="flex-1"
          />
        </div>
      </motion.div>
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
}

function readSourcePath(): string {
  if (typeof window === "undefined") return ""
  return window.localStorage.getItem(MUSIC_DOCK_SOURCE_STORAGE_KEY) ?? ""
}

function writeSourcePath(path: string) {
  if (typeof window === "undefined") return
  if (path) window.localStorage.setItem(MUSIC_DOCK_SOURCE_STORAGE_KEY, path)
  else window.localStorage.removeItem(MUSIC_DOCK_SOURCE_STORAGE_KEY)
}

function isPersistedTrack(value: unknown): value is PersistedTrack {
  if (!value || typeof value !== "object") return false
  const track = value as PersistedTrack
  return typeof track.name === "string" && (track.path === undefined || typeof track.path === "string")
}

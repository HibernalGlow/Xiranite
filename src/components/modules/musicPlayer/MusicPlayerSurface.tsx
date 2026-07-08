import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react"
import AudioPlayer from "react-modern-audio-player"
import { Clipboard, Disc3, FolderOpen, Library, ListMusic, Loader2, Music2 } from "lucide-react"
import { localBackendFileUrl } from "@/backend/localBackendConfig"
import { resolveLocalAudioTracks, type LocalAudioTrack } from "@/backend/localFilesClient"
import { useTheme } from "@/components/theme-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

export interface PersistedTrack {
  name: string
  writer?: string
  fileName?: string
  path?: string
  relativePath?: string
  size?: number
  type?: string
}

interface RuntimeTrack extends PersistedTrack {
  id: number
  path: string
  src: string
  img?: string
  description?: string
}

export interface MusicPlayerSurfaceProps {
  savedTracks?: PersistedTrack[]
  savedSourcePath?: string
  onSavedTracksChange?: (tracks: PersistedTrack[]) => void
  onSourcePathChange?: (path: string) => void
  variant?: "module" | "dock"
  className?: string
}

const DEFAULT_LOCAL_PATH = "E:\\1Hub\\Music\\焚蝶 - 铁痕电台-MSR&Aurora Sky&Lucien X.flac"
const DEFAULT_TRACK_NAME = "焚蝶"
const DEFAULT_COVER_URL = "https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/68/6b/51/686b5103-f58d-3ba6-4f20-3bb55b482078/4711720299471.jpg/600x600bb.jpg"

const PLAYER_VARIABLES = {
  "--rm-audio-player-text-color": "hsl(var(--foreground))",
  "--rm-audio-player-shadow": "none",
  "--rm-audio-player-interface-container": "hsl(var(--muted) / 0.35)",
  "--rm-audio-player-volume-background": "hsl(var(--muted))",
  "--rm-audio-player-volume-panel-background": "hsl(var(--popover))",
  "--rm-audio-player-volume-panel-border": "hsl(var(--border))",
  "--rm-audio-player-volume-thumb": "hsl(var(--primary))",
  "--rm-audio-player-volume-fill": "hsl(var(--primary) / 0.72)",
  "--rm-audio-player-volume-track": "hsl(var(--muted-foreground) / 0.35)",
  "--rm-audio-player-track-current-time": "hsl(var(--primary))",
  "--rm-audio-player-track-duration": "hsl(var(--muted-foreground))",
  "--rm-audio-player-progress-bar": "hsl(var(--primary))",
  "--rm-audio-player-progress-bar-background": "hsl(var(--muted-foreground) / 0.24)",
  "--rm-audio-player-waveform-cursor": "hsl(var(--primary))",
  "--rm-audio-player-waveform-background": "hsl(var(--muted-foreground) / 0.24)",
  "--rm-audio-player-waveform-bar": "hsl(var(--primary))",
  "--rm-audio-player-sortable-list": "hsl(var(--card))",
  "--rm-audio-player-sortable-list-button-active": "hsl(var(--primary))",
  "--rm-audio-player-selected-list-item-background": "hsl(var(--accent))",
} as CSSProperties

const COMPACT_ACTIVE_UI = {
  all: false,
  artwork: false,
  trackInfo: false,
  trackTime: false,
  progress: "bar",
  repeatType: true,
  volume: true,
  volumeSlider: true,
  playButton: true,
  prevNnext: true,
  playList: false,
  playbackRate: false,
} as const

const FULL_ACTIVE_UI = {
  all: true,
  artwork: true,
  progress: "bar",
  playList: "sortable",
  prevNnext: true,
  playbackRate: true,
} as const

export function MusicPlayerSurface({
  savedTracks = [],
  savedSourcePath,
  onSavedTracksChange,
  onSourcePathChange,
  variant = "module",
  className,
}: MusicPlayerSurfaceProps) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const [surfaceSize, setSurfaceSize] = useState({ width: 0, height: 0 })
  const responsiveCompact = surfaceSize.width > 0 && (surfaceSize.width < 560 || surfaceSize.height < 300)
  const compact = variant === "dock" || responsiveCompact
  const [sourcePath, setSourcePath] = useState(savedSourcePath || DEFAULT_LOCAL_PATH)
  const [tracks, setTracks] = useState<RuntimeTrack[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { resolvedTheme, theme } = useTheme()
  const colorScheme = resolvedTheme === "light" || theme === "light" ? "light" : "dark"

  useEffect(() => {
    if (savedSourcePath && savedSourcePath !== sourcePath) setSourcePath(savedSourcePath)
  }, [savedSourcePath])

  useEffect(() => {
    const el = surfaceRef.current
    if (!el || typeof ResizeObserver === "undefined") return

    const applySize = (width: number, height: number) => {
      const next = { width: Math.round(width), height: Math.round(height) }
      setSurfaceSize((current) => (
        current.width === next.width && current.height === next.height ? current : next
      ))
    }

    applySize(el.clientWidth, el.clientHeight)

    const observer = new ResizeObserver(([entry]) => {
      applySize(entry.contentRect.width, entry.contentRect.height)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (tracks.length || !savedTracks.length) return
    const restored = restoreTracks(savedTracks)
    if (restored.length) setTracks(restored)
  }, [savedTracks, tracks.length])

  const playList = useMemo(() => tracks.map((track) => ({
    id: track.id,
    src: track.src,
    name: track.name,
    writer: track.writer,
    img: track.img,
    description: track.description,
  })), [tracks])

  async function loadSource(nextSourcePath = sourcePath) {
    const trimmed = nextSourcePath.trim()
    if (!trimmed) return

    setLoading(true)
    setError(null)
    try {
      const localTracks = await resolveLocalAudioTracks(trimmed)
      if (!localTracks.length) {
        throw new Error("这个路径下没有找到可播放的音频文件。")
      }

      const nextTracks = toRuntimeTracks(localTracks)
      setTracks(nextTracks)
      onSourcePathChange?.(trimmed)
      onSavedTracksChange?.(nextTracks.map(toPersistedTrack))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoading(false)
    }
  }

  async function pastePath() {
    const text = await navigator.clipboard?.readText?.()
    if (!text) return
    setSourcePath(text.trim())
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void loadSource()
  }

  return (
    <div
      ref={surfaceRef}
      data-music-player-surface={variant}
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground",
        compact ? "gap-2 p-2" : "gap-3 p-3",
        className
      )}
    >
      <MusicLibraryToolbar
        compact={compact}
        loading={loading}
        sourcePath={sourcePath}
        trackCount={tracks.length}
        savedTrackCount={savedTracks.length}
        onLoad={() => void loadSource()}
        onPastePath={() => void pastePath()}
        onSourcePathChange={setSourcePath}
        onSubmit={handleSubmit}
      />

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className={cn("min-h-0 flex-1 overflow-hidden border bg-card/60", compact ? "rounded-md" : "rounded-lg")}>
        {tracks.length > 0 ? (
          <AudioPlayer
            playList={playList}
            colorScheme={colorScheme}
            audioInitialState={{
              curPlayId: playList[0]?.id ?? 1,
              repeatType: "ALL",
              volume: 0.85,
              playListExpanded: !compact,
            }}
            activeUI={compact ? COMPACT_ACTIVE_UI : FULL_ACTIVE_UI}
            placement={{
              player: "static",
              playList: "bottom",
              volumeSlider: "top",
              speedSelector: "top",
            }}
            coverImgsCss={{
              artwork: { borderRadius: "8px", objectFit: "cover" },
              listThumbnail: { borderRadius: "6px", objectFit: "cover" },
            }}
            rootContainerProps={{
              className: "h-full rounded-lg border-0 bg-transparent",
              style: PLAYER_VARIABLES,
            }}
          />
        ) : (
          <EmptyLibrary
            compact={compact}
            loading={loading}
            savedTracks={savedTracks}
            onLoad={() => void loadSource()}
            onUseDefaultPath={() => {
              setSourcePath(DEFAULT_LOCAL_PATH)
              void loadSource(DEFAULT_LOCAL_PATH)
            }}
          />
        )}
      </div>
    </div>
  )
}

function MusicLibraryToolbar({
  compact,
  loading,
  sourcePath,
  trackCount,
  savedTrackCount,
  onLoad,
  onPastePath,
  onSourcePathChange,
  onSubmit,
}: {
  compact: boolean
  loading: boolean
  sourcePath: string
  trackCount: number
  savedTrackCount: number
  onLoad(): void
  onPastePath(): void
  onSourcePathChange(path: string): void
  onSubmit(event: FormEvent<HTMLFormElement>): void
}) {
  const countLabel = trackCount > 0 ? `${trackCount} 首` : savedTrackCount > 0 ? `上次 ${savedTrackCount} 首` : "待载入"

  return (
    <div className={cn("flex min-w-0 items-center gap-3", compact ? "min-h-9" : "min-h-12")}>
      <div className="flex min-w-0 items-center gap-2">
        <div className={cn("flex shrink-0 items-center justify-center rounded-md border bg-muted/55 text-primary", compact ? "size-8" : "size-10")}>
          <Disc3 className={compact ? "size-4" : "size-5"} />
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className={cn("truncate font-semibold leading-tight", compact ? "text-sm" : "text-lg")}>本地音乐库</h3>
            <Badge variant="secondary" className="shrink-0 text-[10px]">{countLabel}</Badge>
          </div>
          {!compact && (
            <p className="truncate text-xs text-muted-foreground">后端文件服务播放，不走浏览器上传。</p>
          )}
        </div>
      </div>

      <form className="flex min-w-0 flex-1 items-center gap-1.5" onSubmit={onSubmit}>
        <Input
          value={sourcePath}
          onChange={(event) => onSourcePathChange(event.target.value)}
          className={cn("h-8 min-w-0 text-xs", compact && "hidden")}
          placeholder="输入本地音频文件或文件夹路径"
          aria-label="本地音乐路径"
        />
        <Button type="button" size="icon-sm" variant="outline" onClick={onPastePath} title="粘贴路径" aria-label="粘贴路径">
          <Clipboard />
        </Button>
        <Button type="button" size="sm" className="h-8 gap-1.5" disabled={loading} onClick={onLoad}>
          {loading ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <FolderOpen data-icon="inline-start" />}
          载入
        </Button>
      </form>
    </div>
  )
}

function EmptyLibrary({
  compact,
  loading,
  savedTracks,
  onLoad,
  onUseDefaultPath,
}: {
  compact: boolean
  loading: boolean
  savedTracks: PersistedTrack[]
  onLoad(): void
  onUseDefaultPath(): void
}) {
  if (compact) {
    return (
      <div className="flex h-full min-h-[96px] items-center gap-3 p-3 text-left">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-lg border bg-muted/60">
          <ListMusic className="size-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">输入文件或文件夹路径后开始播放</p>
          <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
            FLAC、MP3、WAV、OGG、M4A 等格式会通过本地后端文件服务流式播放。
          </p>
        </div>
        <Button size="sm" disabled={loading} onClick={onLoad} className="hidden h-8 gap-1.5 sm:inline-flex">
          <Music2 data-icon="inline-start" />
          载入
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-[180px] flex-col items-center justify-center gap-4 p-4 text-center">
      <div className="flex size-14 items-center justify-center rounded-full border bg-muted/60">
        <ListMusic className="text-primary" />
      </div>
      <div className="max-w-md">
        <p className="text-sm font-medium">载入本地音乐文件或整个文件夹</p>
        <p className="mt-1 text-xs text-muted-foreground">
          使用 react-modern-audio-player 负责播放器和歌单；本地文件由 Xiranite 后端文件服务提供 URL 与 Range 流。
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={loading} onClick={onLoad} className="gap-1.5">
          <Library data-icon="inline-start" />
          载入路径
        </Button>
        <Button size="sm" variant="outline" disabled={loading} onClick={onUseDefaultPath} className="gap-1.5">
          <Music2 data-icon="inline-start" />
          焚蝶示例
        </Button>
      </div>
      {savedTracks.length > 0 && (
        <>
          <Separator className="max-w-sm" />
          <p className="max-w-sm text-[11px] text-muted-foreground">
            已保存 {savedTracks.length} 首的路径元数据。后端服务可用时会自动恢复播放 URL。
          </p>
        </>
      )}
    </div>
  )
}

function restoreTracks(savedTracks: PersistedTrack[]): RuntimeTrack[] {
  const restored: RuntimeTrack[] = []
  for (const track of savedTracks) {
    if (!track.path) continue
    try {
      restored.push({
        ...track,
        id: restored.length + 1,
        path: track.path,
        src: localBackendFileUrl(track.path),
        img: track.name.includes(DEFAULT_TRACK_NAME) ? DEFAULT_COVER_URL : undefined,
        description: track.relativePath ?? track.path,
      })
    } catch {
      return []
    }
  }
  return restored
}

function toRuntimeTracks(tracks: LocalAudioTrack[]): RuntimeTrack[] {
  return tracks.map((track, index) => ({
    ...track,
    id: index + 1,
    img: track.name.includes(DEFAULT_TRACK_NAME) ? DEFAULT_COVER_URL : undefined,
    description: track.relativePath ?? track.path,
  }))
}

function toPersistedTrack(track: RuntimeTrack): PersistedTrack {
  return {
    name: track.name,
    writer: track.writer,
    fileName: track.fileName,
    path: track.path,
    relativePath: track.relativePath,
    size: track.size,
    type: track.type,
  }
}

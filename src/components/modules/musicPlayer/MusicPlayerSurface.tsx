import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from "react"
import AudioPlayer from "react-modern-audio-player"
import { FolderOpen, Library, ListMusic, Music2, Upload } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

export interface PersistedTrack {
  name: string
  writer?: string
  fileName?: string
  relativePath?: string
  size?: number
  type?: string
}

interface RuntimeTrack extends PersistedTrack {
  id: number
  src: string
  img?: string
  description?: string
}

export interface MusicPlayerSurfaceProps {
  savedTracks?: PersistedTrack[]
  onSavedTracksChange?: (tracks: PersistedTrack[]) => void
  variant?: "module" | "dock"
  className?: string
}

const AUDIO_ACCEPT = [
  ".flac",
  ".mp3",
  ".wav",
  ".ogg",
  ".oga",
  ".m4a",
  ".aac",
  ".opus",
  ".webm",
  "audio/*",
].join(",")

const DEFAULT_LOCAL_PATH = "E:\\1Hub\\Music\\焚蝶 - 铁痕电台-MSR&Aurora Sky&Lucien X.flac"
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

export function MusicPlayerSurface({
  savedTracks = [],
  onSavedTracksChange,
  variant = "module",
  className,
}: MusicPlayerSurfaceProps) {
  const [tracks, setTracks] = useState<RuntimeTrack[]>([])
  const objectUrlsRef = useRef<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const compact = variant === "dock"

  useEffect(() => () => revokeObjectUrls(objectUrlsRef.current), [])

  const playList = useMemo(() => tracks.map((track) => ({
    id: track.id,
    src: track.src,
    name: track.name,
    writer: track.writer,
    img: track.img,
    description: track.description,
    customTrackInfo: track.fileName,
  })), [tracks])

  function loadFiles(files: FileList | File[]) {
    const nextFiles = Array.from(files).filter(isSupportedAudioFile)
    if (nextFiles.length === 0) return

    revokeObjectUrls(objectUrlsRef.current)
    const urls: string[] = []
    const nextTracks = nextFiles.map((file, index) => {
      const src = URL.createObjectURL(file)
      urls.push(src)
      const metadata = parseTrackMetadata(file)
      return {
        ...metadata,
        id: index + 1,
        src,
        img: metadata.name === "焚蝶" ? DEFAULT_COVER_URL : undefined,
        description: metadata.relativePath ?? file.name,
      } satisfies RuntimeTrack
    })

    objectUrlsRef.current = urls
    setTracks(nextTracks)
    onSavedTracksChange?.(nextTracks.map(({ name, writer, fileName, relativePath, size, type }) => ({
      name,
      writer,
      fileName,
      relativePath,
      size,
      type,
    })))
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) loadFiles(event.target.files)
    event.target.value = ""
  }

  function openFolderPicker() {
    const input = folderInputRef.current
    if (!input) return
    input.setAttribute("webkitdirectory", "")
    input.setAttribute("directory", "")
    input.click()
  }

  return (
    <div className={cn("flex h-full min-h-0 flex-col overflow-hidden bg-background", compact ? "p-2" : "p-3", className)}>
      <input ref={fileInputRef} hidden type="file" accept={AUDIO_ACCEPT} multiple onChange={handleFileChange} />
      <input ref={folderInputRef} hidden type="file" accept={AUDIO_ACCEPT} multiple onChange={handleFileChange} />

      <div className={cn("flex min-w-0 items-start justify-between gap-3", compact ? "mb-2" : "mb-3")}>
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="text-[10px]">本地音乐库</Badge>
            <Badge variant="outline" className="text-[10px]">FLAC / MP3 / WAV / OGG / M4A</Badge>
          </div>
          <h3 className={cn("truncate font-semibold leading-tight", compact ? "text-sm" : "text-lg")}>Music Player</h3>
          {!compact && (
            <p className="truncate text-xs text-muted-foreground">默认示例：{DEFAULT_LOCAL_PATH}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => fileInputRef.current?.click()}>
            <Upload data-icon="inline-start" />
            文件
          </Button>
          <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={openFolderPicker}>
            <FolderOpen data-icon="inline-start" />
            文件夹
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border bg-card/60">
        {tracks.length > 0 ? (
          <AudioPlayer
            playList={playList}
            colorScheme="dark"
            audioInitialState={{
              curPlayId: playList[0]?.id ?? 1,
              repeatType: "ALL",
              volume: 0.85,
              playListExpanded: !compact,
            }}
            activeUI={{
              all: true,
              artwork: !compact,
              progress: "bar",
              playList: compact ? false : "sortable",
              prevNnext: true,
              playbackRate: !compact,
            }}
            placement={{
              player: "bottom",
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
            savedTracks={savedTracks}
            onPickFiles={() => fileInputRef.current?.click()}
            onPickFolder={openFolderPicker}
          />
        )}
      </div>
    </div>
  )
}

function EmptyLibrary({
  compact,
  savedTracks,
  onPickFiles,
  onPickFolder,
}: {
  compact: boolean
  savedTracks: PersistedTrack[]
  onPickFiles(): void
  onPickFolder(): void
}) {
  return (
    <div className={cn("flex h-full flex-col items-center justify-center gap-4 p-4 text-center", compact ? "min-h-[120px]" : "min-h-[180px]")}>
      <div className="flex size-14 items-center justify-center rounded-full border bg-muted/60">
        <ListMusic className="text-primary" />
      </div>
      <div className="max-w-md">
        <p className="text-sm font-medium">导入本地音乐文件或整个文件夹</p>
        {!compact && (
          <p className="mt-1 text-xs text-muted-foreground">
            使用 react-modern-audio-player，支持歌单、拖拽排序、循环、随机和浏览器可解码的音频格式。
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={onPickFiles} className="gap-1.5">
          <Music2 data-icon="inline-start" />
          选择文件
        </Button>
        <Button size="sm" variant="outline" onClick={onPickFolder} className="gap-1.5">
          <Library data-icon="inline-start" />
          选择文件夹
        </Button>
      </div>
      {savedTracks.length > 0 && !compact && (
        <>
          <Separator className="max-w-sm" />
          <p className="max-w-sm text-[11px] text-muted-foreground">
            上次歌单有 {savedTracks.length} 首。浏览器安全限制下，刷新后需要重新选择本地文件才能恢复可播放 URL。
          </p>
        </>
      )}
    </div>
  )
}

function parseTrackMetadata(file: File): PersistedTrack {
  const relativePath = getRelativePath(file)
  const fileName = file.name
  const baseName = fileName.replace(/\.[^.]+$/, "")
  const [namePart, writerPart] = baseName.split(/\s+-\s+/, 2)
  const name = (namePart || baseName).trim()
  const writer = writerPart?.trim() || inferWriterFromPath(relativePath)

  return {
    name,
    writer,
    fileName,
    relativePath,
    size: file.size,
    type: file.type || inferMimeType(fileName),
  }
}

function getRelativePath(file: File): string | undefined {
  const maybePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath
  return maybePath || undefined
}

function inferWriterFromPath(path: string | undefined): string | undefined {
  if (!path) return undefined
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts.length > 1 ? parts[parts.length - 2] : undefined
}

function isSupportedAudioFile(file: File): boolean {
  const lowerName = file.name.toLowerCase()
  return /\.(flac|mp3|wav|ogg|oga|m4a|aac|opus|webm)$/i.test(lowerName) || file.type.startsWith("audio/")
}

function inferMimeType(fileName: string): string | undefined {
  const extension = fileName.toLowerCase().split(".").pop()
  switch (extension) {
    case "flac":
      return "audio/flac"
    case "mp3":
      return "audio/mpeg"
    case "wav":
      return "audio/wav"
    case "ogg":
    case "oga":
      return "audio/ogg"
    case "m4a":
      return "audio/mp4"
    case "aac":
      return "audio/aac"
    case "opus":
      return "audio/opus"
    case "webm":
      return "audio/webm"
    default:
      return undefined
  }
}

function revokeObjectUrls(urls: string[]) {
  for (const url of urls) URL.revokeObjectURL(url)
  urls.length = 0
}

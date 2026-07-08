import { useEffect, useMemo, useState, type CSSProperties } from "react"
import {
  MediaController,
  MediaControlBar,
  MediaDurationDisplay,
  MediaMuteButton,
  MediaPlayButton,
  MediaPlaybackRateButton,
  MediaTimeDisplay,
  MediaTimeRange,
  MediaVolumeRange,
} from "media-chrome/react"
import { Music2, Radio, Sparkles } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useComponentData } from "@/hooks/useComponentData"
import { cn } from "@/lib/utils"
import type { ModuleProps } from "./ModuleRenderer"

interface MusicPlayerData {
  audioSrc?: string
  coverSrc?: string
}

interface MusicTrack {
  id: string
  title: string
  artist: string
  album: string
  sourceLabel: string
  audioSrc: string
  coverSrc: string
}

const DEFAULT_TRACK: MusicTrack = {
  id: "fen-die-msr",
  title: "焚蝶",
  artist: "MSR",
  album: "Monster Siren Records",
  sourceLabel: "默认曲目",
  audioSrc: "",
  coverSrc: "",
}

const MEDIA_CHROME_STYLE = {
  "--media-primary-color": "hsl(var(--foreground))",
  "--media-secondary-color": "transparent",
  "--media-text-color": "hsl(var(--muted-foreground))",
  "--media-icon-color": "hsl(var(--foreground))",
  "--media-control-background": "transparent",
  "--media-control-hover-background": "hsl(var(--accent))",
  "--media-range-track-background": "hsl(var(--muted))",
  "--media-range-track-pointer-background": "hsl(var(--muted))",
  "--media-range-bar-color": "hsl(var(--primary))",
  "--media-range-thumb-background": "hsl(var(--primary))",
  "--media-background-color": "transparent",
  "--media-control-height": "22px",
  "--media-control-padding": "6px",
} as CSSProperties

export default function MusicPlayerModule({ compId }: ModuleProps) {
  const [data, setData] = useComponentData<MusicPlayerData>(compId)
  const track = useMemo<MusicTrack>(() => ({
    ...DEFAULT_TRACK,
    audioSrc: data.audioSrc?.trim() ?? "",
    coverSrc: data.coverSrc?.trim() ?? "",
  }), [data.audioSrc, data.coverSrc])

  const playable = track.audioSrc.length > 0

  return (
    <TooltipProvider>
      <div className="flex h-full min-h-[220px] flex-col overflow-hidden rounded-[inherit] bg-background p-3">
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="flex min-w-0 flex-1 gap-3">
            <AlbumArtwork track={track} />
            <div className="flex min-w-0 flex-1 flex-col justify-between gap-3">
              <div className="min-w-0">
                <div className="mb-1 flex items-center gap-2">
                  <Badge variant="secondary" className="shrink-0 text-[10px]">
                    {track.sourceLabel}
                  </Badge>
                  {!playable && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge variant="outline" className="shrink-0 text-[10px]">
                          待音源
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>填入本地或远程音频 URL 后即可播放</TooltipContent>
                    </Tooltip>
                  )}
                </div>
                <h3 className="truncate text-lg font-semibold leading-tight text-foreground">
                  {track.title}
                </h3>
                <p className="truncate text-sm text-muted-foreground">{track.artist}</p>
                <p className="truncate text-xs text-muted-foreground/80">{track.album}</p>
              </div>

              <MediaShell track={track} playable={playable} />
            </div>
          </div>

          <Separator />

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor={`${compId}-music-src`} className="text-[10px] uppercase tracking-wide text-muted-foreground">
                音频 URL
              </Label>
              <Input
                id={`${compId}-music-src`}
                value={data.audioSrc ?? ""}
                onChange={(event) => setData({ audioSrc: event.target.value })}
                placeholder="/music/fen-die-msr.mp3"
                className="h-8 text-xs"
              />
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor={`${compId}-cover-src`} className="text-[10px] uppercase tracking-wide text-muted-foreground">
                封面 URL
              </Label>
              <Input
                id={`${compId}-cover-src`}
                value={data.coverSrc ?? ""}
                onChange={(event) => setData({ coverSrc: event.target.value })}
                placeholder="/images/fen-die-cover.jpg"
                className="h-8 text-xs"
              />
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}

function AlbumArtwork({ track }: { track: MusicTrack }) {
  const [coverFailed, setCoverFailed] = useState(false)

  useEffect(() => {
    setCoverFailed(false)
  }, [track.coverSrc])

  if (track.coverSrc && !coverFailed) {
    return (
      <img
        src={track.coverSrc}
        alt={`${track.title} cover`}
        className="aspect-square w-28 shrink-0 rounded-lg object-cover shadow-sm sm:w-36"
        onError={() => setCoverFailed(true)}
      />
    )
  }

  return (
    <div
      aria-label={`${track.title} cover placeholder`}
      className="relative flex aspect-square w-28 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted shadow-sm sm:w-36"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_35%_25%,hsl(var(--primary)/0.22),transparent_34%),linear-gradient(135deg,hsl(var(--muted)),hsl(var(--background))_58%,hsl(var(--accent)))]" />
      <div className="relative flex flex-col items-center gap-2 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-background/75 shadow-sm backdrop-blur">
          <Music2 className="text-primary" />
        </div>
        <div className="max-w-24 px-2">
          <p className="truncate text-sm font-semibold">{track.title}</p>
          <p className="truncate text-[10px] text-muted-foreground">{track.artist}</p>
        </div>
      </div>
    </div>
  )
}

function MediaShell({ track, playable }: { track: MusicTrack; playable: boolean }) {
  return (
    <div
      className={cn(
        "xiranite-music-player min-w-0 rounded-lg border bg-muted/35 p-2 text-card-foreground",
        !playable && "opacity-75",
      )}
    >
      <MediaController audio className="block w-full bg-transparent" style={MEDIA_CHROME_STYLE}>
        <audio slot="media" src={playable ? track.audioSrc : undefined} preload="metadata" />
        <div className="flex items-center gap-2 px-1 pb-2 text-[11px] text-muted-foreground">
          <Radio className="shrink-0" />
          <span className="truncate">{playable ? "Media Chrome audio engine" : "等待音频源"}</span>
          <Sparkles className="ml-auto shrink-0 text-primary" />
        </div>
        <MediaTimeRange className="w-full rounded-full" disabled={!playable} />
        <MediaControlBar className="mt-2 flex w-full items-center justify-center gap-1 rounded-md bg-transparent">
          <MediaPlayButton disabled={!playable} className="rounded-md" />
          <MediaTimeDisplay showduration className="min-w-10 text-xs text-muted-foreground" />
          <MediaDurationDisplay className="min-w-10 text-xs text-muted-foreground" />
          <MediaPlaybackRateButton disabled={!playable} className="rounded-md" />
          <MediaMuteButton disabled={!playable} className="rounded-md" />
          <MediaVolumeRange disabled={!playable} className="max-w-20" />
        </MediaControlBar>
      </MediaController>
    </div>
  )
}

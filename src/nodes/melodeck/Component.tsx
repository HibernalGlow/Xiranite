"use no memo"

import { lazy, Suspense } from "react"
import { Pause, Play, SkipBack, SkipForward } from "lucide-react"
import type { NodeComponentProps } from "@xiranite/contract"
import { Button } from "@/components/ui/button"
import { useWorkspaceMelodeck } from "@/components/workspace/WorkspaceMelodeck"

const FoliaFullscreenSurface = lazy(() => import("@hibernalglow/folia-player/fullscreen").then((module) => ({
  default: module.FoliaFullscreenSurface,
})))

export function Component(_props: NodeComponentProps) {
  const deck = useWorkspaceMelodeck()

  if (deck.playerEngine === "legacy") {
    const controls = deck.playbackControlsRef.current
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-4 bg-card/40 p-4 text-center">
        {deck.playback.artworkUrl ? <img src={deck.playback.artworkUrl} alt="" className="size-28 rounded-lg object-cover" /> : null}
        <div className="min-w-0"><strong className="block truncate">{deck.playback.trackName ?? "Music"}</strong><span className="block truncate text-xs text-muted-foreground">{deck.playback.supportLine ?? "Legacy"}</span></div>
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => controls?.playPrevious()} aria-label="上一首"><SkipBack /></Button>
          <Button size="icon" onClick={() => controls?.togglePlay()} aria-label={deck.playback.isPlaying ? "暂停" : "播放"}>{deck.playback.isPlaying ? <Pause /> : <Play />}</Button>
          <Button variant="ghost" size="icon" onClick={() => controls?.playNext()} aria-label="下一首"><SkipForward /></Button>
        </div>
        <Button variant="outline" size="sm" onClick={() => deck.setPlayerEngine("folia")}>Folia</Button>
      </div>
    )
  }

  return <MelodeckFoliaNodeSurface />
}

export function MelodeckFoliaNodeSurface() {
  return (
    <div
      className="relative h-full min-h-0 w-full overflow-hidden rounded-[inherit]"
      data-melodeck-folia-view="app"
    >
      <Suspense fallback={<div className="grid h-full place-items-center text-xs text-muted-foreground">Loading lyrics...</div>}>
        <FoliaFullscreenSurface brandLabel="Meloddeck" className="h-full min-h-0 rounded-[inherit]" />
      </Suspense>
    </div>
  )
}

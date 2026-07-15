/**
 * @migrated-from src/lib/components/layout/TopToolbar/SlideshowPanel.svelte
 * @source-hash sha256:eb7a063ad1252600384269d05fe9a67c8af75568dd31cf48f66ed912d5a9f326
 * @migrated-from src/lib/stores/slideshow.svelte.ts
 * @source-hash sha256:d80a421a6535a7d1619f156765121466401fb292fc2620e1b26b491a6a474551
 * @features slideshow,panels-toolbar-shell
 * @migration-status adapted
 */
import { Pause, Play, Repeat2, Shuffle } from "lucide-react"
import { useSyncExternalStore } from "react"
import type { ReaderSlideshow } from "@xiranite/node-neoview/core"

import { Button } from "@/components/ui/button"

export function ReaderSlideshowToolbar({ slideshow, disabled }: { slideshow: ReaderSlideshow; disabled?: boolean }) {
  const snapshot = useSyncExternalStore(slideshow.subscribe, slideshow.getSnapshot, slideshow.getSnapshot)
  const playing = snapshot.state === "playing"
  return (
    <div className="flex shrink-0 items-center gap-1" aria-label="幻灯片控制">
      <Button
        title={playing ? "暂停幻灯片" : "播放幻灯片"}
        aria-label={playing ? "暂停幻灯片" : "播放幻灯片"}
        aria-pressed={playing}
        type="button"
        size="icon-xs"
        variant={playing ? "default" : "ghost"}
        disabled={disabled}
        onClick={() => slideshow.toggle()}
      >{playing ? <Pause /> : <Play />}</Button>
      <label className="sr-only" htmlFor="neoview-slideshow-interval">幻灯片间隔</label>
      <input
        type="number"
        id="neoview-slideshow-interval"
        aria-label="幻灯片间隔"
        className="h-7 w-14 rounded border border-border bg-background px-1 text-center text-[11px] tabular-nums text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        disabled={disabled}
        min={1}
        max={60}
        step={1}
        value={snapshot.intervalSeconds}
        onChange={(event) => slideshow.setInterval(Number(event.currentTarget.value))}
      />
      <Button title="循环播放" aria-label="循环播放" aria-pressed={snapshot.loop} type="button" size="icon-xs" variant={snapshot.loop ? "default" : "ghost"} disabled={disabled} onClick={() => slideshow.setLoop(!snapshot.loop)}><Repeat2 /></Button>
      <Button title="随机播放" aria-label="随机播放" aria-pressed={snapshot.random} type="button" size="icon-xs" variant={snapshot.random ? "default" : "ghost"} disabled={disabled} onClick={() => slideshow.setRandom(!snapshot.random)}><Shuffle /></Button>
      {snapshot.state !== "stopped" ? <output className="w-6 text-center text-[10px] tabular-nums text-muted-foreground" aria-label="幻灯片剩余时间">{snapshot.remainingSeconds}s</output> : null}
    </div>
  )
}

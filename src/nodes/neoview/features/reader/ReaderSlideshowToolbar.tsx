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
import type { ReaderSlideshow } from "@xiranite/node-neoview/ui-core"

import { Button } from "@/components/ui/button"
import { RangeInput } from "@/components/ui/range-input"
import type { ReaderSlideshowPatch } from "../../adapters/reader-http-client"

export function ReaderSlideshowToolbar({
  slideshow,
  disabled,
  onChange,
}: {
  slideshow: ReaderSlideshow
  disabled?: boolean
  onChange(patch: ReaderSlideshowPatch["slideshow"]): void | Promise<void>
}) {
  const snapshot = useSyncExternalStore(slideshow.subscribe, slideshow.getSnapshot, slideshow.getSnapshot)
  const playing = snapshot.state === "playing"
  const progress = snapshot.intervalSeconds > 0
    ? Math.max(0, Math.min(100, ((snapshot.intervalSeconds - snapshot.remainingSeconds) / snapshot.intervalSeconds) * 100))
    : 0
  const circumference = 2 * Math.PI * 15
  return (
    <div className="flex flex-wrap items-center justify-center gap-2" aria-label="幻灯片控制">
      <span className="text-xs text-muted-foreground">幻灯片</span>
      <Button
        title={playing ? "暂停幻灯片" : "播放幻灯片"}
        aria-label={playing ? "暂停幻灯片" : "播放幻灯片"}
        aria-pressed={playing}
        type="button"
        size="sm"
        className="h-7 px-3"
        variant={playing ? "default" : "outline"}
        disabled={disabled}
        onClick={() => slideshow.toggle()}
      >{playing ? <><Pause />暂停</> : <><Play />开始</>}</Button>
      <Separator />
      <label className="sr-only" htmlFor="neoview-slideshow-interval">幻灯片间隔</label>
      <span className="text-xs text-muted-foreground">间隔</span>
      <div className="flex items-center gap-1">
        <RangeInput
          id="neoview-slideshow-interval"
          aria-label="幻灯片间隔"
          className="h-1 w-20 disabled:cursor-not-allowed"
          disabled={disabled}
          min={1}
          max={60}
          step={1}
          value={snapshot.intervalSeconds}
          onChange={(event) => void onChange({ intervalSeconds: Number(event.currentTarget.value) })}
        />
        <output className="w-8 text-center text-xs tabular-nums" htmlFor="neoview-slideshow-interval">{snapshot.intervalSeconds}s</output>
      </div>
      <div className="inline-flex items-center gap-0.5 rounded-full bg-muted/60 p-0.5 shadow-inner" aria-label="幻灯片快捷间隔">
        {[3, 5, 10, 15].map((seconds) => <Button
          key={seconds}
          aria-label={`幻灯片间隔 ${seconds} 秒`}
          aria-pressed={snapshot.intervalSeconds === seconds}
          type="button"
          size="sm"
          className="h-6 w-8 rounded-full px-1 text-xs"
          variant={snapshot.intervalSeconds === seconds ? "default" : "ghost"}
          disabled={disabled}
          onClick={() => void onChange({ intervalSeconds: seconds })}
        >{seconds}s</Button>)}
      </div>
      <Separator />
      <Button title="循环播放" aria-label="循环播放" aria-pressed={snapshot.loop} type="button" size="icon-xs" variant={snapshot.loop ? "default" : "ghost"} disabled={disabled} onClick={() => void onChange({ loop: !snapshot.loop })}><Repeat2 /></Button>
      <Button title="随机播放" aria-label="随机播放" aria-pressed={snapshot.random} type="button" size="icon-xs" variant={snapshot.random ? "default" : "ghost"} disabled={disabled} onClick={() => void onChange({ random: !snapshot.random })}><Shuffle /></Button>
      {playing ? <>
        <Separator />
        <div className="flex items-center gap-1">
          <svg className="size-6 -rotate-90" viewBox="0 0 36 36" role="progressbar" aria-label="幻灯片倒计时进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
            <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
            <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray={circumference} strokeDashoffset={circumference - (progress / 100) * circumference} strokeLinecap="round" className="text-primary transition-all duration-200" />
          </svg>
          <output className="w-6 text-center text-xs tabular-nums" aria-label="幻灯片剩余时间">{Math.ceil(snapshot.remainingSeconds)}s</output>
        </div>
      </> : null}
    </div>
  )
}

function Separator() {
  return <span className="mx-1 h-5 w-px bg-border/50" aria-hidden="true" />
}

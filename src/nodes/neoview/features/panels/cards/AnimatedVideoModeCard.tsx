/**
 * @migrated-from src/lib/cards/info/AnimatedVideoModeCard.svelte
 * @source-hash sha256:db33c8837b3a01da9bb33ae3a003bac5fc957de73c1c741dd7bdc689eca09416
 * @ast-prototype migration/neoview/frontend/tsx-scaffold/src/lib/cards/info/AnimatedVideoModeCard.tsx
 * @migration-status partial
 */
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import type { ReaderMediaPatchDto } from "../../../adapters/reader-http-client"
import { DEFAULT_READER_ANIMATED_VIDEO_KEYWORDS, normalizeReaderAnimatedVideoKeywords } from "@xiranite/node-neoview/animated-video"
import type { ReaderPanelContext } from "../registry"
import { ReaderCardEmptyState } from "./ReaderCardEmptyState"

interface FfmpegState {
  available: boolean
  checked: boolean
  checking: boolean
  error?: string
}

const DEFAULT_FFMPEG_STATE: FfmpegState = { available: false, checked: false, checking: false }

export default function AnimatedVideoModeCard({ media, onMediaChange, disabled = false, panelActive = true }: ReaderPanelContext) {
  const [enabledOverride, setEnabledOverride] = useState<boolean>()
  const [keywordsOverride, setKeywordsOverride] = useState<readonly string[]>()
  const [keywordText, setKeywordText] = useState(() => DEFAULT_READER_ANIMATED_VIDEO_KEYWORDS.join(", "))
  const [ffmpeg, setFfmpeg] = useState<FfmpegState>(DEFAULT_FFMPEG_STATE)
  const [saveError, setSaveError] = useState<string>()

  const enabled = enabledOverride ?? media?.animatedVideoEnabled ?? false
  const keywords = keywordsOverride ?? media?.animatedVideoKeywords ?? DEFAULT_READER_ANIMATED_VIDEO_KEYWORDS

  useEffect(() => {
    if (media?.animatedVideoEnabled !== undefined) setEnabledOverride(undefined)
    if (media?.animatedVideoKeywords) {
      setKeywordsOverride(undefined)
      setKeywordText(media.animatedVideoKeywords.join(", "))
    }
  }, [media?.animatedVideoEnabled, media?.animatedVideoKeywords])

  async function updateMedia(patch: ReaderMediaPatchDto["media"]) {
    if (!onMediaChange) return
    try {
      setSaveError(undefined)
      await onMediaChange(patch)
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  function updateKeywords(text: string) {
    setKeywordText(text)
    const normalized = normalizeReaderAnimatedVideoKeywords(text.split(/[\n,\r]+/))
    setKeywordsOverride(normalized)
    void updateMedia({ animatedVideoKeywords: normalized })
  }

  async function refreshFfmpeg() {
    setFfmpeg((current) => ({ ...current, checking: true, error: undefined }))
    // The host-side probe is intentionally optional until the runtime exposes it.
    await Promise.resolve()
    setFfmpeg({ available: false, checked: true, checking: false, error: "当前运行时未提供 FFmpeg 探测" })
  }

  if (!panelActive) return <ReaderCardEmptyState />

  return (
    <div className="space-y-3 text-xs" data-neoview-card="animated-video-mode" data-animated-video-state="ready">
      <div className="flex items-center justify-between gap-2">
        <div className="space-y-0.5">
          <p className="font-medium text-foreground">动图按视频模式播放</p>
          <p className="text-[11px] text-muted-foreground">GIF/APNG 将走视频播放器，可使用倍速与循环。</p>
        </div>
        <Switch
          size="sm"
          className="origin-right scale-75"
          checked={enabled}
          disabled={disabled}
          aria-label="启用动图视频模式"
          onCheckedChange={(checked) => {
            setEnabledOverride(checked)
            void updateMedia({ animatedVideoEnabled: checked })
          }}
        />
      </div>

      <div className="space-y-2 rounded-md border border-border/50 bg-muted/20 p-2">
        <p className="mb-1 text-[11px] text-muted-foreground">关键词直判（优先于 WebP 探测）</p>
        <textarea
          className="min-h-16 w-full rounded border border-border bg-background px-2 py-1 text-[11px]"
          value={keywordText}
          disabled={disabled}
          aria-label="动图关键词"
          onChange={(event) => updateKeywords(event.currentTarget.value)}
          placeholder="例如: [#dyna], [#anim], __gif"
        />
        <p className="mt-1 text-[10px] text-muted-foreground">使用逗号或换行分隔。命中后直接按动图处理，跳过额外检测。</p>
      </div>

      <div className="space-y-2 rounded-md border border-border/50 bg-muted/20 p-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">FFmpeg</span>
          <span className={ffmpeg.checking ? "rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-600" : ffmpeg.available ? "rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-600" : ffmpeg.checked ? "rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] text-destructive" : "rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"}>
            {ffmpeg.checking ? "检测中" : ffmpeg.available ? "可用" : ffmpeg.checked ? "不可用" : "未检测"}
          </span>
        </div>
        {!ffmpeg.available && ffmpeg.checked ? <p className="mt-1 text-[10px] text-muted-foreground">{ffmpeg.error ?? "未检测到 FFmpeg，将使用前端解码播放动图。"}</p> : null}
        {saveError ? <p className="text-[10px] text-destructive" role="alert">设置保存失败：{saveError}</p> : null}
        <Button type="button" variant="outline" size="sm" className="h-7 text-[10px]" disabled={disabled || ffmpeg.checking} onClick={() => void refreshFfmpeg()}>
          {ffmpeg.checking ? "检测中…" : "重新检测 FFmpeg"}
        </Button>
      </div>

      {enabled ? <p className="text-[10px] text-muted-foreground">已启用后，当前页若是 GIF/APNG/动图 WebP（或命中关键词），会自动进入视频模式。</p> : null}
      <output className="sr-only" aria-label="当前动图关键词">{keywords.join(", ")}</output>
    </div>
  )
}

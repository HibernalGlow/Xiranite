/**
 * Global media defaults. Runtime-only animated-video refinements stay on the sidebar card.
 */
import { Image as ImageIcon } from "lucide-react"
import { useState } from "react"

import { Switch } from "@/components/ui/switch"
import type { ReaderMediaConfigDto, ReaderMediaPatchDto } from "../../../adapters/reader-http-client"
import type { ReaderPanelContext, ReaderSettingsCardContext } from "../../panels/registry"
import { SettingsCardSection, SettingsCardShell, SettingsToggleRow } from "../SettingsCardShell"

export function MediaSettingsCard({
  media,
  onMedia,
}: {
  media: ReaderMediaConfigDto
  onMedia(patch: ReaderMediaPatchDto["media"]): Promise<ReaderMediaConfigDto>
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()

  async function commit(patch: ReaderMediaPatchDto["media"]) {
    if (saving) return
    setSaving(true)
    setError(undefined)
    try {
      await onMedia(patch)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsCardShell
      id="media-settings"
      title="影像"
      description="配置全局图片/视频识别与播放默认值。动图关键词等细项仍可在侧栏「动图视频模式」中调整。"
      icon={ImageIcon}
    >
      <SettingsCardSection title="图片" description="动图行为与当前识别格式。">
        <SettingsToggleRow
          label="自动播放 GIF / APNG"
          description="关闭后动图以静态首帧显示，需手动触发播放。"
          control={<Switch checked={media.autoPlayAnimatedImages} disabled={saving} onCheckedChange={(value) => void commit({ autoPlayAnimatedImages: value })} aria-label="自动播放动图" />}
        />
        <SettingsToggleRow
          label="动图按视频模式播放"
          description="启用后 GIF/APNG 可走视频播放器（倍速/循环）。更细的关键词在侧栏卡片。"
          control={<Switch checked={media.animatedVideoEnabled} disabled={saving} onCheckedChange={(value) => void commit({ animatedVideoEnabled: value })} aria-label="动图视频模式" />}
        />
        <div className="rounded-md border bg-background/60 px-3 py-2 text-xs">
          <div className="font-medium text-sm">当前图片格式</div>
          <p className="mt-1 text-muted-foreground">{media.supportedImageFormats.join(", ") || "（空）"}</p>
        </div>
      </SettingsCardSection>

      <SettingsCardSection title="视频" description="扩展名与播放速率边界由节点配置驱动，此处只读。">
        <div className="rounded-md border bg-background/60 px-3 py-2 text-xs">
          <div className="font-medium text-sm">当前视频格式</div>
          <p className="mt-1 text-muted-foreground">{media.videoFormats.join(", ") || "（空）"}</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <ReadonlyMetric label="最小倍速" value={String(media.videoMinPlaybackRate)} />
          <ReadonlyMetric label="最大倍速" value={String(media.videoMaxPlaybackRate)} />
          <ReadonlyMetric label="步进" value={String(media.videoPlaybackRateStep)} />
        </div>
      </SettingsCardSection>

      <SettingsCardSection title="字幕">
        <label className="grid gap-2 text-sm">
          <span className="font-medium">字号</span>
          <input
            type="number"
            min={10}
            max={64}
            className="h-9 w-full max-w-xs rounded-md border border-input bg-background px-2.5 text-sm"
            disabled={saving}
            value={media.subtitle.fontSize}
            aria-label="字幕字号"
            onChange={(event) => {
              const next = Number(event.currentTarget.value)
              if (!Number.isFinite(next)) return
              void commit({ subtitle: { fontSize: Math.min(64, Math.max(10, Math.round(next))) } })
            }}
          />
        </label>
        <label className="grid gap-2 text-sm">
          <span className="font-medium">底部边距（%）</span>
          <input
            type="number"
            min={0}
            max={40}
            className="h-9 w-full max-w-xs rounded-md border border-input bg-background px-2.5 text-sm"
            disabled={saving}
            value={media.subtitle.bottomPercent}
            aria-label="字幕底部边距"
            onChange={(event) => {
              const next = Number(event.currentTarget.value)
              if (!Number.isFinite(next)) return
              void commit({ subtitle: { bottomPercent: Math.min(40, Math.max(0, Math.round(next))) } })
            }}
          />
        </label>
        <label className="grid gap-2 text-sm">
          <span className="font-medium">背景不透明度</span>
          <input
            type="number"
            min={0}
            max={1}
            step={0.05}
            className="h-9 w-full max-w-xs rounded-md border border-input bg-background px-2.5 text-sm"
            disabled={saving}
            value={media.subtitle.backgroundOpacity}
            aria-label="字幕背景不透明度"
            onChange={(event) => {
              const next = Number(event.currentTarget.value)
              if (!Number.isFinite(next)) return
              void commit({ subtitle: { backgroundOpacity: Math.min(1, Math.max(0, next)) } })
            }}
          />
        </label>
      </SettingsCardSection>
      {error ? <p role="alert" className="text-sm text-destructive">保存失败：{error}</p> : null}
    </SettingsCardShell>
  )
}

function ReadonlyMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-background/60 px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-sm tabular-nums">{value}</div>
    </div>
  )
}

export function SettingsMediaCard({ media, onMedia }: ReaderSettingsCardContext) {
  if (!media || !onMedia) return null
  return <MediaSettingsCard media={media} onMedia={onMedia} />
}

export default function DockedMediaSettingsCard({ media, onMediaChange }: ReaderPanelContext) {
  if (!media || !onMediaChange) return null
  return <MediaSettingsCard media={media} onMedia={onMediaChange} />
}

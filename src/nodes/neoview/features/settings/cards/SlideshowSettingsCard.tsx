/**
 * Slideshow defaults for the settings window / settings panel.
 */
import { Play } from "lucide-react"
import { useState } from "react"

import { Switch } from "@/components/ui/switch"
import type { ReaderSlideshowConfig, ReaderSlideshowPatch } from "../../../adapters/reader-http-client"
import type { ReaderPanelContext, ReaderSettingsCardContext } from "../../panels/registry"
import { SettingsCardSection, SettingsCardShell, SettingsToggleRow } from "../SettingsCardShell"

export function SlideshowSettingsCard({
  slideshow,
  onSlideshow,
}: {
  slideshow: ReaderSlideshowConfig
  onSlideshow(patch: ReaderSlideshowPatch["slideshow"]): Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()

  async function commit(patch: ReaderSlideshowPatch["slideshow"]) {
    if (saving) return
    setSaving(true)
    setError(undefined)
    try {
      await onSlideshow(patch)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsCardShell
      id="slideshow-settings"
      title="幻灯片"
      description="配置自动翻页默认行为。侧栏运行时工具栏可临时覆盖播放状态。"
      icon={Play}
    >
      <SettingsCardSection title="播放">
        <label className="grid gap-2 text-sm">
          <span className="font-medium">间隔（秒）</span>
          <input
            type="number"
            min={1}
            max={120}
            step={1}
            className="h-9 w-full max-w-xs rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            disabled={saving}
            value={slideshow.intervalSeconds}
            aria-label="幻灯片间隔秒数"
            onChange={(event) => {
              const next = Number(event.currentTarget.value)
              if (!Number.isFinite(next)) return
              void commit({ intervalSeconds: Math.min(120, Math.max(1, Math.round(next))) })
            }}
          />
        </label>
        <SettingsToggleRow
          label="循环播放"
          description="到末页后从头继续。"
          control={<Switch checked={slideshow.loop} disabled={saving} onCheckedChange={(value) => void commit({ loop: value })} aria-label="循环播放" />}
        />
        <SettingsToggleRow
          label="随机顺序"
          description="在当前书内按随机页序播放。"
          control={<Switch checked={slideshow.random} disabled={saving} onCheckedChange={(value) => void commit({ random: value })} aria-label="随机顺序" />}
        />
        <SettingsToggleRow
          label="淡入淡出"
          description="页间使用淡入淡出过渡（若当前渲染链支持）。"
          control={<Switch checked={slideshow.fadeTransition} disabled={saving} onCheckedChange={(value) => void commit({ fadeTransition: value })} aria-label="淡入淡出" />}
        />
      </SettingsCardSection>
      {error ? <p role="alert" className="text-sm text-destructive">保存失败：{error}</p> : null}
    </SettingsCardShell>
  )
}

export function SettingsSlideshowCard({ slideshow, onSlideshow }: ReaderSettingsCardContext) {
  if (!slideshow || !onSlideshow) return null
  return <SlideshowSettingsCard slideshow={slideshow} onSlideshow={onSlideshow} />
}

export default function DockedSlideshowSettingsCard({ slideshow, onSlideshow }: ReaderPanelContext) {
  if (!slideshow || !onSlideshow) return null
  return <SlideshowSettingsCard slideshow={slideshow} onSlideshow={onSlideshow} />
}

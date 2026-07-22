import { Gauge } from "lucide-react"
import { useEffect, useState } from "react"

import type { ReaderRuntimeConfigDto } from "../../../adapters/reader-http-client"
import type { ReaderPanelContext, ReaderSettingsCardContext } from "../../panels/registry"
import { SettingsCardSection, SettingsCardShell } from "../SettingsCardShell"

export function PreloadSettingsCard({ preload, onChange }: {
  preload: ReaderRuntimeConfigDto["preload"]
  onChange(patch: ReaderRuntimeConfigDto["preload"]): Promise<ReaderRuntimeConfigDto["preload"]>
}) {
  const [draft, setDraft] = useState(() => String(preload.maxCandidatePages))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => setDraft(String(preload.maxCandidatePages)), [preload.maxCandidatePages])

  async function commit() {
    if (saving) return
    const requested = Number(draft)
    if (!Number.isFinite(requested)) {
      setDraft(String(preload.maxCandidatePages))
      return
    }
    const maxCandidatePages = Math.min(32, Math.max(0, Math.round(requested)))
    setDraft(String(maxCandidatePages))
    if (maxCandidatePages === preload.maxCandidatePages) return
    setSaving(true)
    setError(undefined)
    try {
      await onChange({ maxCandidatePages })
    } catch (cause) {
      setDraft(String(preload.maxCandidatePages))
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  return <SettingsCardShell id="preload-settings" title="预读预算" description="限制新打开书籍的后台候选页数量。此设置不会重建当前阅读会话或中断翻页。" icon={Gauge}>
    <SettingsCardSection title="后台预读">
      <label className="grid max-w-xs gap-2 text-sm">
        <span className="font-medium">候选页上限</span>
        <input type="number" min={0} max={32} step={1} value={draft} disabled={saving} aria-label="预读候选页上限"
          className="h-9 rounded-md border border-input bg-background px-2.5 text-sm tabular-nums"
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={() => void commit()}
          onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { setDraft(String(preload.maxCandidatePages)); event.currentTarget.blur() } }} />
        <span className="text-xs text-muted-foreground">0 关闭候选预读；最大 32 页。更改仅在重新打开书籍后生效。</span>
      </label>
    </SettingsCardSection>
    {error ? <p role="alert" className="text-sm text-destructive">保存失败：{error}</p> : null}
  </SettingsCardShell>
}

export function SettingsPreloadCard({ preload, onPreload }: ReaderSettingsCardContext) {
  if (!preload || !onPreload) return null
  return <PreloadSettingsCard preload={preload} onChange={onPreload} />
}

export default function DockedPreloadSettingsCard({ preload, onPreload }: ReaderPanelContext) {
  if (!preload || !onPreload) return null
  return <PreloadSettingsCard preload={preload} onChange={onPreload} />
}

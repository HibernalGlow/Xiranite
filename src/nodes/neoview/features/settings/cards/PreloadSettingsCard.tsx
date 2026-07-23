import { Gauge } from "lucide-react"
import { useEffect, useState } from "react"

import { Switch } from "@/components/ui/switch"
import type { ReaderRuntimeConfigDto } from "../../../adapters/reader-http-client"
import type { ReaderPanelContext, ReaderSettingsCardContext } from "../../panels/registry"
import { SettingsCardSection, SettingsCardShell } from "../SettingsCardShell"

export function PreloadSettingsCard({ preload, onChange }: {
  preload: ReaderRuntimeConfigDto["preload"]
  onChange(patch: Partial<ReaderRuntimeConfigDto["preload"]>): Promise<ReaderRuntimeConfigDto["preload"]>
}) {
  const [draft, setDraft] = useState(() => String(preload.maxCandidatePages))
  const [browserPredecodeDraft, setBrowserPredecodeDraft] = useState(() => String(preload.browserPredecodePages))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => setDraft(String(preload.maxCandidatePages)), [preload.maxCandidatePages])
  useEffect(() => setBrowserPredecodeDraft(String(preload.browserPredecodePages)), [preload.browserPredecodePages])

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

  async function setBrowserPredecodeEnabled(browserPredecodeEnabled: boolean) {
    if (saving || browserPredecodeEnabled === preload.browserPredecodeEnabled) return
    setSaving(true)
    setError(undefined)
    try {
      await onChange({ browserPredecodeEnabled })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  async function commitBrowserPredecodePages() {
    if (saving) return
    const requested = Number(browserPredecodeDraft)
    if (!Number.isFinite(requested)) {
      setBrowserPredecodeDraft(String(preload.browserPredecodePages))
      return
    }
    const browserPredecodePages = Math.min(4, Math.max(1, Math.round(requested)))
    setBrowserPredecodeDraft(String(browserPredecodePages))
    if (browserPredecodePages === preload.browserPredecodePages) return
    setSaving(true)
    setError(undefined)
    try {
      await onChange({ browserPredecodePages })
    } catch (cause) {
      setBrowserPredecodeDraft(String(preload.browserPredecodePages))
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  return <SettingsCardShell id="preload-settings" title="预读预算" description="限制候选页与浏览器相邻页预解码。设置会立即控制后续后台工作，不会重建当前阅读会话。" icon={Gauge}>
    <SettingsCardSection title="后台预读">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <div className="grid gap-0.5">
          <span className="text-sm font-medium">相邻页预解码</span>
          <span className="text-xs text-muted-foreground">关闭可停止后续预解码；页面数仍受像素预算限制。</span>
        </div>
        <Switch checked={preload.browserPredecodeEnabled} disabled={saving} onCheckedChange={(enabled) => void setBrowserPredecodeEnabled(enabled)} aria-label="相邻页预解码" />
      </div>
      <label className="grid max-w-xs gap-2 text-sm">
        <span className="font-medium">相邻页预解码数量</span>
        <input type="number" min={1} max={4} step={1} value={browserPredecodeDraft} disabled={saving || !preload.browserPredecodeEnabled} aria-label="相邻页预解码数量"
          className="h-9 rounded-md border border-input bg-background px-2.5 text-sm tabular-nums"
          onChange={(event) => setBrowserPredecodeDraft(event.currentTarget.value)}
          onBlur={() => void commitBrowserPredecodePages()}
          onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { setBrowserPredecodeDraft(String(preload.browserPredecodePages)); event.currentTarget.blur() } }} />
        <span className="text-xs text-muted-foreground">1 至 4 页；始终串行解码，并受 60 MP 总像素预算保护。</span>
      </label>
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

/**
 * @migrated-from src/lib/components/panels/ViewSettingsPanel.svelte
 * @source-hash sha256:c8ab80f12c0fe4b677cb4f25f8cdf1f6733fc8d40a04ac160e37a9cc1d3dfeca
 * @features settings-import-export-backup,panels-toolbar-shell
 * @migration-status adapted
 */
import { Columns2, Eye, Square } from "lucide-react"
import { useEffect, useState } from "react"
import { DEFAULT_READER_MOUSE_CURSOR_SETTINGS, type ReaderFitMode } from "@xiranite/node-neoview/ui-core"

import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import type { ReaderRuntimeConfigDto, ReaderViewDefaultsPatch } from "../../../adapters/reader-http-client"
import type { ReaderPanelContext, ReaderSettingsCardContext } from "../../panels/registry"
import { SettingsCardShell } from "../SettingsCardShell"

const FIT_MODES: Array<{ value: ReaderFitMode; label: string }> = [
  { value: "fit", label: "适应窗口" },
  { value: "fill", label: "填满窗口" },
  { value: "fit-width", label: "适应宽度" },
  { value: "fit-height", label: "适应高度" },
  { value: "original", label: "原始大小" },
]

export function ViewDefaultsSettingsCard({
  viewDefaults,
  onChange,
}: {
  viewDefaults: ReaderRuntimeConfigDto["viewDefaults"]
  onChange(patch: ReaderViewDefaultsPatch["viewDefaults"]): Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const [doublePageGapDraft, setDoublePageGapDraft] = useState(() => String(viewDefaults.doublePageGap ?? 0))
  const mouseCursor = viewDefaults.mouseCursor ?? DEFAULT_READER_MOUSE_CURSOR_SETTINGS
  const [cursorHideDelayDraft, setCursorHideDelayDraft] = useState(() => String(mouseCursor.hideDelay))
  const [cursorThresholdDraft, setCursorThresholdDraft] = useState(() => String(mouseCursor.showMovementThreshold))

  useEffect(() => {
    setDoublePageGapDraft(String(viewDefaults.doublePageGap ?? 0))
  }, [viewDefaults.doublePageGap])

  useEffect(() => {
    setCursorHideDelayDraft(String(mouseCursor.hideDelay))
    setCursorThresholdDraft(String(mouseCursor.showMovementThreshold))
  }, [mouseCursor.hideDelay, mouseCursor.showMovementThreshold])

  async function commit(patch: ReaderViewDefaultsPatch["viewDefaults"]) {
    if (saving) return
    setSaving(true)
    setError(undefined)
    try {
      await onChange(patch)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  function commitDoublePageGap() {
    const value = Number(doublePageGapDraft)
    if (!Number.isFinite(value)) {
      setDoublePageGapDraft(String(viewDefaults.doublePageGap ?? 0))
      return
    }
    const normalized = Math.max(-500, Math.min(500, Math.round(value)))
    setDoublePageGapDraft(String(normalized))
    if (normalized !== (viewDefaults.doublePageGap ?? 0)) void commit({ doublePageGap: normalized })
  }

  function commitCursorHideDelay() {
    const value = Number(cursorHideDelayDraft)
    if (!Number.isFinite(value)) {
      setCursorHideDelayDraft(String(mouseCursor.hideDelay))
      return
    }
    const normalized = Math.max(0, Math.min(60, Math.round(value * 10) / 10))
    setCursorHideDelayDraft(String(normalized))
    if (normalized !== mouseCursor.hideDelay) void commit({ mouseCursor: { hideDelay: normalized } })
  }

  function commitCursorThreshold() {
    const value = Number(cursorThresholdDraft)
    if (!Number.isFinite(value)) {
      setCursorThresholdDraft(String(mouseCursor.showMovementThreshold))
      return
    }
    const normalized = Math.max(0, Math.min(1_000, Math.round(value)))
    setCursorThresholdDraft(String(normalized))
    if (normalized !== mouseCursor.showMovementThreshold) void commit({ mouseCursor: { showMovementThreshold: normalized } })
  }

  return (
    <SettingsCardShell id="view-defaults" title="视图默认值" description="新开书籍时的默认缩放与页面模式。" icon={Eye}>
      <div className="grid gap-2">
        <label className="text-sm font-medium" htmlFor="neoview-default-fit-mode">默认缩放模式</label>
        <select
          id="neoview-default-fit-mode"
          className="h-9 w-full max-w-xs rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          disabled={saving}
          value={viewDefaults.fitMode}
          onChange={(event) => void commit({ fitMode: event.currentTarget.value as ReaderFitMode })}
        >
          {FIT_MODES.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
        </select>
      </div>
      {error ? <p role="alert" className="text-sm text-destructive">保存失败：{error}</p> : null}
      <div className="grid gap-2">
        <span className="text-sm font-medium">默认页面模式</span>
        <div className="flex w-fit items-center rounded-md border border-border bg-muted/45 p-0.5" aria-label="默认页面模式">
          <Button
            type="button"
            size="sm"
            variant={viewDefaults.pageMode === "single" ? "default" : "ghost"}
            aria-pressed={viewDefaults.pageMode === "single"}
            disabled={saving}
            onClick={() => void commit({ pageMode: "single" })}
          ><Square />单页</Button>
          <Button
            type="button"
            size="sm"
            variant={viewDefaults.pageMode === "double" ? "default" : "ghost"}
            aria-pressed={viewDefaults.pageMode === "double"}
            disabled={saving}
            onClick={() => void commit({ pageMode: "double" })}
          ><Columns2 />双页</Button>
        </div>
      </div>
      <div className="grid max-w-xs gap-2">
        <label className="text-sm font-medium" htmlFor="neoview-double-page-gap">双页间距</label>
        <div className="flex items-center gap-2">
          <input
            id="neoview-double-page-gap"
            aria-label="双页间距"
            type="number"
            min={-500}
            max={500}
            step={1}
            className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            disabled={saving}
            value={doublePageGapDraft}
            onChange={(event) => setDoublePageGapDraft(event.currentTarget.value)}
            onBlur={commitDoublePageGap}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur()
              if (event.key === "Escape") {
                setDoublePageGapDraft(String(viewDefaults.doublePageGap ?? 0))
                event.currentTarget.blur()
              }
            }}
          />
          <span className="text-xs text-muted-foreground">px</span>
        </div>
      </div>
      <section className="grid max-w-lg gap-3 border-t border-border/60 pt-4" aria-labelledby="neoview-mouse-cursor-heading">
        <div className="flex items-center justify-between gap-3">
          <div className="grid gap-0.5">
            <h3 id="neoview-mouse-cursor-heading" className="text-sm font-medium">鼠标光标</h3>
          </div>
          <Switch aria-label="自动隐藏鼠标光标" checked={mouseCursor.autoHide} disabled={saving} onCheckedChange={(autoHide) => void commit({ mouseCursor: { autoHide } })} />
        </div>
        {mouseCursor.autoHide ? <>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="grid gap-1 text-sm" htmlFor="neoview-cursor-hide-delay">隐藏延迟（秒）
              <input id="neoview-cursor-hide-delay" aria-label="光标隐藏延迟" type="number" min={0} max={60} step={0.1} className="h-9 min-w-0 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" disabled={saving} value={cursorHideDelayDraft} onChange={(event) => setCursorHideDelayDraft(event.currentTarget.value)} onBlur={commitCursorHideDelay} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { setCursorHideDelayDraft(String(mouseCursor.hideDelay)); event.currentTarget.blur() } }} />
            </label>
            <label className="grid gap-1 text-sm" htmlFor="neoview-cursor-movement-threshold">唤醒移动阈值（px）
              <input id="neoview-cursor-movement-threshold" aria-label="光标唤醒移动阈值" type="number" min={0} max={1000} step={1} className="h-9 min-w-0 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" disabled={saving} value={cursorThresholdDraft} onChange={(event) => setCursorThresholdDraft(event.currentTarget.value)} onBlur={commitCursorThreshold} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { setCursorThresholdDraft(String(mouseCursor.showMovementThreshold)); event.currentTarget.blur() } }} />
            </label>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <CursorWakeSwitch label="点击时唤醒光标" checked={mouseCursor.showOnButtonClick} disabled={saving} onCheckedChange={(showOnButtonClick) => void commit({ mouseCursor: { showOnButtonClick } })} />
            <CursorWakeSwitch label="按键时唤醒光标" checked={mouseCursor.showOnKeyDown} disabled={saving} onCheckedChange={(showOnKeyDown) => void commit({ mouseCursor: { showOnKeyDown } })} />
            <CursorWakeSwitch label="滚轮时唤醒光标" checked={mouseCursor.showOnWheel} disabled={saving} onCheckedChange={(showOnWheel) => void commit({ mouseCursor: { showOnWheel } })} />
          </div>
        </> : null}
      </section>
    </SettingsCardShell>
  )
}

function CursorWakeSwitch({ label, checked, disabled, onCheckedChange }: { label: string; checked: boolean; disabled: boolean; onCheckedChange(checked: boolean): void }) {
  return <label className="flex min-h-9 items-center justify-between gap-2 text-xs text-muted-foreground"><span>{label}</span><Switch aria-label={label} size="sm" checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} /></label>
}

export default function DockedViewDefaultsSettingsCard({ viewDefaults, onViewDefaults }: ReaderPanelContext) {
  if (!viewDefaults || !onViewDefaults) return null
  return <ViewDefaultsSettingsCard viewDefaults={viewDefaults} onChange={onViewDefaults} />
}

export function SettingsViewDefaultsCard({ viewDefaults, onViewDefaults }: ReaderSettingsCardContext) {
  if (!viewDefaults || !onViewDefaults) return null
  return <ViewDefaultsSettingsCard viewDefaults={viewDefaults} onChange={onViewDefaults} />
}

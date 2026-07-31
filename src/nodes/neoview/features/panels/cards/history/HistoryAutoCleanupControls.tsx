import { useEffect, useState } from "react"

import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { DEFAULT_READER_HISTORY_AUTO_CLEANUP, type ReaderHistoryAutoCleanupDto } from "../../../../adapters/reader-http-client"

const CLEANUP_INTERVALS = [15, 60, 360, 1_440, 10_080]

export function HistoryAutoCleanupControls({ value, disabled, onChange }: {
  value?: ReaderHistoryAutoCleanupDto
  disabled: boolean
  onChange?(patch: Partial<ReaderHistoryAutoCleanupDto>): Promise<void>
}) {
  const configured = value ?? DEFAULT_READER_HISTORY_AUTO_CLEANUP
  const [draft, setDraft] = useState(configured)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => setDraft(configured), [configured.enabled, configured.intervalMinutes, configured.trigger])

  async function commit(patch: Partial<ReaderHistoryAutoCleanupDto>) {
    if (!onChange || pending) return
    const previous = draft
    const next = { ...draft, ...patch }
    setDraft(next)
    setPending(true)
    setError(undefined)
    try {
      await onChange(patch)
    } catch (cause) {
      setDraft(previous)
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(false)
    }
  }

  const controlsDisabled = disabled || pending || !onChange
  return (
    <div className="grid gap-3 rounded border p-3" data-history-auto-cleanup="true">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <Label htmlFor="neoview-history-auto-cleanup">自动清理失效历史</Label>
          <p className="mt-1 text-[10px] text-muted-foreground">仅删除确认不存在的路径，离线磁盘记录会保留。</p>
        </div>
        <Switch
          id="neoview-history-auto-cleanup"
          checked={draft.enabled}
          disabled={controlsDisabled}
          aria-label="自动清理失效历史"
          onCheckedChange={(enabled) => void commit({ enabled })}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1 text-[10px] text-muted-foreground">
          扫描方式
          <select
            className="h-8 rounded border border-input bg-background px-2 text-xs text-foreground"
            aria-label="历史自动清理扫描方式"
            value={draft.trigger}
            disabled={controlsDisabled || !draft.enabled}
            onChange={(event) => void commit({ trigger: event.currentTarget.value as ReaderHistoryAutoCleanupDto["trigger"] })}
          >
            <option value="on-show">呼出时扫描</option>
            <option value="interval">呼出并定时扫描</option>
          </select>
        </label>
        <label className="grid gap-1 text-[10px] text-muted-foreground">
          扫描周期
          <select
            className="h-8 rounded border border-input bg-background px-2 text-xs text-foreground"
            aria-label="历史自动清理扫描周期"
            value={draft.intervalMinutes}
            disabled={controlsDisabled || !draft.enabled || draft.trigger !== "interval"}
            onChange={(event) => void commit({ intervalMinutes: Number(event.currentTarget.value) })}
          >
            {CLEANUP_INTERVALS.map((minutes) => <option key={minutes} value={minutes}>{formatInterval(minutes)}</option>)}
          </select>
        </label>
      </div>
      {error ? <div role="alert" className="text-xs text-destructive">{error}</div> : null}
    </div>
  )
}

function formatInterval(minutes: number): string {
  if (minutes < 60) return `${minutes} 分钟`
  if (minutes < 1_440) return `${minutes / 60} 小时`
  if (minutes < 10_080) return `${minutes / 1_440} 天`
  return "7 天"
}

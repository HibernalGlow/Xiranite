/**
 * @migrated-from src/lib/cards/upscale/ProgressiveUpscaleCard.svelte
 * @migrated-from src/lib/cards/upscale/UpscaleControlCard.svelte
 * @source-hash sha256:83acedf9cae856ef8224b45bcd63b1d8dc6e9f7312161eb649f07ed9dd6f99ef
 * @ast-prototype migration/neoview/frontend/tsx-scaffold/src/lib/cards/upscale/ProgressiveUpscaleCard.tsx
 * @source-ui-inventory migration/neoview/progressive-upscale-compatibility.json#sourceUiInventory
 * @migration-status partial
 * @unsupported live upscale outcome counts remain transport-pending; settings and bounded preload status are available.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"

import { Progress } from "@/components/ui/progress"
import { Switch } from "@/components/ui/switch"
import type {
  ReaderSuperResolutionConfigDto,
  ReaderSuperResolutionPreferencesDto,
} from "../../../adapters/reader-http-client"
import { EMPTY_READER_UPSCALE_PRELOAD_SNAPSHOTS, readerUpscalePreloadSnapshot, subscribeReaderUpscalePreload } from "../../reader/ReaderUpscalePreloadStore"
import type { ReaderPanelContext } from "../registry"

const DEFAULT_PREFERENCES: Required<Pick<ReaderSuperResolutionPreferencesDto, "autoUpscaleEnabled" | "preUpscaleEnabled" | "preloadPages" | "backgroundConcurrency" | "progressiveEnabled" | "progressiveDwellTimeMs" | "progressiveMaxPages">> = {
  autoUpscaleEnabled: false,
  preUpscaleEnabled: true,
  preloadPages: 3,
  backgroundConcurrency: 2,
  progressiveEnabled: false,
  progressiveDwellTimeMs: 3_000,
  progressiveMaxPages: 20,
}

const PRELOAD_PAGE_OPTIONS = [1, 2, 3, 5, 10, 20]
const CONCURRENCY_OPTIONS = [1, 2, 3, 4]
const DWELL_OPTIONS = [1, 2, 3, 5, 10, 15, 30]
const MAX_PAGE_OPTIONS = [5, 10, 20, 50, 100, 999]

type ProgressivePreferences = typeof DEFAULT_PREFERENCES
type Feedback = { tone: "success" | "warning" | "error"; text: string }

export default function ProgressiveUpscaleCard({ client, session, disabled, panelActive = true, superResolution, onSuperResolutionChange }: ReaderPanelContext) {
  const [config, setConfig] = useState<ReaderSuperResolutionConfigDto>(superResolution)
  const [preferences, setPreferences] = useState<ProgressivePreferences>(DEFAULT_PREFERENCES)
  const [feedback, setFeedback] = useState<Feedback>()
  const [clock, setClock] = useState(() => Date.now())
  const generationRef = useRef(0)
  const commitQueueRef = useRef(Promise.resolve())

  useEffect(() => {
    if (!superResolution) return
    setConfig(superResolution)
    setPreferences(normalizePreferences(superResolution.preferences))
  }, [superResolution])

  useEffect(() => {
    const generation = ++generationRef.current
    const controller = new AbortController()
    void client.config(controller.signal).then((value) => {
      if (generation !== generationRef.current) return
      const nextConfig = value.superResolution
      setConfig(nextConfig)
      setPreferences(normalizePreferences(nextConfig?.preferences))
      setFeedback(undefined)
    }).catch((error: unknown) => {
      if (generation === generationRef.current && !controller.signal.aborted) {
        setFeedback({ tone: "warning", text: `超分配置读取失败：${error instanceof Error ? error.message : "未知错误"}` })
      }
    })
    return () => {
      generationRef.current += 1
      controller.abort()
    }
  }, [client])

  const sessionId = session?.sessionId ?? ""
  const subscribePreloads = useCallback((listener: () => void) => sessionId
    ? subscribeReaderUpscalePreload(sessionId, listener)
    : () => undefined, [sessionId])
  const getPreloads = useCallback(() => sessionId ? readerUpscalePreloadSnapshot(sessionId) : EMPTY_READER_UPSCALE_PRELOAD_SNAPSHOTS, [sessionId])
  const preloads = useSyncExternalStore(subscribePreloads, getPreloads, getPreloads)

  const progressive = preloads.find((snapshot) => snapshot.mode === "progressive")
  useEffect(() => {
    if (progressive?.state !== "countdown") return
    setClock(Date.now())
    const timer = window.setInterval(() => setClock(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [progressive?.generation, progressive?.startedAt, progressive?.state])

  const totalPages = session?.book.pageCount ?? 0
  const pendingCount = preloads.reduce((total, snapshot) => total + snapshot.pending, 0)
  const settledCount = preloads.reduce((total, snapshot) => total + snapshot.settled, 0)
  const plannedCount = preloads.reduce((total, snapshot) => total + snapshot.planned, 0)
  const isAutoEnabled = preferences.autoUpscaleEnabled
  const progressLabel = totalPages > 0 ? `${Math.min(settledCount, totalPages)} / ${totalPages}` : "0 / 0"
  const status = useMemo(() => {
    if (!preferences.progressiveEnabled || !isAutoEnabled) return undefined
    if (!progressive) return { tone: "muted" as const, label: "等待调度" }
    if (progressive.state === "countdown") {
      const remaining = Math.max(0, Math.ceil((progressive.startedAt + preferences.progressiveDwellTimeMs - clock) / 1_000))
      return remaining > 0 ? { tone: "amber" as const, label: `${remaining}秒后触发` } : { tone: "green" as const, label: "即将触发" }
    }
    if (progressive.state === "queued" || progressive.state === "running") return { tone: "cyan" as const, label: "触发中" }
    if (progressive.state === "completed") return { tone: "green" as const, label: "已完成" }
    if (progressive.state === "failed") return { tone: "red" as const, label: "失败" }
    if (progressive.state === "cancelled") return { tone: "amber" as const, label: "已取消" }
    if (progressive.state === "paused") return { tone: "amber" as const, label: "已暂停" }
    if (progressive.state === "disabled") return { tone: "amber" as const, label: "未启用" }
    if (progressive.state === "empty") return { tone: "muted" as const, label: "无待处理页" }
    return { tone: "muted", label: "待机" }
  }, [clock, isAutoEnabled, preferences.progressiveDwellTimeMs, preferences.progressiveEnabled, progressive])

  function commit(patch: ReaderSuperResolutionPreferencesDto, next: ProgressivePreferences) {
    setPreferences(next)
    setFeedback(undefined)
    if (!onSuperResolutionChange && !client.updateSuperResolution) {
      setFeedback({ tone: "warning", text: "当前 Reader 不支持超分配置写入" })
      return
    }
    commitQueueRef.current = commitQueueRef.current.then(async () => {
      try {
        const updated = onSuperResolutionChange
          ? await onSuperResolutionChange(patch)
          : await client.updateSuperResolution!({ superResolution: { preferences: patch } })
        setConfig(updated)
        setPreferences(normalizePreferences(updated.preferences))
        setFeedback({ tone: "success", text: "超分设置已保存" })
      } catch (error: unknown) {
        setFeedback({ tone: "error", text: `超分设置保存失败：${error instanceof Error ? error.message : "未知错误"}` })
      }
    })
  }

  function updatePreference<K extends keyof ProgressivePreferences>(key: K, value: ProgressivePreferences[K]) {
    const next = { ...preferences, [key]: value }
    commit({ [key]: value }, next)
  }

  return (
    <div className="space-y-3 text-xs" data-neoview-progressive-upscale="true" data-panel-active={panelActive ? "true" : "false"} data-upscale-provider={config?.provider ?? "unknown"}>
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium" htmlFor="neoview-auto-upscale">自动超分</label>
        <Switch
          id="neoview-auto-upscale"
          checked={preferences.autoUpscaleEnabled}
          onCheckedChange={(value) => updatePreference("autoUpscaleEnabled", value)}
          disabled={disabled || config?.provider === "disabled"}
          aria-label="自动超分"
        />
      </div>
      <p className="-mt-1 text-[10px] text-muted-foreground">切换图片时自动执行超分（全局主开关）</p>

      <div className="border-t border-border pt-3">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium" htmlFor="neoview-pre-upscale">预超分</label>
        <Switch
          id="neoview-pre-upscale"
          checked={preferences.preUpscaleEnabled}
          onCheckedChange={(value) => updatePreference("preUpscaleEnabled", value)}
          disabled={disabled || !isAutoEnabled}
          aria-label="预超分"
        />
      </div>
      <p className="-mt-1 text-[10px] text-muted-foreground">预加载相邻页面并后台超分</p>
      </div>

      {!isAutoEnabled ? <div className="rounded bg-amber-500/10 p-2 text-[10px] text-amber-600">需要先启用“自动超分”才能生效</div> : null}

      {preferences.preUpscaleEnabled && isAutoEnabled ? (
        <div className="space-y-2">
          <SelectField label="预加载页数" value={preferences.preloadPages} options={PRELOAD_PAGE_OPTIONS} disabled={disabled} onChange={(value) => updatePreference("preloadPages", value)} suffix="页" />
          <SelectField label="后台并发数" value={preferences.backgroundConcurrency} options={CONCURRENCY_OPTIONS} disabled={disabled} onChange={(value) => updatePreference("backgroundConcurrency", value)} />
        </div>
      ) : null}

      <div className="border-t border-border pt-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium" htmlFor="neoview-progressive-upscale">递进超分</label>
          <Switch
            id="neoview-progressive-upscale"
            checked={preferences.progressiveEnabled}
            onCheckedChange={(value) => updatePreference("progressiveEnabled", value)}
            disabled={disabled}
            aria-label="递进超分"
          />
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground">停留 {Math.round(preferences.progressiveDwellTimeMs / 1_000)} 秒后自动向后超分</p>
      </div>

      {preferences.progressiveEnabled && isAutoEnabled ? (
        <div className="space-y-2">
          <SelectField label="停留时间" value={Math.round(preferences.progressiveDwellTimeMs / 1_000)} options={DWELL_OPTIONS} disabled={disabled} onChange={(value) => updatePreference("progressiveDwellTimeMs", value * 1_000)} suffix="秒" />
          <SelectField label="最大页数" value={preferences.progressiveMaxPages} options={MAX_PAGE_OPTIONS} disabled={disabled} onChange={(value) => updatePreference("progressiveMaxPages", value)} formatValue={(value) => value === 999 ? "全部" : String(value)} suffix={preferences.progressiveMaxPages === 999 ? undefined : "页"} />
        </div>
      ) : null}

      <div className="space-y-2 border-t border-border pt-2">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">已超分</span>
          <span className="font-mono text-xs text-emerald-600">{progressLabel}</span>
        </div>
        {pendingCount > 0 ? <div className="flex items-center justify-between"><span className="text-muted-foreground">队列中</span><span className="font-mono text-xs text-cyan-600">{pendingCount}</span></div> : null}
        {totalPages > 0 ? <Progress value={plannedCount > 0 ? (settledCount / plannedCount) * 100 : 0} className="h-1.5" aria-label="超分完成进度" /> : null}
        {status ? <div className="flex items-center justify-between"><span className="text-muted-foreground">递进状态</span><span className={`font-mono text-xs ${statusToneClass(status.tone)}`} data-upscale-progressive-status={status.tone}>{status.label}</span></div> : null}
      </div>

      {feedback ? <div className={feedback.tone === "error" ? "rounded bg-destructive/10 p-2 text-destructive" : feedback.tone === "warning" ? "rounded bg-amber-500/10 p-2 text-amber-700" : "rounded bg-emerald-500/10 p-2 text-emerald-700"} role={feedback.tone === "error" ? "alert" : "status"} aria-live="polite">{feedback.text}</div> : null}
    </div>
  )
}

function normalizePreferences(value: ReaderSuperResolutionPreferencesDto | undefined): ProgressivePreferences {
  return {
    ...DEFAULT_PREFERENCES,
    ...value,
    progressiveDwellTimeMs: value?.progressiveDwellTimeMs ?? DEFAULT_PREFERENCES.progressiveDwellTimeMs,
  }
}

function statusToneClass(tone: "cyan" | "amber" | "green" | "red" | "muted"): string {
  if (tone === "cyan") return "text-cyan-600"
  if (tone === "amber") return "text-amber-600"
  if (tone === "green") return "text-emerald-600"
  if (tone === "red") return "text-destructive"
  return "text-muted-foreground"
}

function SelectField({ label, value, options, disabled, onChange, suffix, formatValue = String }: {
  label: string
  value: number
  options: readonly number[]
  disabled: boolean
  suffix?: string
  onChange(value: number): void
  formatValue?: (value: number) => string
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <select className="h-6 rounded border border-input bg-background px-2 text-xs" value={value} disabled={disabled} aria-label={label} onChange={(event) => onChange(Number(event.currentTarget.value))}>
        {options.map((option) => <option key={option} value={option}>{formatValue(option)}{suffix ? ` ${suffix}` : ""}</option>)}
      </select>
    </label>
  )
}

/**
 * @migrated-from src/lib/cards/monitor/SystemMonitorCard.svelte
 * @source-hash sha256:599fbdeb29e842871c119c64ef4a1daa3ca0f7fa52e5f66670172d3178d0ad61
 * @ast-prototype migration/neoview/frontend/tsx-scaffold/src/lib/cards/monitor/SystemMonitorCard.tsx
 * @migration-status adapted
 */
import { Activity, Cpu, RefreshCw, RotateCcw } from "lucide-react"
import { lazy, startTransition, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Progress } from "@/components/ui/progress"

import type {
  ReaderSystemMonitorConfigDto,
  ReaderSystemMonitorIntervalDto,
  ReaderSystemMonitorSnapshotDto,
} from "../../../adapters/reader-http-client"
import type { ReaderPanelContext } from "../registry"
import { ReaderCardEmptyState } from "./ReaderCardEmptyState"
import type { SystemMonitorHistoryPoint } from "./system-monitor/SystemMonitorHistoryChart"

const SystemMonitorHistoryChart = lazy(() => import("./system-monitor/SystemMonitorHistoryChart"))
const INTERVALS: readonly ReaderSystemMonitorIntervalDto[] = [500, 1_000, 2_000, 5_000]
const DEFAULT_PREFERENCES: ReaderSystemMonitorConfigDto = { enabled: true, refreshIntervalMs: 1_000, maxSamples: 60 }
const LEGACY_MONITORING_KEY = "neoview-monitor-isMonitoring"
const LEGACY_INTERVAL_KEY = "neoview-monitor-refreshInterval"
const LEGACY_IMPORT_MARKER = "xiranite-neoview-monitor-imported-v1"

export default function SystemMonitorCard(props: ReaderPanelContext) {
  if (!props.panelActive) return <ReaderCardEmptyState />
  return <SystemMonitorContent {...props} />
}

function SystemMonitorContent({ client, disabled }: ReaderPanelContext) {
  const [preferences, setPreferences] = useState<ReaderSystemMonitorConfigDto>()
  const [sample, setSample] = useState<ReaderSystemMonitorSnapshotDto>()
  const [history, setHistory] = useState<readonly SystemMonitorHistoryPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const timerRef = useRef<ReturnType<typeof setTimeout>>()
  const requestRef = useRef<{ controller: AbortController; promise: Promise<void> }>()
  const generationRef = useRef(0)

  const requestSample = useCallback((): Promise<void> => {
    if (requestRef.current) return requestRef.current.promise
    if (!client.systemMonitorSnapshot) {
      setError("当前 Reader 后端不支持系统资源采样。")
      setLoading(false)
      return Promise.resolve()
    }
    const controller = new AbortController()
    const promise = client.systemMonitorSnapshot(controller.signal).then((next) => {
      setSample(next)
      setError(undefined)
      startTransition(() => {
        setHistory((current) => {
          const memoryPercent = percent(next.memory.usedBytes, next.memory.totalBytes)
          const appended = [...current, { sampledAtMs: next.sampledAtMs, cpuPercent: finitePercent(next.cpu.averageUsagePercent), memoryPercent }]
          return appended.slice(-Math.max(10, preferences?.maxSamples ?? 60))
        })
      })
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(errorMessage(reason))
    }).finally(() => {
      if (requestRef.current?.promise === promise) requestRef.current = undefined
      setLoading(false)
    })
    requestRef.current = { controller, promise }
    return promise
  }, [client, preferences?.maxSamples])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    void client.config(controller.signal).then(async (config) => {
      let loaded = config.systemMonitor ?? DEFAULT_PREFERENCES
      const legacy = readLegacyMonitorPreferences(loaded)
      if (legacy?.patch && client.updateSystemMonitor) {
        loaded = await client.updateSystemMonitor({ systemMonitor: legacy.patch }, controller.signal)
        finalizeLegacyMonitorImport()
      } else if (legacy?.discard) {
        finalizeLegacyMonitorImport()
      }
      if (controller.signal.aborted) return
      setPreferences(loaded)
      setError(undefined)
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) {
        setError(errorMessage(reason))
        setLoading(false)
      }
    })
    return () => controller.abort()
  }, [client])

  useEffect(() => {
    if (!preferences?.enabled) {
      setLoading(false)
      return
    }
    const generation = ++generationRef.current
    let disposed = false
    const tick = async () => {
      await requestSample()
      if (!disposed && generationRef.current === generation) {
        timerRef.current = setTimeout(tick, preferences.refreshIntervalMs)
      }
    }
    void tick()
    return () => {
      disposed = true
      generationRef.current += 1
      if (timerRef.current !== undefined) clearTimeout(timerRef.current)
      timerRef.current = undefined
      requestRef.current?.controller.abort()
      requestRef.current = undefined
    }
  }, [preferences?.enabled, preferences?.refreshIntervalMs, requestSample])

  const updatePreferences = useCallback(async (patch: Partial<ReaderSystemMonitorConfigDto>) => {
    if (!client.updateSystemMonitor) {
      setError("当前 Reader 后端不支持保存系统监控设置。")
      return
    }
    const previous = preferences
    setPreferences((current) => current ? { ...current, ...patch } : current)
    try {
      const updated = await client.updateSystemMonitor({ systemMonitor: patch })
      setPreferences(updated)
      setError(undefined)
    } catch (reason) {
      setPreferences(previous)
      setError(errorMessage(reason))
    }
  }, [client, preferences])

  if (!preferences) {
    return <div className="h-14 animate-pulse rounded bg-muted" aria-label="正在加载系统监控设置" />
  }

  const cpuPeak = peak(history, "cpuPercent")
  const memoryPeak = peak(history, "memoryPercent")
  return (
    <div className="min-w-0 space-y-3 text-xs" data-system-monitor="true">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={preferences.enabled ? "destructive" : "default"}
            disabled={disabled}
            onClick={() => void updatePreferences({ enabled: !preferences.enabled })}
          >
            <Activity className="size-4" aria-hidden="true" />
            {preferences.enabled ? "停止监控" : "开始监控"}
          </Button>
          <Button size="sm" variant="outline" disabled={disabled || loading} onClick={() => void requestSample()}>
            <RefreshCw className={`size-4 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" />
            刷新
          </Button>
        </div>
        <label className="flex items-center gap-2 text-muted-foreground">
          刷新间隔
          <NativeSelect
            size="sm"
            aria-label="刷新间隔"
            disabled={disabled}
            value={preferences.refreshIntervalMs}
            onChange={(event) => void updatePreferences({ refreshIntervalMs: Number(event.target.value) as ReaderSystemMonitorIntervalDto })}
          >
            {INTERVALS.map((interval) => <NativeSelectOption key={interval} value={interval}>{interval / 1_000} 秒</NativeSelectOption>)}
          </NativeSelect>
        </label>
      </div>

      {error ? <div className="rounded bg-destructive/10 p-2 text-destructive" role="alert">{error}</div> : null}
      {!sample ? (
        <div className="py-8 text-center text-muted-foreground" role="status">
          {loading ? "正在加载系统状态…" : preferences.enabled ? "等待系统状态…" : "点击“开始监控”查看系统状态"}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <MetricTile label="系统运行时间" value={formatUptime(sample.uptimeSeconds)} />
            <MetricTile label="负载平均" value={sample.loadAverage.map((value) => finite(value).toFixed(2)).join(" / ")} />
            <MetricTile label="CPU 核心" value={`${sample.cpu.cores.length} 核`} />
          </div>

          <MetricSection title="CPU" icon={<Cpu className="size-4" aria-hidden="true" />}>
            <UsageBar label="平均使用率" value={sample.cpu.averageUsagePercent} />
            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
              {sample.cpu.cores.map((core) => <UsageBar key={core.index} label={`Core ${core.index}`} value={core.usagePercent} compact />)}
            </div>
          </MetricSection>

          <MetricSection title="内存">
            <UsageBar label="内存使用率" value={percent(sample.memory.usedBytes, sample.memory.totalBytes)} />
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Value label="总计" value={formatBytes(sample.memory.totalBytes)} />
              <Value label="已用" value={formatBytes(sample.memory.usedBytes)} />
              <Value label="空闲" value={formatBytes(sample.memory.freeBytes)} />
              <Value label="缓存" value={sample.memory.cachedBytes === null ? "不可用" : formatBytes(sample.memory.cachedBytes)} />
            </dl>
          </MetricSection>

          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            <MetricSection title="网络">
              {sample.network.available ? (
                <dl className="grid grid-cols-2 gap-2">
                  <Value label="下载" value={formatRate(sample.network.receiveBytesPerSecond)} />
                  <Value label="上传" value={formatRate(sample.network.transmitBytesPerSecond)} />
                </dl>
              ) : <Unavailable>当前宿主采样器无法提供网络吞吐率。</Unavailable>}
            </MetricSection>
            <MetricSection title="磁盘">
              {sample.disk.available && sample.disk.totalBytes !== null && sample.disk.usedBytes !== null ? (
                <>
                  <UsageBar label="磁盘使用率" value={percent(sample.disk.usedBytes, sample.disk.totalBytes)} />
                  <dl className="grid grid-cols-3 gap-2">
                    <Value label="总计" value={formatBytes(sample.disk.totalBytes)} />
                    <Value label="已用" value={formatBytes(sample.disk.usedBytes)} />
                    <Value label="可用" value={formatBytes(sample.disk.freeBytes)} />
                  </dl>
                </>
              ) : <Unavailable>当前宿主无法提供磁盘容量。</Unavailable>}
            </MetricSection>
          </div>

          <MetricSection title="GPU" icon={<Cpu className="size-4" aria-hidden="true" />}>
            <Unavailable>GPU 监控功能开发中，需要专用后端采样支持。</Unavailable>
          </MetricSection>

          <MetricSection title="趋势">
            <div className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground">
              <span>CPU 峰值 {cpuPeak.toFixed(1)}% · 内存峰值 {memoryPeak.toFixed(1)}%</span>
              <Button size="sm" variant="ghost" disabled={!history.length} onClick={() => setHistory([])}>
                <RotateCcw className="size-3" aria-hidden="true" />重置历史
              </Button>
            </div>
            {history.length > 1 ? (
              <Suspense fallback={<div className="h-36 animate-pulse rounded bg-muted" aria-label="正在加载趋势图" />}>
                <SystemMonitorHistoryChart samples={history} />
              </Suspense>
            ) : <Unavailable>至少需要两个样本才能显示趋势。</Unavailable>}
          </MetricSection>
        </>
      )}
    </div>
  )
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded bg-muted/50 p-2"><div className="mb-1 text-muted-foreground">{label}</div><div className="break-words font-mono font-semibold tabular-nums">{value}</div></div>
}

function MetricSection({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return <section className="min-w-0 space-y-2 rounded border p-2"><h3 className="flex items-center gap-1 font-medium">{icon}{title}</h3>{children}</section>
}

function UsageBar({ label, value, compact = false }: { label: string; value: number; compact?: boolean }) {
  const safe = finitePercent(value)
  return <div className="min-w-0 space-y-1"><div className="flex justify-between gap-2"><span className="truncate">{label}</span><span className="tabular-nums">{safe.toFixed(1)}%</span></div><Progress className={`${compact ? "h-1.5" : "h-2"} motion-reduce:[&_[data-slot=progress-indicator]]:transition-none ${safe >= 90 ? "[&_[data-slot=progress-indicator]]:bg-destructive" : safe >= 75 ? "[&_[data-slot=progress-indicator]]:bg-orange-500" : safe >= 50 ? "[&_[data-slot=progress-indicator]]:bg-yellow-500" : ""}`} value={safe} label={`${label} ${safe.toFixed(1)}%`} /></div>
}

function Value({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded bg-muted/40 p-2"><dt className="truncate text-muted-foreground">{label}</dt><dd className="truncate font-mono tabular-nums" title={value}>{value}</dd></div>
}

function Unavailable({ children }: { children: ReactNode }) {
  return <p className="break-words rounded bg-muted/40 p-2 text-muted-foreground">{children}</p>
}

export function formatSystemMonitorUptime(seconds: number): string {
  return formatUptime(seconds)
}

export function formatSystemMonitorBytes(bytes: number | null | undefined): string {
  return bytes === null || bytes === undefined ? "不可用" : formatBytes(bytes)
}

function formatUptime(seconds: number): string {
  const safe = Math.floor(Math.max(0, finite(seconds)))
  const days = Math.floor(safe / 86_400)
  const hours = Math.floor((safe % 86_400) / 3_600)
  const minutes = Math.floor((safe % 3_600) / 60)
  if (days > 0) return `${days}天 ${hours}小时`
  if (hours > 0) return `${hours}小时 ${minutes}分钟`
  return `${minutes}分钟`
}

function formatBytes(bytes: number): string {
  const safe = Math.max(0, finite(bytes))
  const units = ["B", "KB", "MB", "GB", "TB"] as const
  if (safe === 0) return "0 B"
  const power = Math.min(units.length - 1, Math.floor(Math.log(safe) / Math.log(1_024)))
  const value = safe / 1_024 ** power
  return `${value >= 100 || power === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[power]}`
}

function formatRate(bytes: number | null): string {
  return bytes === null ? "不可用" : `${formatBytes(bytes)}/s`
}

function percent(used: number, total: number): number {
  return total > 0 ? finitePercent((used / total) * 100) : 0
}

function peak(samples: readonly SystemMonitorHistoryPoint[], key: "cpuPercent" | "memoryPercent"): number {
  let result = 0
  for (const sample of samples) result = Math.max(result, finitePercent(sample[key]))
  return result
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function finitePercent(value: number): number {
  return Math.min(100, Math.max(0, finite(value)))
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

function readLegacyMonitorPreferences(current: ReaderSystemMonitorConfigDto): { patch?: Partial<ReaderSystemMonitorConfigDto>; discard?: true } | undefined {
  try {
    if (localStorage.getItem(LEGACY_IMPORT_MARKER) === "1") return undefined
    const enabledRaw = localStorage.getItem(LEGACY_MONITORING_KEY)
    const intervalRaw = localStorage.getItem(LEGACY_INTERVAL_KEY)
    if (enabledRaw === null && intervalRaw === null) return undefined
    if (current.enabled !== DEFAULT_PREFERENCES.enabled
      || current.refreshIntervalMs !== DEFAULT_PREFERENCES.refreshIntervalMs
      || current.maxSamples !== DEFAULT_PREFERENCES.maxSamples) {
      return { discard: true }
    }
    const patch: Partial<ReaderSystemMonitorConfigDto> = {}
    if (enabledRaw !== null) {
      const enabled = JSON.parse(enabledRaw) as unknown
      if (typeof enabled === "boolean") patch.enabled = enabled
    }
    if (intervalRaw !== null) {
      const interval = JSON.parse(intervalRaw) as unknown
      if (typeof interval === "number" && INTERVALS.includes(interval as ReaderSystemMonitorIntervalDto)) {
        patch.refreshIntervalMs = interval as ReaderSystemMonitorIntervalDto
      }
    }
    return Object.keys(patch).length ? { patch } : { discard: true }
  } catch {
    return { discard: true }
  }
}

function finalizeLegacyMonitorImport(): void {
  try {
    localStorage.removeItem(LEGACY_MONITORING_KEY)
    localStorage.removeItem(LEGACY_INTERVAL_KEY)
    localStorage.setItem(LEGACY_IMPORT_MARKER, "1")
  } catch {
    // A storage-restricted browser can still use the canonical backend config.
  }
}

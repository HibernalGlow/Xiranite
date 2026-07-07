import { useRef, useState } from "react"
import type { NodeComponentProps } from "@xiranite/contract"
import type { RecycleuData, RecycleuInput, RecycleuResult } from "@xiranite/node-recycleu/core"
import { Gauge, Play, Settings2, ShieldCheck, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import { statusFromState } from "./constants"
import {
  CleanupFields,
  ConfirmActionButton,
  IconConfirmButton,
  IntervalPresets,
  LogPanel,
  StatusStrip,
  TimerDial,
} from "./controls"
import type { RecycleuCardState, RecycleuStatusMeta } from "./types"

export function Component({ compId, host }: NodeComponentProps) {
  const surface = useNodeSurface()
  const data = host.getData<RecycleuCardState>(compId) ?? {}
  const dataRef = useRef<RecycleuCardState>(data)
  dataRef.current = data

  const [running, setRunning] = useState(false)
  const interval = clampNumber(data.interval, 10, 5, 3600)
  const maxCycles = clampNumber(data.maxCycles, 1, 1, 360)
  const driveLetter = sanitizeDrive(data.driveLetter)
  const logs = data.logs ?? []
  const cleanCount = data.cleanCount ?? data.result?.cleanCount ?? 0
  const lastCleanTime = data.lastCleanTime ?? data.result?.lastCleanTime ?? null
  const progress = data.progress ?? (running ? 0 : data.phase === "completed" ? 100 : 0)
  const remainingSeconds = data.remainingSeconds ?? interval
  const status = statusFromState(data, running)
  const compactSurface = surface.mode === "compact" || surface.mode === "portrait"
  const forceCollapsedSurface = compactSurface && surface.height > 0 && surface.height < 160
  const portraitCompact = surface.mode === "portrait" || (surface.mode === "compact" && surface.height >= 430)
  const crampedCompact = surface.mode === "compact" && surface.height > 0 && surface.height < 280

  function patch(patchData: Partial<RecycleuCardState>) {
    dataRef.current = { ...dataRef.current, ...patchData }
    host.patchData(compId, patchData)
  }

  function pushLog(message: string, patchData: Partial<RecycleuCardState> = {}) {
    const nextLogs = [...(dataRef.current.logs ?? []), message].slice(-100)
    patch({ ...patchData, logs: nextLogs })
  }

  function updateSettings(patchData: Partial<RecycleuCardState>) {
    const next: Partial<RecycleuCardState> = { ...patchData }
    if (next.interval !== undefined) next.interval = clampNumber(next.interval, 10, 5, 3600)
    if (next.maxCycles !== undefined) next.maxCycles = clampNumber(next.maxCycles, 1, 1, 360)
    if (next.driveLetter !== undefined) next.driveLetter = sanitizeDrive(next.driveLetter)
    patch(next)
  }

  async function execute(action: RecycleuInput["action"]) {
    if (running) return
    const runAction = host.actions?.run
    if (!runAction) {
      const message = "Local Backend 暂不可用，无法执行 recycleu。"
      pushLog(message, { phase: "error", progress: 0, progressText: message })
      return
    }

    const input: RecycleuInput = {
      action,
      interval,
      maxCycles,
      driveLetter: driveLetter || undefined,
    }

    setRunning(true)
    patch({
      action,
      phase: "running",
      progress: 0,
      progressText: action === "start" ? "自动清理已启动。" : action === "clean_now" ? "正在清空回收站。" : "正在读取状态。",
      remainingSeconds: interval,
    })

    try {
      const response = await runAction<RecycleuInput, RecycleuData>("recycleu", input, (event) => {
        if (event.type === "progress") {
          const seconds = parseRemainingSeconds(event.message)
          patch({
            progress: event.progress ?? dataRef.current.progress ?? 0,
            progressText: event.message,
            remainingSeconds: seconds ?? dataRef.current.remainingSeconds ?? interval,
          })
          pushLog(event.message)
          return
        }
        pushLog(event.message)
      }) as RecycleuResult

      patch({
        phase: response.success ? "completed" : "error",
        progress: response.success ? 100 : 0,
        progressText: response.message,
        result: response.data ?? null,
        cleanCount: response.data?.cleanCount ?? dataRef.current.cleanCount ?? cleanCount,
        lastCleanTime: response.data?.lastCleanTime ?? dataRef.current.lastCleanTime ?? lastCleanTime,
        remainingSeconds: response.data?.remainingSeconds ?? 0,
      })
      pushLog(response.message)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      pushLog(message, { phase: "error", progress: 0, progressText: message })
    } finally {
      setRunning(false)
    }
  }

  function reset() {
    patch({
      action: undefined,
      phase: "idle",
      progress: 0,
      progressText: "",
      remainingSeconds: interval,
      cleanCount: 0,
      lastCleanTime: null,
      result: null,
      logs: [],
    })
  }

  async function copyLogs() {
    if (logs.length) await host.clipboard?.writeText?.(logs.join("\n"))
  }

  const commonProps = {
    cleanCount,
    data: { ...data, interval, maxCycles, driveLetter },
    driveLetter,
    interval,
    lastCleanTime,
    logs,
    maxCycles,
    progress,
    remainingSeconds,
    running,
    status,
    onCopyLogs: copyLogs,
    onExecute: execute,
    onPatch: updateSettings,
    onReset: reset,
  }

  return (
    <TooltipProvider>
      <div ref={surface.ref} className="@container/recycleu relative flex h-full min-h-0 w-full overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-[radial-gradient(circle_at_18%_0%,hsl(var(--destructive)/0.14),transparent_34%),radial-gradient(circle_at_86%_4%,hsl(var(--primary)/0.16),transparent_32%)]" />
        <div className="relative flex min-h-0 w-full flex-col">
          {surface.mode === "collapsed" || forceCollapsedSurface ? (
            <CollapsedView {...commonProps} />
          ) : compactSurface ? (
            portraitCompact
              ? <PortraitCompactView {...commonProps} />
              : crampedCompact
                ? <CondensedCompactView {...commonProps} />
                : <CompactView {...commonProps} />
          ) : (
            <FullView {...commonProps} />
          )}
        </div>
      </div>
    </TooltipProvider>
  )
}

function CollapsedView(props: ViewProps) {
  return (
    <div className="relative flex h-full min-h-0 items-center gap-2 overflow-hidden rounded-xl border bg-background/85 px-3 py-2 shadow-sm">
      <div className={cn("absolute inset-0 opacity-70", props.status.tone === "running" && "animate-pulse bg-primary/10", props.status.tone === "error" && "bg-destructive/10", props.status.tone === "success" && "bg-primary/10")} />
      <div className="relative grid size-8 shrink-0 place-items-center rounded-lg bg-destructive text-destructive-foreground">
        <Trash2 />
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="truncate text-xs font-semibold leading-none">
          <span>Recycleu</span>
        </div>
        <div className="mt-1 truncate text-xs text-muted-foreground">{props.status.label} · {summaryText(props)}</div>
        <div className="mt-1 truncate text-[11px] text-muted-foreground">{settingsText(props)}</div>
      </div>
      <CollapsedCommandPopover {...props} />
    </div>
  )
}

function CollapsedCommandPopover(props: ViewProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button aria-label="操作和参数" className="relative shrink-0" size="icon-sm" variant="outline">
          <Settings2 />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,420px)]">
        <div className="mb-3">
          <div className="text-sm font-semibold">Recycleu 操作</div>
          <p className="text-xs text-muted-foreground">折叠状态保留完整参数和清理动作，不在卡片内横向堆按钮。</p>
        </div>
        <div className="grid gap-3">
          <CleanupFields data={props.data} disabled={props.running} onPatch={props.onPatch} />
          <IntervalPresets disabled={props.running} value={props.interval} onChange={(interval) => props.onPatch({ interval })} />
          <div className="flex flex-wrap gap-2">
            <ConfirmActionButton
              confirmLabel="确认启动"
              description={startDescription(props)}
              disabled={props.running}
              icon={Play}
              label="启动"
              title="启动自动清理?"
              onConfirm={() => props.onExecute("start")}
            />
            <ConfirmActionButton
              confirmLabel="确认清理"
              description={cleanDescription(props)}
              disabled={props.running}
              icon={Trash2}
              label="立即清理"
              title="立即清空回收站?"
              variant="destructive"
              onConfirm={() => props.onExecute("clean_now")}
            />
            <Button disabled={props.running} size="sm" variant="outline" onClick={() => props.onExecute("status")}>
              <ShieldCheck />
              状态
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function CompactView(props: ViewProps) {
  const latestLog = props.logs.at(-1)
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2">
      <Header status={props.status} trailing={settingsText(props)} />
      <div className="grid min-h-0 gap-2 @md/recycleu:grid-cols-[auto_minmax(0,1fr)]">
        <TimerDial
          cleanCount={props.cleanCount}
          compact
          progress={props.progress}
          remainingSeconds={props.remainingSeconds}
          running={props.running}
          status={props.status}
        />
        <div className="grid min-w-0 gap-2">
          <CleanupFields compact data={props.data} disabled={props.running} onPatch={props.onPatch} />
          <IntervalPresets disabled={props.running} value={props.interval} onChange={(interval) => props.onPatch({ interval })} />
        </div>
      </div>
      <StatusStrip compact progress={props.progress} status={props.status} text={latestLog ?? props.status.detail} />
      <ActionRow {...props} compact />
    </div>
  )
}

function CondensedCompactView(props: ViewProps) {
  const latestLog = props.logs.at(-1)
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2">
      <Header status={props.status} trailing={settingsText(props)} />
      <div className="grid min-h-0 flex-1 grid-cols-[auto_minmax(0,1fr)] items-center gap-2">
        <TimerDial
          cleanCount={props.cleanCount}
          compact
          progress={props.progress}
          remainingSeconds={props.remainingSeconds}
          running={props.running}
          status={props.status}
        />
        <div className="flex min-w-0 flex-col gap-2">
          <StatusStrip compact progress={props.progress} status={props.status} text={latestLog ?? props.status.detail} />
          <div className="flex flex-wrap items-center gap-1.5">
            <IconConfirmButton
              confirmLabel="确认启动"
              description={startDescription(props)}
              disabled={props.running}
              icon={Play}
              label="启动"
              title="启动自动清理?"
              onConfirm={() => props.onExecute("start")}
            />
            <IconConfirmButton
              confirmLabel="确认清理"
              description={cleanDescription(props)}
              destructive
              disabled={props.running}
              icon={Trash2}
              label="立即清理"
              title="立即清空回收站?"
              onConfirm={() => props.onExecute("clean_now")}
            />
            <Button aria-label="状态" disabled={props.running} size="icon-sm" variant="outline" onClick={() => props.onExecute("status")}>
              <ShieldCheck />
            </Button>
            <CollapsedCommandPopover {...props} />
          </div>
        </div>
      </div>
    </div>
  )
}

function PortraitCompactView(props: ViewProps) {
  const latestLog = props.logs.at(-1)
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2">
      <Header status={props.status} trailing={settingsText(props)} />
      <div className="grid shrink-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-2">
        <TimerDial
          cleanCount={props.cleanCount}
          compact
          progress={props.progress}
          remainingSeconds={props.remainingSeconds}
          running={props.running}
          status={props.status}
        />
        <div className="grid min-w-0 gap-2">
          <CleanupFields compact data={props.data} disabled={props.running} onPatch={props.onPatch} />
          <IntervalPresets disabled={props.running} value={props.interval} onChange={(interval) => props.onPatch({ interval })} />
        </div>
      </div>
      <StatusStrip compact progress={props.progress} status={props.status} text={latestLog ?? props.status.detail} />
      <ActionRow {...props} compact />
      <div className="min-h-0 flex-1">
        <LogPanel compact logs={props.logs} onCopyLogs={props.onCopyLogs} onReset={props.onReset} />
      </div>
    </div>
  )
}

function FullView(props: ViewProps) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3">
      <Header status={props.status} trailing={settingsText(props)} />
      <div className="grid min-h-0 flex-1 gap-3 @4xl/recycleu:grid-cols-[minmax(260px,0.85fr)_minmax(320px,1.15fr)]">
        <section className="flex min-h-0 flex-col gap-3 rounded-md border bg-background/70 p-3">
          <div className="flex items-start gap-3">
            <TimerDial
              cleanCount={props.cleanCount}
              progress={props.progress}
              remainingSeconds={props.remainingSeconds}
              running={props.running}
              status={props.status}
            />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">清理控制</div>
              <p className="mt-1 text-xs text-muted-foreground">所有系统写入操作都需要确认；盘符留空时清理所有回收站。</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge variant="outline">已清理 {props.cleanCount} 次</Badge>
                <Badge variant="outline">上次 {props.lastCleanTime ?? "-"}</Badge>
              </div>
            </div>
          </div>
          <CleanupFields data={props.data} disabled={props.running} onPatch={props.onPatch} />
          <IntervalPresets disabled={props.running} value={props.interval} onChange={(interval) => props.onPatch({ interval })} />
          <StatusStrip progress={props.progress} status={props.status} text={props.status.detail} />
          <ActionRow {...props} />
        </section>
        <LogPanel logs={props.logs} onCopyLogs={props.onCopyLogs} onReset={props.onReset} />
      </div>
    </div>
  )
}

function Header({ status, trailing }: {
  status: RecycleuStatusMeta
  trailing: string
}) {
  return (
    <header className="flex shrink-0 items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <div className="grid size-8 shrink-0 place-items-center rounded-md bg-destructive text-destructive-foreground">
          <Trash2 />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold">Recycleu</span>
            <Badge variant={status.badgeVariant}>{status.label}</Badge>
          </div>
          <div className="truncate text-xs text-muted-foreground">{status.detail}</div>
        </div>
      </div>
      <div className="hidden shrink-0 text-right text-xs text-muted-foreground @md/recycleu:block">{trailing}</div>
    </header>
  )
}

function ActionRow(props: ViewProps & { compact?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ConfirmActionButton
        confirmLabel="确认启动"
        description={startDescription(props)}
        disabled={props.running}
        icon={Play}
        label="启动"
        title="启动自动清理?"
        onConfirm={() => props.onExecute("start")}
      />
      <ConfirmActionButton
        confirmLabel="确认清理"
        description={cleanDescription(props)}
        disabled={props.running}
        icon={Trash2}
        label="立即清理"
        title="立即清空回收站?"
        variant="destructive"
        onConfirm={() => props.onExecute("clean_now")}
      />
      <Button disabled={props.running} size="sm" variant="outline" onClick={() => props.onExecute("status")}>
        <ShieldCheck />
        状态
      </Button>
      {!props.compact && (
        <Button size="sm" variant="ghost" onClick={props.onReset}>
          <Gauge />
          重置
        </Button>
      )}
    </div>
  )
}

interface ViewProps {
  cleanCount: number
  data: RecycleuCardState
  driveLetter: string
  interval: number
  lastCleanTime: string | null
  logs: string[]
  maxCycles: number
  progress: number
  remainingSeconds: number
  running: boolean
  status: RecycleuStatusMeta
  onCopyLogs: () => void
  onExecute: (action: RecycleuInput["action"]) => void
  onPatch: (patch: Partial<RecycleuCardState>) => void
  onReset: () => void
}

function startDescription(props: ViewProps): string {
  return `将以 ${props.interval}s 间隔运行 ${props.maxCycles} 次清理${props.driveLetter ? `，范围限定为 ${props.driveLetter}:` : "，范围为所有回收站"}。此操作会删除回收站内容。`
}

function cleanDescription(props: ViewProps): string {
  return props.driveLetter
    ? `将立即清空 ${props.driveLetter}: 的回收站内容。`
    : "将立即清空所有可访问回收站内容。"
}

function summaryText(props: ViewProps): string {
  if (props.running) return `下一次清理 ${props.remainingSeconds}s`
  if (props.status.tone === "success") return props.status.detail
  if (props.status.tone === "error") return props.status.detail
  return props.logs.at(-1) ?? "等待清理任务。"
}

function settingsText(props: Pick<ViewProps, "driveLetter" | "interval" | "maxCycles">): string {
  return `${props.driveLetter ? `${props.driveLetter}:` : "全部"} · ${props.interval}s · ${props.maxCycles} 次`
}

function parseRemainingSeconds(message: string): number | undefined {
  const match = message.match(/next clean in\s+(\d+)s/i) ?? message.match(/(\d+)s/)
  if (!match) return undefined
  const value = Number(match[1])
  return Number.isFinite(value) ? value : undefined
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, Math.floor(parsed)))
}

function sanitizeDrive(value: unknown): string {
  return String(value ?? "").toUpperCase().replace(/[^A-Z:]/g, "").slice(0, 2).replace(/:$/, "")
}

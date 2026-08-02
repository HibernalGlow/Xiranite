import { useEffect, useMemo, useState } from "react"
import { Activity, CheckCircle2, CircleAlert, CircleSlash, Clock3, Pause, Play, RefreshCw, Square } from "lucide-react"
import type { NodeOperationPhaseDTO } from "@xiranite/shared"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"
import { cancelNodeOperationOnLocalBackend, listNodeOperationsOnLocalBackend, pauseNodeOperationOnLocalBackend, refreshNodeOperationEventsOnLocalBackend, resumeNodeOperationOnLocalBackend } from "@/backend/nodeRpcClient"
import { isTerminalPhase, useNodeOperations, type TrackedNodeOperation } from "@/store/nodeOperations"
import { ViewHeading } from "./shared"

type TaskFilter = "all" | "active" | "finished"

export function TasksView() {
  const operations = useNodeOperations((state) => state.operations)
  const upsertOperation = useNodeOperations((state) => state.upsertOperation)
  const [filter, setFilter] = useState<TaskFilter>("active")
  const [selectedId, setSelectedId] = useState<string>()
  const [busyId, setBusyId] = useState<string>()
  const [error, setError] = useState<string>()
  const clipmOperations = useMemo(() => operations.filter((operation) => operation.nodeId === "clipm"), [operations])
  const visibleOperations = useMemo(() => clipmOperations.filter((operation) => filter === "active" ? !isTerminalPhase(operation.phase) : filter === "finished" ? isTerminalPhase(operation.phase) : true), [clipmOperations, filter])
  const selected = visibleOperations.find((operation) => operation.operationId === selectedId) ?? visibleOperations[0]

  useEffect(() => {
    let mounted = true
    const refresh = async () => {
      try {
        const listed = await listNodeOperationsOnLocalBackend({ nodeId: "clipm", limit: 100 })
        const syncResults = await Promise.allSettled(listed.filter((operation) => !isTerminalPhase(operation.phase)).slice(0, 20).map((operation) => refreshNodeOperationEventsOnLocalBackend(operation.operationId)))
        const failedSync = syncResults.find((result): result is PromiseRejectedResult => result.status === "rejected")
        if (failedSync) throw failedSync.reason
        if (mounted) setError(undefined)
      } catch (reason) {
        if (mounted) setError(reason instanceof Error ? reason.message : String(reason))
      }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 1_000)
    return () => { mounted = false; window.clearInterval(timer) }
  }, [])

  async function control(operation: TrackedNodeOperation, action: "pause" | "resume" | "cancel") {
    setBusyId(operation.operationId)
    try {
      const next = action === "pause"
        ? await pauseNodeOperationOnLocalBackend(operation.operationId)
        : action === "resume"
          ? await resumeNodeOperationOnLocalBackend(operation.operationId)
          : await cancelNodeOperationOnLocalBackend(operation.operationId)
      upsertOperation(next)
      setError(undefined)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusyId(undefined)
    }
  }

  const activeCount = clipmOperations.filter((operation) => !isTerminalPhase(operation.phase)).length
  const finishedCount = clipmOperations.length - activeCount

  return <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-testid="clipm-tasks-view">
    <ViewHeading icon={Activity} title="任务监督" detail="查看 ClipM 后端操作的实时进度，并暂停、恢复或取消正在运行的任务" actions={<Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => void listNodeOperationsOnLocalBackend({ nodeId: "clipm", limit: 100 })}><RefreshCw className="size-3.5" />刷新</Button>} />
    <div className="grid grid-cols-3 gap-2 border-b p-3 text-xs">
      <Metric label="进行中" value={activeCount} />
      <Metric label="最近任务" value={clipmOperations.length} />
      <Metric label="已结束" value={finishedCount} />
    </div>
    <div className="flex min-h-0 flex-1 flex-col @5xl/clipm:flex-row">
      <section className="flex min-h-[280px] min-w-0 flex-1 flex-col border-b @5xl/clipm:min-h-0 @5xl/clipm:max-w-[52%] @5xl/clipm:border-b-0 @5xl/clipm:border-r">
        <div className="border-b p-3"><ToggleGroup type="single" value={filter} variant="selection" size="sm" aria-label="任务过滤" onValueChange={(value) => value && setFilter(value as TaskFilter)}><ToggleGroupItem value="active">进行中</ToggleGroupItem><ToggleGroupItem value="all">全部</ToggleGroupItem><ToggleGroupItem value="finished">已结束</ToggleGroupItem></ToggleGroup></div>
        {error ? <div role="alert" className="border-b px-3 py-2 text-xs text-destructive">{error}</div> : null}
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {visibleOperations.length ? <div className="space-y-2">{visibleOperations.map((operation) => <TaskRow key={operation.operationId} operation={operation} selected={selected?.operationId === operation.operationId} busy={busyId === operation.operationId} onSelect={() => setSelectedId(operation.operationId)} onControl={(action) => void control(operation, action)} />)}</div> : <div className="flex h-full min-h-48 items-center justify-center text-center text-sm text-muted-foreground">当前没有 ClipM 任务</div>}
        </div>
      </section>
      <section className="flex min-h-[250px] min-w-0 flex-1 flex-col p-3 @5xl/clipm:min-h-0">
        {selected ? <TaskDetails operation={selected} busy={busyId === selected.operationId} onControl={(action) => void control(selected, action)} /> : <div className="flex h-full items-center justify-center text-sm text-muted-foreground">选择任务查看事件和控制项</div>}
      </section>
    </div>
  </div>
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="border px-2.5 py-2"><div className="text-[10px] text-muted-foreground">{label}</div><div className="mt-1 font-mono text-lg font-semibold tabular-nums">{value}</div></div>
}

function TaskRow({ operation, selected, busy, onSelect, onControl }: { operation: TrackedNodeOperation; selected: boolean; busy: boolean; onSelect: () => void; onControl: (action: "pause" | "resume" | "cancel") => void }) {
  return <div role="button" tabIndex={0} className={cn("w-full border px-3 py-2 text-left transition-colors hover:bg-muted/40", selected && "border-primary bg-primary/5")} onClick={onSelect} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect() } }} data-testid={`clipm-task-${operation.operationId}`}>
    <div className="flex items-start gap-2"><PhasePill phase={operation.phase} /><div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold">{operation.lastMessage || operation.result?.message || operation.operationId}</div><div className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{operation.operationId}</div></div><div className="shrink-0 font-mono text-[10px] text-muted-foreground">{operation.lastProgress === undefined ? "--" : `${Math.round(operation.lastProgress)}%`}</div></div>
    {typeof operation.lastProgress === "number" ? <Progress className="mt-2 h-1" value={operation.lastProgress} /> : null}
    {!isTerminalPhase(operation.phase) ? <div className="mt-2 flex justify-end gap-1" onClick={(event) => event.stopPropagation()}>{operation.phase === "paused" ? <Button variant="outline" size="icon-sm" disabled={busy} aria-label="恢复任务" onClick={() => onControl("resume")}><Play className="size-3" /></Button> : <Button variant="outline" size="icon-sm" disabled={busy} aria-label="暂停任务" onClick={() => onControl("pause")}><Pause className="size-3" /></Button>}<Button variant="destructive" size="icon-sm" disabled={busy} aria-label="取消任务" onClick={() => onControl("cancel")}><Square className="size-3" /></Button></div> : null}
  </div>
}

function TaskDetails({ operation, busy, onControl }: { operation: TrackedNodeOperation; busy: boolean; onControl: (action: "pause" | "resume" | "cancel") => void }) {
  const terminal = isTerminalPhase(operation.phase)
  return <div className="flex min-h-0 flex-1 flex-col"><div className="flex items-start justify-between gap-2"><div><h4 className="text-sm font-semibold">ClipM 任务详情</h4><p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">{operation.operationId}</p></div><PhasePill phase={operation.phase} /></div>{typeof operation.lastProgress === "number" ? <div className="mt-4"><div className="mb-1 flex justify-between text-[10px] text-muted-foreground"><span>进度</span><span>{Math.round(operation.lastProgress)}%</span></div><Progress value={operation.lastProgress} /></div> : null}<div className="mt-3 flex gap-2 text-[10px] text-muted-foreground"><span>{operation.eventCount} 个事件</span><span>更新于 {formatTime(operation.updatedAt)}</span></div><div className="mt-3 min-h-0 flex-1 overflow-y-auto border-t pt-2">{operation.events.length ? operation.events.slice(-30).map((event, index) => <div key={`${operation.operationId}-${index}`} className="flex gap-2 py-1 text-xs"><span className={cn("mt-1 size-1.5 shrink-0", event.type === "progress" ? "bg-primary" : "bg-muted-foreground/50")} /><span className="min-w-0 break-words text-muted-foreground">{event.message}</span></div>) : <span className="text-xs text-muted-foreground">暂无事件</span>}</div>{!terminal ? <div className="mt-3 flex gap-2">{operation.phase === "paused" ? <Button variant="outline" size="sm" className="gap-1.5" disabled={busy} onClick={() => onControl("resume")}><Play className="size-3" />恢复</Button> : <Button variant="outline" size="sm" className="gap-1.5" disabled={busy} onClick={() => onControl("pause")}><Pause className="size-3" />暂停</Button>}<Button variant="destructive" size="sm" className="gap-1.5" disabled={busy} onClick={() => onControl("cancel")}><Square className="size-3" />取消</Button></div> : null}</div>
}

const PHASE_META: Record<NodeOperationPhaseDTO, { label: string; icon: typeof Clock3; className: string }> = {
  queued: { label: "排队", icon: Clock3, className: "text-muted-foreground" },
  running: { label: "运行", icon: Activity, className: "text-primary" },
  paused: { label: "暂停", icon: Pause, className: "text-amber-600" },
  completed: { label: "完成", icon: CheckCircle2, className: "text-emerald-600" },
  error: { label: "错误", icon: CircleAlert, className: "text-destructive" },
  cancelled: { label: "取消", icon: CircleSlash, className: "text-muted-foreground" },
}

function PhasePill({ phase }: { phase: NodeOperationPhaseDTO }) {
  const meta = PHASE_META[phase]
  const Icon = meta.icon
  return <span className={cn("inline-flex h-6 shrink-0 items-center gap-1 border px-1.5 text-[10px] font-mono", meta.className)}><Icon className="size-3" />{meta.label}</span>
}

function formatTime(value: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value))
}

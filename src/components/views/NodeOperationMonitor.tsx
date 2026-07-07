import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Activity, CheckCircle2, CircleAlert, CircleSlash, Clock3, RotateCcw, Square, Trash2 } from "lucide-react"
import type { NodeOperationPhaseDTO } from "@xiranite/shared"
import { cancelNodeOperationOnLocalBackend, cleanupNodeOperationsOnLocalBackend } from "@/backend/nodeRpcClient"
import { cn } from "@/lib/utils"
import { activeNodeOperationCount, isTerminalPhase, type TrackedNodeOperation, useNodeOperations } from "@/store/nodeOperations"
import { Button } from "@/components/ui/button"

const PHASE_ICON: Record<NodeOperationPhaseDTO, typeof Clock3> = {
  queued: Clock3,
  running: Activity,
  completed: CheckCircle2,
  error: CircleAlert,
  cancelled: CircleSlash,
}

const PHASE_CLASS: Record<NodeOperationPhaseDTO, string> = {
  queued: "border-muted-foreground/30 text-muted-foreground",
  running: "border-primary/40 bg-primary/10 text-primary",
  completed: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  error: "border-destructive/40 bg-destructive/10 text-destructive",
  cancelled: "border-muted-foreground/30 bg-muted/40 text-muted-foreground",
}

export function NodeOperationMonitor() {
  const { t } = useTranslation()
  const operations = useNodeOperations((store) => store.operations)
  const clearTerminal = useNodeOperations((store) => store.clearTerminal)
  const upsertOperation = useNodeOperations((store) => store.upsertOperation)
  const activeCount = activeNodeOperationCount(operations)
  const [busyOperationId, setBusyOperationId] = useState<string | null>(null)
  const [cleanupBusy, setCleanupBusy] = useState(false)

  async function cancelOperation(operationId: string) {
    setBusyOperationId(operationId)
    try {
      const operation = await cancelNodeOperationOnLocalBackend(operationId)
      upsertOperation(operation)
    } finally {
      setBusyOperationId(null)
    }
  }

  async function cleanupFinished() {
    setCleanupBusy(true)
    try {
      await cleanupNodeOperationsOnLocalBackend({ maxAgeMs: 0 })
      clearTerminal()
    } finally {
      setCleanupBusy(false)
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-border/60 px-6 py-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-foreground">{t("view:operations.title")}</h1>
            <p className="mt-1 text-xs text-muted-foreground">{t("view:operations.subtitle")}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={clearTerminal}>
              <Trash2 className="h-3.5 w-3.5" />
              {t("view:operations.clearLocal")}
            </Button>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" disabled={cleanupBusy} onClick={cleanupFinished}>
              <RotateCcw className="h-3.5 w-3.5" />
              {t("view:operations.cleanupBackend")}
            </Button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <Metric label={t("view:operations.active")} value={activeCount} />
          <Metric label={t("view:operations.recent")} value={operations.length} />
          <Metric label={t("view:operations.finished")} value={operations.length - activeCount} />
        </div>
      </div>

      <div className="flex-1 overflow-auto px-4 py-4">
        {operations.length ? (
          <div className="space-y-2">
            {operations.map((operation) => (
              <OperationRow
                key={operation.operationId}
                operation={operation}
                busy={busyOperationId === operation.operationId}
                onCancel={() => cancelOperation(operation.operationId)}
              />
            ))}
          </div>
        ) : (
          <div className="flex h-full min-h-60 items-center justify-center text-center text-sm text-muted-foreground">
            {t("view:operations.empty")}
          </div>
        )}
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-sm border border-border/60 bg-muted/20 px-3 py-2">
      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">{value}</div>
    </div>
  )
}

function OperationRow({
  operation,
  busy,
  onCancel,
}: {
  operation: TrackedNodeOperation
  busy: boolean
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const terminal = isTerminalPhase(operation.phase)
  const progress = operation.lastProgress
  const latestEvents = operation.events.slice(-5).reverse()

  return (
    <section className="rounded-sm border border-border/60 bg-card/80 p-3">
      <div className="flex items-start gap-3">
        <PhasePill phase={operation.phase} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <div className="truncate text-sm font-semibold text-foreground">{operation.nodeId}</div>
            <div className="shrink-0 text-[10px] font-mono text-muted-foreground">{shortOperationId(operation.operationId)}</div>
          </div>
          <div className="mt-1 truncate text-xs text-muted-foreground">
            {operation.lastMessage || operation.result?.message || t("view:operations.noMessage")}
          </div>
        </div>
        {!terminal && (
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" disabled={busy} onClick={onCancel}>
            <Square className="h-3 w-3" />
            {t("view:operations.cancel")}
          </Button>
        )}
      </div>

      {typeof progress === "number" && (
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between text-[10px] font-mono text-muted-foreground">
            <span>{t("view:operations.progress")}</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
          </div>
        </div>
      )}

      <div className="mt-3 grid grid-cols-3 gap-2 text-[10px] font-mono text-muted-foreground">
        <span>{t("view:operations.events", { count: operation.eventCount })}</span>
        <span>{t("view:operations.started", { time: formatTime(operation.startedAt ?? operation.createdAt) })}</span>
        <span>{t("view:operations.updated", { time: formatTime(operation.updatedAt) })}</span>
      </div>

      <div className="mt-3 space-y-1 border-t border-border/50 pt-2">
        {latestEvents.length ? latestEvents.map((event, index) => (
          <div key={`${operation.operationId}-${operation.eventCount}-${index}`} className="flex min-w-0 items-center gap-2 text-xs">
            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", event.type === "progress" ? "bg-primary" : "bg-muted-foreground/60")} />
            <span className="truncate text-muted-foreground">{event.message}</span>
          </div>
        )) : (
          <div className="text-xs text-muted-foreground">{t("view:operations.noEvents")}</div>
        )}
      </div>
    </section>
  )
}

function PhasePill({ phase }: { phase: NodeOperationPhaseDTO }) {
  const { t } = useTranslation()
  const Icon = PHASE_ICON[phase]
  return (
    <div className={cn("flex h-7 shrink-0 items-center gap-1.5 rounded-sm border px-2 text-[10px] font-mono uppercase", PHASE_CLASS[phase])}>
      <Icon className="h-3 w-3" />
      {t(`view:operations.phase.${phase}`)}
    </div>
  )
}

function shortOperationId(operationId: string): string {
  return operationId.length <= 12 ? operationId : operationId.slice(0, 12)
}

function formatTime(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value))
}


import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleSlash,
  Clock3,
  Copy,
  History,
  Info,
  Loader2,
  Trash2,
} from "lucide-react"
import type { RuntimeHistoryItemDTO, RuntimeHistoryKindDTO, RuntimeHistoryStatusDTO } from "@xiranite/shared"
import { useClearRuntimeHistory, useDeleteRuntimeHistory, useRuntimeHistory } from "@/hooks/useRuntimeHistory"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { OverlayViewShell } from "@/components/workspace/OverlayViewShell"

const STATUS_ICON: Record<RuntimeHistoryStatusDTO, typeof Clock3> = {
  success: CheckCircle2,
  error: CircleAlert,
  cancelled: CircleSlash,
  info: Info,
}

const STATUS_CLASS: Record<RuntimeHistoryStatusDTO, string> = {
  success: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  error: "border-destructive/40 bg-destructive/10 text-destructive",
  cancelled: "border-muted-foreground/30 bg-muted/40 text-muted-foreground",
  info: "border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400",
}

type HistoryKindFilter = "all" | RuntimeHistoryKindDTO
type HistoryStatusFilter = "all" | RuntimeHistoryStatusDTO

const KIND_FILTERS: HistoryKindFilter[] = ["all", "node", "workspace", "config", "system"]
const STATUS_FILTERS: HistoryStatusFilter[] = ["all", "success", "error", "cancelled", "info"]

export function NodeRunHistoryView() {
  const { t } = useTranslation()
  const [kindFilter, setKindFilter] = useState<HistoryKindFilter>("all")
  const [statusFilter, setStatusFilter] = useState<HistoryStatusFilter>("all")
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const query = useMemo(
    () => ({
      limit: 50,
      kind: kindFilter === "all" ? undefined : kindFilter,
      status: statusFilter === "all" ? undefined : statusFilter,
    }),
    [kindFilter, statusFilter],
  )

  const historyQuery = useRuntimeHistory(query)
  const deleteMutation = useDeleteRuntimeHistory()
  const clearMutation = useClearRuntimeHistory()

  const items = historyQuery.data?.items ?? []

  async function copyInput(item: RuntimeHistoryItemDTO) {
    try {
      await navigator.clipboard.writeText(JSON.stringify(item.input ?? null, null, 2))
      setCopiedId(item.id)
      setTimeout(() => setCopiedId(null), 1500)
    } catch {
      // Clipboard access can be blocked by browser permissions.
    }
  }

  async function handleClearAll() {
    await clearMutation.mutateAsync(kindFilter === "all" ? {} : { kind: kindFilter })
  }

  return (
    <OverlayViewShell
      header={
        <>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-foreground">{t("view:history.title")}</h1>
            <p className="mt-1 text-xs text-muted-foreground">{t("view:history.subtitle")}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            disabled={clearMutation.isPending || items.length === 0}
            onClick={handleClearAll}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t("view:history.clearAll")}
          </Button>
        </div>

        <div className="mt-4 grid grid-cols-5 gap-1 rounded-sm border border-border/50 bg-muted/20 p-1">
          {KIND_FILTERS.map((key) => (
            <FilterButton
              key={key}
              active={kindFilter === key}
              label={t(`view:history.kind.${key}`)}
              onClick={() => setKindFilter(key)}
            />
          ))}
        </div>
        <div className="mt-2 grid grid-cols-5 gap-1 rounded-sm border border-border/50 bg-muted/20 p-1">
          {STATUS_FILTERS.map((key) => (
            <FilterButton
              key={key}
              active={statusFilter === key}
              label={t(`view:history.statusFilter.${key}`)}
              onClick={() => setStatusFilter(key)}
            />
          ))}
        </div>
        </>
      }
      bodyClassName="px-4 py-4"
    >
        {historyQuery.isLoading && (
          <div className="flex h-full min-h-60 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {t("view:history.loading")}
          </div>
        )}

        {!historyQuery.isLoading && items.length === 0 && (
          <div className="flex h-full min-h-60 flex-col items-center justify-center text-center">
            <History className="mb-3 h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">{t("view:history.empty")}</p>
            <p className="mt-1 text-xs text-muted-foreground/60">{t("view:history.emptyHint")}</p>
          </div>
        )}

        {items.length > 0 && (
          <div className="space-y-2">
            {items.map((item) => (
              <HistoryRow
                key={item.id}
                item={item}
                expanded={expandedId === item.id}
                copied={copiedId === item.id}
                deleting={deleteMutation.isPending && deleteMutation.variables === item.id}
                onToggleExpand={() => setExpandedId(expandedId === item.id ? null : item.id)}
                onCopyInput={() => copyInput(item)}
                onDelete={() => deleteMutation.mutate(item.id)}
              />
            ))}

            {historyQuery.data?.nextCursor && (
              <div className="flex justify-center pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs text-muted-foreground"
                  disabled
                >
                  {t("view:history.loadMore")}
                </Button>
              </div>
            )}
          </div>
        )}
    </OverlayViewShell>
  )
}

function HistoryRow({
  item,
  expanded,
  copied,
  deleting,
  onToggleExpand,
  onCopyInput,
  onDelete,
}: {
  item: RuntimeHistoryItemDTO
  expanded: boolean
  copied: boolean
  deleting: boolean
  onToggleExpand: () => void
  onCopyInput: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const title = item.title ?? item.target?.label ?? item.nodeId ?? item.operation
  const subtitle = item.inputSummary || item.resultSummary || item.target?.id

  return (
    <section className="rounded-sm border border-border/60 bg-card/80 p-3">
      <div className="flex items-start gap-3">
        <StatusPill status={item.status} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <div className="truncate text-sm font-semibold text-foreground">{title}</div>
            <div className="shrink-0 rounded-sm bg-muted/50 px-1.5 py-0.5 text-[10px] font-mono uppercase text-muted-foreground">
              {t(`view:history.kind.${item.kind}`)}
            </div>
            <div className="shrink-0 text-[10px] font-mono text-muted-foreground">
              {formatTime(item.finishedAt)}
            </div>
          </div>
          {subtitle && (
            <div className="mt-1 truncate text-xs text-muted-foreground">{subtitle}</div>
          )}
          <div className="mt-1 truncate text-xs text-muted-foreground">{item.message}</div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={onCopyInput}
            className="grid h-7 w-7 place-items-center rounded-sm text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            title={t("view:history.copyInput")}
            aria-label={t("view:history.copyInput")}
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            className="grid h-7 w-7 place-items-center rounded-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
            title={t("view:history.delete")}
            aria-label={t("view:history.delete")}
          >
            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={onToggleExpand}
            className="grid h-7 w-7 place-items-center rounded-sm text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            title={t("view:history.viewDetail")}
            aria-label={t("view:history.viewDetail")}
          >
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-3 text-[10px] font-mono text-muted-foreground">
        <span>{item.operation}</span>
        <span>{t("view:history.duration", { ms: item.durationMs })}</span>
        {item.eventCount !== undefined && <span>{t("view:history.events", { count: item.eventCount })}</span>}
        {copied && <span className="text-emerald-500">{t("view:history.copied")}</span>}
      </div>

      {expanded && <HistoryDetail item={item} />}
    </section>
  )
}

function HistoryDetail({ item }: { item: RuntimeHistoryItemDTO }) {
  const { t } = useTranslation()
  const hasInput = item.input !== undefined && item.input !== null
  const hasResult = item.result !== undefined && item.result !== null
  const resultRecord = isRecord(item.result) ? item.result : undefined
  const stats = isNumberRecord(resultRecord?.stats) ? resultRecord.stats : undefined
  const outputPath = typeof resultRecord?.outputPath === "string" ? resultRecord.outputPath : undefined

  return (
    <div className="mt-3 space-y-3 border-t border-border/50 pt-3">
      <div className="grid grid-cols-2 gap-1.5">
        <MetaField label={t("view:history.operation")} value={item.operation} />
        <MetaField label={t("view:history.kindLabel")} value={item.kind} />
        {item.nodeId && <MetaField label={t("view:history.nodeId")} value={item.nodeId} />}
        {item.componentId && <MetaField label={t("view:history.componentId")} value={item.componentId} />}
        {item.workspaceId && <MetaField label={t("view:history.workspaceId")} value={item.workspaceId} />}
      </div>

      {hasInput ? (
        <DetailSection label={t("view:history.input")}>
          <pre className="max-h-48 overflow-auto rounded-sm bg-muted/40 p-2 text-[10px] leading-relaxed text-foreground">
            {JSON.stringify(item.input, null, 2)}
          </pre>
        </DetailSection>
      ) : (
        <p className="text-xs text-muted-foreground">{t("view:history.noInput")}</p>
      )}

      {hasResult && (
        <DetailSection label={t("view:history.result")}>
          <pre className="max-h-48 overflow-auto rounded-sm bg-muted/40 p-2 text-[10px] leading-relaxed text-foreground">
            {JSON.stringify(item.result, null, 2)}
          </pre>
        </DetailSection>
      )}

      {stats && Object.keys(stats).length > 0 && (
        <DetailSection label={t("view:history.stats")}>
          <div className="grid grid-cols-2 gap-1.5">
            {Object.entries(stats).map(([key, value]) => (
              <div key={key} className="rounded-sm border border-border/40 bg-muted/20 px-2 py-1">
                <div className="text-[9px] font-mono uppercase text-muted-foreground">{key}</div>
                <div className="text-sm font-semibold tabular-nums text-foreground">{value}</div>
              </div>
            ))}
          </div>
        </DetailSection>
      )}

      {outputPath && (
        <DetailSection label={t("view:history.outputPath")}>
          <code className="block break-all rounded-sm bg-muted/40 p-2 text-[10px] text-foreground">
            {outputPath}
          </code>
        </DetailSection>
      )}
    </div>
  )
}

function MetaField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm border border-border/40 bg-muted/20 px-2 py-1">
      <div className="text-[9px] font-mono uppercase text-muted-foreground">{label}</div>
      <div className="truncate text-[11px] text-foreground">{value}</div>
    </div>
  )
}

function DetailSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-mono uppercase text-muted-foreground">{label}</div>
      {children}
    </div>
  )
}

function StatusPill({ status }: { status: RuntimeHistoryStatusDTO }) {
  const { t } = useTranslation()
  const Icon = STATUS_ICON[status]
  return (
    <div className={cn("flex h-7 shrink-0 items-center gap-1.5 rounded-sm border px-2 text-[10px] font-mono uppercase", STATUS_CLASS[status])}>
      <Icon className="h-3 w-3" />
      {t(`view:history.status.${status}`)}
    </div>
  )
}

function FilterButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-8 rounded-sm px-2 text-[11px] transition-colors",
        active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
      )}
    >
      {label}
    </button>
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function isNumberRecord(value: unknown): value is Record<string, number> {
  if (!isRecord(value)) return false
  return Object.values(value).every((item) => typeof item === "number")
}

function formatTime(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value))
}

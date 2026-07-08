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
  Loader2,
  Trash2,
} from "lucide-react"
import type { NodeRunHistoryItemDTO, NodeRunHistoryStatusDTO } from "@xiranite/shared"
import { useNodeRunHistory, useDeleteNodeRunHistory, useClearNodeRunHistory } from "@/hooks/useNodeRunHistory"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

const STATUS_ICON: Record<NodeRunHistoryStatusDTO, typeof Clock3> = {
  success: CheckCircle2,
  error: CircleAlert,
  cancelled: CircleSlash,
}

const STATUS_CLASS: Record<NodeRunHistoryStatusDTO, string> = {
  success: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  error: "border-destructive/40 bg-destructive/10 text-destructive",
  cancelled: "border-muted-foreground/30 bg-muted/40 text-muted-foreground",
}

type HistoryFilter = "all" | NodeRunHistoryStatusDTO

const FILTERS: HistoryFilter[] = ["all", "success", "error", "cancelled"]

export function NodeRunHistoryView() {
  const { t } = useTranslation()
  const [filter, setFilter] = useState<HistoryFilter>("all")
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const query = useMemo(
    () => ({
      limit: 50,
      status: filter === "all" ? undefined : filter,
    }),
    [filter],
  )

  const historyQuery = useNodeRunHistory(query)
  const deleteMutation = useDeleteNodeRunHistory()
  const clearMutation = useClearNodeRunHistory()

  const items = historyQuery.data?.items ?? []

  async function copyInput(item: NodeRunHistoryItemDTO) {
    try {
      await navigator.clipboard.writeText(JSON.stringify(item.input ?? null, null, 2))
      setCopiedId(item.id)
      setTimeout(() => setCopiedId(null), 1500)
    } catch {
      // ignore clipboard errors
    }
  }

  async function handleClearAll() {
    await clearMutation.mutateAsync({})
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-border/60 px-6 py-5">
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

        <div className="mt-4 grid grid-cols-4 gap-1 rounded-sm border border-border/50 bg-muted/20 p-1">
          {FILTERS.map((key) => (
            <FilterButton
              key={key}
              active={filter === key}
              label={t(`view:history.${key}`)}
              onClick={() => setFilter(key)}
            />
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto px-4 py-4">
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
                  disabled={historyQuery.isFetching}
                  onClick={() => {
                    // Cursor-based pagination: refetch with cursor
                    // For now, the hook handles placeholderData; full cursor
                    // support can be added by extending the hook to accept cursor.
                  }}
                >
                  {historyQuery.isFetching ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  {t("view:history.loadMore")}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
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
  item: NodeRunHistoryItemDTO
  expanded: boolean
  copied: boolean
  deleting: boolean
  onToggleExpand: () => void
  onCopyInput: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const Icon = STATUS_ICON[item.status]

  return (
    <section className="rounded-sm border border-border/60 bg-card/80 p-3">
      <div className="flex items-start gap-3">
        <StatusPill status={item.status} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <div className="truncate text-sm font-semibold text-foreground">{item.nodeId}</div>
            <div className="shrink-0 text-[10px] font-mono text-muted-foreground">
              {formatTime(item.finishedAt)}
            </div>
          </div>
          {item.inputSummary && (
            <div className="mt-1 truncate text-xs text-muted-foreground">{item.inputSummary}</div>
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
        <span>{t("view:history.duration", { ms: item.durationMs })}</span>
        <span>{t("view:history.events", { count: item.eventCount })}</span>
        {copied && <span className="text-emerald-500">{t("view:history.copyInput")} ✓</span>}
      </div>

      {expanded && <HistoryDetail item={item} />}
    </section>
  )
}

function HistoryDetail({ item }: { item: NodeRunHistoryItemDTO }) {
  const { t } = useTranslation()
  const hasInput = item.input !== undefined && item.input !== null
  const hasResult = item.result !== undefined && item.result !== null
  const stats = item.result?.stats
  const outputPath = item.result?.outputPath

  return (
    <div className="mt-3 space-y-3 border-t border-border/50 pt-3">
      {hasInput && (
        <DetailSection label={t("view:history.input")}>
          <pre className="max-h-48 overflow-auto rounded-sm bg-muted/40 p-2 text-[10px] leading-relaxed text-foreground">
            {JSON.stringify(item.input, null, 2)}
          </pre>
        </DetailSection>
      )}
      {!hasInput && (
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
                <div className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">{key}</div>
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

function DetailSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{label}</div>
      {children}
    </div>
  )
}

function StatusPill({ status }: { status: NodeRunHistoryStatusDTO }) {
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

function formatTime(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value))
}

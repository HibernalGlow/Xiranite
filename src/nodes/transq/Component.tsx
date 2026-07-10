import { useRef, useState } from "react"
import type { NodeComponentProps, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type { TransqData, TransqInput } from "@xiranite/node-transq/core"
import { Eye, FileOutput, Languages, Play, ShieldAlert, Square } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldContent, FieldDescription, FieldTitle } from "@/components/ui/field"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useNodeI18n } from "@/nodes/shared/useNodeI18n"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import { NODE_META } from "./constants"
import { ActionIconButton, LogStrip, PathsInput, QueueBoard, QueueEmptyState } from "./controls"
import type { TransqCardState, TransqStatusMeta } from "./types"

export function Component({ compId, host }: NodeComponentProps<TransqCardState>) {
  const surface = useNodeSurface()
  const { t } = useNodeI18n("transq")
  const data = host.state?.getData?.() ?? host.getData<TransqCardState>(compId) ?? {}
  const dataRef = useRef<TransqCardState>(data)
  dataRef.current = data
  const [running, setRunning] = useState(false)

  const result = data.result ?? null
  const logs = data.logs ?? []
  const progress = data.progress ?? 0
  const preview = data.preview ?? true
  const status = statusFromState(data, running, t)
  const compactSurface = surface.mode === "compact" || surface.mode === "portrait"
  const forceCollapsedSurface = compactSurface && surface.height > 0 && surface.height < 160
  const portraitCompact = surface.mode === "portrait" || (surface.mode === "compact" && surface.width < 560 && surface.height >= 300)

  function patch(patchData: Partial<TransqCardState>) {
    dataRef.current = { ...dataRef.current, ...patchData }
    if (host.state?.patchData) host.state.patchData(patchData)
    else host.patchData(compId, patchData)
  }

  function pushLog(message: string) {
    patch({ logs: [...(dataRef.current.logs ?? []), message].slice(-120) })
  }

  async function pastePaths() {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ pathsText: text.trim() })
  }

  async function copyLogs() {
    await host.clipboard?.writeText?.(logs.join("\n"))
  }

  async function copyResults() {
    if (!result) return
    await host.clipboard?.writeText?.(result.items.map((item) => `${item.status}\t${item.originalImagesPath}\t${item.outputPath}`).join("\n"))
  }

  function reset() {
    patch({ logs: [], phase: "idle", progress: 0, progressText: "", result: null })
  }

  async function execute() {
    if (running) return
    const paths = splitPaths(dataRef.current.pathsText)
    if (!paths.length) {
      const message = t("error.pathRequired", "请先输入至少一个翻译工作区路径。")
      patch({ phase: "error", progress: 0, progressText: message })
      pushLog(message)
      return
    }

    const run = host.runner?.run ?? host.actions?.run
    if (!run) {
      const message = t("error.noRunEnv", "当前环境没有本地运行能力，请使用桌面模式或 CLI。")
      patch({ phase: "error", progress: 0, progressText: message })
      pushLog("Native TransQ action is unavailable in this host.")
      return
    }

    setRunning(true)
    patch({ phase: "running", progress: 0, progressText: t("progress.start", "{{action}}开始", { action: preview ? t("actions.preview", "预演") : t("actions.organize", "整理队列") }), result: null })
    try {
      const response = await run<TransqInput, TransqData>(NODE_META.id, { action: "run", paths, preview }, (event: NodeRunEvent) => {
        if (event.type === "progress") {
          patch({ progress: event.progress ?? 0, progressText: event.message })
          pushLog(`[${event.progress ?? 0}%] ${event.message}`)
          return
        }
        pushLog(event.message)
      }) as NodeRunResult<TransqData>

      patch({
        phase: response.success ? "completed" : "error",
        progress: response.success ? 100 : 0,
        progressText: response.message,
        result: response.data ?? null,
      })
      pushLog(response.message)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      patch({ phase: "error", progress: 0, progressText: message })
      pushLog(message)
    } finally {
      setRunning(false)
    }
  }

  const viewProps = {
    data,
    logs,
    preview,
    progress,
    result,
    running,
    status,
    t,
    onCopyLogs: copyLogs,
    onCopyResults: copyResults,
    onExecute: execute,
    onPastePaths: pastePaths,
    onPatch: patch,
    onReset: reset,
  }

  return (
    <TooltipProvider>
      <div ref={surface.ref} className="@container/transq flex h-full min-h-0 w-full overflow-hidden bg-card">
        {surface.mode === "collapsed" || forceCollapsedSurface ? (
          <CollapsedView {...viewProps} />
        ) : compactSurface ? (
          portraitCompact ? <PortraitCompactView {...viewProps} /> : <CompactView {...viewProps} />
        ) : (
          <FullView {...viewProps} />
        )}
      </div>
    </TooltipProvider>
  )
}

type ViewProps = ReturnType<typeof createViewProps>

function createViewProps(props: {
  data: TransqCardState
  logs: string[]
  preview: boolean
  progress: number
  result: TransqData | null
  running: boolean
  status: TransqStatusMeta
  t: ReturnType<typeof useNodeI18n>["t"]
  onCopyLogs: () => void
  onCopyResults: () => void
  onExecute: () => void
  onPastePaths: () => void
  onPatch: (patch: Partial<TransqCardState>) => void
  onReset: () => void
}) {
  return props
}

function CollapsedView(props: ViewProps) {
  const Icon = NODE_META.icon
  return (
    <div data-testid="transq-collapsed-view" className="flex h-full min-h-0 w-full items-center gap-2 overflow-hidden rounded-xl border bg-card px-3 py-2 shadow-sm">
      <div className={cn("grid size-8 shrink-0 place-items-center rounded-lg", props.status.iconClass)}><Icon /></div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-xs font-semibold"><span>{props.t("name", "TransQ")}</span><Badge variant={props.status.badgeVariant}>{props.status.label}</Badge></div>
        <div className="mt-1 truncate text-xs text-muted-foreground">{summaryText(props)}</div>
      </div>
      <RunActionButton compact props={props} />
    </div>
  )
}

function CompactView(props: ViewProps) {
  return (
    <div data-testid="transq-compact-view" className="flex min-h-0 flex-1 flex-col gap-2 p-3">
      <HeaderLine status={props.status} subtitle={props.data.progressText || summaryText(props)} t={props.t} />
      <PathsInput compact data={props.data} disabled={props.running} t={props.t} onClear={() => props.onPatch({ pathsText: "" })} onPaste={props.onPastePaths} onPatch={props.onPatch} />
      <ExecutionGate compact props={props} />
      {(props.status.tone === "running" || props.status.tone === "error") && <StatusStrip compact progress={props.progress} status={props.status} text={props.data.progressText} />}
      <div className="min-h-0 flex-1 overflow-auto">{props.result ? <QueueBoard compact items={props.result.items} t={props.t} /> : <QueueEmptyState t={props.t} />}</div>
    </div>
  )
}

function PortraitCompactView(props: ViewProps) {
  return (
    <div data-testid="transq-portrait-view" className="flex h-full min-h-0 flex-col gap-2 p-2">
      <HeaderLine status={props.status} subtitle={props.data.progressText || summaryText(props)} t={props.t} />
      <PathsInput compact data={props.data} disabled={props.running} t={props.t} onClear={() => props.onPatch({ pathsText: "" })} onPaste={props.onPastePaths} onPatch={props.onPatch} />
      <ExecutionGate compact props={props} />
      <div className="min-h-0 flex-1 overflow-auto">{props.result ? <QueueBoard compact items={props.result.items} t={props.t} /> : <QueueEmptyState t={props.t} />}</div>
    </div>
  )
}

function FullView(props: ViewProps) {
  return (
    <div data-testid="transq-full-view" className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <div className="flex shrink-0 flex-col gap-2 @4xl/transq:flex-row @4xl/transq:items-center @4xl/transq:justify-between">
        <HeaderLine status={props.status} subtitle={props.data.progressText || summaryText(props)} t={props.t} />
        <div data-testid="transq-header-toolbar" className="flex items-center gap-1">
          <ActionIconButton disabled={props.running} icon={FileOutput} label={props.t("actions.copyQueue", "Copy queue")} onClick={props.onCopyResults} />
          <ActionIconButton disabled={props.running} icon={Languages} label={props.t("actions.clearState", "Clear state")} onClick={props.onReset} />
        </div>
      </div>
      <div className="grid min-h-0 flex-1 gap-3 @4xl/transq:grid-cols-[minmax(230px,280px)_minmax(0,1fr)_minmax(230px,280px)]">
        <section className="flex min-h-0 flex-col gap-3 rounded-lg border bg-card p-3">
          <PathsInput data={props.data} disabled={props.running} t={props.t} onClear={() => props.onPatch({ pathsText: "" })} onPaste={props.onPastePaths} onPatch={props.onPatch} />
          <Separator />
          <RuleSummary t={props.t} />
        </section>
        <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border bg-card">
          <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2">
            <div className="text-sm font-semibold">{props.t("queue.title", "Queue board")}</div>
            <Badge variant="outline">{props.t("queue.count", "{{count}} queues", { count: props.result?.items.length ?? 0 })}</Badge>
          </div>
          <Separator />
          <div className="min-h-0 flex-1 overflow-auto p-2">{props.result ? <QueueBoard items={props.result.items} t={props.t} /> : <QueueEmptyState t={props.t} />}</div>
        </section>
        <section className={cn("flex min-h-0 flex-col gap-3 rounded-lg border bg-card p-3", !props.preview && "border-destructive/50")}>
          <ExecutionGate props={props} />
          <Separator />
          <ResultSummary result={props.result} t={props.t} />
        </section>
      </div>
      {(props.status.tone === "running" || props.status.tone === "error") && <StatusStrip progress={props.progress} status={props.status} text={props.data.progressText} />}
      <LogStrip logs={props.logs} t={props.t} onCopy={props.onCopyLogs} />
    </div>
  )
}

function ExecutionGate({ compact, props }: { compact?: boolean; props: ViewProps }) {
  const previewTitle = props.preview ? props.t("execution.previewState", "Preview: no files change") : props.t("execution.liveState", "Live: files move and originals are removed")
  const previewDescription = props.preview ? props.t("execution.previewDescription", "Builds the queue only; no files are copied, moved, or deleted.") : props.t("execution.liveDescription", "Copies missing files, moves results, and removes original work folders after confirmation.")
  return (
    <section data-testid="transq-execution-gate" className={cn("flex min-w-0 items-center gap-2", compact && "grid grid-cols-[minmax(0,1fr)_auto] rounded-lg border bg-card px-2 py-1.5", !props.preview && "border-destructive/50")}>
      <Field orientation="horizontal" className="min-w-0 flex-1 items-center gap-2">
        {props.preview ? <Eye className="shrink-0 text-muted-foreground" /> : <ShieldAlert className="shrink-0 text-destructive" />}
        <FieldContent className="min-w-0 gap-0.5">
          <FieldTitle className="truncate text-xs">{compact ? (props.preview ? props.t("mode.preview", "Preview") : props.t("mode.live", "Live")) : previewTitle}</FieldTitle>
          {!compact && <FieldDescription className="text-[11px]">{previewDescription}</FieldDescription>}
        </FieldContent>
        <Switch aria-label={props.t("aria.previewSwitch", "transq preview switch")} checked={props.preview} disabled={props.running} size="default" onCheckedChange={(preview) => props.onPatch({ preview })} />
      </Field>
      {!compact && <Separator className="h-6 shrink-0" orientation="vertical" />}
      <RunActionButton compact={compact} props={props} />
    </section>
  )
}

function RunActionButton({ compact, props }: { compact?: boolean; props: ViewProps }) {
  if (props.running) return <Button aria-label={props.t("aria.running", "transq running")} disabled size={compact ? "xs" : "sm"} variant="secondary"><Square /><span>{props.t("status.running", "Running")}</span></Button>
  const label = props.preview ? props.t("actions.preview", "Preview queue") : props.t("actions.organize", "Organize queue")
  const compactLabel = props.preview ? props.t("actions.previewShort", "Preview") : props.t("actions.organizeShort", "Organize")
  if (!props.preview) {
    return (
      <AlertDialog>
        <AlertDialogTrigger asChild><Button aria-label={label} disabled={!props.data.pathsText?.trim()} size={compact ? "xs" : "sm"} variant="destructive"><Play /><span>{compact ? compactLabel : label}</span></Button></AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{props.t("confirm.title", "Organize translation queues?")}</AlertDialogTitle><AlertDialogDescription>{props.t("confirm.description", "This copies missing images, moves result folders, and removes original work folders. Confirm the planned queues before continuing.")}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>{props.t("common:cancel", "Cancel")}</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={props.onExecute}>{props.t("actions.confirm", "Confirm organize")}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
  }
  return <Button aria-label={label} disabled={!props.data.pathsText?.trim()} size={compact ? "xs" : "sm"} onClick={props.onExecute}><Play /><span>{compact ? compactLabel : label}</span></Button>
}

function HeaderLine({ status, subtitle, t }: { status: TransqStatusMeta; subtitle: string; t: ViewProps["t"] }) {
  const Icon = NODE_META.icon
  return <div className="flex min-w-0 items-center gap-2"><div className={cn("grid size-8 shrink-0 place-items-center rounded-lg", status.iconClass)}><Icon /></div><div className="min-w-0"><div className="flex min-w-0 items-center gap-2"><h3 className="truncate text-sm font-semibold">{t("name", "TransQ")}</h3><Badge variant={status.badgeVariant}>{status.label}</Badge></div><p className="mt-1 truncate text-xs text-muted-foreground">{subtitle}</p></div></div>
}

function RuleSummary({ t }: { t: ViewProps["t"] }) {
  const rules = [t("rules.map", "Use translation_map.json to identify expected result files."), t("rules.copy", "Copy mapped originals missing from result."), t("rules.output", "Move the completed result beside original_images.")]
  return <div className="grid gap-2"><div className="text-xs font-semibold text-muted-foreground">{t("rules.title", "Native rules")}</div>{rules.map((rule) => <div key={rule} className="flex gap-2 text-xs"><Languages className="shrink-0 text-muted-foreground" /><span>{rule}</span></div>)}</div>
}

function ResultSummary({ result, t }: { result: TransqData | null; t: ViewProps["t"] }) {
  const stats = [[t("stats.pending", "Needs copy"), result?.pendingCount ?? 0], [t("stats.ready", "Ready"), result?.readyCount ?? 0], [t("stats.output", "Output"), result?.outputCount ?? 0], [t("stats.conflict", "Conflicts"), result?.conflictCount ?? 0]]
  return <div className="grid grid-cols-2 gap-2">{stats.map(([label, value]) => <div key={label} className="rounded-md bg-muted/35 px-2 py-2"><div className="truncate text-[11px] text-muted-foreground">{label}</div><div className={cn("text-base font-semibold tabular-nums", label === t("stats.conflict", "Conflicts") && Number(value) > 0 && "text-destructive")}>{value}</div></div>)}</div>
}

function StatusStrip({ compact, progress, status, text }: { compact?: boolean; progress: number; status: TransqStatusMeta; text?: string }) {
  return <div className={cn("rounded-md border bg-card p-2", compact && "p-1.5")}><div className="mb-1 flex min-w-0 items-center justify-between gap-2"><span className="truncate text-xs font-medium">{text || status.description}</span><Badge variant={status.badgeVariant}>{status.label}</Badge></div><Progress value={progress} className={cn("h-1.5", status.tone === "error" && "bg-destructive/20")} /></div>
}

function statusFromState(data: TransqCardState, running: boolean, t: ViewProps["t"]): TransqStatusMeta {
  if (running || data.phase === "running") return { label: t("status.running", "Running"), description: data.progressText || t("statusDesc.running", "TransQ is planning or organizing translation queues."), tone: "running", badgeVariant: "secondary", iconClass: "bg-primary text-primary-foreground" }
  if (data.phase === "completed") return { label: t("status.completed", "Done"), description: data.progressText || t("statusDesc.completed", "The last translation queue operation completed."), tone: "success", badgeVariant: "default", iconClass: "bg-primary text-primary-foreground" }
  if (data.phase === "error") return { label: t("status.error", "Failed"), description: data.progressText || t("statusDesc.error", "The last translation queue operation failed."), tone: "error", badgeVariant: "destructive", iconClass: "bg-destructive text-destructive-foreground" }
  return { label: t("status.idle", "Ready"), description: t("statusDesc.idle", "Add a translation workspace to preview its result queues."), tone: "idle", badgeVariant: "outline", iconClass: "bg-secondary text-secondary-foreground" }
}

function summaryText(props: ViewProps): string {
  if (props.data.progressText) return props.data.progressText
  if (props.result) return props.t("summary.items", "{{count}} queues / {{conflicts}} conflicts", { count: props.result.items.length, conflicts: props.result.conflictCount })
  return props.preview ? props.t("summary.preview", "Preview queue is armed") : props.t("summary.live", "Live organization is armed")
}

function splitPaths(value: string | undefined): string[] {
  return (value ?? "").split(/\r?\n/).map((path) => path.trim()).filter(Boolean)
}

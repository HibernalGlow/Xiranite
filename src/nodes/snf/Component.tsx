import { useEffect, useRef, useState } from "react"
import type { NodeComponentProps, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import { FloatingWindowNodeHeader } from "@/components/workspace/FloatingWindowFrame"
import type { SnfAction, SnfData, SnfInput, SnfMode, SnfPlanItem } from "@xiranite/node-snf/core"
import type { LucideIcon } from "lucide-react"
import { AlertTriangle, CheckCircle2, Clipboard, Copy, DatabaseZap, FolderInput, GitCompare, ListOrdered, Play, RotateCcw, Settings2, ShieldAlert, Square, Terminal, Trash2, XCircle } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PathTextarea } from "@/components/ui/path-input"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useNodeI18n } from "@/nodes/shared/useNodeI18n"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import { NodeConfigButton } from "@/nodes/shared/NodeConfigPopover"
import { ACTIONS, MODES, NODE_ICON } from "./constants"
import type { SnfCardState, SnfStatusMeta } from "./types"
import { CONFIG_FIELDS } from "./types"

type TranslateFn = (key: string, fallback: string, vars?: Record<string, unknown>) => string

export function Component({ compId, host }: NodeComponentProps<SnfCardState>) {
  "use no memo"
  const surface = useNodeSurface()
  const { t } = useNodeI18n("snf")
  const data = getHostData(host, compId)
  const dataRef = useRef<SnfCardState>(data)
  dataRef.current = data
  const [running, setRunning] = useState(false)
  const [defaults, setDefaults] = useState<Partial<SnfCardState> | undefined>()
  const [configDirty, setConfigDirty] = useState(false)

  const action = data.action ?? "plan"
  const actionMeta = ACTIONS.find((item) => item.value === action) ?? ACTIONS[1]!
  const paths = splitLines(data.pathsText)
  const result = data.result ?? null
  const logs = data.logs ?? []
  const progress = data.progress ?? 0
  const status = statusFromState(data, running, result, t)
  const compactSurface = surface.mode === "compact" || surface.mode === "portrait"
  const forceCollapsedSurface = compactSurface && surface.height > 0 && surface.height < 160
  const portraitCompact = surface.mode === "portrait" || (surface.mode === "compact" && surface.width < 560 && surface.height >= 300)

  useEffect(() => {
    const loadConfig = host.config?.get?.<Partial<SnfCardState>>() ?? host.getNodeConfig?.<Partial<SnfCardState>>()
    loadConfig?.then((response) => setDefaults(response.config)).catch(() => undefined)
  }, [host])

  useEffect(() => {
    if (!defaults) return
    setConfigDirty(CONFIG_FIELDS.some((field) => String(data[field] ?? "") !== String(defaults[field] ?? "")))
  }, [data.pathsText, data.mode, data.keepTimestamp, data.dryRun, defaults])

  function patch(patchData: Partial<SnfCardState>) {
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

  async function copyResults() {
    const lines = (dataRef.current.result?.items ?? []).map((item) => `${item.status}\t${item.sourcePath}\t${item.targetName}\t${item.reason ?? ""}`)
    await host.clipboard?.writeText?.(lines.join("\n"))
  }

  async function copyLogs() {
    await host.clipboard?.writeText?.(logs.join("\n"))
  }

  function reset() {
    patch({ logs: [], phase: "idle", progress: 0, progressText: "", result: null })
  }

  async function saveAsDefault() {
    const config: Partial<SnfCardState> = {}
    for (const field of CONFIG_FIELDS) {
      const value = dataRef.current[field]
      if (value !== undefined) (config as Record<string, unknown>)[field] = value
    }
    if (host.config?.save) await host.config.save(config)
    else await host.saveNodeConfig?.(config)
    setDefaults(config)
    setConfigDirty(false)
  }

  async function execute(nextAction: SnfAction = action) {
    if (running) return
    if (!splitLines(dataRef.current.pathsText).length) {
      const message = t("error.noPaths", "请先输入至少一个库目录或作者目录。")
      patch({ phase: "error", progress: 0, progressText: message })
      pushLog(message)
      return
    }
    const run = host.runner?.run ?? host.actions?.run
    if (!run) {
      const message = t("error.noRunEnv", "当前环境没有本地运行能力，请使用桌面模式或 CLI。")
      patch({ phase: "error", progress: 0, progressText: message })
      pushLog("Native action is unavailable in this host.")
      return
    }
    setRunning(true)
    patch({ action: nextAction, phase: "running", progress: 0, progressText: t("progress.start", "{{action}}开始", { action: actionLabel(nextAction, t) }), result: null })
    try {
      const response = await run<SnfInput, SnfData>("snf", buildInput(nextAction, dataRef.current), (event: NodeRunEvent) => {
        if (event.type === "progress") {
          patch({ progress: event.progress ?? 0, progressText: event.message })
          pushLog(`[${event.progress ?? 0}%] ${event.message}`)
        } else pushLog(event.message)
      }) as NodeRunResult<SnfData>
      patch({ phase: response.success ? "completed" : "error", progress: response.success ? 100 : 0, progressText: response.message, result: response.data ?? null })
      pushLog(response.message)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      patch({ phase: "error", progress: 0, progressText: message })
      pushLog(message)
    } finally {
      setRunning(false)
    }
  }

  const props: ViewProps = {
    action, actionMeta, configDirty, data, defaults, logs, paths, progress, result, running, status, t,
    onActionChange: (value) => patch({ action: value }),
    onCopyLogs: copyLogs,
    onCopyResults: copyResults,
    onExecute: execute,
    onPastePaths: pastePaths,
    onPatch: patch,
    onReset: reset,
    onRestoreDefault: () => defaults && patch(defaults),
    onSaveDefault: saveAsDefault,
  }

  return (
    <TooltipProvider>
      <div ref={surface.ref} className="@container/snf flex h-full min-h-0 w-full overflow-hidden">
        {surface.mode === "collapsed" || forceCollapsedSurface ? <CollapsedView {...props} /> : compactSurface ? (portraitCompact ? <PortraitView {...props} /> : <CompactView {...props} />) : <FullView {...props} />}
      </div>
    </TooltipProvider>
  )
}

interface ViewProps {
  action: SnfAction
  actionMeta: (typeof ACTIONS)[number]
  configDirty: boolean
  data: SnfCardState
  defaults?: Partial<SnfCardState>
  logs: string[]
  paths: string[]
  progress: number
  result: SnfData | null
  running: boolean
  status: SnfStatusMeta
  t: TranslateFn
  onActionChange: (value: SnfAction) => void
  onCopyLogs: () => void
  onCopyResults: () => void
  onExecute: (action?: SnfAction) => void
  onPastePaths: () => void
  onPatch: (patch: Partial<SnfCardState>) => void
  onReset: () => void
  onRestoreDefault: () => void
  onSaveDefault: () => void
}

function CollapsedView(props: ViewProps) {
  const Icon = NODE_ICON
  return <div data-testid="snf-collapsed-view" className="flex h-full min-h-0 w-full items-center gap-2 overflow-hidden rounded-xl border bg-background/85 px-3 py-2 shadow-sm"><div className={cn("grid size-8 shrink-0 place-items-center rounded-lg", props.status.iconClass)}><Icon /></div><div className="min-w-0 flex-1"><div className="flex items-center gap-1 text-xs font-semibold leading-none"><span>{props.t("name", "SNF")}</span><Badge variant={props.status.badgeVariant}>{props.status.label}</Badge></div><div className="mt-1 truncate text-xs text-muted-foreground">{summaryText(props)}</div></div><RunButton compact props={props} /></div>
}

function CompactView(props: ViewProps) {
  return (
    <div data-testid="snf-compact-view" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-2 p-3 pb-2"><HeaderLine status={props.status} subtitle={props.data.progressText || summaryText(props)} t={props.t} /><div className="flex shrink-0 items-center gap-1"><ActionTools {...props} /><RunButton compact props={props} /></div></div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3"><ActionMode value={props.action} disabled={props.running} onChange={props.onActionChange} t={props.t} /><ModeToggle value={props.data.mode ?? "library"} disabled={props.running} onChange={(mode) => props.onPatch({ mode })} t={props.t} /><PathInput compact data={props.data} disabled={props.running} onPaste={props.onPastePaths} onPatch={props.onPatch} t={props.t} /><SwitchPanel compact data={props.data} disabled={props.running} onPatch={props.onPatch} t={props.t} /><div className="min-h-0 flex-1"><ResultTabs compact logs={props.logs} result={props.result} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} t={props.t} /></div></div>
    </div>
  )
}

function PortraitView(props: ViewProps) {
  return <div data-testid="snf-portrait-view" className="flex h-full min-h-0 flex-col gap-2 p-2"><div className="flex shrink-0 items-start justify-between gap-2"><HeaderLine status={props.status} subtitle={props.data.progressText || summaryText(props)} t={props.t} /><RunButton compact props={props} /></div><ActionMode value={props.action} disabled={props.running} onChange={props.onActionChange} t={props.t} /><ModeToggle value={props.data.mode ?? "library"} disabled={props.running} onChange={(mode) => props.onPatch({ mode })} t={props.t} /><PathInput compact data={props.data} disabled={props.running} onPaste={props.onPastePaths} onPatch={props.onPatch} t={props.t} /><SwitchPanel compact data={props.data} disabled={props.running} onPatch={props.onPatch} t={props.t} /><div className="min-h-0 flex-1"><ResultTabs compact logs={props.logs} result={props.result} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} t={props.t} /></div></div>
}

function FullView(props: ViewProps) {
  return (
    <div data-testid="snf-full-view" className="flex min-h-0 flex-1 flex-col gap-2 p-3">
      <div className="flex shrink-0 flex-col gap-2 @3xl/snf:flex-row @3xl/snf:items-center @3xl/snf:justify-between"><div className="flex min-w-0 flex-col gap-2 @3xl/snf:flex-row @3xl/snf:items-center"><HeaderLine status={props.status} subtitle={props.data.progressText || summaryText(props)} t={props.t} /><div data-testid="snf-header-toolbar" className="flex min-w-0 flex-wrap items-center gap-1"><ActionTools {...props} /></div></div><StatsPanel result={props.result} paths={props.paths} progress={props.progress} t={props.t} /></div>
      {(props.status.tone === "running" || props.status.tone === "error") && <StatusStrip progress={props.progress} status={props.status} text={props.data.progressText} />}
      <div className="grid min-h-0 flex-1 gap-2 @2xl/snf:grid-cols-[minmax(250px,320px)_minmax(0,1fr)] @4xl/snf:grid-cols-[minmax(250px,320px)_minmax(0,1fr)_minmax(260px,320px)]">
        <section className="flex min-h-0 flex-col gap-2 overflow-auto rounded-lg border bg-card p-2"><ZoneTitle icon={FolderInput} label={props.t("sections.pathAndPattern", "路径和模式")} /><PathInput data={props.data} disabled={props.running} onPaste={props.onPastePaths} onPatch={props.onPatch} t={props.t} /><ModeToggle value={props.data.mode ?? "library"} disabled={props.running} onChange={(mode) => props.onPatch({ mode })} t={props.t} /><SwitchPanel data={props.data} disabled={props.running} onPatch={props.onPatch} t={props.t} /></section>
        <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border bg-card"><div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2"><ZoneTitle icon={GitCompare} label={props.t("sections.scheme", "序号计划")} /><Badge variant="outline">{props.result?.items.length ?? props.paths.length}</Badge></div><Separator /><PlanRows items={props.result?.items ?? []} paths={props.paths} t={props.t} /></section>
        <div className="grid min-h-0 gap-2 grid-rows-[auto_minmax(0,1fr)] @2xl/snf:col-span-2 @4xl/snf:col-span-1"><ExecutionGate {...props} /><ResultTabs logs={props.logs} result={props.result} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} t={props.t} /></div>
      </div>
    </div>
  )
}

function ActionTools(props: ViewProps & { compact?: boolean }) {
  return <div className="flex min-w-0 items-center gap-1">{!props.compact && <ActionMode value={props.action} disabled={props.running} onChange={props.onActionChange} t={props.t} />}<NodeConfigButton nodeKey="snf" configDirty={props.configDirty} defaults={props.defaults} disabled={props.running} onResetOverride={props.onRestoreDefault} onRestoreDefault={props.onRestoreDefault} onSaveDefault={props.onSaveDefault} /><IconButton icon={RotateCcw} label={props.t("actions.clearState", "清空状态")} onClick={props.onReset} /></div>
}

function ActionMode(props: { disabled?: boolean; value: SnfAction; onChange: (value: SnfAction) => void; t: TranslateFn }) {
  return <ToggleGroup type="single" value={props.value} disabled={props.disabled} onValueChange={(value) => value && props.onChange(value as SnfAction)} className="grid grid-cols-3" size="sm">{ACTIONS.map((item) => <ToggleGroupItem key={item.value} value={item.value} className="min-w-0 gap-1"><item.icon className="size-3.5" /><span className="truncate text-xs">{props.t(`actions.${item.value}.short`, item.shortLabel)}</span></ToggleGroupItem>)}</ToggleGroup>
}

function ModeToggle(props: { disabled?: boolean; value: SnfMode; onChange: (value: SnfMode) => void; t: TranslateFn }) {
  return <ToggleGroup type="single" value={props.value} disabled={props.disabled} onValueChange={(value) => value && props.onChange(value as SnfMode)} className="grid grid-cols-2" size="sm">{MODES.map((item) => <ToggleGroupItem key={item.value} value={item.value} className="min-w-0 gap-1"><item.icon className="size-3.5" /><span className="truncate text-xs">{props.t(`modes.${item.value}`, item.label)}</span></ToggleGroupItem>)}</ToggleGroup>
}

function PathInput(props: { compact?: boolean; data: SnfCardState; disabled?: boolean; onPaste: () => void; onPatch: (patch: Partial<SnfCardState>) => void; t: TranslateFn }) {
  return <div className="grid gap-1.5">{!props.compact && <Label htmlFor="snf-paths" className="text-xs">{props.t("fields.pathsLabel", "库目录或作者目录")}</Label>}<div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-1.5"><PathTextarea id="snf-paths" aria-label="snf paths" className={cn("min-h-0 resize-none font-mono text-xs", props.compact ? "h-14" : "h-28")} disabled={props.disabled} placeholder={props.t("placeholder.paths", "每行一个目录\nD:/archives")} value={props.data.pathsText ?? ""} onValueChange={(pathsText) => props.onPatch({ pathsText })} /><div className="grid content-start gap-1.5"><IconButton disabled={props.disabled} icon={Clipboard} label={props.t("actions.pastePaths", "粘贴路径")} onClick={props.onPaste} /><IconButton disabled={props.disabled || !props.data.pathsText} icon={Trash2} label={props.t("actions.clearPaths", "清空路径")} onClick={() => props.onPatch({ pathsText: "" })} /></div></div></div>
}

function SwitchPanel(props: { compact?: boolean; data: SnfCardState; disabled?: boolean; onPatch: (patch: Partial<SnfCardState>) => void; t: TranslateFn }) {
  return <div className={cn("grid gap-2", props.compact ? "grid-cols-1" : "grid-cols-[repeat(auto-fit,minmax(8rem,1fr))]")}><SwitchRow checked={props.data.dryRun ?? true} disabled={props.disabled} icon={ShieldAlert} label={props.t("switches.preview", "预览")} onCheckedChange={(dryRun) => props.onPatch({ dryRun })} /><SwitchRow checked={props.data.keepTimestamp ?? true} disabled={props.disabled} icon={ListOrdered} label={props.t("switches.keepTimestamp", "保留时间")} onCheckedChange={(keepTimestamp) => props.onPatch({ keepTimestamp })} /></div>
}

function ExecutionGate(props: ViewProps) {
  const live = props.action === "rename" && !(props.data.dryRun ?? true)
  return <section className={cn("flex shrink-0 flex-col gap-2 rounded-lg border bg-card p-2", live && "border-destructive/50 bg-destructive/[0.03]")}><div className="flex items-center justify-between gap-2"><ZoneTitle icon={live ? AlertTriangle : ShieldAlert} label={props.t("sections.execution", "执行")} tone={live ? "danger" : "default"} /><Badge variant={live ? "destructive" : "outline"}>{props.data.dryRun ?? true ? props.t("execution.preview", "预览") : props.t("execution.write", "写入")}</Badge></div><ActionMode value={props.action} disabled={props.running} onChange={props.onActionChange} t={props.t} /><SwitchPanel data={props.data} disabled={props.running} onPatch={props.onPatch} t={props.t} /><RunButton props={props} /></section>
}

function RunButton({ compact, props }: { compact?: boolean; props: ViewProps }) {
  if (props.running) return <Button aria-label="snf running" disabled size={compact ? "icon-sm" : "sm"} variant="secondary"><Square />{!compact && <span>{props.t("labels.running", "运行中")}</span>}</Button>
  const label = actionLabel(props.action, props.t)
  const live = props.action === "rename" && !(props.data.dryRun ?? true)
  if (live) return <AlertDialog><AlertDialogTrigger asChild><Button aria-label={label} size={compact ? "icon-sm" : "sm"} variant="destructive"><Play />{!compact && <span>{label}</span>}</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{props.t("confirm.title", "确认执行修复？")}</AlertDialogTitle><AlertDialogDescription>{props.t("confirm.description", "当前会重命名编号目录。请先确认路径、模式和冲突列表。")}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{props.t("actions.cancel", "取消")}</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => props.onExecute(props.action)}>{props.t("actions.confirmExecute", "确认执行")}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  return <Button aria-label={label} size={compact ? "icon-sm" : "sm"} onClick={() => props.onExecute(props.action)}><Play />{!compact && <span>{label}</span>}</Button>
}

function PlanRows(props: { items: SnfPlanItem[]; paths: string[]; t: TranslateFn }) {
  if (!props.items.length) return <div className="flex min-h-32 flex-1 items-center justify-center p-4 text-center text-sm text-muted-foreground">{props.paths.length ? props.t("empty.planAfterRun", "运行预览后显示序号修复计划。") : props.t("empty.planAfterInput", "输入目录后预览序号修复计划。")}</div>
  return <ScrollArea className="min-h-0 flex-1"><div className="grid gap-1.5 p-3">{props.items.slice(0, 180).map((item, index) => { const meta = itemStatusMeta(item.status, props.t); const StatusIcon = meta.icon; return <div key={`${item.sourcePath}:${index}`} className={cn("grid gap-1 rounded-md border px-2 py-1.5", (item.status === "conflict" || item.status === "error") && "border-destructive/40", item.status === "unchanged" && "opacity-75")}><div className="flex min-w-0 items-center gap-2"><ListOrdered className="size-4 shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1"><div className="truncate text-xs font-medium">{item.sourceName}</div><div className="truncate font-mono text-[11px] text-muted-foreground">{"->"} {item.targetName}</div></div><Badge variant={meta.variant} className="gap-1"><StatusIcon className="size-3" />{meta.label}</Badge></div><div className="truncate text-[11px] text-muted-foreground">{item.sequence ? `#${item.sequence}` : props.t("labels.unnumbered", "未编号")}{item.reason ? ` / ${item.reason}` : ""}</div></div> })}</div></ScrollArea>
}

function ResultTabs(props: { compact?: boolean; logs: string[]; result: SnfData | null; onCopyLogs: () => void; onCopyResults: () => void; t: TranslateFn }) {
  return <Tabs defaultValue="plan" className="flex h-full min-h-0 flex-col"><TabsList variant="line" className="shrink-0"><TabsTrigger value="plan">{props.t("tabs.plan", "计划")}</TabsTrigger><TabsTrigger value="issues">{props.t("tabs.issues", "问题")}</TabsTrigger><TabsTrigger value="logs">{props.t("tabs.logs", "日志")}</TabsTrigger></TabsList><TabsContent value="plan" className="min-h-0 flex-1"><PlanPanel compact={props.compact} result={props.result} onCopy={props.onCopyResults} t={props.t} /></TabsContent><TabsContent value="issues" className="min-h-0 flex-1"><TextPanel empty={props.t("empty.noIssues", "暂无问题")} lines={[...(props.result?.errors ?? []), ...(props.result?.items ?? []).filter((item) => item.reason && item.status !== "ready").map((item) => `${item.sourcePath}: ${item.reason}`)]} t={props.t} /></TabsContent><TabsContent value="logs" className="min-h-0 flex-1"><TextPanel actionLabel={props.t("actions.copy", "复制")} empty={props.t("empty.logsHint", "运行日志会显示在这里。")} icon={Terminal} lines={props.logs} onAction={props.onCopyLogs} t={props.t} /></TabsContent></Tabs>
}

function PlanPanel(props: { compact?: boolean; result: SnfData | null; onCopy: () => void; t: TranslateFn }) {
  return <section className="flex h-full min-h-0 flex-col rounded-lg border bg-card"><div className={props.compact ? "flex shrink-0 items-center justify-between gap-2 px-2 py-1.5" : "flex shrink-0 items-center justify-between gap-2 px-3 py-2"}><div className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground"><GitCompare className="size-3.5" /><span>{props.result?.items.length ? `${props.result.items.length} ${props.t("labels.itemUnit", "项")}` : props.t("labels.waitRun", "等待运行")}</span></div><Button disabled={!props.result?.items.length} size="xs" variant="ghost" onClick={props.onCopy}><Copy data-icon="inline-start" />{props.t("actions.copy", "复制")}</Button></div><Separator /><PlanRows items={props.result?.items ?? []} paths={[]} t={props.t} /></section>
}

function TextPanel(props: { actionLabel?: string; empty: string; icon?: LucideIcon; lines: string[]; onAction?: () => void; t: TranslateFn }) {
  const Icon = props.icon
  return <section className="flex h-full min-h-0 flex-col rounded-lg border bg-card"><div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2"><span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">{Icon && <Icon className="size-3.5" />}{props.lines.length ? `${props.lines.length} ${props.t("labels.lineUnit", "行")}` : props.empty}</span>{props.onAction && <Button disabled={!props.lines.length} size="xs" variant="ghost" onClick={props.onAction}>{props.actionLabel ?? props.t("actions.copy", "复制")}</Button>}</div><Separator /><ScrollArea className="min-h-0 flex-1">{props.lines.length ? <pre className="p-3 text-xs leading-5 text-muted-foreground">{props.lines.join("\n")}</pre> : <div className="flex min-h-24 items-center justify-center p-4 text-sm text-muted-foreground">{props.empty}</div>}</ScrollArea></section>
}

function HeaderLine(props: { status: SnfStatusMeta; subtitle: string; t: TranslateFn }) {
  const Icon = NODE_ICON
  return <FloatingWindowNodeHeader><div className="min-w-0"><div className="flex min-w-0 items-center gap-2"><div className={cn("grid size-8 shrink-0 place-items-center rounded-lg", props.status.iconClass)}><Icon /></div><div className="min-w-0"><div className="flex min-w-0 items-center gap-2"><h3 className="truncate text-sm font-semibold leading-none">{props.t("name", "SNF")}</h3><Badge variant={props.status.badgeVariant}>{props.status.label}</Badge></div><p className="mt-1 truncate text-xs text-muted-foreground">{props.subtitle}</p></div></div></div></FloatingWindowNodeHeader>
}

function StatsPanel(props: { paths: string[]; progress: number; result: SnfData | null; t: TranslateFn }) {
  const stats = [{ label: props.t("stats.paths", "路径"), value: props.paths.length }, { label: props.t("stats.artists", "作者"), value: props.result?.artistCount ?? 0 }, { label: props.t("stats.ready", "待改"), value: props.result?.readyCount ?? 0 }, { label: props.t("stats.renamed", "已改"), value: props.result?.renamedCount ?? 0 }, { label: props.t("stats.conflict", "冲突"), value: props.result?.conflictCount ?? 0 }, { label: props.t("stats.progress", "进度"), value: props.progress, suffix: "%" }]
  return <div className="grid shrink-0 grid-cols-3 gap-1 @3xl/snf:grid-cols-6">{stats.map((item) => <div key={item.label} className="min-w-0 rounded-md bg-muted/35 px-2 py-1.5 text-center"><div className="truncate text-[11px] text-muted-foreground">{item.label}</div><div className="text-sm font-semibold tabular-nums">{item.value}{item.suffix ?? ""}</div></div>)}</div>
}

function StatusStrip(props: { progress: number; status: SnfStatusMeta; text?: string }) {
  return <div className="rounded-md border bg-card p-2"><div className="mb-1 flex min-w-0 items-center justify-between gap-2"><div className="truncate text-xs font-medium">{props.text || props.status.description}</div><Badge variant={props.status.badgeVariant}>{props.status.label}</Badge></div><Progress value={props.progress} className={cn("h-1.5", props.status.tone === "error" && "bg-destructive/20")} /></div>
}

function SwitchRow(props: { checked: boolean; disabled?: boolean; icon: LucideIcon; label: string; onCheckedChange: (checked: boolean) => void }) {
  const Icon = props.icon
  return <label className="flex min-w-0 items-center justify-between gap-2 rounded-md border bg-card px-2 py-1.5"><span className="flex min-w-0 items-center gap-1.5"><Icon className="size-4 shrink-0 text-muted-foreground" /><span className="truncate text-xs font-medium">{props.label}</span></span><Switch checked={props.checked} disabled={props.disabled} size="sm" onCheckedChange={props.onCheckedChange} /></label>
}

function IconButton(props: { active?: boolean; disabled?: boolean; icon: LucideIcon; label: string; onClick: () => void }) {
  const Icon = props.icon
  return <Tooltip><TooltipTrigger asChild><Button aria-label={props.label} disabled={props.disabled} size="icon-sm" variant={props.active ? "secondary" : "outline"} onClick={props.onClick}><Icon /></Button></TooltipTrigger><TooltipContent>{props.label}</TooltipContent></Tooltip>
}

function ZoneTitle(props: { icon: LucideIcon; label: string; tone?: "default" | "danger" }) {
  const Icon = props.icon
  return <div className="flex shrink-0 items-center gap-1.5"><Icon className={cn("size-3.5", props.tone === "danger" ? "text-destructive" : "text-muted-foreground")} /><span className="text-xs font-semibold">{props.label}</span></div>
}

function statusFromState(data: SnfCardState, running: boolean, result: SnfData | null, t: TranslateFn): SnfStatusMeta {
  if (running || data.phase === "running") return { label: t("status.running.label", "运行中"), description: data.progressText || t("status.running.description", "SNF 正在扫描或修复序号。"), tone: "running", badgeVariant: "secondary", iconClass: "bg-primary text-primary-foreground" }
  if (data.phase === "error" || result?.errorCount) return { label: t("status.error.label", "失败"), description: data.progressText || result?.errors[0] || t("status.error.description", "上次任务失败，请查看问题列表。"), tone: "error", badgeVariant: "destructive", iconClass: "bg-destructive text-destructive-foreground" }
  if (data.phase === "completed") return { label: t("status.completed.label", "完成"), description: data.progressText || t("status.completed.description", "上次 SNF 任务已完成。"), tone: "success", badgeVariant: "default", iconClass: "bg-primary text-primary-foreground" }
  return { label: t("status.idle.label", "就绪"), description: t("status.idle.description", "输入目录后预览序号修复计划。"), tone: "idle", badgeVariant: "outline", iconClass: "bg-secondary text-secondary-foreground" }
}

function itemStatusMeta(status: SnfPlanItem["status"], t: TranslateFn) {
  if (status === "renamed") return { icon: CheckCircle2, label: t("itemStatus.renamed", "已改"), variant: "default" as const }
  if (status === "ready") return { icon: GitCompare, label: t("itemStatus.ready", "待改"), variant: "secondary" as const }
  if (status === "conflict") return { icon: AlertTriangle, label: t("itemStatus.conflict", "冲突"), variant: "destructive" as const }
  if (status === "error") return { icon: XCircle, label: t("itemStatus.error", "错误"), variant: "destructive" as const }
  if (status === "skipped") return { icon: AlertTriangle, label: t("itemStatus.skipped", "跳过"), variant: "outline" as const }
  return { icon: CheckCircle2, label: t("itemStatus.unchanged", "不变"), variant: "outline" as const }
}

function summaryText(props: ViewProps): string {
  if (props.data.progressText) return props.data.progressText
  if (props.result) return `${props.result.items.length} ${props.t("summary.items", "项")} / ${props.t("summary.ready", "待改")} ${props.result.readyCount} / ${props.t("summary.conflict", "冲突")} ${props.result.conflictCount}`
  if (props.paths.length) return `${props.paths.length} ${props.t("summary.paths", "条路径")} / ${actionLabel(props.action, props.t)}`
  return props.t(`actions.${props.actionMeta.value}.description`, props.actionMeta.description)
}

function actionLabel(action: SnfAction, t: TranslateFn): string {
  const item = ACTIONS.find((it) => it.value === action)
  return item ? t(`actions.${item.value}.label`, item.label) : action
}

function buildInput(action: SnfAction, data: SnfCardState): SnfInput {
  return { action, paths: splitLines(data.pathsText), mode: data.mode ?? "library", keepTimestamp: data.keepTimestamp ?? true, dryRun: data.dryRun ?? true }
}

function splitLines(value: unknown): string[] {
  return String(value ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

function getHostData(host: NodeComponentProps<SnfCardState>["host"], compId: string): SnfCardState {
  return host.state?.getData?.() ?? host.getData<SnfCardState>(compId) ?? {}
}

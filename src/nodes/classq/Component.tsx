import { useEffect, useMemo, useRef, useState } from "react"
import type { NodeComponentProps, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type { ClassqAction, ClassqData, ClassqInput, ClassqPlanItem, ClassqTransferMode } from "@xiranite/node-classq/core"
import type { LucideIcon } from "lucide-react"
import { AlertTriangle, CheckCircle2, Clipboard, Copy, DatabaseZap, File, Folder, FolderOpen, ListTree, Play, RotateCcw, Search, Settings2, ShieldAlert, Square, Terminal, Trash2, XCircle } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Tree, type TreeViewElement } from "@/components/ui/file-tree"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { cn } from "@/lib/utils"
import { useNodeI18n } from "@/nodes/shared/useNodeI18n"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import { ACTIONS, NODE_ICON, PLAN_ICON, TRANSFER_MODES } from "./constants"
import type { ClassqCardState, ClassqStatusMeta } from "./types"
import { CONFIG_FIELDS } from "./types"

export function Component({ compId, host }: NodeComponentProps<ClassqCardState>) {
  const surface = useNodeSurface()
  const { t } = useNodeI18n("classq")
  const data = getHostData(host, compId)
  const dataRef = useRef<ClassqCardState>(data)
  dataRef.current = data

  const [running, setRunning] = useState(false)
  const [defaults, setDefaults] = useState<Partial<ClassqCardState> | undefined>()
  const [configDirty, setConfigDirty] = useState(false)

  const persistedAction = data.action ?? "plan"
  const [action, setAction] = useState<ClassqAction>(persistedAction)
  const actionMeta = ACTIONS.find((item) => item.value === action) ?? ACTIONS[0]!
  const roots = useMemo(() => splitLines(data.pathsText), [data.pathsText])
  const logs = data.logs ?? []
  const result = data.result ?? null
  const progress = data.progress ?? 0
  const status = statusFromState(data, running, result, t)
  const compactSurface = surface.mode === "compact" || surface.mode === "portrait"
  const forceCollapsedSurface = compactSurface && surface.height > 0 && surface.height < 160
  const portraitCompact = surface.mode === "portrait" || (surface.mode === "compact" && surface.width < 560 && surface.height >= 300)

  useEffect(() => {
    const loadConfig = host.config?.get?.<Partial<ClassqCardState>>() ?? host.getNodeConfig?.<Partial<ClassqCardState>>()
    loadConfig?.then((response) => setDefaults(response.config)).catch(() => undefined)
  }, [host])

  useEffect(() => {
    setAction(persistedAction)
  }, [persistedAction])

  useEffect(() => {
    if (!defaults) return
    setConfigDirty(CONFIG_FIELDS.some((field) => String(data[field] ?? "") !== String(defaults[field] ?? "")))
  }, [data.pathsText, data.keyword, data.waitKeyword, data.transferMode, data.existingPolicy, data.dryRun, defaults])

  function patch(patchData: Partial<ClassqCardState>) {
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
    const lines = (dataRef.current.result?.items ?? []).map((item) => `${item.status}\t${item.stage}\t${item.sourcePath}\t${item.targetRelative}\t${item.reason ?? ""}`)
    await host.clipboard?.writeText?.(lines.join("\n"))
  }

  async function copyLogs() {
    await host.clipboard?.writeText?.(logs.join("\n"))
  }

  function reset() {
    patch({ logs: [], phase: "idle", progress: 0, progressText: "", result: null })
  }

  async function saveAsDefault() {
    const config: Partial<ClassqCardState> = {}
    for (const field of CONFIG_FIELDS) {
      const value = dataRef.current[field]
      if (value !== undefined) (config as Record<string, unknown>)[field] = value
    }
    if (host.config?.save) await host.config.save(config)
    else await host.saveNodeConfig?.(config)
    setDefaults(config)
    setConfigDirty(false)
  }

  async function execute(nextAction: ClassqAction = action) {
    if (running) return
    if (!splitLines(dataRef.current.pathsText).length) {
      const message = "Add at least one root directory before running ClassQ."
      patch({ phase: "error", progress: 0, progressText: message })
      pushLog(message)
      return
    }
    const run = host.runner?.run ?? host.actions?.run
    if (!run) {
      const message = "Native execution is unavailable in this host. Use the desktop backend or CLI."
      patch({ phase: "error", progress: 0, progressText: message })
      pushLog(message)
      return
    }

    setRunning(true)
    setAction(nextAction)
    patch({ action: nextAction, phase: "running", progress: 0, progressText: t("status.started", "{{action}}已开始", { action: actionLabel(nextAction, t) }), result: null })
    try {
      const response = await run<ClassqInput, ClassqData>("classq", buildInput(nextAction, dataRef.current), (event: NodeRunEvent) => {
        if (event.type === "progress") {
          patch({ progress: event.progress ?? 0, progressText: event.message })
          pushLog(`[${event.progress ?? 0}%] ${event.message}`)
        } else {
          pushLog(event.message)
        }
      }) as NodeRunResult<ClassqData>
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
    action,
    actionMeta,
    configDirty,
    data,
    defaults,
    logs,
    progress,
    result,
    roots,
    running,
    status,
    t,
    onActionChange: (value) => {
      setAction(value)
      patch({ action: value })
    },
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
      <div ref={surface.ref} className="@container/classq flex h-full min-h-0 w-full overflow-hidden bg-card">
        {surface.mode === "collapsed" || forceCollapsedSurface ? (
          <CollapsedView {...props} />
        ) : compactSurface ? (
          portraitCompact ? <PortraitView {...props} /> : <CompactView {...props} />
        ) : (
          <FullView {...props} />
        )}
      </div>
    </TooltipProvider>
  )
}

interface ViewProps {
  action: ClassqAction
  actionMeta: (typeof ACTIONS)[number]
  configDirty: boolean
  data: ClassqCardState
  defaults?: Partial<ClassqCardState>
  logs: string[]
  progress: number
  result: ClassqData | null
  roots: string[]
  running: boolean
  status: ClassqStatusMeta
  t: ReturnType<typeof useNodeI18n>["t"]
  onActionChange: (value: ClassqAction) => void
  onCopyLogs: () => void
  onCopyResults: () => void
  onExecute: (action?: ClassqAction) => void
  onPastePaths: () => void
  onPatch: (patch: Partial<ClassqCardState>) => void
  onReset: () => void
  onRestoreDefault: () => void
  onSaveDefault: () => void
}

function CollapsedView(props: ViewProps) {
  const Icon = NODE_ICON
  return (
    <div data-testid="classq-collapsed-view" className="flex h-full min-h-0 w-full items-center gap-2 overflow-hidden rounded-xl border bg-card px-3 py-2 shadow-sm">
      <div className={cn("grid size-8 shrink-0 place-items-center rounded-lg", props.status.iconClass)}><Icon /></div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-xs font-semibold leading-none"><span>ClassQ</span><Badge variant={props.status.badgeVariant}>{props.status.label}</Badge></div>
        <div className="mt-1 truncate text-xs text-muted-foreground">{summaryText(props)}</div>
      </div>
      <RunButton compact props={props} />
    </div>
  )
}

function CompactView(props: ViewProps) {
  return (
    <div data-testid="classq-compact-view" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-2 px-3 pb-2 pt-3">
        <HeaderLine status={props.status} subtitle={viewSubtitle(props)} />
        <ActionTools {...props} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 px-3 pb-3">
        <div className="grid shrink-0 gap-1.5 @lg/classq:grid-cols-[minmax(0,1.35fr)_minmax(220px,0.65fr)]">
          <RootInput compact data={props.data} disabled={props.running} onPaste={props.onPastePaths} onPatch={props.onPatch} />
          <KeywordFields compact data={props.data} disabled={props.running} onPatch={props.onPatch} />
        </div>
        <ModeExecutionTabs compact props={props} />
        <div className="min-h-0 flex-1"><ResultTabs compact logs={props.logs} result={props.result} t={props.t} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} /></div>
      </div>
    </div>
  )
}

function PortraitView(props: ViewProps) {
  return (
    <div data-testid="classq-portrait-view" className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="flex shrink-0 items-start justify-between gap-2"><HeaderLine status={props.status} subtitle={viewSubtitle(props)} /><ActionTools {...props} /></div>
      <RootInput compact data={props.data} disabled={props.running} onPaste={props.onPastePaths} onPatch={props.onPatch} />
      <KeywordFields compact data={props.data} disabled={props.running} onPatch={props.onPatch} />
      <ModeExecutionTabs compact props={props} />
      <div className="min-h-0 flex-1"><ResultTabs compact logs={props.logs} result={props.result} t={props.t} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} /></div>
    </div>
  )
}

function FullView(props: ViewProps) {
  return (
    <div data-testid="classq-full-view" className="flex min-h-0 flex-1 p-3">
      <SpatialWorkbench {...props} />
    </div>
  )
}

function CommandPanel(props: ViewProps) {
  return (
    <section className="flex h-full min-h-0 flex-col bg-card" data-testid="classq-command-deck">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <Settings2 className="size-4 text-muted-foreground" />
        <span className="text-xs font-semibold">{props.t("command.title", "分类配置")}</span>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="grid min-w-0 gap-3 p-3">
          <div className="grid min-w-0 gap-1.5">
            <Label className="text-xs text-muted-foreground">{props.t("command.input", "输入目录")}</Label>
            <CommandRootInput expanded data={props.data} disabled={props.running} onPaste={props.onPastePaths} onPatch={props.onPatch} t={props.t} />
          </div>
          <div className="grid min-w-0 gap-1.5">
            <Label className="text-xs text-muted-foreground">{props.t("command.folders", "分类目录规则")}</Label>
            <div className="grid min-w-0 grid-cols-2 gap-1.5">
              <Input aria-label="classq keyword" className="h-8 min-w-0 font-mono text-xs" disabled={props.running} placeholder={props.t("fields.keyword", "关键词目录")} value={props.data.keyword ?? ""} onChange={(event) => props.onPatch({ keyword: event.currentTarget.value })} />
              <Input aria-label="classq wait" className="h-8 min-w-0 font-mono text-xs" disabled={props.running} placeholder={props.t("fields.wait", "等待目录")} value={props.data.waitKeyword ?? ""} onChange={(event) => props.onPatch({ waitKeyword: event.currentTarget.value })} />
            </div>
          </div>
          <ModeExecutionTabs compact props={props} />
        </div>
      </ScrollArea>
    </section>
  )
}

function CommandRootInput(props: { data: ClassqCardState; disabled?: boolean; expanded?: boolean; onPaste: () => void; onPatch: (patch: Partial<ClassqCardState>) => void; t: ViewProps["t"] }) {
  return (
    <InputGroup className="min-w-0 flex-1">
      <InputGroupTextarea aria-label="classq roots" className={cn(props.expanded ? "h-24 min-h-24" : "h-9 min-h-9", "py-2 font-mono text-xs leading-4")} disabled={props.disabled} placeholder={props.t("fields.roots", "根目录，每行一个")} value={props.data.pathsText ?? ""} onChange={(event) => props.onPatch({ pathsText: event.currentTarget.value })} />
      <InputGroupAddon align="inline-end">
        <InputGroupButton aria-label="Paste roots" disabled={props.disabled} size="icon-xs" onClick={props.onPaste}><Clipboard /></InputGroupButton>
        <InputGroupButton aria-label="Clear roots" disabled={props.disabled || !props.data.pathsText} size="icon-xs" onClick={() => props.onPatch({ pathsText: "" })}><Trash2 /></InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}

function ActionTools(props: ViewProps) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <IconButton disabled={props.running} active={props.configDirty} icon={DatabaseZap} label="Save defaults" onClick={props.onSaveDefault} />
      <IconButton disabled={props.running || !props.defaults} icon={Settings2} label="Restore defaults" onClick={props.onRestoreDefault} />
      <IconButton icon={RotateCcw} label="Clear state" onClick={props.onReset} />
    </div>
  )
}

function ModeExecutionTabs({ compact, props }: { compact?: boolean; props: ViewProps }) {
  const classifyDescription = props.data.dryRun ?? true
    ? props.t("mode.classify.previewDescription", "按当前移动或复制规则生成分类结果，不改动文件")
    : props.t("mode.classify.liveDescription", "按当前规则实际处理就绪项，执行前需要确认")
  return (
    <Tabs
      value={props.action}
      onValueChange={(value) => props.onActionChange(value as ClassqAction)}
      className="min-w-0 gap-1 rounded-md border p-1"
      data-testid="classq-mode-tabs"
    >
      <TabsList variant="line" className="h-8 w-full justify-start rounded-none border-b p-0">
        <TabsTrigger value="plan" disabled={props.running} className="flex-none px-3 text-xs"><Search />{props.t("action.scan.short", "扫描")}</TabsTrigger>
        <TabsTrigger value="classify" disabled={props.running} className="flex-none px-3 text-xs"><Play />{props.t("action.classify.short", "分类")}</TabsTrigger>
      </TabsList>
      <TabsContent value="plan" className="min-w-0">
        <div className="flex min-w-0 items-center justify-between gap-2">
          {!compact && <p className="min-w-0 truncate px-1 text-[11px] text-muted-foreground">{props.t("mode.scan.description", "递归扫描关键词目录并生成等待项计划")}</p>}
          <div className="ml-auto shrink-0"><RunButton action="plan" props={props} /></div>
        </div>
      </TabsContent>
      <TabsContent value="classify" className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <TransferToggle value={props.data.transferMode ?? "move"} disabled={props.running} onChange={(transferMode) => props.onPatch({ transferMode })} t={props.t} />
          <RiskToggle compact={compact} checked={props.data.dryRun ?? true} disabled={props.running} onCheckedChange={(dryRun) => props.onPatch({ dryRun })} t={props.t} />
          {!compact && <p className="min-w-32 flex-1 truncate px-1 text-[11px] text-muted-foreground">{classifyDescription}</p>}
          <div className="ml-auto shrink-0"><RunButton action="classify" props={props} /></div>
        </div>
      </TabsContent>
    </Tabs>
  )
}

function TransferToggle(props: { disabled?: boolean; value: ClassqTransferMode; onChange: (value: ClassqTransferMode) => void; t: ViewProps["t"] }) {
  return (
    <ToggleGroup type="single" value={props.value} disabled={props.disabled} onValueChange={(value) => value && props.onChange(value as ClassqTransferMode)} className="grid grid-cols-2" size="sm">
      {TRANSFER_MODES.map((item) => <ToggleGroupItem key={item.value} value={item.value} className="min-w-0 gap-1"><item.icon className="size-3.5" /><span className="truncate text-xs">{item.value === "move" ? props.t("transfer.move", "移动") : props.t("transfer.copy", "复制")}</span></ToggleGroupItem>)}
    </ToggleGroup>
  )
}

function RootInput(props: { compact?: boolean; data: ClassqCardState; disabled?: boolean; onPaste: () => void; onPatch: (patch: Partial<ClassqCardState>) => void }) {
  return (
    <div className="grid gap-1.5">
      {!props.compact && <Label htmlFor="classq-roots" className="text-xs">Root directories</Label>}
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-1.5">
        <Textarea id="classq-roots" aria-label="classq roots" className={cn("min-h-0 resize-none font-mono text-xs", props.compact ? "h-14" : "h-28")} disabled={props.disabled} placeholder={"One root directory per line\nD:/set"} value={props.data.pathsText ?? ""} onChange={(event) => props.onPatch({ pathsText: event.currentTarget.value })} />
        <div className="grid content-start gap-1.5"><IconButton disabled={props.disabled} icon={Clipboard} label="Paste roots" onClick={props.onPaste} /><IconButton disabled={props.disabled || !props.data.pathsText} icon={Trash2} label="Clear roots" onClick={() => props.onPatch({ pathsText: "" })} /></div>
      </div>
    </div>
  )
}

function KeywordFields(props: { compact?: boolean; data: ClassqCardState; disabled?: boolean; onPatch: (patch: Partial<ClassqCardState>) => void }) {
  return (
    <div className={cn("grid gap-2", props.compact ? "grid-cols-2" : "grid-cols-2")}>
      <div className="grid gap-1.5">
        {!props.compact && <Label htmlFor="classq-keyword" className="text-xs">Keyword folder</Label>}
        <Input id="classq-keyword" aria-label="classq keyword" disabled={props.disabled} placeholder="already" value={props.data.keyword ?? ""} onChange={(event) => props.onPatch({ keyword: event.currentTarget.value })} />
      </div>
      <div className="grid gap-1.5">
        {!props.compact && <Label htmlFor="classq-wait" className="text-xs">Wait folder</Label>}
        <Input id="classq-wait" aria-label="classq wait" disabled={props.disabled} placeholder="wait" value={props.data.waitKeyword ?? ""} onChange={(event) => props.onPatch({ waitKeyword: event.currentTarget.value })} />
      </div>
    </div>
  )
}

function RunButton({ action, compact, props }: { action?: ClassqAction; compact?: boolean; props: ViewProps }) {
  const resolvedAction = action ?? props.action
  const label = executionLabel(resolvedAction, props.data.dryRun ?? true, props.t)
  if (props.running) return <Button aria-label="classq running" disabled size={compact ? "icon-sm" : "sm"} variant="secondary"><Square />{!compact && <span>{props.t("status.running", "运行中")}</span>}</Button>
  const live = resolvedAction === "classify" && !(props.data.dryRun ?? true)
  if (live) {
    return (
      <AlertDialog>
        <AlertDialogTrigger asChild><Button aria-label={label} size={compact ? "icon-sm" : "sm"} variant="destructive"><Play />{!compact && <span>{label}</span>}</Button></AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{props.t("confirm.title", "确认实时执行 ClassQ 分类？")}</AlertDialogTitle><AlertDialogDescription>{props.t("confirm.description", "ClassQ 将移动或复制就绪的同级项目到等待目录；已存在的目标会作为冲突跳过。")}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>{props.t("confirm.cancel", "取消")}</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => props.onExecute(resolvedAction)}>{props.t("confirm.classify", "确认分类")}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
  }
  return <Button aria-label={label} size={compact ? "icon-sm" : "sm"} variant={resolvedAction === "plan" ? "secondary" : "default"} onClick={() => props.onExecute(resolvedAction)}><Play />{!compact && <span>{label}</span>}</Button>
}

function PlanRows(props: { items: ClassqPlanItem[]; roots: string[] }) {
  if (!props.items.length) {
    const text = props.roots.length ? "Run a scan to show keyword folders and wait transfers." : "Add root directories to preview wait classification."
    return <div className="flex min-h-32 flex-1 items-center justify-center p-4 text-center text-sm text-muted-foreground">{text}</div>
  }
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="grid gap-1.5 p-3">
        {props.items.slice(0, 180).map((item, index) => {
          const meta = itemStatusMeta(item.status)
          const StatusIcon = meta.icon
          const KindIcon = item.kind === "folder" ? Folder : File
          return (
            <div key={`${item.sourcePath}:${index}`} className={cn("grid gap-1 rounded-md border px-2 py-1.5", (item.status === "conflict" || item.status === "error") && "border-destructive/40", item.stage === "keyword" && "bg-muted/25")}>
              <div className="flex min-w-0 items-center gap-2"><KindIcon className="size-4 shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1"><div className="truncate text-xs font-medium">{item.sourceName}</div><div className="truncate font-mono text-[11px] text-muted-foreground">{"->"} {item.targetRelative}</div></div><Badge variant={meta.variant} className="gap-1"><StatusIcon className="size-3" />{meta.label}</Badge></div>
              <div className="truncate text-[11px] text-muted-foreground">{item.stage === "keyword" ? "keyword folder" : "wait candidate"}{item.reason ? ` / ${item.reason}` : ""}</div>
            </div>
          )
        })}
      </div>
    </ScrollArea>
  )
}

function SpatialWorkbench(props: ViewProps) {
  const issueLines = [
    ...(props.result?.errors ?? []),
    ...(props.result?.items ?? [])
      .filter((item) => item.reason && item.status !== "ready")
      .map((item) => `${item.sourcePath}: ${item.reason}`),
  ]
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card" data-testid="classq-spatial-workbench">
      <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 px-2 py-1.5" data-testid="classq-header-toolbar">
        <HeaderLine status={props.status} subtitle={viewSubtitle(props)} />
        <MetricsStrip progress={props.progress} result={props.result} roots={props.roots} t={props.t} />
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <IconButton disabled={!props.result?.items.length} icon={Copy} label="Copy plan" onClick={props.onCopyResults} />
          <IconButton disabled={!props.logs.length} icon={Terminal} label="Copy log" onClick={props.onCopyLogs} />
          <ActionTools {...props} />
        </div>
      </div>
      <Separator />
      {(props.status.tone === "running" || props.status.tone === "error") && <div className="shrink-0 border-b px-2 py-1.5"><StatusStrip progress={props.progress} status={props.status} text={props.data.progressText} /></div>}
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1" data-testid="classq-three-zone-workbench">
        <ResizablePanel id="classq-command" defaultSize="27%" minSize="21%" maxSize="38%">
          <CommandPanel {...props} />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel id="classq-results" defaultSize="73%" minSize="52%">
          <ClassqResultsWorkspace items={props.result?.items ?? []} issueLines={issueLines} logs={props.logs} roots={props.roots} t={props.t} />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}

function ResultTabList(props: { issueCount: number; logCount: number; planCount: number; t: ViewProps["t"] }) {
  const items = [
    { count: props.planCount, icon: PLAN_ICON, label: props.t("tabs.plan", "计划"), value: "plan" },
    { count: props.issueCount, icon: AlertTriangle, label: props.t("tabs.issues", "问题"), value: "issues" },
    { count: props.logCount, icon: Terminal, label: props.t("tabs.log", "日志"), value: "logs" },
  ]
  return (
    <TabsList variant="line" className="h-9 w-full shrink-0 justify-start border-b px-2" data-testid="classq-result-list">
      {items.map((item) => (
        <TabsTrigger key={item.value} value={item.value} className="flex-none px-3 text-xs">
          <item.icon />
          <span>{item.label}</span>
          <span className="text-[10px] tabular-nums text-muted-foreground">{item.count}</span>
        </TabsTrigger>
      ))}
    </TabsList>
  )
}

function MetricsStrip(props: { progress: number; result: ClassqData | null; roots: string[]; t: ViewProps["t"] }) {
  const stats = [
    { label: props.t("metrics.roots", "根目录"), value: props.roots.length },
    { label: props.t("metrics.keyword", "关键词"), value: props.result?.keywordCount ?? 0 },
    { label: props.t("metrics.wait", "等待"), value: props.result?.waitCount ?? 0 },
    { label: props.t("metrics.ready", "就绪"), value: props.result?.readyCount ?? 0 },
    { label: props.t("metrics.moved", "已移动"), value: props.result?.movedCount ?? 0 },
    { label: props.t("metrics.progress", "进度"), value: `${props.progress}%` },
  ]
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden px-1">
      {stats.map((item) => (
        <div key={item.label} className="flex shrink-0 items-baseline gap-1 text-[11px]">
          <span className="text-muted-foreground">{item.label}</span>
          <span className="font-semibold tabular-nums">{item.value}</span>
        </div>
      ))}
    </div>
  )
}

function WorkbenchTextView(props: { empty: string; lines: string[] }) {
  return (
    <ScrollArea className="h-full min-h-0">
      {props.lines.length
        ? <pre className="p-3 font-mono text-xs leading-5 text-muted-foreground">{props.lines.join("\n")}</pre>
        : <div className="flex min-h-40 items-center justify-center p-4 text-sm text-muted-foreground">{props.empty}</div>}
    </ScrollArea>
  )
}

function ClassqResultsWorkspace(props: { items: ClassqPlanItem[]; issueLines: string[]; logs: string[]; roots: string[]; t: ViewProps["t"] }) {
  const groups = useMemo(() => groupByParent(props.items), [props.items])
  const [selectedParent, setSelectedParent] = useState("")
  const { elements, expandedIds, selectionMap } = useMemo(() => buildExplorerTree(groups), [groups])

  useEffect(() => {
    if (!groups.length) {
      setSelectedParent("")
      return
    }
    if (!groups.some((group) => group.parentPath === selectedParent)) {
      setSelectedParent(groups[0]!.parentPath)
    }
  }, [groups, selectedParent])

  const selectedGroup = groups.find((group) => group.parentPath === selectedParent) ?? groups[0]
  const emptyText = props.roots.length
    ? props.t("empty.runScan", "运行扫描后，这里会显示递归文件树和分类计划表")
    : props.t("empty.addRoots", "添加根目录以预览分类计划")
  return (
    <ResizablePanelGroup orientation="horizontal" className="h-full" data-testid="classq-results-workspace">
      <ResizablePanel id="classq-tree" defaultSize="29%" minSize="20%" maxSize="44%">
        <section className="flex h-full min-h-0 flex-col bg-muted/[0.12]" data-testid="classq-explorer">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
            <div className="flex min-w-0 items-center gap-2"><ListTree className="size-4 text-muted-foreground" /><span className="truncate text-xs font-semibold">{props.t("explorer.tree", "递归文件树")}</span></div>
            <span className="text-[11px] tabular-nums text-muted-foreground">{groups.length}</span>
          </div>
          {selectedGroup ? (
            <Tree
              key={`${props.items.length}:${groups.length}`}
              className="min-h-0 flex-1 py-2"
              elements={elements}
              initialExpandedItems={expandedIds}
              initialSelectedId={`parent:${selectedGroup.parentPath}`}
              onSelectedIdChange={(id) => {
                const parentPath = selectionMap.get(id)
                if (parentPath) setSelectedParent(parentPath)
              }}
              sort="none"
            />
          ) : (
            <div className="flex min-h-32 flex-1 items-center justify-center p-4 text-center text-xs text-muted-foreground">{emptyText}</div>
          )}
        </section>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel id="classq-plan" defaultSize="71%" minSize="48%">
        <Tabs defaultValue="plan" className="h-full min-h-0 gap-0" data-testid="classq-result-tabs">
          <ResultTabList issueCount={props.issueLines.length} logCount={props.logs.length} planCount={props.items.length} t={props.t} />
          <div className="min-w-0 flex-1 overflow-hidden">
            <TabsContent value="plan" className="h-full min-h-0">
              {selectedGroup
                ? <PlanDetailTable group={selectedGroup} t={props.t} />
                : <div className="flex h-full min-h-40 items-center justify-center p-4 text-center text-sm text-muted-foreground">{emptyText}</div>}
            </TabsContent>
            <TabsContent value="issues" className="h-full min-h-0">
              <WorkbenchTextView empty={props.t("empty.issues", "暂无问题")} lines={props.issueLines} />
            </TabsContent>
            <TabsContent value="logs" className="h-full min-h-0">
              <WorkbenchTextView empty={props.t("empty.logs", "运行日志会显示在这里")} lines={props.logs} />
            </TabsContent>
          </div>
        </Tabs>
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}

function PlanDetailTable(props: { group: { parentPath: string; items: ClassqPlanItem[] }; t: ViewProps["t"] }) {
  const keywordItems = props.group.items.filter((item) => item.stage === "keyword")
  const waitItems = props.group.items.filter((item) => item.stage === "wait")
  return (
    <section className="flex h-full min-h-0 flex-col" data-testid="classq-plan-table">
      <div className="flex min-w-0 shrink-0 items-center justify-between gap-3 border-b px-3 py-2">
        <div className="flex min-w-0 items-center gap-2"><FolderOpen className="size-4 shrink-0 text-muted-foreground" /><div className="min-w-0"><div className="truncate text-xs font-semibold">{baseName(props.group.parentPath)}</div><div className="truncate font-mono text-[11px] text-muted-foreground">{props.group.parentPath}</div></div></div>
        <div className="flex shrink-0 items-center gap-1">{keywordItems.map((item) => <Badge key={item.sourcePath} variant="outline" className="max-w-48 gap-1"><Search className="size-3" /><span className="truncate">{item.sourceName}</span></Badge>)}</div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <Table className="table-fixed">
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              <TableHead className="w-[34%]">{props.t("table.source", "源节点")}</TableHead>
              <TableHead className="w-[42%]">{props.t("table.target", "等待目录目标")}</TableHead>
              <TableHead className="w-[10%]">{props.t("table.type", "类型")}</TableHead>
              <TableHead className="w-[14%] text-right">{props.t("table.status", "状态")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {waitItems.map((item) => {
              const meta = itemStatusMeta(item.status)
              const StatusIcon = meta.icon
              const KindIcon = item.kind === "folder" ? Folder : File
              return (
                <TableRow key={item.sourcePath}>
                  <TableCell className="min-w-0 whitespace-normal"><div className="flex min-w-0 items-center gap-2"><KindIcon className="size-4 shrink-0 text-muted-foreground" /><div className="min-w-0"><div className="truncate text-xs font-medium">{item.sourceName}</div><div className="truncate font-mono text-[10px] text-muted-foreground">{item.sourcePath}</div></div></div></TableCell>
                  <TableCell className="min-w-0 whitespace-normal"><div className="truncate font-mono text-[11px]">{item.targetRelative}</div><div className="truncate font-mono text-[10px] text-muted-foreground">{item.targetPath}</div></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{item.kind === "folder" ? props.t("type.folder", "目录") : props.t("type.file", "文件")}</TableCell>
                  <TableCell className="text-right"><Badge variant={meta.variant} className="gap-1"><StatusIcon className="size-3" />{localizedItemStatus(item.status, props.t)}</Badge></TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
        {!waitItems.length && <div className="flex min-h-32 items-center justify-center p-4 text-sm text-muted-foreground">{props.t("empty.table", "此目录没有等待项")}</div>}
      </ScrollArea>
    </section>
  )
}

function buildExplorerTree(groups: Array<{ parentPath: string; items: ClassqPlanItem[] }>): { elements: TreeViewElement[]; expandedIds: string[]; selectionMap: Map<string, string> } {
  const rootGroups = new Map<string, Array<{ parentPath: string; items: ClassqPlanItem[] }>>()
  for (const group of groups) {
    const rootPath = group.items[0]?.rootPath ?? group.parentPath
    const list = rootGroups.get(rootPath) ?? []
    list.push(group)
    rootGroups.set(rootPath, list)
  }
  const selectionMap = new Map<string, string>()
  const expandedIds: string[] = []
  const elements = [...rootGroups.entries()].map(([rootPath, rootItems]) => {
    const rootId = `root:${rootPath}`
    expandedIds.push(rootId)
    selectionMap.set(rootId, rootItems[0]?.parentPath ?? rootPath)
    return {
      id: rootId,
      name: baseName(rootPath) || rootPath,
      type: "folder" as const,
      children: rootItems.map((group) => {
        const parentId = `parent:${group.parentPath}`
        expandedIds.push(parentId)
        selectionMap.set(parentId, group.parentPath)
        return {
          id: parentId,
          name: baseName(group.parentPath),
          type: "folder" as const,
          children: group.items.map((item, index) => {
            const id = `item:${group.parentPath}:${index}`
            selectionMap.set(id, group.parentPath)
            return { id, name: item.sourceName, type: item.kind, isSelectable: true }
          }),
        }
      }),
    }
  })
  return { elements, expandedIds, selectionMap }
}

function ResultTabs(props: { compact?: boolean; logs: string[]; result: ClassqData | null; t: ViewProps["t"]; onCopyLogs: () => void; onCopyResults: () => void }) {
  const issueLines = [
    ...(props.result?.errors ?? []),
    ...(props.result?.items ?? []).filter((item) => item.reason && item.status !== "ready").map((item) => `${item.sourcePath}: ${item.reason}`),
  ]
  return (
    <Tabs defaultValue="plan" className="h-full min-h-0 gap-0 rounded-lg border bg-card" data-testid="classq-result-tabs">
      <ResultTabList issueCount={issueLines.length} logCount={props.logs.length} planCount={props.result?.items.length ?? 0} t={props.t} />
      <div className="min-w-0 flex-1 overflow-hidden p-1.5">
        <TabsContent value="plan" className="h-full min-h-0"><PlanPanel compact={props.compact} result={props.result} t={props.t} onCopy={props.onCopyResults} /></TabsContent>
        <TabsContent value="issues" className="h-full min-h-0"><TextPanel empty={props.t("empty.issues", "暂无问题")} lines={issueLines} t={props.t} /></TabsContent>
        <TabsContent value="logs" className="h-full min-h-0"><TextPanel actionLabel={props.t("actions.copy", "复制")} empty={props.t("empty.logs", "运行日志会显示在这里")} icon={Terminal} lines={props.logs} t={props.t} onAction={props.onCopyLogs} /></TabsContent>
      </div>
    </Tabs>
  )
}

function PlanPanel(props: { compact?: boolean; result: ClassqData | null; t: ViewProps["t"]; onCopy: () => void }) {
  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border bg-card">
      <div className={props.compact ? "flex shrink-0 items-center justify-between gap-2 px-2 py-1.5" : "flex shrink-0 items-center justify-between gap-2 px-3 py-2"}><div className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground"><PLAN_ICON className="size-3.5" /><span>{props.result?.items.length ? props.t("plan.itemCount", "{{count}} 项", { count: props.result.items.length }) : props.t("plan.waiting", "等待扫描")}</span></div><Button disabled={!props.result?.items.length} size="xs" variant="ghost" onClick={props.onCopy}><Copy data-icon="inline-start" />{props.t("actions.copy", "复制")}</Button></div>
      <Separator />
      <PlanRows items={props.result?.items ?? []} roots={[]} />
    </section>
  )
}

function TextPanel(props: { actionLabel?: string; empty: string; icon?: LucideIcon; lines: string[]; t: ViewProps["t"]; onAction?: () => void }) {
  const Icon = props.icon
  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border bg-card">
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2"><span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">{Icon && <Icon className="size-3.5" />}{props.lines.length ? props.t("text.lineCount", "{{count}} 行", { count: props.lines.length }) : props.empty}</span>{props.onAction && <Button disabled={!props.lines.length} size="xs" variant="ghost" onClick={props.onAction}>{props.actionLabel ?? props.t("actions.copy", "复制")}</Button>}</div>
      <Separator />
      <ScrollArea className="min-h-0 flex-1">{props.lines.length ? <pre className="p-3 text-xs leading-5 text-muted-foreground">{props.lines.join("\n")}</pre> : <div className="flex min-h-24 items-center justify-center p-4 text-sm text-muted-foreground">{props.empty}</div>}</ScrollArea>
    </section>
  )
}

function HeaderLine(props: { status: ClassqStatusMeta; subtitle: string }) {
  const Icon = NODE_ICON
  return <div className="min-w-0"><div className="flex min-w-0 items-center gap-2"><div className={cn("grid size-8 shrink-0 place-items-center rounded-lg", props.status.iconClass)}><Icon /></div><div className="min-w-0"><div className="flex min-w-0 items-center gap-2"><h3 className="truncate text-sm font-semibold leading-none">ClassQ</h3><Badge variant={props.status.badgeVariant}>{props.status.label}</Badge></div><p className="mt-1 truncate text-xs text-muted-foreground">{props.subtitle}</p></div></div></div>
}

function StatusStrip(props: { progress: number; status: ClassqStatusMeta; text?: string }) {
  return <div className="rounded-md border bg-card p-2"><div className="mb-1 flex min-w-0 items-center justify-between gap-2"><div className="truncate text-xs font-medium">{props.text || props.status.description}</div><Badge variant={props.status.badgeVariant}>{props.status.label}</Badge></div><Progress value={props.progress} className={cn("h-1.5", props.status.tone === "error" && "bg-destructive/20")} /></div>
}

function RiskToggle(props: { checked: boolean; compact?: boolean; disabled?: boolean; onCheckedChange: (checked: boolean) => void; t: ViewProps["t"] }) {
  const label = props.checked ? props.t("risk.dryRun", "预览") : props.t("risk.live", "实时")
  return (
    <Field orientation="horizontal" className="w-auto shrink-0 items-center gap-2">
      <FieldContent className="min-w-0 gap-0">
        <FieldLabel htmlFor="classq-dry-run" className={cn("items-center text-xs", !props.checked && "text-destructive")}>
          <ShieldAlert className="size-3.5" />
          {label}
        </FieldLabel>
        {!props.compact && <FieldDescription className="text-[11px]">{props.checked ? props.t("risk.dryRunDescription", "不改动文件") : props.t("risk.liveDescription", "会改动文件")}</FieldDescription>}
      </FieldContent>
      <Switch id="classq-dry-run" aria-label={label} checked={props.checked} disabled={props.disabled} onCheckedChange={props.onCheckedChange} />
    </Field>
  )
}

function IconButton(props: { active?: boolean; disabled?: boolean; icon: LucideIcon; label: string; onClick: () => void }) {
  const Icon = props.icon
  return <Tooltip><TooltipTrigger asChild><Button aria-label={props.label} disabled={props.disabled} size="icon-sm" variant={props.active ? "secondary" : "outline"} onClick={props.onClick}><Icon /></Button></TooltipTrigger><TooltipContent>{props.label}</TooltipContent></Tooltip>
}

function statusFromState(data: ClassqCardState, running: boolean, result: ClassqData | null, t: ViewProps["t"]): ClassqStatusMeta {
  if (running || data.phase === "running") return { label: t("status.running", "运行中"), description: data.progressText || t("status.runningDescription", "正在扫描关键词目录或处理等待项"), tone: "running", badgeVariant: "secondary", iconClass: "bg-primary text-primary-foreground" }
  if (data.phase === "error" || result?.errorCount) return { label: t("status.failed", "失败"), description: data.progressText || result?.errors[0] || t("status.failedDescription", "上次运行失败，请查看问题"), tone: "error", badgeVariant: "destructive", iconClass: "bg-destructive text-destructive-foreground" }
  if (data.phase === "completed") return { label: t("status.done", "完成"), description: t("status.doneDescription", "上次运行已完成"), tone: "success", badgeVariant: "default", iconClass: "bg-primary text-primary-foreground" }
  return { label: t("status.ready", "就绪"), description: t("status.readyDescription", "扫描根目录中的关键词目录和等待项"), tone: "idle", badgeVariant: "outline", iconClass: "bg-secondary text-secondary-foreground" }
}

function itemStatusMeta(status: ClassqPlanItem["status"]) {
  if (status === "moved") return { icon: CheckCircle2, label: "Moved", variant: "default" as const }
  if (status === "copied") return { icon: CheckCircle2, label: "Copied", variant: "default" as const }
  if (status === "found") return { icon: Search, label: "Found", variant: "outline" as const }
  if (status === "ready") return { icon: ListTree, label: "Ready", variant: "secondary" as const }
  if (status === "conflict") return { icon: AlertTriangle, label: "Conflict", variant: "destructive" as const }
  if (status === "error") return { icon: XCircle, label: "Error", variant: "destructive" as const }
  return { icon: AlertTriangle, label: "Skipped", variant: "outline" as const }
}

function localizedItemStatus(status: ClassqPlanItem["status"], t: ViewProps["t"]): string {
  const fallbacks: Record<ClassqPlanItem["status"], string> = {
    found: "已找到",
    ready: "就绪",
    skipped: "已跳过",
    moved: "已移动",
    copied: "已复制",
    conflict: "冲突",
    error: "错误",
  }
  return t(`status.item.${status}`, fallbacks[status])
}

function summaryText(props: ViewProps): string {
  if (props.result) return props.t("summary.result", "关键词 {{keyword}} / 等待 {{wait}} / 就绪 {{ready}}", { keyword: props.result.keywordCount, wait: props.result.waitCount, ready: props.result.readyCount })
  if (props.roots.length) return props.t("summary.roots", "{{count}} 个根目录 / {{action}}", { count: props.roots.length, action: actionLabel(props.action, props.t) })
  return props.t("summary.idle", "通过关键词递归分类文件夹")
}

function viewSubtitle(props: ViewProps): string {
  if ((props.running || props.status.tone === "error") && props.data.progressText) return props.data.progressText
  return summaryText(props)
}

function actionLabel(action: ClassqAction, t: ViewProps["t"]): string {
  return action === "plan" ? t("action.scan", "扫描根目录") : t("action.classify", "执行分类")
}

function executionLabel(action: ClassqAction, dryRun: boolean, t: ViewProps["t"]): string {
  if (action === "plan") return t("action.scan", "扫描根目录")
  return dryRun ? t("action.classify.preview", "预览分类") : t("action.classify", "执行分类")
}

function buildInput(action: ClassqAction, data: ClassqCardState): ClassqInput {
  return {
    action,
    paths: splitLines(data.pathsText),
    keyword: data.keyword,
    waitKeyword: data.waitKeyword,
    transferMode: data.transferMode ?? "move",
    existingPolicy: data.existingPolicy ?? "merge",
    dryRun: data.dryRun ?? true,
  }
}

function groupByParent(items: ClassqPlanItem[]): Array<{ parentPath: string; items: ClassqPlanItem[] }> {
  const groups = new Map<string, ClassqPlanItem[]>()
  for (const item of items) {
    const list = groups.get(item.parentPath) ?? []
    list.push(item)
    groups.set(item.parentPath, list)
  }
  return [...groups.entries()].map(([parentPath, groupItems]) => ({ parentPath, items: groupItems }))
}

function baseName(value: string): string {
  const normalized = value.replace(/\\/g, "/")
  return normalized.split("/").filter(Boolean).at(-1) ?? value
}

function splitLines(value: unknown): string[] {
  return String(value ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

function getHostData(host: NodeComponentProps<ClassqCardState>["host"], compId: string): ClassqCardState {
  return host.state?.getData?.() ?? host.getData<ClassqCardState>(compId) ?? {}
}

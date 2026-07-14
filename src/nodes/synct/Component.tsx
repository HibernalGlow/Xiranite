import { useEffect, useRef, useState } from "react"
import type { NodeComponentProps, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type { SynctAction, SynctData, SynctFormatKey, SynctInput, SynctPlanItem, SynctSourceMode } from "@xiranite/node-synct/core"
import type { LucideIcon } from "lucide-react"
import { AlertTriangle, Archive, CalendarClock, CheckCircle2, Clipboard, Copy, DatabaseZap, File, Folder, FolderInput, FolderTree, GitCompareArrows, ListChecks, Map, Play, RotateCcw, Settings2, ShieldAlert, Square, Terminal, Trash2, XCircle } from "lucide-react"
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
import { tNode, useNodeI18n } from "@/nodes/shared/useNodeI18n"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import { NodeConfigButton } from "@/nodes/shared/NodeConfigPopover"
import { ACTIONS, FORMAT_OPTIONS, NODE_ICON, SOURCE_MODES } from "./constants"
import type { SynctCardState, SynctStatusMeta } from "./types"
import { CONFIG_FIELDS } from "./types"

export function Component({ compId, host }: NodeComponentProps<SynctCardState>) {
  "use no memo"
  const surface = useNodeSurface()
  const { t } = useNodeI18n("synct")
  const data = getHostData(host, compId)
  const dataRef = useRef<SynctCardState>(data)
  dataRef.current = data

  const [running, setRunning] = useState(false)
  const [defaults, setDefaults] = useState<Partial<SynctCardState> | undefined>()
  const [configDirty, setConfigDirty] = useState(false)

  const action = data.action ?? "plan"
  const actionMeta = ACTIONS.find((item) => item.value === action) ?? ACTIONS[1]!
  const paths = splitLines(data.pathsText)
  const result = data.result ?? null
  const logs = data.logs ?? []
  const progress = data.progress ?? 0
  const status = statusFromState(data, running, result)
  const compactSurface = surface.mode === "compact" || surface.mode === "portrait"
  const forceCollapsedSurface = compactSurface && surface.height > 0 && surface.height < 160
  const portraitCompact = surface.mode === "portrait" || (surface.mode === "compact" && surface.width < 560 && surface.height >= 300)

  useEffect(() => {
    const loadConfig = host.config?.get?.<Partial<SynctCardState>>() ?? host.getNodeConfig?.<Partial<SynctCardState>>()
    loadConfig?.then((response) => setDefaults(response.config)).catch(() => undefined)
  }, [host])

  useEffect(() => {
    if (!defaults) return
    setConfigDirty(CONFIG_FIELDS.some((field) => String(data[field] ?? "") !== String(defaults[field] ?? "")))
  }, [data.pathsText, data.sourceMode, data.formatKey, data.recursive, data.archiveFolder, data.fallbackToCreatedTime, data.syncFolderFileTimes, data.dryRun, defaults])

  function patch(patchData: Partial<SynctCardState>) {
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
    const lines = (dataRef.current.result?.items ?? []).map((item) => `${item.status}\t${item.sourcePath}\t${item.targetRelative}\t${item.reason ?? ""}`)
    await host.clipboard?.writeText?.(lines.join("\n"))
  }

  async function copyLogs() {
    await host.clipboard?.writeText?.(logs.join("\n"))
  }

  function reset() {
    patch({ logs: [], phase: "idle", progress: 0, progressText: "", result: null })
  }

  async function saveAsDefault() {
    const config: Partial<SynctCardState> = {}
    for (const field of CONFIG_FIELDS) {
      const value = dataRef.current[field]
      if (value !== undefined) (config as Record<string, unknown>)[field] = value
    }
    if (host.config?.save) await host.config.save(config)
    else await host.saveNodeConfig?.(config)
    setDefaults(config)
    setConfigDirty(false)
  }

  async function execute(nextAction: SynctAction = action) {
    if (running) return
    if (!splitLines(dataRef.current.pathsText).length) {
      const message = t("error.noPaths", "运行 Synct 前请至少添加一个源路径。")
      patch({ phase: "error", progress: 0, progressText: message })
      pushLog(message)
      return
    }
    const run = host.runner?.run ?? host.actions?.run
    if (!run) {
      const message = t("error.noRunEnv", "当前环境没有本地运行能力，请使用桌面后端或 CLI。")
      patch({ phase: "error", progress: 0, progressText: message })
      pushLog(message)
      return
    }

    setRunning(true)
    patch({ action: nextAction, phase: "running", progress: 0, progressText: t("progress.started", "{{action}} 已开始。", { action: actionLabel(nextAction) }), result: null })
    try {
      const response = await run<SynctInput, SynctData>("synct", buildInput(nextAction, dataRef.current), (event: NodeRunEvent) => {
        if (event.type === "progress") {
          patch({ progress: event.progress ?? 0, progressText: event.message })
          pushLog(`[${event.progress ?? 0}%] ${event.message}`)
        } else {
          pushLog(event.message)
        }
      }) as NodeRunResult<SynctData>
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
    paths,
    progress,
    result,
    running,
    status,
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
      <div ref={surface.ref} className="@container/synct flex h-full min-h-0 w-full overflow-hidden">
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
  action: SynctAction
  actionMeta: (typeof ACTIONS)[number]
  configDirty: boolean
  data: SynctCardState
  defaults?: Partial<SynctCardState>
  logs: string[]
  paths: string[]
  progress: number
  result: SynctData | null
  running: boolean
  status: SynctStatusMeta
  onActionChange: (value: SynctAction) => void
  onCopyLogs: () => void
  onCopyResults: () => void
  onExecute: (action?: SynctAction) => void
  onPastePaths: () => void
  onPatch: (patch: Partial<SynctCardState>) => void
  onReset: () => void
  onRestoreDefault: () => void
  onSaveDefault: () => void
}

function CollapsedView(props: ViewProps) {
  const Icon = NODE_ICON
  return (
    <div data-testid="synct-collapsed-view" className="flex h-full min-h-0 w-full items-center gap-2 overflow-hidden rounded-xl border bg-background/85 px-3 py-2 shadow-sm">
      <div className={cn("grid size-8 shrink-0 place-items-center rounded-lg", props.status.iconClass)}><Icon /></div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-xs font-semibold leading-none"><span>Synct</span><Badge variant={props.status.badgeVariant}>{props.status.label}</Badge></div>
        <div className="mt-1 truncate text-xs text-muted-foreground">{summaryText(props)}</div>
      </div>
      <RunButton compact props={props} />
    </div>
  )
}

function CompactView(props: ViewProps) {
  return (
    <div data-testid="synct-compact-view" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-2 p-3 pb-2">
        <HeaderLine status={props.status} subtitle={props.data.progressText || summaryText(props)} />
        <div className="flex shrink-0 items-center gap-1"><ActionTools {...props} compact /><RunButton compact props={props} /></div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
        <ActionMode value={props.action} disabled={props.running} onChange={props.onActionChange} />
        <SourceMode value={props.data.sourceMode ?? "files"} disabled={props.running} onChange={(sourceMode) => props.onPatch({ sourceMode })} />
        <PathInput compact data={props.data} disabled={props.running} onPaste={props.onPastePaths} onPatch={props.onPatch} />
        <SwitchPanel compact data={props.data} disabled={props.running} onPatch={props.onPatch} />
        <div className="min-h-0 flex-1"><ResultTabs compact logs={props.logs} result={props.result} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} /></div>
      </div>
    </div>
  )
}

function PortraitView(props: ViewProps) {
  return (
    <div data-testid="synct-portrait-view" className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="flex shrink-0 items-start justify-between gap-2"><HeaderLine status={props.status} subtitle={props.data.progressText || summaryText(props)} /><RunButton compact props={props} /></div>
      <ActionMode value={props.action} disabled={props.running} onChange={props.onActionChange} />
      <PathInput compact data={props.data} disabled={props.running} onPaste={props.onPastePaths} onPatch={props.onPatch} />
      <SourceMode value={props.data.sourceMode ?? "files"} disabled={props.running} onChange={(sourceMode) => props.onPatch({ sourceMode })} />
      <FormatPicker value={props.data.formatKey ?? "year_month"} disabled={props.running} onChange={(formatKey) => props.onPatch({ formatKey })} />
      <div className="min-h-0 flex-1"><ResultTabs compact logs={props.logs} result={props.result} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} /></div>
    </div>
  )
}

function FullView(props: ViewProps) {
  return (
    <div data-testid="synct-full-view" className="flex min-h-0 flex-1 flex-col gap-2 p-3">
      <div className="flex shrink-0 flex-col gap-2 @3xl/synct:flex-row @3xl/synct:items-center @3xl/synct:justify-between">
        <div className="flex min-w-0 flex-col gap-2 @3xl/synct:flex-row @3xl/synct:items-center">
          <HeaderLine status={props.status} subtitle={props.data.progressText || summaryText(props)} />
          <div data-testid="synct-header-toolbar" className="flex min-w-0 flex-wrap items-center gap-1"><ActionTools {...props} /></div>
        </div>
        <StatsPanel progress={props.progress} result={props.result} paths={props.paths} />
      </div>
      {(props.status.tone === "running" || props.status.tone === "error") && <StatusStrip progress={props.progress} status={props.status} text={props.data.progressText} />}
      <div className="grid min-h-0 flex-1 gap-2 @2xl/synct:grid-cols-[minmax(250px,330px)_minmax(0,1fr)] @4xl/synct:grid-cols-[minmax(250px,330px)_minmax(0,1fr)_minmax(270px,340px)]">
        <section className="flex min-h-0 flex-col gap-2 overflow-auto rounded-lg border bg-card p-2">
          <ZoneTitle icon={FolderInput} label={tNode("synct", "sections.sourcesAndFormat", "来源和格式")} />
          <PathInput data={props.data} disabled={props.running} onPaste={props.onPastePaths} onPatch={props.onPatch} />
          <SourceMode value={props.data.sourceMode ?? "files"} disabled={props.running} onChange={(sourceMode) => props.onPatch({ sourceMode })} />
          <FormatPicker value={props.data.formatKey ?? "year_month"} disabled={props.running} onChange={(formatKey) => props.onPatch({ formatKey })} />
          <SwitchPanel data={props.data} disabled={props.running} onPatch={props.onPatch} />
        </section>
        <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border bg-card">
          <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2"><ZoneTitle icon={Map} label={tNode("synct", "sections.archivePlan", "归档路径规划")} /><Badge variant="outline">{props.result?.items.length ?? props.paths.length}</Badge></div>
          <Separator />
          <ChronologicalTimeline items={props.result?.items ?? []} paths={props.paths} />
        </section>
        <div className="grid min-h-0 gap-2 grid-rows-[auto_minmax(0,1fr)] @2xl/synct:col-span-2 @4xl/synct:col-span-1">
          <ExecutionGate {...props} />
          <ResultTabs logs={props.logs} result={props.result} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} />
        </div>
      </div>
    </div>
  )
}

function ActionTools(props: ViewProps & { compact?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      {!props.compact && <ActionMode value={props.action} disabled={props.running} onChange={props.onActionChange} />}
      <NodeConfigButton nodeKey="synct" configDirty={props.configDirty} defaults={props.defaults} disabled={props.running} onResetOverride={props.onRestoreDefault} onRestoreDefault={props.onRestoreDefault} onSaveDefault={props.onSaveDefault} />
      <IconButton icon={RotateCcw} label={tNode("synct", "actions.clearState", "清空状态")} onClick={props.onReset} />
    </div>
  )
}

function ActionMode(props: { disabled?: boolean; value: SynctAction; onChange: (value: SynctAction) => void }) {
  return (
    <ToggleGroup type="single" value={props.value} disabled={props.disabled} onValueChange={(value) => value && props.onChange(value as SynctAction)} className="grid grid-cols-3" size="sm">
      {ACTIONS.map((item) => <ToggleGroupItem key={item.value} value={item.value} className="min-w-0 gap-1"><item.icon className="size-3.5" /><span className="truncate text-xs">{actionShortLabel(item.value)}</span></ToggleGroupItem>)}
    </ToggleGroup>
  )
}

function SourceMode(props: { disabled?: boolean; value: SynctSourceMode; onChange: (value: SynctSourceMode) => void }) {
  return (
    <ToggleGroup type="single" value={props.value} disabled={props.disabled} onValueChange={(value) => value && props.onChange(value as SynctSourceMode)} className="grid grid-cols-2" size="sm">
      {SOURCE_MODES.map((item) => <ToggleGroupItem key={item.value} value={item.value} className="min-w-0 gap-1"><item.icon className="size-3.5" /><span className="truncate text-xs">{sourceModeLabel(item.value)}</span></ToggleGroupItem>)}
    </ToggleGroup>
  )
}

function FormatPicker(props: { disabled?: boolean; value: SynctFormatKey; onChange: (value: SynctFormatKey) => void }) {
  return (
    <div className="grid gap-1.5">
      <ZoneTitle icon={GitCompareArrows} label={tNode("synct", "sections.targetFormat", "目标格式")} />
      <ToggleGroup type="single" value={props.value} disabled={props.disabled} onValueChange={(value) => value && props.onChange(value as SynctFormatKey)} className="grid grid-cols-2 gap-1 @md/synct:grid-cols-3" size="sm">
        {FORMAT_OPTIONS.map((item) => (
          <ToggleGroupItem key={item.value} value={item.value} className="h-auto min-w-0 justify-start gap-1 px-2 py-1.5 text-left">
            <item.icon className="size-3.5 shrink-0" />
            <span className="min-w-0">
              <span className="block truncate text-xs">{formatLabel(item.value)}</span>
              <span className="block truncate text-[10px] text-muted-foreground">{item.example}</span>
            </span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}

function PathInput(props: { compact?: boolean; data: SynctCardState; disabled?: boolean; onPaste: () => void; onPatch: (patch: Partial<SynctCardState>) => void }) {
  return (
    <div className="grid gap-1.5">
      {!props.compact && <Label htmlFor="synct-paths" className="text-xs">{tNode("synct", "labels.sourcePaths", "源路径")}</Label>}
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-1.5">
        <PathTextarea id="synct-paths" aria-label="synct paths" className={cn("min-h-0 resize-none font-mono text-xs", props.compact ? "h-14" : "h-28")} disabled={props.disabled} placeholder={tNode("synct", "placeholder.paths", "每行一个文件或文件夹\nD:/downloads")} value={props.data.pathsText ?? ""} onValueChange={(pathsText) => props.onPatch({ pathsText })} />
        <div className="grid content-start gap-1.5"><IconButton disabled={props.disabled} icon={Clipboard} label={tNode("synct", "actions.pastePaths", "粘贴路径")} onClick={props.onPaste} /><IconButton disabled={props.disabled || !props.data.pathsText} icon={Trash2} label={tNode("synct", "actions.clearPaths", "清空路径")} onClick={() => props.onPatch({ pathsText: "" })} /></div>
      </div>
    </div>
  )
}

function SwitchPanel(props: { compact?: boolean; data: SynctCardState; disabled?: boolean; onPatch: (patch: Partial<SynctCardState>) => void }) {
  return (
    <div className={cn("grid gap-2", props.compact ? "grid-cols-1" : "grid-cols-[repeat(auto-fit,minmax(8rem,1fr))]")}>
      <SwitchRow checked={props.data.dryRun ?? true} disabled={props.disabled} icon={ShieldAlert} label={tNode("synct", "switches.dryRun", "预演")} onCheckedChange={(dryRun) => props.onPatch({ dryRun })} />
      <SwitchRow checked={props.data.recursive ?? false} disabled={props.disabled || props.data.sourceMode === "folders"} icon={FolderTree} label={tNode("synct", "switches.recursive", "递归文件")} onCheckedChange={(recursive) => props.onPatch({ recursive })} />
      <SwitchRow checked={props.data.archiveFolder ?? false} disabled={props.disabled} icon={Archive} label={tNode("synct", "switches.archiveFolder", "使用归档文件夹")} onCheckedChange={(archiveFolder) => props.onPatch({ archiveFolder })} />
      <SwitchRow checked={props.data.fallbackToCreatedTime ?? true} disabled={props.disabled} icon={CalendarClock} label={tNode("synct", "switches.fallbackTime", "回退时间")} onCheckedChange={(fallbackToCreatedTime) => props.onPatch({ fallbackToCreatedTime })} />
      <SwitchRow checked={props.data.syncFolderFileTimes ?? true} disabled={props.disabled || props.data.sourceMode !== "folders"} icon={ListChecks} label={tNode("synct", "switches.syncFolderFiles", "同步文件夹文件")} onCheckedChange={(syncFolderFileTimes) => props.onPatch({ syncFolderFileTimes })} />
    </div>
  )
}

function ExecutionGate(props: ViewProps) {
  const live = props.action === "archive" && !(props.data.dryRun ?? true)
  return (
    <section className={cn("flex shrink-0 flex-col gap-2 rounded-lg border bg-card p-2", live && "border-destructive/50 bg-destructive/[0.03]")}>
      <div className="flex items-center justify-between gap-2"><ZoneTitle icon={live ? AlertTriangle : ShieldAlert} label={tNode("synct", "sections.run", "执行")} tone={live ? "danger" : "default"} /><Badge variant={live ? "destructive" : "outline"}>{props.data.dryRun ?? true ? tNode("synct", "badges.dryRun", "预演") : tNode("synct", "badges.live", "实模式")}</Badge></div>
      <ActionMode value={props.action} disabled={props.running} onChange={props.onActionChange} />
      <div className="grid gap-2 @sm/synct:grid-cols-2">
        <SwitchRow checked={props.data.dryRun ?? true} disabled={props.running} icon={ShieldAlert} label={tNode("synct", "switches.dryRun", "预演")} onCheckedChange={(dryRun) => props.onPatch({ dryRun })} />
        <SwitchRow checked={props.data.archiveFolder ?? false} disabled={props.running} icon={Archive} label={tNode("synct", "switches.archiveFolder", "使用归档文件夹")} onCheckedChange={(archiveFolder) => props.onPatch({ archiveFolder })} />
      </div>
      <RunButton props={props} />
    </section>
  )
}

function RunButton({ compact, props }: { compact?: boolean; props: ViewProps }) {
  if (props.running) return <Button aria-label="synct running" disabled size={compact ? "icon-sm" : "sm"} variant="secondary"><Square />{!compact && <span>{tNode("synct", "status.running", "运行中")}</span>}</Button>
  const label = actionLabel(props.action)
  const live = props.action === "archive" && !(props.data.dryRun ?? true)
  if (live) {
    return (
      <AlertDialog>
        <AlertDialogTrigger asChild><Button aria-label={label} size={compact ? "icon-sm" : "sm"} variant="destructive"><Play />{!compact && <span>{label}</span>}</Button></AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{tNode("synct", "confirm.title", "确认执行真实归档？")}</AlertDialogTitle><AlertDialogDescription>{tNode("synct", "confirm.description", "Synct 将移动就绪的文件或文件夹。已存在的目标将作为冲突跳过，继续前请检查源路径。")}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>{tNode("synct", "common:cancel", "取消")}</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => props.onExecute(props.action)}>{tNode("synct", "confirm.archive", "确认归档")}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
  }
  return <Button aria-label={label} size={compact ? "icon-sm" : "sm"} onClick={() => props.onExecute(props.action)}><Play />{!compact && <span>{label}</span>}</Button>
}

function PlanRows(props: { items: SynctPlanItem[]; paths: string[] }) {
  if (!props.items.length) {
    const text = props.paths.length ? tNode("synct", "plan.runToPreview", "运行规划以显示归档目标。") : tNode("synct", "plan.addPaths", "添加源路径以预览归档路线。")
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
            <div key={`${item.sourcePath}:${index}`} className={cn("grid gap-1 rounded-md border px-2 py-1.5", (item.status === "conflict" || item.status === "error") && "border-destructive/40", item.status === "unchanged" && "opacity-75")}>
              <div className="flex min-w-0 items-center gap-2"><KindIcon className="size-4 shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1"><div className="truncate text-xs font-medium">{item.sourceName}</div><div className="truncate font-mono text-[11px] text-muted-foreground">{"->"} {item.targetRelative}</div></div><Badge variant={meta.variant} className="gap-1"><StatusIcon className="size-3" />{meta.label}</Badge></div>
              <div className="truncate text-[11px] text-muted-foreground">{item.timestamp ? formatDate(item.timestamp) : tNode("synct", "labels.noTimestamp", "无时间戳")}{item.reason ? ` / ${item.reason}` : ""}</div>
            </div>
          )
        })}
      </div>
    </ScrollArea>
  )
}

function ChronologicalTimeline(props: { items: SynctPlanItem[]; paths: string[] }) {
  if (!props.items.length) return <PlanRows {...props} />
  const groups = new Map<string, SynctPlanItem[]>()
  for (const item of props.items) {
    const key = item.targetRelative.split(/[\\/]/).slice(0, 2).join(" / ") || tNode("synct", "labels.unscheduled", "未排定")
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="relative grid gap-4 p-4 before:absolute before:inset-y-5 before:left-8 before:w-px before:bg-border">
        {[...groups.entries()].map(([period, items]) => (
          <div key={period} className="relative grid grid-cols-[3rem_minmax(0,1fr)] gap-3">
            <div className="relative z-10 grid size-8 place-items-center rounded-md border bg-primary/10 text-xs font-semibold text-primary">{items.length}</div>
            <div className="min-w-0 rounded-md border bg-card px-3 py-2">
              <div className="flex items-center justify-between gap-2"><div className="font-semibold">{period}</div><Badge variant="outline">{tNode("synct", "labels.fileCount", "{{count}} 个文件", { count: items.length })}</Badge></div>
              <div className="mt-1 grid gap-1">
                {items.map((item) => <div key={item.sourcePath} className="truncate font-mono text-[11px] text-muted-foreground">{item.sourceName} <span className="text-foreground">{"->"}</span> {item.targetRelative}</div>)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  )
}

function ResultTabs(props: { compact?: boolean; logs: string[]; result: SynctData | null; onCopyLogs: () => void; onCopyResults: () => void }) {
  return (
    <Tabs defaultValue="plan" className="flex h-full min-h-0 flex-col">
      <TabsList variant="line" className="shrink-0"><TabsTrigger value="plan"><Map className="size-3.5" />{tNode("synct", "tabs.plan", "规划")}</TabsTrigger><TabsTrigger value="issues"><AlertTriangle className="size-3.5" />{tNode("synct", "tabs.issues", "问题")}</TabsTrigger><TabsTrigger value="logs"><Terminal className="size-3.5" />{tNode("synct", "tabs.logs", "日志")}</TabsTrigger></TabsList>
      <TabsContent value="plan" className="min-h-0 flex-1"><PlanPanel compact={props.compact} result={props.result} onCopy={props.onCopyResults} /></TabsContent>
      <TabsContent value="issues" className="min-h-0 flex-1"><TextPanel empty={tNode("synct", "empty.issues", "暂无问题。")} lines={[...(props.result?.errors ?? []), ...(props.result?.items ?? []).filter((item) => item.reason && item.status !== "ready").map((item) => `${item.sourcePath}: ${item.reason}`)]} /></TabsContent>
      <TabsContent value="logs" className="min-h-0 flex-1"><TextPanel actionLabel={tNode("synct", "actions.copy", "复制")} empty={tNode("synct", "empty.logs", "运行日志将显示在此。")} icon={Terminal} lines={props.logs} onAction={props.onCopyLogs} /></TabsContent>
    </Tabs>
  )
}

function PlanPanel(props: { compact?: boolean; result: SynctData | null; onCopy: () => void }) {
  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border bg-card">
      <div className={props.compact ? "flex shrink-0 items-center justify-between gap-2 px-2 py-1.5" : "flex shrink-0 items-center justify-between gap-2 px-3 py-2"}><div className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground"><Map className="size-3.5" /><span>{props.result?.items.length ? tNode("synct", "labels.itemsCount", "{{count}} 项", { count: props.result.items.length }) : tNode("synct", "status.waiting", "等待规划")}</span></div><Button disabled={!props.result?.items.length} size="xs" variant="ghost" onClick={props.onCopy}><Copy data-icon="inline-start" />{tNode("synct", "actions.copy", "复制")}</Button></div>
      <Separator />
      <PlanRows items={props.result?.items ?? []} paths={[]} />
    </section>
  )
}

function TextPanel(props: { actionLabel?: string; empty: string; icon?: LucideIcon; lines: string[]; onAction?: () => void }) {
  const Icon = props.icon
  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border bg-card">
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2"><span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">{Icon && <Icon className="size-3.5" />}{props.lines.length ? tNode("synct", "labels.linesCount", "{{count}} 行", { count: props.lines.length }) : props.empty}</span>{props.onAction && <Button disabled={!props.lines.length} size="xs" variant="ghost" onClick={props.onAction}>{props.actionLabel ?? tNode("synct", "actions.copy", "复制")}</Button>}</div>
      <Separator />
      <ScrollArea className="min-h-0 flex-1">{props.lines.length ? <pre className="p-3 text-xs leading-5 text-muted-foreground">{props.lines.join("\n")}</pre> : <div className="flex min-h-24 items-center justify-center p-4 text-sm text-muted-foreground">{props.empty}</div>}</ScrollArea>
    </section>
  )
}

function HeaderLine(props: { status: SynctStatusMeta; subtitle: string }) {
  const Icon = NODE_ICON
  return <div className="min-w-0"><div className="flex min-w-0 items-center gap-2"><div className={cn("grid size-8 shrink-0 place-items-center rounded-lg", props.status.iconClass)}><Icon /></div><div className="min-w-0"><div className="flex min-w-0 items-center gap-2"><h3 className="truncate text-sm font-semibold leading-none">Synct</h3><Badge variant={props.status.badgeVariant}>{props.status.label}</Badge></div><p className="mt-1 truncate text-xs text-muted-foreground">{props.subtitle}</p></div></div></div>
}

function StatsPanel(props: { paths: string[]; progress: number; result: SynctData | null }) {
  const stats = [
    { label: tNode("synct", "stats.sources", "源"), value: props.paths.length },
    { label: tNode("synct", "stats.scanned", "已扫描"), value: props.result?.scannedCount ?? 0 },
    { label: tNode("synct", "stats.ready", "就绪"), value: props.result?.readyCount ?? 0 },
    { label: tNode("synct", "stats.moved", "已移动"), value: props.result?.movedCount ?? 0 },
    { label: tNode("synct", "stats.conflicts", "冲突"), value: props.result?.conflictCount ?? 0 },
    { label: tNode("synct", "stats.progress", "进度"), value: props.progress, suffix: "%" },
  ]
  return <div className="grid shrink-0 grid-cols-3 gap-1 @3xl/synct:grid-cols-6">{stats.map((item) => <div key={item.label} className="min-w-0 rounded-md bg-muted/35 px-2 py-1.5 text-center"><div className="truncate text-[11px] text-muted-foreground">{item.label}</div><div className="text-sm font-semibold tabular-nums">{item.value}{item.suffix ?? ""}</div></div>)}</div>
}

function StatusStrip(props: { progress: number; status: SynctStatusMeta; text?: string }) {
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
  return <div className="flex min-w-0 shrink-0 items-center gap-1.5"><Icon className={cn("size-3.5 shrink-0", props.tone === "danger" ? "text-destructive" : "text-muted-foreground")} /><span className="truncate text-xs font-semibold">{props.label}</span></div>
}

function statusFromState(data: SynctCardState, running: boolean, result: SynctData | null): SynctStatusMeta {
  if (running || data.phase === "running") return { label: tNode("synct", "status.running", "运行中"), description: data.progressText || tNode("synct", "desc.running", "Synct 正在扫描或移动归档项目。"), tone: "running", badgeVariant: "secondary", iconClass: "bg-primary text-primary-foreground" }
  if (data.phase === "error" || result?.errorCount) return { label: tNode("synct", "status.failed", "失败"), description: data.progressText || result?.errors[0] || tNode("synct", "desc.failed", "上次 Synct 运行失败，请查看问题。"), tone: "error", badgeVariant: "destructive", iconClass: "bg-destructive text-destructive-foreground" }
  if (data.phase === "completed") return { label: tNode("synct", "status.done", "完成"), description: data.progressText || tNode("synct", "desc.done", "上次 Synct 运行已完成。"), tone: "success", badgeVariant: "default", iconClass: "bg-primary text-primary-foreground" }
  return { label: tNode("synct", "status.ready", "就绪"), description: tNode("synct", "desc.ready", "添加路径并预览时间戳归档目标。"), tone: "idle", badgeVariant: "outline", iconClass: "bg-secondary text-secondary-foreground" }
}

function itemStatusMeta(status: SynctPlanItem["status"]) {
  if (status === "moved") return { icon: CheckCircle2, label: tNode("synct", "itemStatus.moved", "已移动"), variant: "default" as const }
  if (status === "ready") return { icon: Archive, label: tNode("synct", "itemStatus.ready", "就绪"), variant: "secondary" as const }
  if (status === "conflict") return { icon: AlertTriangle, label: tNode("synct", "itemStatus.conflict", "冲突"), variant: "destructive" as const }
  if (status === "error") return { icon: XCircle, label: tNode("synct", "itemStatus.error", "错误"), variant: "destructive" as const }
  if (status === "skipped") return { icon: AlertTriangle, label: tNode("synct", "itemStatus.skipped", "已跳过"), variant: "outline" as const }
  return { icon: CheckCircle2, label: tNode("synct", "itemStatus.same", "相同"), variant: "outline" as const }
}

function summaryText(props: ViewProps): string {
  if (props.data.progressText) return props.data.progressText
  if (props.result) return tNode("synct", "summary.items", "{{count}} 项 / 就绪 {{ready}} / 冲突 {{conflicts}}", { count: props.result.items.length, ready: props.result.readyCount, conflicts: props.result.conflictCount })
  if (props.paths.length) return tNode("synct", "summary.paths", "{{count}} 个源路径 / {{action}}", { count: props.paths.length, action: actionShortLabel(props.action) })
  return actionDescription(props.action)
}

function actionLabel(action: SynctAction): string {
  const labels: Record<SynctAction, string> = {
    scan: tNode("synct", "actions.scan.label", "扫描日期"),
    plan: tNode("synct", "actions.plan.label", "构建规划"),
    archive: tNode("synct", "actions.archive.label", "归档项目"),
  }
  return labels[action] ?? action
}

function actionShortLabel(action: SynctAction): string {
  const labels: Record<SynctAction, string> = {
    scan: tNode("synct", "actions.scan.short", "扫描"),
    plan: tNode("synct", "actions.plan.short", "规划"),
    archive: tNode("synct", "actions.archive.short", "归档"),
  }
  return labels[action] ?? action
}

function actionDescription(action: SynctAction): string {
  const labels: Record<SynctAction, string> = {
    scan: tNode("synct", "actions.scan.description", "读取源名称并显示检测到的时间戳。"),
    plan: tNode("synct", "actions.plan.description", "预览目标归档路径和冲突。"),
    archive: tNode("synct", "actions.archive.description", "将就绪项目移动到按日期命名的文件夹。"),
  }
  return labels[action] ?? ""
}

function sourceModeLabel(mode: SynctSourceMode): string {
  const labels: Record<SynctSourceMode, string> = {
    files: tNode("synct", "sourceModes.files.label", "文件"),
    folders: tNode("synct", "sourceModes.folders.label", "文件夹"),
  }
  return labels[mode]
}

function formatLabel(format: SynctFormatKey): string {
  const labels: Record<SynctFormatKey, string> = {
    year_month: tNode("synct", "formats.year_month.label", "年月"),
    year_month_day: tNode("synct", "formats.year_month_day.label", "日期"),
    nested_y_m: tNode("synct", "formats.nested_y_m.label", "年 / 月"),
    nested_y_m_d: tNode("synct", "formats.nested_y_m_d.label", "年 / 月 / 日"),
    nested_ym_d: tNode("synct", "formats.nested_ym_d.label", "月文件夹 + 日"),
    nested_y_md: tNode("synct", "formats.nested_y_md.label", "年 + 月日"),
    year: tNode("synct", "formats.year.label", "年"),
    month_day: tNode("synct", "formats.month_day.label", "月日"),
    day: tNode("synct", "formats.day.label", "日"),
  }
  return labels[format]
}

function buildInput(action: SynctAction, data: SynctCardState): SynctInput {
  return {
    action,
    paths: splitLines(data.pathsText),
    sourceMode: data.sourceMode ?? "files",
    formatKey: data.formatKey ?? "year_month",
    recursive: data.recursive ?? false,
    archiveFolder: data.archiveFolder ?? false,
    fallbackToCreatedTime: data.fallbackToCreatedTime ?? true,
    syncFolderFileTimes: data.syncFolderFileTimes ?? true,
    dryRun: data.dryRun ?? true,
  }
}

function splitLines(value: unknown): string[] {
  return String(value ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}

function getHostData(host: NodeComponentProps<SynctCardState>["host"], compId: string): SynctCardState {
  return host.state?.getData?.() ?? host.getData<SynctCardState>(compId) ?? {}
}

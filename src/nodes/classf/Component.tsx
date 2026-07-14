import { useCallback, useEffect, useRef, useState } from "react"
import type { NodeComponentProps, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type { ClassfAction, ClassfClassifyMode, ClassfData, ClassfInput, ClassfPlacementMode, ClassfPlanItem, ClassfProgressData, ClassfTransferMode, ClassfWorkItemMode } from "@xiranite/node-classf/core"
import type { LucideIcon } from "lucide-react"
import { AlertTriangle, Archive, ArrowRight, BarChart3, CheckCircle2, Clipboard, Copy, File, Folder, FolderInput, FolderTree, Layers3, Maximize2, Play, RotateCcw, ShieldAlert, Square, Terminal, Trash2, XCircle } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { CollapseButton, Tree, type TreeViewElement } from "@/components/ui/file-tree"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { PathTextarea } from "@/components/ui/path-input"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { ModulePanel } from "@/components/ui/module-panel"
import { cn } from "@/lib/utils"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import { useNodeI18n } from "@/nodes/shared/useNodeI18n"
import { NodeConfigPopover } from "@/nodes/shared/NodeConfigPopover"
import { ACTIONS, CLASSIFY_MODES, NODE_ICON, PLACEMENT_MODES, PLAN_ICON, TRANSFER_MODES } from "./constants"
import type { ClassfCardState, ClassfStatusMeta } from "./types"
import { CONFIG_FIELDS } from "./types"

export function Component({ compId, host }: NodeComponentProps<ClassfCardState>) {
  const surface = useNodeSurface()
  const { t: tNode } = useNodeI18n("classf")
  const data = getHostData(host, compId)
  const dataRef = useRef<ClassfCardState>(data)
  dataRef.current = data

  const [running, setRunning] = useState(false)
  const [defaults, setDefaults] = useState<Partial<ClassfCardState> | undefined>()
  const [configFilePath, setConfigFilePath] = useState<string | undefined>()
  const [configDirty, setConfigDirty] = useState(false)

  const action = data.action ?? "plan"
  const actionMeta = ACTIONS.find((item) => item.value === action) ?? ACTIONS[0]!
  const paths = splitLines(data.pathsText)
  const logs = data.logs ?? []
  const result = data.result ?? null
  const progress = data.progress ?? 0
  const planCurrent = isPlanCurrent(data)
  const status = statusFromState(data, running, result, tNode)
  const compactSurface = surface.mode === "compact" || surface.mode === "portrait"
  const forceCollapsedSurface = compactSurface && surface.height > 0 && surface.height < 160
  const portraitCompact = surface.mode === "portrait" || (surface.mode === "compact" && surface.width < 560 && surface.height >= 300)

  const reloadDefaults = useCallback(async () => {
    const loadConfig = host.config?.get?.<Partial<ClassfCardState>>() ?? host.getNodeConfig?.<Partial<ClassfCardState>>()
    if (!loadConfig) return
    try {
      const response = await loadConfig
      setDefaults(response.config)
      setConfigFilePath(response.path)
    } catch {
      // Configuration management is optional in lightweight hosts.
    }
  }, [host])

  useEffect(() => {
    void reloadDefaults()
  }, [reloadDefaults])

  useEffect(() => {
    if (data.phase !== "running" || running) return
    patch({
      phase: data.result ? "completed" : "idle",
      progress: data.result ? data.progress ?? 100 : 0,
      progressText: data.result ? data.progressText : "",
      runningItem: null,
    })
  // A persisted running phase cannot be resumed after an HMR/remount. Keep any
  // preview result and recover to a stable state instead of showing a phantom run.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.phase, running])

  useEffect(() => {
    if (!defaults) return
    setConfigDirty(CONFIG_FIELDS.some((field) => String(data[field] ?? "") !== String(defaults[field] ?? "")))
  }, [data.pathsText, data.targetDir, data.transferMode, data.classifyMode, data.placementMode, data.existingPolicy, data.workItemMode, data.dryRun, data.sameaGroupEnabled, data.sameaGroupMinOccurrences, data.sameaGroupCentralize, defaults])

  function patch(patchData: Partial<ClassfCardState>) {
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
    const config: Partial<ClassfCardState> = {}
    for (const field of CONFIG_FIELDS) {
      const value = dataRef.current[field]
      if (value !== undefined) (config as Record<string, unknown>)[field] = value
    }
    if (host.config?.save) await host.config.save(config)
    else await host.saveNodeConfig?.(config)
    setDefaults(config)
    setConfigDirty(false)
  }

  async function execute(requestedAction: ClassfAction = action) {
    if (running) return
    const run = host.runner?.run ?? host.actions?.run
    if (!run) {
      const message = "Native execution is unavailable in this host. Use the desktop backend or CLI."
      patch({ phase: "error", progress: 0, progressText: message })
      pushLog(message)
      return
    }
    const nextAction = requestedAction === "classify" && !isPlanCurrent(dataRef.current) ? "plan" : requestedAction
    setRunning(true)
    patch({ progress: 0, progressText: tNode(nextAction === "plan" ? "progress.buildingPlan" : "progress.executing", nextAction === "plan" ? "正在生成完整分类计划…" : "正在执行已确认的分类计划…"), runningItem: null })
    try {
      const response = await run<ClassfInput, ClassfData>("classf", buildInput(nextAction, dataRef.current), (event: NodeRunEvent) => {
        const progressData = readProgressData(event.data)
        if (progressData?.kind === "classf-plan") {
          patch({ result: progressData.result, planFingerprint: planFingerprint(dataRef.current) })
        } else if (progressData?.kind === "classf-item") {
          if (progressData.status === "running") {
            patch({ runningItem: { sourcePath: progressData.sourcePath, stage: progressData.stage } })
          } else {
            patch({ result: updateResultItem(dataRef.current.result, progressData), runningItem: null })
          }
        }
        if (event.type === "progress") {
          patch({ progress: event.progress ?? 0, progressText: localizedProgress(progressData, event.message, tNode) })
          pushLog(`[${event.progress ?? 0}%] ${event.message}`)
        } else {
          pushLog(event.message)
        }
      }) as NodeRunResult<ClassfData>
      const finalResult = response.data ?? null
      const finalMessage = response.success
        ? nextAction === "plan"
          ? tNode("progress.planReady", "计划已生成：{{count}} 项可执行。", { count: finalResult?.readyCount ?? 0 })
          : tNode("progress.completed", "执行完成：{{count}} 项已处理。", { count: (finalResult?.movedCount ?? 0) + (finalResult?.copiedCount ?? 0) })
        : response.message
      patch({ phase: response.success ? "completed" : "error", progress: response.success ? 100 : 0, progressText: finalMessage, result: finalResult, planFingerprint: response.success ? planFingerprint(dataRef.current) : dataRef.current.planFingerprint, runningItem: null })
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
    configFilePath,
    configDirty,
    data,
    defaults,
    logs,
    paths,
    progress,
    planCurrent,
    result,
    running,
    status,
    tNode,
    onActionChange: (value) => patch({ action: value }),
    onCopyLogs: copyLogs,
    onCopyResults: copyResults,
    onExecute: execute,
    onPastePaths: pastePaths,
    onPatch: patch,
    onReset: reset,
    onReloadDefaults: reloadDefaults,
    onOpenConfigFile: host.config?.openFile ?? host.openConfigFile,
    onRestoreDefault: () => defaults && patch(defaults),
    onSaveDefault: saveAsDefault,
  }

  return (
    <TooltipProvider>
      <div ref={surface.ref} className="@container/classf flex h-full min-h-0 w-full overflow-hidden">
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
  action: ClassfAction
  actionMeta: (typeof ACTIONS)[number]
  configFilePath?: string
  configDirty: boolean
  data: ClassfCardState
  defaults?: Partial<ClassfCardState>
  logs: string[]
  paths: string[]
  progress: number
  planCurrent: boolean
  result: ClassfData | null
  running: boolean
  status: ClassfStatusMeta
  tNode: (key: string, fallback: string, vars?: Record<string, unknown>) => string
  onActionChange: (value: ClassfAction) => void
  onCopyLogs: () => void
  onCopyResults: () => void
  onExecute: (action?: ClassfAction) => void
  onPastePaths: () => void
  onPatch: (patch: Partial<ClassfCardState>) => void
  onReset: () => void
  onReloadDefaults: () => Promise<void>
  onOpenConfigFile?: () => Promise<void> | void
  onRestoreDefault: () => void
  onSaveDefault: () => void
}

function CollapsedView(props: ViewProps) {
  const Icon = NODE_ICON
  return (
    <div data-testid="classf-collapsed-view" className="flex h-full min-h-0 w-full items-center gap-2 overflow-hidden rounded-xl border bg-background/85 px-3 py-2 shadow-sm">
      <div className={cn("grid size-8 shrink-0 place-items-center rounded-lg", props.status.iconClass)}><Icon /></div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-xs font-semibold leading-none"><span>ClassF</span><Badge variant={props.status.badgeVariant}>{props.status.label}</Badge></div>
        <div className="mt-1 truncate text-xs text-muted-foreground">{summaryText(props)}</div>
      </div>
      <RunButton compact props={props} />
    </div>
  )
}

function CompactView(props: ViewProps) {
  return (
    <div data-testid="classf-compact-view" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-2 p-3 pb-2">
        <HeaderLine status={props.status} subtitle={props.data.progressText || summaryText(props)} />
        <div className="flex shrink-0 items-center gap-1"><ActionTools {...props} compact /><RunButton compact props={props} /></div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
        <ActionMode value={props.action} disabled={props.running} t={props.tNode} onChange={props.onActionChange} />
        <ModeToggle value={props.data.classifyMode ?? "auto"} disabled={props.running} t={props.tNode} onChange={(classifyMode) => props.onPatch({ classifyMode })} />
        <PathInput compact data={props.data} disabled={props.running} t={props.tNode} onPaste={props.onPastePaths} onPatch={props.onPatch} />
        <div className="min-h-0 flex-1"><ResultTabs compact logs={props.logs} planCurrent={props.planCurrent} result={props.result} runningItem={props.data.runningItem} t={props.tNode} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} /></div>
      </div>
    </div>
  )
}

function PortraitView(props: ViewProps) {
  return (
    <div data-testid="classf-portrait-view" className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col gap-2 p-2">
      <div className="flex shrink-0 items-start justify-between gap-2"><HeaderLine status={props.status} subtitle={props.data.progressText || summaryText(props)} /><RunButton compact props={props} /></div>
      <ActionMode value={props.action} disabled={props.running} t={props.tNode} onChange={props.onActionChange} />
      <PathInput compact data={props.data} disabled={props.running} t={props.tNode} onPaste={props.onPastePaths} onPatch={props.onPatch} />
      <ModeToggle value={props.data.classifyMode ?? "auto"} disabled={props.running} t={props.tNode} onChange={(classifyMode) => props.onPatch({ classifyMode })} />
      <TargetField compact data={props.data} disabled={props.running} t={props.tNode} onPatch={props.onPatch} />
      <div className="min-h-0 flex-1"><ResultTabs compact logs={props.logs} planCurrent={props.planCurrent} result={props.result} runningItem={props.data.runningItem} t={props.tNode} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} /></div>
    </div>
  )
}

function FullView(props: ViewProps) {
  const sourcesPanel = (
    <div data-testid="classf-scan-sources" className="h-full min-h-0">
      <ModulePanel fill icon={FolderInput} title={props.tNode("sections.scanSources", "Scan sources")}>
        <PathInput data={props.data} disabled={props.running} t={props.tNode} onPaste={props.onPastePaths} onPatch={props.onPatch} />
        <ModeToggle value={props.data.classifyMode ?? "auto"} disabled={props.running} t={props.tNode} onChange={(classifyMode) => props.onPatch({ classifyMode })} />
        <TargetField data={props.data} disabled={props.running} t={props.tNode} onPatch={props.onPatch} />
      </ModulePanel>
    </div>
  )
  const executionPanel = <ExecutionGate {...props} embedded />
  const sourceAndExecution = (
    <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-2">
      {sourcesPanel}
      {executionPanel}
    </div>
  )
  const matrixPanel = (
    <div data-testid="classf-classification-matrix" className="h-full min-h-0">
      <ModulePanel fill badge={props.result?.items.length ?? props.paths.length} icon={PLAN_ICON} title={props.tNode("tabs.matrix", "Classification matrix")} contentClassName="gap-0">
        <Tabs defaultValue="tree" className="min-h-0 flex-1 gap-0">
          <div className="flex shrink-0 items-center justify-between gap-2 px-3 pt-1">
            <TabsList variant="line">
              <TabsTrigger value="tree"><FolderTree />{props.tNode("tabs.tree", "文件树")}</TabsTrigger>
              <TabsTrigger value="matrix"><PLAN_ICON />{props.tNode("tabs.matrix", "分类矩阵")}</TabsTrigger>
            </TabsList>
            <div className="flex items-center gap-1">{props.result?.items.length && !props.planCurrent ? <Badge variant="destructive">{props.tNode("status.stale", "计划已失效")}</Badge> : null}<Badge variant="outline">{props.result?.items.length ?? props.paths.length}</Badge></div>
          </div>
          <Separator />
          <TabsContent value="tree" className="min-h-0 flex-1"><PlanTree planCurrent={props.planCurrent} result={props.result} runningItem={props.data.runningItem} t={props.tNode} /></TabsContent>
          <TabsContent value="matrix" className="flex min-h-0 flex-1 flex-col"><PlanRows items={props.result?.items ?? []} paths={props.paths} planCurrent={props.planCurrent} runningItem={props.data.runningItem} t={props.tNode} /></TabsContent>
        </Tabs>
      </ModulePanel>
    </div>
  )
  const analysisPanel = <div data-testid="classf-analysis" className="h-full min-h-0"><AnalysisPanel {...props} /></div>

  return (
    <div data-testid="classf-full-view" className="flex min-h-0 flex-1 flex-col gap-2 p-3">
      <div className="flex shrink-0 flex-col gap-2 @3xl/classf:flex-row @3xl/classf:items-center @3xl/classf:justify-between">
        <div className="flex min-w-0 flex-col gap-2 @3xl/classf:flex-row @3xl/classf:items-center">
          <HeaderLine status={props.status} subtitle={props.data.progressText || summaryText(props)} />
          <div data-testid="classf-header-toolbar" className="flex min-w-0 flex-wrap items-center gap-1">
            <ActionTools {...props} hideAction />
          </div>
        </div>
        <StatsPanel progress={props.progress} result={props.result} paths={props.paths} t={props.tNode} />
      </div>
      {(props.status.tone === "running" || props.status.tone === "error") && <StatusStrip progress={props.progress} status={props.status} text={props.data.progressText} />}
      <div className="grid min-h-0 flex-1 gap-2 @2xl/classf:grid-cols-[minmax(250px,330px)_minmax(0,1fr)] @4xl/classf:grid-cols-[minmax(250px,330px)_minmax(0,1fr)_minmax(270px,340px)]">
        {sourceAndExecution}
        {matrixPanel}
        <div className="min-h-0 @2xl/classf:col-span-2 @4xl/classf:col-span-1">{analysisPanel}</div>
      </div>
    </div>
  )
}

function ActionTools(props: ViewProps & { compact?: boolean; hideAction?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      {!props.compact && !props.hideAction && <ActionMode value={props.action} disabled={props.running} t={props.tNode} onChange={props.onActionChange} />}
      <NodeConfigPopover
        configPath={props.configFilePath}
        defaults={props.defaults}
        dirty={props.configDirty}
        disabled={props.running}
        t={props.tNode}
        onOpenFile={props.onOpenConfigFile}
        onReload={props.onReloadDefaults}
        onRestore={props.onRestoreDefault}
        onSave={props.onSaveDefault}
      />
      <IconButton icon={RotateCcw} label={props.tNode("actions.clear", "清空状态")} onClick={props.onReset} />
    </div>
  )
}

function ActionMode(props: { disabled?: boolean; value: ClassfAction; t: ViewProps["tNode"]; onChange: (value: ClassfAction) => void }) {
  return (
    <ToggleGroup type="single" value={props.value} disabled={props.disabled} onValueChange={(value) => value && props.onChange(value as ClassfAction)} className="grid grid-cols-2" size="sm">
      {ACTIONS.map((item) => <ToggleGroupItem key={item.value} value={item.value} aria-label={props.t(`actions.${item.value}`, item.shortLabel)} className="min-w-0 gap-1"><item.icon /><span className="truncate text-xs">{props.t(`actions.${item.value}`, item.shortLabel)}</span></ToggleGroupItem>)}
    </ToggleGroup>
  )
}

function ModeToggle(props: { disabled?: boolean; value: ClassfClassifyMode; t: ViewProps["tNode"]; onChange: (value: ClassfClassifyMode) => void }) {
  return (
    <ToggleGroup type="single" value={props.value} disabled={props.disabled} onValueChange={(value) => value && props.onChange(value as ClassfClassifyMode)} className="grid grid-cols-2" size="sm">
      {CLASSIFY_MODES.map((item) => <ToggleGroupItem key={item.value} value={item.value} className="min-w-0 gap-1"><item.icon /><span className="truncate text-xs">{props.t(`classifyModes.${item.value}`, item.label)}</span></ToggleGroupItem>)}
    </ToggleGroup>
  )
}

function TransferToggle(props: { disabled?: boolean; value: ClassfTransferMode; t: ViewProps["tNode"]; onChange: (value: ClassfTransferMode) => void }) {
  return (
    <ToggleGroup type="single" value={props.value} disabled={props.disabled} onValueChange={(value) => value && props.onChange(value as ClassfTransferMode)} className="grid grid-cols-2" size="sm">
      {TRANSFER_MODES.map((item) => <ToggleGroupItem key={item.value} value={item.value} className="min-w-0 gap-1"><item.icon /><span className="truncate text-xs">{props.t(`transferModes.${item.value}`, item.label)}</span></ToggleGroupItem>)}
    </ToggleGroup>
  )
}

function PathInput(props: { compact?: boolean; data: ClassfCardState; disabled?: boolean; t: ViewProps["tNode"]; onPaste: () => void; onPatch: (patch: Partial<ClassfCardState>) => void }) {
  return (
    <div className="grid gap-1.5">
      {!props.compact && <Label htmlFor="classf-paths" className="text-xs">{props.t("fields.sameaRoots", "SameA 归档来源")}</Label>}
      <ToggleGroup type="single" value={props.data.workItemMode ?? "files"} disabled={props.disabled} onValueChange={(value) => value && props.onPatch({ workItemMode: value as ClassfWorkItemMode })} className="grid grid-cols-3" size="sm">
        <ToggleGroupItem value="files" className="gap-1"><Archive /><span className="text-xs">{props.t("workItemModes.files", "压缩包文件")}</span></ToggleGroupItem>
        <ToggleGroupItem value="folders" className="gap-1"><Folder /><span className="text-xs">{props.t("workItemModes.folders", "已解压文件夹")}</span></ToggleGroupItem>
        <ToggleGroupItem value="mixed" className="gap-1"><Layers3 /><span className="text-xs">{props.t("workItemModes.mixed", "混合")}</span></ToggleGroupItem>
      </ToggleGroup>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-1.5">
        <PathTextarea id="classf-paths" aria-label="classf paths" className={cn("min-h-0 resize-none font-mono text-xs", props.compact ? "h-14" : "h-28")} disabled={props.disabled} placeholder={props.t("placeholders.sameaRoots", "每行一个文件或文件夹\nD:/set/reviewed.zip")} value={props.data.pathsText ?? ""} onValueChange={(pathsText) => props.onPatch({ pathsText })} />
        <div className="grid content-start gap-1.5"><IconButton disabled={props.disabled} icon={Clipboard} label={props.t("actions.paste", "粘贴路径")} onClick={props.onPaste} /><IconButton disabled={props.disabled || !props.data.pathsText} icon={Trash2} label={props.t("actions.clearPaths", "清空路径")} onClick={() => props.onPatch({ pathsText: "" })} /></div>
      </div>
      <Textarea aria-label="classf crashu sources" className={cn("min-h-0 resize-none font-mono text-xs", props.compact ? "h-12" : "h-20")} disabled={props.disabled} placeholder={props.t("placeholders.crashuSources", "CrashU 来源目录，每行一个；留空使用默认库")} value={props.data.crashuSourcesText ?? ""} onChange={(event) => props.onPatch({ crashuSourcesText: event.currentTarget.value })} />
      <div className="grid gap-1.5">
        <SwitchRow checked={props.data.sameaGroupEnabled ?? false} disabled={props.disabled} icon={FolderTree} label={props.t("fields.sameaGroup", "already / wait 画师分组")} onCheckedChange={(sameaGroupEnabled) => props.onPatch({ sameaGroupEnabled })} />
        {props.data.sameaGroupEnabled && <div className="flex items-center justify-between gap-2 rounded-md border bg-card px-2 py-1.5"><Label htmlFor="classf-samea-group-min" className="text-xs text-muted-foreground">{props.t("fields.sameaGroupMin", "画师最少文件数")}</Label><Input id="classf-samea-group-min" aria-label="classf samea group minimum" type="number" min={1} max={100} className="h-7 w-20 text-xs" disabled={props.disabled} value={props.data.sameaGroupMinOccurrences ?? 1} onChange={(event) => props.onPatch({ sameaGroupMinOccurrences: Math.max(1, Number(event.currentTarget.value) || 1) })} /></div>}
      </div>
    </div>
  )
}

function TargetField(props: { compact?: boolean; data: ClassfCardState; disabled?: boolean; t: ViewProps["tNode"]; onPatch: (patch: Partial<ClassfCardState>) => void }) {
  const placementMode = props.data.placementMode ?? "local"
  return (
    <div className="grid gap-1.5">
      {!props.compact && <Label className="text-xs">{props.t("fields.placementMode", "放置位置")}</Label>}
      <PlacementToggle value={placementMode} disabled={props.disabled} t={props.t} onChange={(value) => props.onPatch({ placementMode: value })} />
      {placementMode === "root" && <Input id="classf-target" aria-label="classf target" disabled={props.disabled} placeholder={props.t("placeholders.targetRequired", "根目录分流必须填写目标根目录")} value={props.data.targetDir ?? ""} onChange={(event) => props.onPatch({ targetDir: event.currentTarget.value })} />}
    </div>
  )
}

function ExecutionGate(props: ViewProps & { embedded?: boolean }) {
  const live = props.action === "classify" && !(props.data.dryRun ?? true)
  const readyRatio = props.result?.items.length ? Math.round((props.result.readyCount / props.result.items.length) * 100) : props.progress
  return (
    <section data-testid="classf-execution-gate" className={cn("flex min-h-0 flex-col gap-2 rounded-lg border bg-card p-2", !props.embedded && "h-full", live && "border-destructive/50 bg-destructive/[0.03]")}>
      <div className="flex items-center justify-between gap-2"><ZoneTitle icon={live ? AlertTriangle : ShieldAlert} label={props.tNode("sections.executionGate", "执行门")} tone={live ? "danger" : "default"} /><Badge variant={live ? "destructive" : "outline"}>{props.data.dryRun ?? true ? props.tNode("modes.dryRun", "预演") : props.tNode("modes.live", "实际执行")}</Badge></div>
      <ActionMode value={props.action} disabled={props.running} t={props.tNode} onChange={props.onActionChange} />
      <TransferToggle value={props.data.transferMode ?? "move"} disabled={props.running} t={props.tNode} onChange={(transferMode) => props.onPatch({ transferMode })} />
      <SwitchRow checked={props.data.dryRun ?? true} disabled={props.running} icon={ShieldAlert} label={props.tNode("fields.dryRun", "预演模式")} onCheckedChange={(dryRun) => props.onPatch({ dryRun })} />
      <div className={cn("rounded-md border bg-muted/20", props.embedded ? "p-2" : "p-3")}>
        <div className="mb-2 flex items-end justify-between gap-2"><span className="text-xs font-medium text-muted-foreground">{props.tNode("execution.planReadiness", "计划就绪度")}</span><span className="text-sm font-semibold tabular-nums">{readyRatio}%</span></div>
        <Progress value={readyRatio} className="h-2" />
        <div className="mt-2 flex justify-between text-[11px] text-muted-foreground"><span>{props.tNode("execution.ready", "可执行")} {props.result?.readyCount ?? 0}</span><span>{props.planCurrent ? props.tNode("execution.reviewed", "计划已确认") : props.tNode("execution.stale", "需要生成计划")}</span></div>
      </div>
      <div className="mt-auto"><RunButton props={props} /></div>
    </section>
  )
}

function AnalysisPanel(props: ViewProps) {
  const analysis = useMemo(() => analyzePlan(props.result), [props.result])
  const issueLines = useMemo(() => [
    ...(props.result?.errors ?? []),
    ...(props.result?.items ?? []).filter((item) => item.reason).map((item) => `${item.sourcePath}: ${item.reason}`),
  ], [props.result])
  return (
    <ModulePanel fill badge={issueLines.length} icon={BarChart3} title={props.tNode("tabs.analysis", "Analysis")} contentClassName="gap-0">
      <Tabs defaultValue="overview" className="min-h-0 flex-1 gap-0">
        <div className="flex shrink-0 items-center justify-between gap-2 px-3 pt-1">
          <TabsList variant="line">
            <TabsTrigger value="overview"><BarChart3 />{props.tNode("tabs.analysis", "分析")}</TabsTrigger>
            <TabsTrigger value="issues"><AlertTriangle />{props.tNode("tabs.issues", "问题")}</TabsTrigger>
            <TabsTrigger value="logs"><Terminal />{props.tNode("tabs.logs", "日志")}</TabsTrigger>
          </TabsList>
          <Badge variant={issueLines.length ? "destructive" : "outline"}>{issueLines.length}</Badge>
        </div>
        <Separator />
        <TabsContent value="overview" className="min-h-0 flex-1">
          <ScrollArea className="h-full">
            <div className="flex flex-col gap-3 p-3">
              <div className="flex items-center justify-between gap-2"><ZoneTitle icon={Layers3} label={props.tNode("analysis.distribution", "分类分布")} /><Badge variant="outline">{props.result?.placementMode === "root" ? props.tNode("placementModes.root", "根目录分流") : props.tNode("placementModes.local", "就地分流")}</Badge></div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-xs"><span className="text-muted-foreground">already</span><span className="font-medium tabular-nums">{analysis.alreadyCount} · {analysis.alreadyRatio}%</span></div>
                <Progress value={analysis.alreadyRatio} className="h-2" />
                <div className="flex items-center justify-between text-xs"><span className="text-muted-foreground">wait</span><span className="font-medium tabular-nums">{analysis.waitCount} · {analysis.waitRatio}%</span></div>
              </div>
              <Separator />
              <div className="grid grid-cols-2 gap-2">
                <AnalysisMetric label={props.tNode("analysis.files", "文件数")} value={analysis.fileCount} />
                <AnalysisMetric label={props.tNode("analysis.directories", "来源目录")} value={analysis.directoryCount} />
                <AnalysisMetric label={props.tNode("analysis.depth", "最大层级")} value={analysis.maxDepth} />
                <AnalysisMetric label={props.tNode("analysis.ready", "可执行")} value={props.result?.readyCount ?? 0} />
              </div>
              <Separator />
              <div className="flex flex-col gap-2">
                <div className="text-xs font-medium text-muted-foreground">{props.tNode("analysis.extensions", "格式构成")}</div>
                {analysis.extensions.length ? analysis.extensions.map((item) => (
                  <div key={item.extension} className="flex items-center justify-between gap-2 text-xs"><span className="truncate font-mono">{item.extension}</span><Badge variant="secondary">{item.count}</Badge></div>
                )) : <div className="py-4 text-center text-xs text-muted-foreground">{props.tNode("analysis.empty", "生成计划后显示分析结果。")}</div>}
              </div>
            </div>
          </ScrollArea>
        </TabsContent>
        <TabsContent value="issues" className="min-h-0 flex-1"><AnalysisLines empty={props.tNode("empty.noIssues", "暂无问题。") } lines={issueLines} /></TabsContent>
        <TabsContent value="logs" className="min-h-0 flex-1"><AnalysisLines empty={props.tNode("empty.logs", "运行日志会显示在这里。") } lines={props.logs} /></TabsContent>
      </Tabs>
    </ModulePanel>
  )
}

function AnalysisMetric(props: { label: string; value: number }) {
  return <div className="rounded-md border bg-muted/20 p-2"><div className="text-[11px] text-muted-foreground">{props.label}</div><div className="mt-1 text-lg font-semibold tabular-nums">{props.value}</div></div>
}

function AnalysisLines(props: { empty: string; lines: string[] }) {
  return <ScrollArea className="h-full">{props.lines.length ? <div className="flex flex-col gap-2 p-3">{props.lines.map((line, index) => <div key={`${line}:${index}`} className="rounded-md border bg-muted/20 p-2 font-mono text-xs leading-5 text-muted-foreground">{line}</div>)}</div> : <Empty className="h-full border-0 p-4"><EmptyHeader><EmptyTitle className="text-sm">{props.empty}</EmptyTitle></EmptyHeader></Empty>}</ScrollArea>
}

function PlacementToggle(props: { disabled?: boolean; value: ClassfPlacementMode; t: ViewProps["tNode"]; onChange: (value: ClassfPlacementMode) => void }) {
  return (
    <ToggleGroup type="single" value={props.value} disabled={props.disabled} onValueChange={(value) => value && props.onChange(value as ClassfPlacementMode)} className="grid grid-cols-2" size="sm">
      {PLACEMENT_MODES.map((item) => <ToggleGroupItem key={item.value} value={item.value} className="min-w-0 gap-1"><item.icon /><span className="truncate text-xs">{props.t(`placementModes.${item.value}`, item.label)}</span></ToggleGroupItem>)}
    </ToggleGroup>
  )
}

function RunButton({ compact, props }: { compact?: boolean; props: ViewProps }) {
  if (props.running) return <Button aria-label={props.tNode("status.running", "正在运行")} disabled size={compact ? "icon-sm" : "sm"} variant="secondary"><Square />{!compact && <span>{props.tNode("status.running", "正在运行")}</span>}</Button>
  const needsPlan = props.action === "classify" && !props.planCurrent
  const label = needsPlan ? props.tNode("actions.prepareClassify", "先生成执行计划") : props.tNode(`actions.${props.action}Run`, actionLabel(props.action))
  const live = props.action === "classify" && !(props.data.dryRun ?? true)
  if (needsPlan) return <Button aria-label={label} size={compact ? "icon-sm" : "sm"} onClick={() => props.onExecute("classify")}><Clipboard />{!compact && <span>{label}</span>}</Button>
  if (live) {
    return (
      <AlertDialog>
        <AlertDialogTrigger asChild><Button aria-label={label} size={compact ? "icon-sm" : "sm"} variant="destructive"><Play />{!compact && <span>{label}</span>}</Button></AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{props.tNode("confirm.title", "确认执行已预览的分类计划？")}</AlertDialogTitle><AlertDialogDescription>{props.tNode("confirm.description", "ClassF 将严格按中央矩阵中已确认的目标移动或复制文件；冲突项会跳过。")}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>{props.tNode("common.cancel", "取消")}</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => props.onExecute(props.action)}>{props.tNode("confirm.action", "确认执行")}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
  }
  return <Button aria-label={label} size={compact ? "icon-sm" : "sm"} onClick={() => props.onExecute(props.action)}><Play />{!compact && <span>{label}</span>}</Button>
}

function PlanRows(props: { items: ClassfPlanItem[]; paths: string[]; planCurrent?: boolean; runningItem?: ClassfCardState["runningItem"]; t: ViewProps["tNode"] }) {
  if (!props.items.length) {
    const text = props.paths.length ? props.t("empty.ready", "生成计划后，这里会在执行前列出每个来源及其目标位置。") : props.t("empty.noSources", "添加来源路径，即可预览完整分类结果。")
    return <div className="flex min-h-32 flex-1 items-center justify-center p-4 text-center text-sm text-muted-foreground">{text}</div>
  }
  return (
    <ScrollArea className="min-h-0 flex-1">
      <Table className="min-w-[420px] text-xs">
        <TableHeader>
          <TableRow>
            <TableHead>{props.t("table.mapping", "来源 → 执行后位置")}</TableHead>
            <TableHead className="w-24 text-right">{props.t("table.status", "状态")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.items.slice(0, 180).map((item, index) => {
            const isRunning = props.runningItem?.sourcePath === item.sourcePath && props.runningItem.stage === item.stage
            const meta = itemStatusMeta(isRunning ? "running" : item.status, props.t)
            const StatusIcon = meta.icon
            const KindIcon = item.kind === "folder" ? Folder : File
            return (
              <TableRow key={`${item.sourcePath}:${index}`} data-state={item.status === "conflict" || item.status === "error" ? "selected" : undefined}>
                <TableCell>
                  <div className="flex min-w-0 items-start gap-2">
                    <KindIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate font-medium">{item.sourceName}</span>
                        <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
                        <span className="truncate font-medium text-primary" title={item.targetPath}>{item.targetRelative || item.targetPath}</span>
                        <Badge variant="outline" className="shrink-0">{props.t(`stages.${item.stage}`, item.stage)}</Badge>
                      </div>
                      <div className="truncate font-mono text-[11px] text-muted-foreground" title={item.sourcePath}>{item.sourcePath}</div>
                      {item.reason ? <div className="truncate text-[11px] text-destructive">{item.reason}</div> : null}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-right"><Badge variant={meta.variant} className="gap-1"><StatusIcon />{meta.label}</Badge></TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </ScrollArea>
  )
}

function PlanTree(props: { planCurrent: boolean; result: ClassfData | null; runningItem?: ClassfCardState["runningItem"]; t: ViewProps["tNode"] }) {
  const elements = useMemo(() => buildPlanTree(props.result, props.runningItem, props.t), [props.result, props.runningItem, props.t])
  const expandedItems = useMemo(() => elements.flatMap(collectTreeFolderIds), [elements])
  if (!elements.length) {
    return (
      <Empty className="h-full border-0 p-4 md:p-6">
        <EmptyHeader>
          <EmptyMedia variant="icon"><FolderTree /></EmptyMedia>
          <EmptyTitle className="text-sm">{props.t("tree.empty", "等待分类计划")}</EmptyTitle>
          <EmptyDescription className="text-xs">{props.t("tree.emptyDescription", "生成计划后，这里会按目标目录预演具体分类结构。")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <div className="relative h-full min-h-0">
      {!props.planCurrent ? <Badge variant="destructive" className="absolute right-3 top-2">{props.t("status.stale", "计划已失效")}</Badge> : null}
      <Tree
        key={`${props.result?.items.length ?? 0}:${props.result?.movedCount ?? 0}:${props.result?.copiedCount ?? 0}`}
        actions={<CollapseButton elements={elements}><Maximize2 data-icon="inline-start" />{props.t("tree.toggle", "展开/收起")}</CollapseButton>}
        className="py-2 text-xs"
        elements={elements}
        initialExpandedItems={expandedItems}
        sort="none"
      />
    </div>
  )
}

function ResultTabs(props: { compact?: boolean; logs: string[]; planCurrent: boolean; result: ClassfData | null; runningItem?: ClassfCardState["runningItem"]; t: ViewProps["tNode"]; onCopyLogs: () => void; onCopyResults: () => void }) {
  return (
    <Tabs defaultValue="tree" className="flex h-full min-h-0 flex-col">
      <TabsList variant="line" className="shrink-0"><TabsTrigger value="tree"><FolderTree />{props.t("tabs.tree", "文件树")}</TabsTrigger><TabsTrigger value="plan"><PLAN_ICON />{props.t("tabs.plan", "计划")}</TabsTrigger><TabsTrigger value="issues"><AlertTriangle />{props.t("tabs.issues", "问题")}</TabsTrigger><TabsTrigger value="logs"><Terminal />{props.t("tabs.logs", "日志")}</TabsTrigger></TabsList>
      <TabsContent value="tree" className="min-h-0 flex-1"><PlanTree planCurrent={props.planCurrent} result={props.result} runningItem={props.runningItem} t={props.t} /></TabsContent>
      <TabsContent value="plan" className="min-h-0 flex-1"><PlanPanel compact={props.compact} result={props.result} runningItem={props.runningItem} t={props.t} onCopy={props.onCopyResults} /></TabsContent>
      <TabsContent value="issues" className="min-h-0 flex-1"><TextPanel empty={props.t("empty.noIssues", "暂无问题。") } lines={[...(props.result?.errors ?? []), ...(props.result?.items ?? []).filter((item) => item.reason && item.status !== "ready").map((item) => `${item.sourcePath}: ${item.reason}`)]} /></TabsContent>
      <TabsContent value="logs" className="min-h-0 flex-1"><TextPanel actionLabel={props.t("actions.copy", "复制")} empty={props.t("empty.logs", "运行日志会显示在这里。") } icon={Terminal} lines={props.logs} onAction={props.onCopyLogs} /></TabsContent>
    </Tabs>
  )
}

function PlanPanel(props: { compact?: boolean; result: ClassfData | null; runningItem?: ClassfCardState["runningItem"]; t: ViewProps["tNode"]; onCopy: () => void }) {
  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border bg-card">
      <div className={props.compact ? "flex shrink-0 items-center justify-between gap-2 px-2 py-1.5" : "flex shrink-0 items-center justify-between gap-2 px-3 py-2"}><div className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground"><PLAN_ICON /><span>{props.result?.items.length ? props.t("summary.items", "{{count}} 项", { count: props.result.items.length }) : props.t("empty.waitingPlan", "等待生成计划")}</span></div><Button disabled={!props.result?.items.length} size="xs" variant="ghost" onClick={props.onCopy}><Copy data-icon="inline-start" />{props.t("actions.copy", "复制")}</Button></div>
      <Separator />
      <PlanRows items={props.result?.items ?? []} paths={[]} runningItem={props.runningItem} t={props.t} />
    </section>
  )
}

function TextPanel(props: { actionLabel?: string; empty: string; icon?: LucideIcon; lines: string[]; onAction?: () => void }) {
  const Icon = props.icon
  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border bg-card">
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2"><span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">{Icon && <Icon className="size-3.5" />}{props.lines.length ? `${props.lines.length} lines` : props.empty}</span>{props.onAction && <Button disabled={!props.lines.length} size="xs" variant="ghost" onClick={props.onAction}>{props.actionLabel ?? "Copy"}</Button>}</div>
      <Separator />
      <ScrollArea className="min-h-0 flex-1">{props.lines.length ? <pre className="p-3 text-xs leading-5 text-muted-foreground">{props.lines.join("\n")}</pre> : <div className="flex min-h-24 items-center justify-center p-4 text-sm text-muted-foreground">{props.empty}</div>}</ScrollArea>
    </section>
  )
}

function HeaderLine(props: { status: ClassfStatusMeta; subtitle: string }) {
  const Icon = NODE_ICON
  return <div className="min-w-0"><div className="flex min-w-0 items-center gap-2"><div className={cn("grid size-8 shrink-0 place-items-center rounded-lg", props.status.iconClass)}><Icon /></div><div className="min-w-0"><div className="flex min-w-0 items-center gap-2"><h3 className="truncate text-sm font-semibold leading-none">ClassF</h3><Badge variant={props.status.badgeVariant}>{props.status.label}</Badge></div><p className="mt-1 truncate text-xs text-muted-foreground">{props.subtitle}</p></div></div></div>
}

function StatsPanel(props: { paths: string[]; progress: number; result: ClassfData | null; t: ViewProps["tNode"] }) {
  const stats = [
    { label: props.t("stats.selected", "已选择"), value: props.paths.length },
    { label: props.t("stats.ready", "待执行"), value: props.result?.readyCount ?? 0 },
    { label: props.t("stats.wait", "待处理"), value: props.result?.waitCount ?? 0 },
    { label: props.t("stats.completed", "已完成"), value: (props.result?.movedCount ?? 0) + (props.result?.copiedCount ?? 0) },
    { label: props.t("stats.conflicts", "冲突"), value: props.result?.conflictCount ?? 0 },
    { label: props.t("stats.progress", "进度"), value: props.progress, suffix: "%" },
  ]
  return <div className="grid shrink-0 grid-cols-3 gap-1 @3xl/classf:grid-cols-6">{stats.map((item) => <div key={item.label} className="min-w-0 rounded-md bg-muted/35 px-2 py-1.5 text-center"><div className="truncate text-[11px] text-muted-foreground">{item.label}</div><div className="text-sm font-semibold tabular-nums">{item.value}{item.suffix ?? ""}</div></div>)}</div>
}

function StatusStrip(props: { progress: number; status: ClassfStatusMeta; text?: string }) {
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

function statusFromState(data: ClassfCardState, running: boolean, result: ClassfData | null, t: ViewProps["tNode"]): ClassfStatusMeta {
  if (running || data.phase === "running") return { label: t("status.running", "正在运行"), description: data.progressText || t("status.runningDescription", "正在生成或执行分类计划。"), tone: "running", badgeVariant: "secondary", iconClass: "bg-primary text-primary-foreground" }
  if (data.phase === "error" || result?.errorCount) return { label: t("status.failed", "失败"), description: data.progressText || result?.errors[0] || t("status.failedDescription", "上次运行失败，请检查问题列表。"), tone: "error", badgeVariant: "destructive", iconClass: "bg-destructive text-destructive-foreground" }
  if (data.phase === "completed") return { label: t("status.done", "完成"), description: data.progressText || t("status.doneDescription", "上次 ClassF 运行已完成。"), tone: "success", badgeVariant: "default", iconClass: "bg-primary text-primary-foreground" }
  return { label: t("status.ready", "就绪"), description: t("status.readyDescription", "添加来源并先预览 already / wait 的目标结果。"), tone: "idle", badgeVariant: "outline", iconClass: "bg-secondary text-secondary-foreground" }
}

function itemStatusMeta(status: ClassfPlanItem["status"] | "running", t: ViewProps["tNode"]) {
  if (status === "running") return { icon: Play, label: t("itemStatus.running", "执行中"), variant: "secondary" as const }
  if (status === "moved") return { icon: CheckCircle2, label: t("itemStatus.moved", "已移动"), variant: "default" as const }
  if (status === "copied") return { icon: CheckCircle2, label: t("itemStatus.copied", "已复制"), variant: "default" as const }
  if (status === "ready") return { icon: Archive, label: t("itemStatus.ready", "待执行"), variant: "secondary" as const }
  if (status === "conflict") return { icon: AlertTriangle, label: t("itemStatus.conflict", "冲突"), variant: "destructive" as const }
  if (status === "error") return { icon: XCircle, label: t("itemStatus.error", "错误"), variant: "destructive" as const }
  return { icon: AlertTriangle, label: t("itemStatus.skipped", "已跳过"), variant: "outline" as const }
}

interface MutablePlanTreeElement extends TreeViewElement {
  children?: MutablePlanTreeElement[]
}

function buildPlanTree(result: ClassfData | null, runningItem: ClassfCardState["runningItem"], t: ViewProps["tNode"]): TreeViewElement[] {
  if (!result?.items.length) return []
  const root: MutablePlanTreeElement = {
    id: "classf-plan-root",
    name: result.baseDir?.split(/[\\/]/).filter(Boolean).at(-1) ?? t("tree.targetRoot", "目标目录"),
    type: "folder",
    children: [],
  }
  for (const [itemIndex, item] of result.items.entries()) {
    if (!item.targetPath && !item.targetRelative) continue
    const relative = (item.targetRelative || item.targetPath).replaceAll("\\", "/")
    const pathParts = relative.split("/").filter(Boolean)
    if (!pathParts.length) continue
    if (pathParts.length === 1 && (item.stage === "already" || item.stage === "wait")) pathParts.unshift(item.stage)
    let parent = root
    const folderParts = item.kind === "folder" ? pathParts : pathParts.slice(0, -1)
    for (const [partIndex, part] of folderParts.entries()) {
      parent.children ??= []
      const id = `classf-plan:${pathParts.slice(0, partIndex + 1).join("/")}`
      let child = parent.children.find((candidate) => candidate.id === id)
      if (!child) {
        child = { id, name: part, type: "folder", children: [] }
        parent.children.push(child)
      }
      parent = child
    }
    const running = runningItem?.sourcePath === item.sourcePath && runningItem.stage === item.stage
    const status = running ? "running" : item.status
    const statusLabel = itemStatusMeta(status, t).label
    const targetName = pathParts.at(-1) ?? item.sourceName
    const mappingLabel = item.kind === "folder"
      ? `${t("tree.source", "来源")}：${item.sourceName}`
      : item.sourceName === targetName ? targetName : `${item.sourceName} → ${targetName}`
    parent.children ??= []
    parent.children.push({
      id: `classf-plan:item:${item.stage}:${item.sourcePath}:${itemIndex}`,
      name: `${mappingLabel} · ${statusLabel}`,
      type: "file",
      isSelectable: false,
    })
  }
  return root.children?.length ? [root] : []
}

function collectTreeFolderIds(element: TreeViewElement): string[] {
  if (element.type !== "folder") return []
  return [element.id, ...(element.children ?? []).flatMap(collectTreeFolderIds)]
}

function analyzePlan(result: ClassfData | null) {
  const items = result?.items ?? []
  const alreadyCount = items.filter((item) => item.stage === "already").length
  const waitCount = items.filter((item) => item.stage === "wait").length
  const classifiedCount = alreadyCount + waitCount
  const directoryCount = new Set(items.map((item) => item.sourcePath.replace(/[\\/][^\\/]+$/, ""))).size
  const maxDepth = items.reduce((maximum, item) => Math.max(maximum, Math.max(0, (item.targetRelative || item.targetPath).split(/[\\/]+/).filter(Boolean).length - 1)), 0)
  const extensions = new Map<string, number>()
  for (const item of items) {
    const match = /(?:^|[\\/])[^\\/]+(\.[^.\\/]+)$/.exec(item.sourcePath)
    const extension = match?.[1]?.toLocaleLowerCase() ?? "(无扩展名)"
    extensions.set(extension, (extensions.get(extension) ?? 0) + 1)
  }
  return {
    alreadyCount,
    waitCount,
    alreadyRatio: classifiedCount ? Math.round((alreadyCount / classifiedCount) * 100) : 0,
    waitRatio: classifiedCount ? Math.round((waitCount / classifiedCount) * 100) : 0,
    fileCount: items.filter((item) => item.kind === "file").length,
    directoryCount: items.length ? directoryCount : 0,
    maxDepth,
    extensions: [...extensions.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, 6).map(([extension, count]) => ({ extension, count })),
  }
}

function summaryText(props: ViewProps): string {
  if (props.data.progressText) return props.data.progressText
  if (props.result) return props.tNode("summary.result", "{{count}} 项 / 待执行 {{ready}} / wait {{wait}}", { count: props.result.items.length, ready: props.result.readyCount, wait: props.result.waitCount })
  if (props.paths.length) return props.tNode("summary.selected", "已选择 {{count}} 项", { count: props.paths.length })
  return props.tNode("description", props.actionMeta.description)
}

function actionLabel(action: ClassfAction): string {
  return ACTIONS.find((item) => item.value === action)?.label ?? action
}

function buildInput(action: ClassfAction, data: ClassfCardState): ClassfInput {
  return {
    action,
    paths: splitLines(data.pathsText),
    crashuSourcePaths: splitLines(data.crashuSourcesText),
    targetDir: clean(data.targetDir),
    transferMode: data.transferMode ?? "move",
    classifyMode: data.classifyMode ?? "auto",
    placementMode: data.placementMode ?? "local",
    existingPolicy: data.existingPolicy ?? "merge",
    dryRun: data.dryRun ?? true,
    workItemMode: data.workItemMode ?? "files",
    sameaGroupEnabled: data.sameaGroupEnabled ?? false,
    sameaGroupMinOccurrences: data.sameaGroupMinOccurrences ?? 1,
    sameaGroupCentralize: data.sameaGroupCentralize ?? false,
  }
}

function planFingerprint(data: ClassfCardState): string {
  return JSON.stringify({
    paths: splitLines(data.pathsText),
    crashuSources: splitLines(data.crashuSourcesText),
    targetDir: clean(data.targetDir),
    transferMode: data.transferMode ?? "move",
    classifyMode: data.classifyMode ?? "auto",
    placementMode: data.placementMode ?? "local",
    existingPolicy: data.existingPolicy ?? "merge",
    workItemMode: data.workItemMode ?? "files",
    sameaGroupEnabled: data.sameaGroupEnabled ?? false,
    sameaGroupMinOccurrences: data.sameaGroupMinOccurrences ?? 1,
    sameaGroupCentralize: data.sameaGroupCentralize ?? false,
  })
}

function isPlanCurrent(data: ClassfCardState): boolean {
  return Boolean(data.result?.items.length && data.planFingerprint === planFingerprint(data))
}

function readProgressData(data: unknown): ClassfProgressData | undefined {
  if (!data || typeof data !== "object" || !("kind" in data)) return undefined
  const kind = (data as { kind?: unknown }).kind
  return kind === "classf-plan" || kind === "classf-stage" || kind === "classf-item" ? data as ClassfProgressData : undefined
}

function updateResultItem(result: ClassfData | null | undefined, progress: Extract<ClassfProgressData, { kind: "classf-item" }>): ClassfData | null {
  if (!result) return null
  const items = result.items.map((item) => item.sourcePath === progress.sourcePath && item.stage === progress.stage
    ? { ...item, status: progress.status === "running" ? item.status : progress.status, reason: progress.reason }
    : item)
  return {
    ...result,
    items,
    readyCount: items.filter((item) => item.status === "ready").length,
    movedCount: items.filter((item) => item.status === "moved").length,
    copiedCount: items.filter((item) => item.status === "copied").length,
    conflictCount: items.filter((item) => item.status === "conflict").length,
    errorCount: items.filter((item) => item.status === "error").length,
  }
}

function localizedProgress(data: ClassfProgressData | undefined, fallback: string, t: ViewProps["tNode"]): string {
  if (data?.kind === "classf-plan") return t("progress.planVisible", "完整计划已生成，请在矩阵中确认执行结果。")
  if (data?.kind === "classf-item") return data.status === "running"
    ? t("progress.itemRunning", "正在处理：{{name}}", { name: data.sourcePath.split(/[\\/]/).at(-1) ?? data.sourcePath })
    : t("progress.itemCompleted", "已更新：{{name}}", { name: data.sourcePath.split(/[\\/]/).at(-1) ?? data.sourcePath })
  if (data?.kind === "classf-stage") return t(`progress.stage.${data.stage}`, fallback)
  return fallback
}

function splitLines(value: unknown): string[] {
  return String(value ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

function clean(value: unknown): string | undefined {
  const text = String(value ?? "").trim()
  return text || undefined
}

function getHostData(host: NodeComponentProps<ClassfCardState>["host"], compId: string): ClassfCardState {
  return host.state?.getData?.() ?? host.getData<ClassfCardState>(compId) ?? {}
}

import { useRef, useState } from "react"
import type { NodeComponentProps, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import { smartSelect, type CzkawkaAction, type CzkawkaData, type CzkawkaInput, type CzkawkaSelectionStrategy, type CzkawkaTool } from "@xiranite/node-czkawka/core"
import { applyCzkawkaFilters, normalizeCzkawkaFilterState, type CzkawkaFilterResult, type CzkawkaFilterState, type CzkawkaStoredFilterPreset } from "@xiranite/node-czkawka/filters"
import { applyCzkawkaDirectorySelection, applyCzkawkaGroupSelection, applyCzkawkaTextSelection, calculateCzkawkaSelectionStats, createCzkawkaSelectionHistory, createDefaultCzkawkaSelectionAssistantConfig, invertCzkawkaSelection, pushCzkawkaSelectionHistory, redoCzkawkaSelectionHistory, selectAllCzkawkaEntries, undoCzkawkaSelectionHistory, type CzkawkaSelectionAssistantConfig, type CzkawkaSelectionHistory, type CzkawkaSelectionResult, type CzkawkaSelectionStats } from "@xiranite/node-czkawka/selection-assistant"
import { AlertTriangle, ArchiveX, AudioLines, Copy, FileQuestion, FileX2, FolderSearch2, FolderX, HardDrive, Image, Link2Off, MoveRight, PanelTopOpen, Play, Save, Search, Trash2, Video, X } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PathTextarea } from "@/components/ui/path-input"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useNodeI18n } from "@/nodes/shared/useNodeI18n"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import { createCzkawkaOperationInput, createCzkawkaScanInput, getCzkawkaToolOptions, type CzkawkaOptionDefinition } from "@xiranite/node-czkawka/tool-options"
import type { CzkawkaCardState, CzkawkaPanel } from "./types"
import { CzkawkaResultTable } from "./result-table"
import { CzkawkaFilterPanel } from "./filter-panel"
import { CzkawkaSelectionAssistant } from "./selection-assistant"
import { CzkawkaAnalysisView } from "./analysis-panel"
import { appendCzkawkaActivityLog, type CzkawkaActivityLogEntry, type CzkawkaActivityLogInput } from "@xiranite/node-czkawka/activity-log"
import { CzkawkaActivityLogView } from "./activity-log"
import { normalizeCzkawkaCardLayout, type CzkawkaCardId, type CzkawkaCardLayout } from "@xiranite/node-czkawka/card-layout"
import { CzkawkaCardManager, CzkawkaCardStack } from "./card-layout"
import { createDefaultCzkawkaFloatingPanel, normalizeCzkawkaFloatingPanel, type CzkawkaFloatingPanelState, type CzkawkaFloatingViewport } from "@xiranite/node-czkawka/floating-panel"
import { CzkawkaFloatingAnalysisPanel } from "./floating-analysis-panel"
import { buildCzkawkaGroupOrganizePlan } from "@xiranite/node-czkawka/operations"

const TOOLS: Array<{ id: CzkawkaTool; label: string; short: string; icon: typeof Copy }> = [
  { id: "duplicate-files", label: "重复文件", short: "重复", icon: Copy },
  { id: "empty-folders", label: "空文件夹", short: "空夹", icon: FolderX },
  { id: "big-files", label: "大文件", short: "大文件", icon: HardDrive },
  { id: "empty-files", label: "空文件", short: "空文件", icon: FileX2 },
  { id: "temporary-files", label: "临时文件", short: "临时", icon: Trash2 },
  { id: "similar-images", label: "相似图片", short: "图片", icon: Image },
  { id: "similar-videos", label: "相似视频", short: "视频", icon: Video },
  { id: "duplicate-music", label: "重复音频", short: "音频", icon: AudioLines },
  { id: "invalid-symlinks", label: "无效符号链接", short: "链接", icon: Link2Off },
  { id: "broken-files", label: "损坏文件", short: "损坏", icon: FileQuestion },
  { id: "bad-extensions", label: "不正确扩展名", short: "扩展名", icon: ArchiveX },
]

export function Component({ compId, host }: NodeComponentProps<CzkawkaCardState>) {
  "use no memo"
  const surface = useNodeSurface()
  const { t } = useNodeI18n("czkawka")
  const data = getData(host, compId)
  const [running, setRunning] = useState(false)
  const [resultsByTool, setResultsByTool] = useState<Partial<Record<CzkawkaTool, CzkawkaData>>>({})
  const [selectedPathsByTool, setSelectedPathsByTool] = useState<Partial<Record<CzkawkaTool, string[]>>>({})
  const [filterStatesByTool, setFilterStatesByTool] = useState<Partial<Record<CzkawkaTool, CzkawkaFilterState>>>(() => data.filterStatesByTool ?? {})
  const [filterPresets, setFilterPresetsState] = useState<CzkawkaStoredFilterPreset[]>(() => data.filterPresets ?? [])
  const [selectionConfig, setSelectionConfigState] = useState<CzkawkaSelectionAssistantConfig>(() => data.selectionAssistantConfig ?? createDefaultCzkawkaSelectionAssistantConfig())
  const [selectionAssistantOpen, setSelectionAssistantOpenState] = useState(data.selectionAssistantOpen ?? false)
  const [selectionHistoriesByTool, setSelectionHistoriesByTool] = useState<Partial<Record<CzkawkaTool, CzkawkaSelectionHistory>>>({})
  const activityLogRef = useRef<CzkawkaActivityLogEntry[]>(data.activityLog ?? [])
  const [activityLog, setActivityLog] = useState<CzkawkaActivityLogEntry[]>(() => data.activityLog ?? [])
  const [cardLayout, setCardLayoutState] = useState<CzkawkaCardLayout>(() => normalizeCzkawkaCardLayout(data.cardLayout))
  const [previewPanelEnabledByTool, setPreviewPanelEnabledByTool] = useState<Partial<Record<CzkawkaTool, boolean>>>(() => data.previewPanelEnabledByTool ?? {})
  const floatingViewport = { width: Math.max(320, surface.width || 1200), height: Math.max(240, surface.height || 760) }
  const [floatingAnalysisPanelState, setFloatingAnalysisPanelState] = useState<CzkawkaFloatingPanelState>(() => data.floatingAnalysisPanel ?? createDefaultCzkawkaFloatingPanel(floatingViewport))
  const floatingAnalysisPanel = normalizeCzkawkaFloatingPanel(floatingAnalysisPanelState, floatingViewport)
  const [filterNow] = useState(Date.now)
  const [panel, setPanel] = useState<CzkawkaPanel>("source")
  const tool = data.tool ?? "duplicate-files"
  const result = resultsByTool[tool] ?? (data.result?.tool === tool ? data.result : null)
  const selectedPaths = selectedPathsByTool[tool] ?? []
  const filterState = normalizeCzkawkaFilterState(filterStatesByTool[tool])
  const filterResult = applyCzkawkaFilters(result?.groups ?? [], selectedPaths, filterState, filterNow, tool)
  const selectionHistory = selectionHistoriesByTool[tool] ?? createCzkawkaSelectionHistory(selectedPaths)
  const selectionStats = calculateCzkawkaSelectionStats(filterResult.groups, selectedPaths)
  const filterText = filterState.text.pattern
  const compact = surface.mode === "compact" || surface.mode === "portrait"

  function patch(next: Partial<CzkawkaCardState>) {
    if (host.state?.patchData) host.state.patchData(next)
    else host.patchData(compId, next)
  }

  function addActivityLog(input: Omit<CzkawkaActivityLogInput, "tool">) {
    const next = appendCzkawkaActivityLog(activityLogRef.current, { ...input, tool })
    activityLogRef.current = next
    setActivityLog(next)
    patch({ activityLog: next })
  }

  function clearActivityLog() {
    activityLogRef.current = []
    setActivityLog([])
    patch({ activityLog: [] })
  }

  function setCardLayout(next: CzkawkaCardLayout) {
    setCardLayoutState(next)
    patch({ cardLayout: next })
  }

  function setPreviewPanelEnabled(enabled: boolean) {
    const next = { ...previewPanelEnabledByTool, [tool]: enabled }
    setPreviewPanelEnabledByTool(next)
    patch({ previewPanelEnabledByTool: next })
  }

  function setFloatingAnalysisPanel(next: CzkawkaFloatingPanelState) {
    const normalized = normalizeCzkawkaFloatingPanel(next, floatingViewport)
    setFloatingAnalysisPanelState(normalized)
    patch({ floatingAnalysisPanel: normalized })
  }

  function setSelectedPaths(paths: string[]) {
    setSelectedPathsByTool((current) => ({ ...current, [tool]: paths }))
    setSelectionHistoriesByTool((current) => ({ ...current, [tool]: pushCzkawkaSelectionHistory(current[tool] ?? createCzkawkaSelectionHistory(selectedPaths), paths) }))
  }

  function resetSelectedPaths(paths: string[] = []) {
    setSelectedPathsByTool((current) => ({ ...current, [tool]: paths }))
    setSelectionHistoriesByTool((current) => ({ ...current, [tool]: createCzkawkaSelectionHistory(paths) }))
  }

  async function executeScan() {
    if (running) return
    const includedDirectories = lines(data.includedDirectoriesText)
    if (!includedDirectories.length) { const text = t("errors.noRoots", "请至少添加一个包含目录。"); patch({ phase: "error", progressText: text }); addActivityLog({ kind: "system", level: "error", message: text }); return }
    const run = host.runner?.run ?? host.actions?.run
    if (!run) { const text = t("errors.noRuntime", "当前环境没有本地运行能力。"); patch({ phase: "error", progressText: text }); addActivityLog({ kind: "system", level: "error", message: text }); return }
    setRunning(true)
    resetSelectedPaths()
    const startingText = t("progress.starting", "正在启动 Czkawka 扫描。")
    patch({ phase: "running", progress: 0, progressText: startingText, result: null })
    addActivityLog({ kind: "scan", level: "info", message: startingText, progress: 0 })
    try {
      const response = await run<CzkawkaInput, CzkawkaData>("czkawka", scanInput(tool, data), (event: NodeRunEvent) => {
        if (event.type === "progress") patch({ progress: event.progress ?? 0, progressText: event.message })
        addActivityLog({ kind: event.type === "progress" ? "progress" : "system", level: "info", message: event.message, progress: event.progress })
      }) as NodeRunResult<CzkawkaData>
      if (response.data) setResultsByTool((current) => ({ ...current, [tool]: response.data }))
      const stopped = response.data?.stopped === true
      patch({ phase: stopped ? "stopped" : response.success ? "completed" : "error", progress: response.success || stopped ? 100 : 0, progressText: response.message, result: response.data ?? null })
      addActivityLog({ kind: "scan", level: stopped ? "warning" : response.success ? "success" : "error", message: response.message, progress: response.success || stopped ? 100 : undefined })
      setPanel("results")
    } catch (error) { const text = message(error); patch({ phase: "error", progressText: text }); addActivityLog({ kind: "scan", level: "error", message: text }) }
    finally { setRunning(false) }
  }

  async function executeOperation(action: CzkawkaAction, overrides: Partial<CzkawkaInput> = {}) {
    const run = host.runner?.run ?? host.actions?.run
    const operationPaths = overrides.selectedPaths ?? selectedPaths
    if (!run || !operationPaths.length || running) return
    setRunning(true)
    patch({ progressText: `${action} ${operationPaths.length} item(s)…` })
    addActivityLog({ kind: "operation", level: "info", action, message: `${action} ${operationPaths.length} item(s)…` })
    try {
      const input = { ...createCzkawkaOperationInput(action as Exclude<CzkawkaAction, "scan">, { ...data, tool, selectedPaths: operationPaths }), ...overrides }
      const response = await run<CzkawkaInput, CzkawkaData>("czkawka", input) as NodeRunResult<CzkawkaData>
      patch({ progressText: response.message, operation: response.data ?? null, phase: response.success ? "completed" : "error" })
      addActivityLog({ kind: "operation", level: response.success ? "success" : "error", action, message: response.message, affectedCount: response.data?.affectedCount, errorCount: response.data?.errorCount })
      if (response.success && data.dryRun === false && action !== "save") resetSelectedPaths()
    } catch (error) { const text = message(error); patch({ phase: "error", progressText: text }); addActivityLog({ kind: "operation", level: "error", action, message: text }) }
    finally { setRunning(false) }
  }

  function applySmartSelection(strategy: CzkawkaSelectionStrategy) { if (result) setSelectedPaths(smartSelect(result.groups, strategy)) }
  function setFilterState(value: CzkawkaFilterState) { setFilterStatesByTool((current) => { const next = { ...current, [tool]: value }; patch({ filterStatesByTool: next }); return next }) }
  function setFilterPresets(value: CzkawkaStoredFilterPreset[]) { setFilterPresetsState(value); patch({ filterPresets: value }) }
  function setFilterText(value: string) { setFilterState({ ...filterState, text: { ...filterState.text, enabled: Boolean(value), pattern: value } }) }
  function setSelectionConfig(value: CzkawkaSelectionAssistantConfig) { setSelectionConfigState(value); patch({ selectionAssistantConfig: value }) }
  function setSelectionAssistantOpen(open: boolean) { setSelectionAssistantOpenState(open); patch({ selectionAssistantOpen: open }) }
  function applySelectionRule(kind: "group" | "text" | "directory"): CzkawkaSelectionResult { const mode = kind === "directory" && selectionConfig.directory.mode === "exclude-directory" ? "remove" : selectionConfig.applyMode; const selection = kind === "group" ? applyCzkawkaGroupSelection(filterResult.groups, selectedPaths, selectionConfig.group, mode) : kind === "text" ? applyCzkawkaTextSelection(filterResult.groups, selectedPaths, selectionConfig.text, mode) : applyCzkawkaDirectorySelection(filterResult.groups, selectedPaths, selectionConfig.directory, mode); if (!selection.error) setSelectedPaths(selection.paths); return selection }
  function undoSelection() { const history = undoCzkawkaSelectionHistory(selectionHistory); setSelectionHistoriesByTool((current) => ({ ...current, [tool]: history })); setSelectedPathsByTool((current) => ({ ...current, [tool]: history.present })) }
  function redoSelection() { const history = redoCzkawkaSelectionHistory(selectionHistory); setSelectionHistoriesByTool((current) => ({ ...current, [tool]: history })); setSelectedPathsByTool((current) => ({ ...current, [tool]: history.present })) }
  function invertSelection() { setSelectedPaths(invertCzkawkaSelection(filterResult.groups, selectedPaths)) }
  function selectAllVisible() { setSelectedPaths(selectAllCzkawkaEntries(filterResult.groups)) }

  const view = { data, tool, result, filterState, filterResult, filterPresets, selectionConfig, selectionStats, selectionHistory, selectionAssistantOpen, activityLog, cardLayout, previewPanelEnabled: previewPanelEnabledByTool[tool] ?? false, floatingAnalysisPanel, floatingViewport, floatingAvailable: !compact, running, selectedPaths, filterText, panel, getFileUrl: host.localFiles?.getUrl, copyText: host.clipboard?.writeText, openPath: host.localFiles?.openPath, revealPath: host.localFiles?.revealPath, patch, clearActivityLog, setCardLayout, setPreviewPanelEnabled, setFloatingAnalysisPanel, setPanel, setSelectedPaths, setFilterState, setFilterPresets, setFilterText, setSelectionConfig, setSelectionAssistantOpen, applySelectionRule, undoSelection, redoSelection, invertSelection, selectAllVisible, executeScan, executeOperation, applySmartSelection }
  return <TooltipProvider><div ref={surface.ref} data-testid="czkawka-surface" className="@container/czkawka flex h-full min-h-0 w-full overflow-hidden bg-background">
    {surface.mode === "collapsed" ? <Collapsed {...view} /> : compact ? <Compact {...view} /> : <Full {...view} />}
  </div></TooltipProvider>
}

type View = {
  data: CzkawkaCardState; tool: CzkawkaTool; result: CzkawkaData | null; filterState: CzkawkaFilterState; filterResult: CzkawkaFilterResult; filterPresets: CzkawkaStoredFilterPreset[]; selectionConfig: CzkawkaSelectionAssistantConfig; selectionStats: CzkawkaSelectionStats; selectionHistory: CzkawkaSelectionHistory; selectionAssistantOpen: boolean; activityLog: CzkawkaActivityLogEntry[]; cardLayout: CzkawkaCardLayout; previewPanelEnabled: boolean; floatingAnalysisPanel: CzkawkaFloatingPanelState; floatingViewport: CzkawkaFloatingViewport; floatingAvailable: boolean; running: boolean; selectedPaths: string[]; filterText: string; panel: CzkawkaPanel
  getFileUrl?: (path: string) => string
  copyText?: (text: string) => Promise<void>
  openPath?: (path: string) => Promise<void>
  revealPath?: (path: string) => Promise<void>
  patch: (next: Partial<CzkawkaCardState>) => void; clearActivityLog: () => void; setCardLayout: (layout: CzkawkaCardLayout) => void; setPreviewPanelEnabled: (enabled: boolean) => void; setFloatingAnalysisPanel: (state: CzkawkaFloatingPanelState) => void; setPanel: (panel: CzkawkaPanel) => void; setSelectedPaths: (paths: string[]) => void; setFilterState: (value: CzkawkaFilterState) => void; setFilterPresets: (value: CzkawkaStoredFilterPreset[]) => void; setFilterText: (value: string) => void; setSelectionConfig: (value: CzkawkaSelectionAssistantConfig) => void; setSelectionAssistantOpen: (open: boolean) => void; applySelectionRule: (kind: "group" | "text" | "directory") => CzkawkaSelectionResult; undoSelection: () => void; redoSelection: () => void; invertSelection: () => void; selectAllVisible: () => void; executeScan: () => Promise<void>; executeOperation: (action: CzkawkaAction, overrides?: Partial<CzkawkaInput>) => Promise<void>
  applySmartSelection: (strategy: CzkawkaSelectionStrategy) => void
}

function Full(props: View) {
  const floatingOpen = props.floatingAvailable && props.floatingAnalysisPanel.open
  return <div data-testid="czkawka-full-view" className="relative flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-2"><Header {...props} /><div className={cn("grid min-h-0 flex-1 gap-2", floatingOpen ? "grid-cols-[176px_minmax(230px,0.8fr)_minmax(440px,1.8fr)]" : "grid-cols-[176px_minmax(230px,0.8fr)_minmax(440px,1.8fr)_minmax(210px,0.75fr)]")}><ToolRail {...props} /><SourcePanel {...props} /><ResultTable {...props} />{floatingOpen ? null : <AnalysisPanel {...props} />}</div><StatusBar {...props} />{floatingOpen ? <CzkawkaFloatingAnalysisPanel state={props.floatingAnalysisPanel} viewport={props.floatingViewport} layout={props.cardLayout} onStateChange={props.setFloatingAnalysisPanel} onLayoutChange={props.setCardLayout} renderCard={(id) => <CzkawkaCardContent id={id} props={props} />} /> : null}</div>
}

function Compact(props: View) {
  return <div data-testid="czkawka-compact-view" className="flex min-h-0 flex-1 flex-col gap-2 p-2"><Header {...props} /><Tabs value={props.panel} onValueChange={(value) => props.setPanel(value as CzkawkaPanel)}><TabsList className="grid w-full grid-cols-3"><TabsTrigger value="source">条件</TabsTrigger><TabsTrigger value="results">结果 <Badge variant="outline">{props.result?.fileCount ?? 0}</Badge></TabsTrigger><TabsTrigger value="analysis">统计</TabsTrigger></TabsList></Tabs><div className="min-h-0 flex-1 overflow-hidden">{props.panel === "source" ? <div className="grid h-full min-h-0 grid-cols-[132px_minmax(0,1fr)] gap-2"><ToolRail {...props} /><SourcePanel {...props} /></div> : props.panel === "results" ? <ResultTable {...props} /> : <AnalysisPanel {...props} />}</div><StatusBar {...props} /></div>
}

function Collapsed(props: View) {
  const meta = toolMeta(props.tool)
  return <div data-testid="czkawka-collapsed-view" className="flex h-full w-full items-center gap-2 rounded-lg border bg-card px-3"><meta.icon className="size-5 text-primary" /><div className="min-w-0 flex-1"><div className="text-sm font-semibold">Czkawka · {meta.label}</div><div className="truncate text-xs text-muted-foreground">{props.data.progressText || `${props.result?.fileCount ?? 0} 个结果`}</div></div><Badge variant={props.data.phase === "error" ? "destructive" : "outline"}>{props.data.phase ?? "idle"}</Badge><Button disabled={props.running} size="icon-sm" onClick={props.executeScan}><Play /></Button></div>
}

function Header(props: View) {
  const meta = toolMeta(props.tool)
  return <header className="flex shrink-0 items-center justify-between gap-3 border-b pb-2"><div className="flex min-w-0 items-center gap-2"><div className="grid size-9 place-items-center rounded-md border bg-muted/40"><meta.icon className="size-5 text-primary" /></div><div className="min-w-0"><h3 className="truncate text-base font-semibold tracking-tight">Czkawka · {meta.label}</h3><p className="truncate font-mono text-[11px] text-muted-foreground">FILE FORENSICS / 11 SCANNERS / TS CONTROL PLANE</p></div></div><div className="flex items-center gap-2"><Button aria-label={props.floatingAnalysisPanel.open ? "关闭浮动分析面板" : "打开浮动分析面板"} disabled={!props.floatingAvailable} size="icon-sm" variant={props.floatingAnalysisPanel.open ? "secondary" : "ghost"} onClick={() => props.setFloatingAnalysisPanel({ ...props.floatingAnalysisPanel, open: !props.floatingAnalysisPanel.open })}><PanelTopOpen /></Button><CzkawkaCardManager layout={props.cardLayout} onChange={props.setCardLayout} /><div className="relative"><Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><Input aria-label="czkawka global filter" className="h-8 w-48 pl-7 pr-7 text-xs" placeholder="搜索当前工具结果" value={props.filterText} onChange={(event) => props.setFilterText(event.currentTarget.value)} />{props.filterText ? <button type="button" aria-label="清除结果搜索" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => props.setFilterText("")}><X className="size-3.5" /></button> : null}</div><CzkawkaFilterPanel tool={props.tool} state={props.filterState} stats={props.filterResult.stats} pathPatternError={props.filterResult.pathPatternError} textPatternError={props.filterResult.textPatternError} presets={props.filterPresets} onChange={props.setFilterState} onPresetsChange={props.setFilterPresets} /><Badge variant="outline">{props.selectedPaths.length} 已选</Badge><Button disabled={props.running} size="sm" onClick={props.executeScan}>{props.running ? <Search className="animate-pulse" /> : <Play />}{props.running ? "扫描中" : "开始扫描"}</Button></div></header>
}

function ToolRail(props: View) {
  return <aside className="flex min-h-0 flex-col rounded-md border bg-card"><div className="border-b px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">扫描工具</div><ScrollArea className="min-h-0 flex-1"><div className="grid gap-0.5 p-1">{TOOLS.map((tool) => <Tooltip key={tool.id}><TooltipTrigger asChild><button type="button" aria-label={tool.label} data-active={props.tool === tool.id} className="flex min-w-0 items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[active=true]:bg-primary data-[active=true]:text-primary-foreground" onClick={() => props.patch({ tool: tool.id })}><tool.icon className="size-3.5 shrink-0" /><span className="truncate">{tool.short}</span></button></TooltipTrigger><TooltipContent side="right">{tool.label}</TooltipContent></Tooltip>)}</div></ScrollArea></aside>
}

function SourcePanel(props: View) {
  return <section className="flex min-h-0 flex-col rounded-md border bg-card"><SectionHeader icon={FolderSearch2} title="扫描条件" /><ScrollArea className="min-h-0 flex-1"><div className="p-2"><CzkawkaCardStack layout={props.cardLayout} panel="source" onChange={props.setCardLayout} renderCard={(id) => <CzkawkaCardContent id={id} props={props} />} /></div></ScrollArea></section>
}

function AlgorithmFields(props: View) {
  return <div className="grid gap-2">{getCzkawkaToolOptions(props.tool).map((definition) => <SchemaOptionField key={definition.id} definition={definition} {...props} />)}</div>
}

function SchemaOptionField({ data, definition, patch }: View & { definition: CzkawkaOptionDefinition }) {
  const value = data[definition.id as keyof CzkawkaCardState] ?? definition.defaultValue
  if (definition.kind === "boolean") return <SwitchLine label={definition.label.zh} checked={Boolean(value)} onChange={(checked) => patch({ [definition.id]: checked } as Partial<CzkawkaCardState>)} />
  if (definition.kind === "number") return <Field label={definition.label.zh}><Input type="number" min={definition.min} max={definition.max} value={String(value)} onChange={(event) => patch({ [definition.id]: event.currentTarget.value } as Partial<CzkawkaCardState>)} /></Field>
  return <Field label={definition.label.zh}><Select value={String(value)} onValueChange={(next) => patch({ [definition.id]: next } as Partial<CzkawkaCardState>)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{definition.choices?.map((choice) => <SelectItem key={choice.value} value={choice.value}>{choice.label ?? choice.value}</SelectItem>)}</SelectContent></Select></Field>
}

function ResultTable(props: View) {
  return <CzkawkaResultTable tool={props.tool} groups={props.filterResult.groups} running={props.running} phase={props.data.phase} statusMessage={props.data.progressText} filterText={props.filterText} externalFiltering selectedPaths={props.selectedPaths} musicCheckType={props.data.musicCheckType} musicMaximumDifference={props.data.musicMaximumDifference} musicMinimumFragmentDuration={props.data.musicMinimumFragmentDuration} musicCompareFingerprintsOnlyWithSimilarTitles={props.data.musicCompareFingerprintsOnlyWithSimilarTitles} previewPanelEnabled={props.previewPanelEnabled} getFileUrl={props.getFileUrl} onCopyText={props.copyText} onOpenPath={props.openPath} onRevealPath={props.revealPath} onFilterTextChange={props.setFilterText} onPreviewPanelEnabledChange={props.setPreviewPanelEnabled} onRetry={props.executeScan} onSelectionChange={props.setSelectedPaths} />
}

function AnalysisPanel(props: View) {
  const stats = props.result
  return <section className="flex min-h-0 flex-col rounded-md border bg-card"><SectionHeader icon={Search} title="分析与操作" /><div className="grid grid-cols-2 gap-px border-b bg-border"><Metric label="文件" value={String(stats?.fileCount ?? 0)} /><Metric label="分组" value={String(stats?.groupCount ?? 0)} /><Metric label="总大小" value={formatBytes(stats?.totalBytes ?? 0)} /><Metric label="可回收" value={formatBytes(stats?.reclaimableBytes ?? 0)} accent /></div><ScrollArea className="min-h-0 flex-1"><div className="p-2"><CzkawkaCardStack layout={props.cardLayout} panel="analysis" onChange={props.setCardLayout} renderCard={(id) => <CzkawkaCardContent id={id} props={props} />} /></div></ScrollArea></section>
}

function CzkawkaCardContent({ id, props }: { id: CzkawkaCardId; props: View }) {
  if (id === "source-settings") return <SourceSettingsCard {...props} />
  if (id === "preview") return <PreviewSettingsCard {...props} />
  if (id === "analysis") return <CzkawkaAnalysisView groups={props.filterResult.groups} selectedPaths={props.selectedPaths} tool={props.tool} hashSize={Number(props.data.similarImagesHashSize ?? 16)} />
  if (id === "logs") return <CzkawkaActivityLogView entries={props.activityLog} onClear={props.clearActivityLog} onCopyText={props.copyText} />
  if (id === "selection") return <SelectionCard {...props} />
  return <OperationsCard {...props} />
}

function SourceSettingsCard(props: View) {
  return <div className="grid gap-3"><Field label="包含目录"><PathTextarea aria-label="czkawka included directories" className="min-h-28 resize-none font-mono text-xs" placeholder="D:/Media\nE:/Archive" value={props.data.includedDirectoriesText ?? ""} onValueChange={(includedDirectoriesText) => props.patch({ includedDirectoriesText })} /></Field><Field label="参考目录"><PathTextarea aria-label="czkawka reference directories" className="min-h-16 resize-none font-mono text-xs" placeholder="只保留这些目录中的文件" value={props.data.includedDirectoriesReferencedText ?? ""} onValueChange={(includedDirectoriesReferencedText) => props.patch({ includedDirectoriesReferencedText })} /></Field><Field label="排除目录"><PathTextarea aria-label="czkawka excluded directories" className="min-h-20 resize-none font-mono text-xs" value={props.data.excludedDirectoriesText ?? ""} onValueChange={(excludedDirectoriesText) => props.patch({ excludedDirectoriesText })} /></Field><Field label="排除项目"><Input value={props.data.excludedItemsText ?? ""} placeholder="*/cache/*; *.part" onChange={(event) => props.patch({ excludedItemsText: event.currentTarget.value })} /></Field><div className="grid grid-cols-2 gap-2"><Field label="允许扩展名"><Input value={props.data.allowedExtensions ?? ""} placeholder="jpg,png" onChange={(event) => props.patch({ allowedExtensions: event.currentTarget.value })} /></Field><Field label="排除扩展名"><Input value={props.data.excludedExtensions ?? ""} placeholder="tmp,bak" onChange={(event) => props.patch({ excludedExtensions: event.currentTarget.value })} /></Field></div><div className="grid grid-cols-2 gap-2"><Field label="最小文件大小（B）"><Input type="number" min={0} value={props.data.minimumFileSize ?? "1"} onChange={(event) => props.patch({ minimumFileSize: event.currentTarget.value })} /></Field><Field label="最大文件大小（B）"><Input type="number" min={1} value={props.data.maximumFileSize ?? ""} placeholder="不限" onChange={(event) => props.patch({ maximumFileSize: event.currentTarget.value })} /></Field></div><SwitchLine label="递归扫描" checked={props.data.recursive ?? true} onChange={(recursive) => props.patch({ recursive })} /><SwitchLine label="使用缓存" checked={props.data.useCache ?? true} onChange={(useCache) => props.patch({ useCache })} /><AlgorithmFields {...props} /></div>
}

function PreviewSettingsCard(props: View) {
  return <div className="grid gap-2 text-xs"><SwitchLine label="固定媒体预览" checked={props.previewPanelEnabled} onChange={props.setPreviewPanelEnabled} /><div className="text-muted-foreground">当前工具：{toolMeta(props.tool).label}。启用后图片、视频和音频在结果侧栏中打开。</div></div>
}

function SelectionCard(props: View) {
  return <div className="grid gap-3"><div className="text-xs text-muted-foreground">已选择 <strong className="text-foreground">{props.selectedPaths.length}</strong> 个路径。</div><SelectionAssistantControl {...props} /><Field label="智能选择"><div className="grid grid-cols-2 gap-1"><Button size="xs" variant="outline" onClick={() => props.applySmartSelection("all-except-first")}>每组除首个</Button><Button size="xs" variant="outline" onClick={() => props.applySmartSelection("all-except-newest")}>保留最新</Button><Button size="xs" variant="outline" onClick={() => props.applySmartSelection("all-except-biggest")}>保留最大</Button><Button size="xs" variant="ghost" onClick={() => props.patch({ operation: null })}><X />清除操作</Button></div></Field></div>
}

function OperationsCard(props: View) {
  const liveDeleteDescription = props.data.deleteMode === "permanent" ? `将永久删除 ${props.selectedPaths.length} 个路径，此操作不可撤销。` : `将把 ${props.selectedPaths.length} 个路径移入系统回收站。`
  const organizePlan = buildCzkawkaGroupOrganizePlan(props.filterResult.groups, props.selectedPaths, { subfolderTemplate: props.data.organizeSubfolderTemplate, skipSingleFileFolders: props.data.organizeSkipSingleFileFolders })
  const visibleEntries = props.filterResult.groups.flatMap((group) => group.entries)
  const exportEntries = props.data.exportScope === "all" ? props.result?.entries ?? [] : props.data.exportScope === "visible" ? visibleEntries : (props.result?.entries ?? []).filter((entry) => props.selectedPaths.includes(entry.path))
  const renameItems = (props.result?.entries ?? []).filter((entry) => props.selectedPaths.includes(entry.path) && entry.properExtension).map((entry) => ({ path: entry.path, properExtension: entry.properExtension! }))
  return <div className="grid gap-3">
    <div className="text-xs text-muted-foreground">删除、移动和改名默认只生成可检查的逐项计划。</div>
    <SwitchLine label="仅预演操作" checked={props.data.dryRun ?? true} onChange={(dryRun) => props.patch({ dryRun })} />
    <Field label="删除方式"><Select value={props.data.deleteMode ?? "trash"} onValueChange={(deleteMode) => props.patch({ deleteMode: deleteMode as CzkawkaCardState["deleteMode"] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="trash">移入回收站</SelectItem><SelectItem value="permanent">永久删除</SelectItem></SelectContent></Select></Field>
    <Field label="移动或复制到"><div className="flex gap-1"><Input value={props.data.destinationDirectory ?? ""} placeholder="D:/Review" onChange={(event) => props.patch({ destinationDirectory: event.currentTarget.value })} /><AlertDialog><AlertDialogTrigger asChild><Button aria-label="move selected" disabled={!props.selectedPaths.length || !props.data.destinationDirectory || props.running} size="icon-sm" variant="outline"><MoveRight /></Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{props.data.dryRun ?? true ? "生成移动/复制计划？" : "执行移动/复制？"}</AlertDialogTitle><AlertDialogDescription>目标：{props.data.destinationDirectory}。{props.data.dryRun ?? true ? "当前不会修改文件。" : `将真实${props.data.copyMode ? "复制" : "移动"} ${props.selectedPaths.length} 项。`}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction onClick={() => void props.executeOperation("move")}>确认移动</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div></Field>
    <SwitchLine label="复制而非移动" checked={props.data.copyMode ?? false} onChange={(copyMode) => props.patch({ copyMode })} />
    <SwitchLine label="保留原目录结构" checked={props.data.preserveStructure ?? false} onChange={(preserveStructure) => props.patch({ preserveStructure })} />
    <Field label="目标冲突"><Select value={props.data.conflictPolicy ?? "skip"} onValueChange={(conflictPolicy) => props.patch({ conflictPolicy: conflictPolicy as CzkawkaCardState["conflictPolicy"] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="skip">跳过</SelectItem><SelectItem value="overwrite">覆盖</SelectItem><SelectItem value="rename">自动改名</SelectItem><SelectItem value="error">报告错误</SelectItem></SelectContent></Select></Field>
    {props.tool === "similar-images" ? <div className="grid gap-2 rounded-md border p-2"><Field label="相似组子目录模板"><Input value={props.data.organizeSubfolderTemplate ?? "variants_{groupId}"} onChange={(event) => props.patch({ organizeSubfolderTemplate: event.currentTarget.value })} /></Field><SwitchLine label="跳过仅一个文件的来源目录" checked={props.data.organizeSkipSingleFileFolders ?? true} onChange={(organizeSkipSingleFileFolders) => props.patch({ organizeSkipSingleFileFolders })} /><AlertDialog><AlertDialogTrigger asChild><Button disabled={!organizePlan.items.length || props.running} size="sm" variant="outline"><ArchiveX />整理相似组（{organizePlan.items.length}）</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{props.data.dryRun ?? true ? "生成相似组整理计划？" : "执行相似组整理？"}</AlertDialogTitle><AlertDialogDescription>将 {organizePlan.selectedGroupCount} 组、{organizePlan.items.length} 项整理到 {organizePlan.targetFolderCount} 个子目录。</AlertDialogDescription></AlertDialogHeader><div className="grid max-h-48 gap-1 overflow-auto rounded-md border p-2 text-xs">{organizePlan.items.slice(0, 12).map((item) => <div key={item.path} className="grid"><span className="truncate font-mono">{item.path}</span><span className="truncate font-mono text-muted-foreground">→ {item.destination}</span></div>)}</div><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction onClick={() => void props.executeOperation("move", { selectedPaths: organizePlan.items.map((item) => item.path), destinationItems: organizePlan.items })}>确认整理</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div> : null}
    {props.tool === "bad-extensions" ? <AlertDialog><AlertDialogTrigger asChild><Button disabled={!renameItems.length || props.running} size="sm" variant="outline">修正扩展名（{renameItems.length}）</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{props.data.dryRun ?? true ? "生成扩展名修正计划？" : "执行扩展名修正？"}</AlertDialogTitle><AlertDialogDescription>将按扫描结果修正 {renameItems.length} 项。执行后如需撤销，请根据操作详情中的源/目标路径反向改名。</AlertDialogDescription></AlertDialogHeader><div className="grid max-h-48 gap-1 overflow-auto rounded-md border p-2 text-xs">{renameItems.slice(0, 12).map((item) => <div key={item.path} className="font-mono">{item.path} → .{item.properExtension}</div>)}</div><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction onClick={() => void props.executeOperation("rename", { renameItems, selectedPaths: renameItems.map((item) => item.path) })}>确认改名</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog> : null}
    <Field label="导出结果"><div className="grid gap-1"><Select value={props.data.exportScope ?? "selected"} onValueChange={(exportScope) => props.patch({ exportScope: exportScope as CzkawkaCardState["exportScope"] })}><SelectTrigger aria-label="export scope"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="selected">选择项</SelectItem><SelectItem value="visible">当前视图</SelectItem><SelectItem value="all">全部结果</SelectItem></SelectContent></Select><div className="flex gap-1"><Input value={props.data.outputPath ?? ""} placeholder="D:/result.json" onChange={(event) => props.patch({ outputPath: event.currentTarget.value })} /><Button aria-label="save selected" disabled={!exportEntries.length || !props.data.outputPath || props.running} size="icon-sm" variant="outline" onClick={() => void props.executeOperation("save", { exportEntries, selectedPaths: exportEntries.map((entry) => entry.path), exportScope: props.data.exportScope ?? "selected" })}><Save /></Button></div></div></Field>
    <AlertDialog><AlertDialogTrigger asChild><Button disabled={!props.selectedPaths.length || props.running} variant="destructive"><Trash2 />删除已选</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{props.data.dryRun ?? true ? "生成删除计划？" : props.data.deleteMode === "permanent" ? "永久删除已选文件？" : "将已选文件移入回收站？"}</AlertDialogTitle><AlertDialogDescription>{props.data.dryRun ?? true ? "当前是预演模式，不会修改文件。" : liveDeleteDescription}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => void props.executeOperation("delete")}>确认删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    {props.data.operation ? <OperationResultDetails data={props.data.operation} /> : null}
  </div>
}

function OperationResultDetails({ data }: { data: CzkawkaData }) {
  return <div className="grid gap-2 rounded-md border bg-muted/30 p-2 text-xs"><div className="flex items-center justify-between"><span className="font-medium">上次操作详情</span><span className="text-muted-foreground">{data.affectedCount} 成功或计划 / {data.errorCount} 错误</span></div><div className="grid max-h-48 gap-1 overflow-auto">{data.entries.map((entry) => <div key={entry.id} className="grid gap-0.5 rounded border bg-background/70 p-1.5"><div className="flex items-center justify-between gap-2"><span className="truncate font-mono">{entry.path}</span><Badge variant={entry.status === "error" ? "destructive" : entry.status === "skipped" ? "secondary" : "outline"}>{entry.status ?? "unknown"}</Badge></div>{entry.secondaryPath ? <div className="truncate font-mono text-muted-foreground">→ {entry.secondaryPath}</div> : null}{entry.error ? <div className="text-destructive">{entry.error}</div> : null}</div>)}</div></div>
}

function SelectionAssistantControl(props: View) {
  return <CzkawkaSelectionAssistant open={props.selectionAssistantOpen} config={props.selectionConfig} stats={props.selectionStats} canUndo={props.selectionHistory.past.length > 0} canRedo={props.selectionHistory.future.length > 0} onOpenChange={props.setSelectionAssistantOpen} onConfigChange={props.setSelectionConfig} onApply={props.applySelectionRule} onUndo={props.undoSelection} onRedo={props.redoSelection} onClear={() => props.setSelectedPaths([])} onInvert={props.invertSelection} onSelectAll={props.selectAllVisible} />
}

function StatusBar(props: View) { return <div className="flex shrink-0 items-center gap-2 rounded-md border bg-muted/20 px-2 py-1"><Progress className="h-1.5 flex-1" value={props.data.progress ?? 0} /><span className="max-w-[55%] truncate text-[11px] text-muted-foreground">{props.data.progressText || "Czkawka 已就绪。"}</span>{props.data.phase === "error" ? <AlertTriangle className="size-3.5 text-destructive" /> : null}</div> }
function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) { return <div className="bg-card p-2"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div><div className={cn("mt-1 font-mono text-sm font-semibold", accent && "text-primary")}>{value}</div></div> }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="grid gap-1.5"><Label className="text-xs">{label}</Label>{children}</label> }
function SwitchLine({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) { return <label className="flex items-center justify-between gap-2 rounded-md border bg-background/50 px-2 py-1.5 text-xs"><span>{label}</span><Switch checked={checked} size="sm" onCheckedChange={onChange} /></label> }
function SectionHeader({ icon, title }: { icon: typeof Search; title: string }) { return <div className="border-b px-3 py-2"><SectionTitle icon={icon} title={title} /></div> }
function SectionTitle({ icon: Icon, title }: { icon: typeof Search; title: string }) { return <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em]"><Icon className="size-3.5 text-primary" />{title}</div> }

export function scanInput(tool: CzkawkaTool, data: CzkawkaCardState): CzkawkaInput { return createCzkawkaScanInput(tool, data as Record<string, unknown>) }
function toolMeta(tool: CzkawkaTool) { return TOOLS.find((item) => item.id === tool) ?? TOOLS[0]! }
function lines(value: unknown) { return String(value ?? "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean) }
function message(error: unknown) { return error instanceof Error ? error.message : String(error) }
function formatBytes(bytes: number) { if (bytes < 1024) return `${bytes} B`; const units = ["KB", "MB", "GB", "TB"]; let value = bytes / 1024, unit = units[0]!; for (let index = 1; index < units.length && value >= 1024; index += 1) { value /= 1024; unit = units[index]! } return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}` }
function getData(host: NodeComponentProps<CzkawkaCardState>["host"], compId: string): CzkawkaCardState { return host.state?.getData?.() ?? host.getData<CzkawkaCardState>(compId) ?? {} }

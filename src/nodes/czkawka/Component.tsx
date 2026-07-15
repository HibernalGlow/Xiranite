import { useEffect, useRef, useState } from "react"
import type { NodeComponentProps, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import { smartSelect, type CzkawkaAction, type CzkawkaData, type CzkawkaInput, type CzkawkaSelectionStrategy, type CzkawkaTool } from "@xiranite/node-czkawka/core"
import { applyCzkawkaFilters, normalizeCzkawkaFilterState, type CzkawkaFilterResult, type CzkawkaFilterState, type CzkawkaStoredFilterPreset } from "@xiranite/node-czkawka/filters"
import { applyCzkawkaDirectorySelection, applyCzkawkaGroupSelection, applyCzkawkaTextSelection, calculateCzkawkaSelectionStats, createCzkawkaSelectionHistory, createDefaultCzkawkaSelectionAssistantConfig, invertCzkawkaSelection, pushCzkawkaSelectionHistory, redoCzkawkaSelectionHistory, selectAllCzkawkaEntries, undoCzkawkaSelectionHistory, type CzkawkaSelectionAssistantConfig, type CzkawkaSelectionHistory, type CzkawkaSelectionResult, type CzkawkaSelectionStats } from "@xiranite/node-czkawka/selection-assistant"
import { AlertTriangle, ArchiveX, AudioLines, Copy, FileQuestion, FileX2, FolderSearch2, FolderX, HardDrive, Image, Link2Off, MoveRight, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, PanelTopOpen, Play, Save, Search, Trash2, Video, X } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useNodeI18n } from "@/nodes/shared/useNodeI18n"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import { createCzkawkaOperationInput, createCzkawkaScanInput, getCzkawkaToolOptions, type CzkawkaOptionDefinition } from "@xiranite/node-czkawka/tool-options"
import type { CzkawkaCardState, CzkawkaPanel, CzkawkaSimilarImagesViewMode } from "./types"
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
import { czkawkaScanPresetFromValues, czkawkaScanPresetToValues, deleteCzkawkaScanPreset, exportCzkawkaScanPresets, importCzkawkaScanPresets } from "@xiranite/node-czkawka/scan-presets"
import { parseCzkawkaList } from "@xiranite/node-czkawka/source-inputs"
import { CzkawkaDirectoryEditor, CzkawkaTokenEditor } from "./source-inputs"
import { CZKAWKA_WORKSPACE_DEFAULTS, normalizeCzkawkaWorkspaceLayout, updateCzkawkaWorkspaceLayout, type CzkawkaWorkspaceLayout } from "@xiranite/node-czkawka/workspace-layout"
import { czkawkaStateMigrationPatch, normalizeCzkawkaCardState } from "./state"
import { CzkawkaSimilarFoldersView } from "./similar-folders-view"
import { CzkawkaSimilarityReferenceDialog } from "./similarity-reference-dialog"

const TOOLS: Array<{
  id: CzkawkaTool
  labelKey: string
  label: string
  shortKey: string
  short: string
  icon: typeof Copy
}> = [
  { id: "duplicate-files", labelKey: "tools.duplicateFiles", label: "重复文件", shortKey: "tools.short.duplicateFiles", short: "重复", icon: Copy },
  { id: "empty-folders", labelKey: "tools.emptyFolders", label: "空文件夹", shortKey: "tools.short.emptyFolders", short: "空夹", icon: FolderX },
  { id: "big-files", labelKey: "tools.bigFiles", label: "大文件", shortKey: "tools.short.bigFiles", short: "大文件", icon: HardDrive },
  { id: "empty-files", labelKey: "tools.emptyFiles", label: "空文件", shortKey: "tools.short.emptyFiles", short: "空文件", icon: FileX2 },
  { id: "temporary-files", labelKey: "tools.temporaryFiles", label: "临时文件", shortKey: "tools.short.temporaryFiles", short: "临时", icon: Trash2 },
  { id: "similar-images", labelKey: "tools.similarImages", label: "相似图片", shortKey: "tools.short.similarImages", short: "图片", icon: Image },
  { id: "similar-videos", labelKey: "tools.similarVideos", label: "相似视频", shortKey: "tools.short.similarVideos", short: "视频", icon: Video },
  { id: "duplicate-music", labelKey: "tools.duplicateMusic", label: "重复音频", shortKey: "tools.short.duplicateMusic", short: "音频", icon: AudioLines },
  {
    id: "invalid-symlinks",
    labelKey: "tools.invalidSymlinks",
    label: "无效符号链接",
    shortKey: "tools.short.invalidSymlinks",
    short: "链接",
    icon: Link2Off
  },
  { id: "broken-files", labelKey: "tools.brokenFiles", label: "损坏文件", shortKey: "tools.short.brokenFiles", short: "损坏", icon: FileQuestion },
  {
    id: "bad-extensions",
    labelKey: "tools.badExtensions",
    label: "不正确扩展名",
    shortKey: "tools.short.badExtensions",
    short: "扩展名",
    icon: ArchiveX
  }
]

export function Component({ compId, host }: NodeComponentProps<CzkawkaCardState>) {
  "use no memo"
  const surface = useNodeSurface()
  const { t, language } = useNodeI18n("czkawka")
  const rawData = getData(host, compId)
  const data = normalizeCzkawkaCardState(rawData)
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
  const [workspaceLayout, setWorkspaceLayoutState] = useState<CzkawkaWorkspaceLayout>(() => normalizeCzkawkaWorkspaceLayout(data.workspaceLayout))
  const [previewPanelEnabledByTool, setPreviewPanelEnabledByTool] = useState<Partial<Record<CzkawkaTool, boolean>>>(() => data.previewPanelEnabledByTool ?? {})
  const [thumbnailEnabledByTool, setThumbnailEnabledByTool] = useState<Partial<Record<CzkawkaTool, boolean>>>(() => data.thumbnailEnabledByTool ?? {})
  const floatingViewport = {
    width: Math.max(320, surface.width || 1200),
    height: Math.max(240, surface.height || 760)
  }
  const [floatingAnalysisPanelState, setFloatingAnalysisPanelState] = useState<CzkawkaFloatingPanelState>(() => data.floatingAnalysisPanel ?? createDefaultCzkawkaFloatingPanel(floatingViewport))
  const floatingAnalysisPanel = normalizeCzkawkaFloatingPanel(floatingAnalysisPanelState, floatingViewport)
  const [filterNow] = useState(Date.now)
  const [panel, setPanel] = useState<CzkawkaPanel>("source")
  const [similarImagesViewMode, setSimilarImagesViewModeState] = useState<CzkawkaSimilarImagesViewMode>(() => data.similarImagesViewMode ?? "images")
  const tool = data.tool ?? "duplicate-files"
  const result = resultsByTool[tool] ?? (data.result?.tool === tool ? data.result : null)
  const selectedPaths = selectedPathsByTool[tool] ?? []
  const filterState = normalizeCzkawkaFilterState(filterStatesByTool[tool])
  const filterResult = applyCzkawkaFilters(result?.groups ?? [], selectedPaths, filterState, filterNow, tool)
  const selectionHistory = selectionHistoriesByTool[tool] ?? createCzkawkaSelectionHistory(selectedPaths)
  const selectionStats = calculateCzkawkaSelectionStats(filterResult.groups, selectedPaths)
  const filterText = filterState.text.pattern
  const compact = surface.mode === "compact" || surface.mode === "portrait" || surface.width < 760

  useEffect(() => {
    const migration = czkawkaStateMigrationPatch(rawData)
    if (!migration) return
    if (host.state?.patchData) host.state.patchData(migration)
    else host.patchData(compId, migration)
  }, [compId, host, rawData])

  function patch(next: Partial<CzkawkaCardState>) {
    if (host.state?.patchData) host.state.patchData(next)
    else host.patchData(compId, next)
  }

  function addActivityLog(input: Omit<CzkawkaActivityLogInput, "tool">) {
    const next = appendCzkawkaActivityLog(activityLogRef.current, {
      ...input,
      tool
    })
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

  function setWorkspaceLayout(next: CzkawkaWorkspaceLayout) {
    const normalized = normalizeCzkawkaWorkspaceLayout(next)
    setWorkspaceLayoutState(normalized)
    patch({ schemaVersion: 1, workspaceLayout: normalized })
  }

  function setPreviewPanelEnabled(enabled: boolean) {
    const next = { ...previewPanelEnabledByTool, [tool]: enabled }
    setPreviewPanelEnabledByTool(next)
    patch({ previewPanelEnabledByTool: next })
  }

  function setThumbnailEnabled(enabled: boolean) {
    const next = { ...thumbnailEnabledByTool, [tool]: enabled }
    setThumbnailEnabledByTool(next)
    patch({ thumbnailEnabledByTool: next })
  }

  function setSimilarImagesViewMode(similarImagesViewMode: CzkawkaSimilarImagesViewMode) {
    setSimilarImagesViewModeState(similarImagesViewMode)
    patch({ similarImagesViewMode })
  }

  function setFloatingAnalysisPanel(next: CzkawkaFloatingPanelState) {
    const normalized = normalizeCzkawkaFloatingPanel(next, floatingViewport)
    setFloatingAnalysisPanelState(normalized)
    patch({ floatingAnalysisPanel: normalized })
  }

  function setSelectedPaths(paths: string[]) {
    setSelectedPathsByTool((current) => ({ ...current, [tool]: paths }))
    setSelectionHistoriesByTool((current) => ({
      ...current,
      [tool]: pushCzkawkaSelectionHistory(current[tool] ?? createCzkawkaSelectionHistory(selectedPaths), paths)
    }))
  }

  function resetSelectedPaths(paths: string[] = []) {
    setSelectedPathsByTool((current) => ({ ...current, [tool]: paths }))
    setSelectionHistoriesByTool((current) => ({
      ...current,
      [tool]: createCzkawkaSelectionHistory(paths)
    }))
  }

  async function executeScan() {
    if (running) return
    const includedDirectories = parseCzkawkaList(data.includedDirectoriesText)
    if (!includedDirectories.length) {
      const text = t("errors.noRoots", "请至少添加一个包含目录。")
      patch({ phase: "error", progressText: text })
      addActivityLog({ kind: "system", level: "error", message: text })
      return
    }
    const run = host.runner?.run ?? host.actions?.run
    if (!run) {
      const text = t("errors.noRuntime", "当前环境没有本地运行能力。")
      patch({ phase: "error", progressText: text })
      addActivityLog({ kind: "system", level: "error", message: text })
      return
    }
    setRunning(true)
    resetSelectedPaths()
    const startingText = t("progress.starting", "正在启动 Czkawka 扫描。")
    patch({
      phase: "running",
      progress: 0,
      progressText: startingText,
      result: null
    })
    addActivityLog({
      kind: "scan",
      level: "info",
      message: startingText,
      progress: 0
    })
    try {
      const response = (await run<CzkawkaInput, CzkawkaData>("czkawka", scanInput(tool, data), (event: NodeRunEvent) => {
        if (event.type === "progress")
          patch({
            progress: event.progress ?? 0,
            progressText: event.message
          })
        addActivityLog({
          kind: event.type === "progress" ? "progress" : "system",
          level: "info",
          message: event.message,
          progress: event.progress
        })
      })) as NodeRunResult<CzkawkaData>
      if (response.data) setResultsByTool((current) => ({ ...current, [tool]: response.data }))
      const stopped = response.data?.stopped === true
      patch({
        phase: stopped ? "stopped" : response.success ? "completed" : "error",
        progress: response.success || stopped ? 100 : 0,
        progressText: response.message,
        result: response.data ?? null
      })
      addActivityLog({
        kind: "scan",
        level: stopped ? "warning" : response.success ? "success" : "error",
        message: response.message,
        progress: response.success || stopped ? 100 : undefined
      })
      setPanel("results")
    } catch (error) {
      const text = message(error)
      patch({ phase: "error", progressText: text })
      addActivityLog({ kind: "scan", level: "error", message: text })
    } finally {
      setRunning(false)
    }
  }

  async function cancelScan() {
    const cancel = host.runner?.cancelCurrent ?? host.actions?.cancelCurrent
    if (!running || !cancel) return
    const stoppingText = t("progress.stopping", "正在请求停止 Czkawka 扫描…")
    patch({ progressText: stoppingText })
    addActivityLog({
      kind: "system",
      level: "warning",
      message: stoppingText
    })
    await cancel()
  }

  async function executeOperation(action: CzkawkaAction, overrides: Partial<CzkawkaInput> = {}) {
    const run = host.runner?.run ?? host.actions?.run
    const operationPaths = overrides.selectedPaths ?? selectedPaths
    if (!run || !operationPaths.length || running) return
    setRunning(true)
    patch({ progressText: `${action} ${operationPaths.length} item(s)…` })
    addActivityLog({
      kind: "operation",
      level: "info",
      action,
      message: `${action} ${operationPaths.length} item(s)…`
    })
    try {
      const input = {
        ...createCzkawkaOperationInput(action as Exclude<CzkawkaAction, "scan">, { ...data, tool, selectedPaths: operationPaths }),
        ...overrides
      }
      const response = (await run<CzkawkaInput, CzkawkaData>("czkawka", input)) as NodeRunResult<CzkawkaData>
      patch({
        progressText: response.message,
        operation: response.data ?? null,
        phase: response.success ? "completed" : "error"
      })
      addActivityLog({
        kind: "operation",
        level: response.success ? "success" : "error",
        action,
        message: response.message,
        affectedCount: response.data?.affectedCount,
        errorCount: response.data?.errorCount
      })
      if (response.success && data.dryRun === false && action !== "save") resetSelectedPaths()
    } catch (error) {
      const text = message(error)
      patch({ phase: "error", progressText: text })
      addActivityLog({
        kind: "operation",
        level: "error",
        action,
        message: text
      })
    } finally {
      setRunning(false)
    }
  }

  function applySmartSelection(strategy: CzkawkaSelectionStrategy) {
    if (result) setSelectedPaths(smartSelect(result.groups, strategy))
  }
  function setFilterState(value: CzkawkaFilterState) {
    setFilterStatesByTool((current) => {
      const next = { ...current, [tool]: value }
      patch({ filterStatesByTool: next })
      return next
    })
  }
  function setFilterPresets(value: CzkawkaStoredFilterPreset[]) {
    setFilterPresetsState(value)
    patch({ filterPresets: value })
  }
  function setFilterText(value: string) {
    setFilterState({
      ...filterState,
      text: { ...filterState.text, enabled: Boolean(value), pattern: value }
    })
  }
  function setSelectionConfig(value: CzkawkaSelectionAssistantConfig) {
    setSelectionConfigState(value)
    patch({ selectionAssistantConfig: value })
  }
  function setSelectionAssistantOpen(open: boolean) {
    setSelectionAssistantOpenState(open)
    patch({ selectionAssistantOpen: open })
  }
  function applySelectionRule(kind: "group" | "text" | "directory"): CzkawkaSelectionResult {
    const mode = kind === "directory" && selectionConfig.directory.mode === "exclude-directory" ? "remove" : selectionConfig.applyMode
    const selection = kind === "group" ? applyCzkawkaGroupSelection(filterResult.groups, selectedPaths, selectionConfig.group, mode) : kind === "text" ? applyCzkawkaTextSelection(filterResult.groups, selectedPaths, selectionConfig.text, mode) : applyCzkawkaDirectorySelection(filterResult.groups, selectedPaths, selectionConfig.directory, mode)
    if (!selection.error) setSelectedPaths(selection.paths)
    return selection
  }
  function undoSelection() {
    const history = undoCzkawkaSelectionHistory(selectionHistory)
    setSelectionHistoriesByTool((current) => ({ ...current, [tool]: history }))
    setSelectedPathsByTool((current) => ({
      ...current,
      [tool]: history.present
    }))
  }
  function redoSelection() {
    const history = redoCzkawkaSelectionHistory(selectionHistory)
    setSelectionHistoriesByTool((current) => ({ ...current, [tool]: history }))
    setSelectedPathsByTool((current) => ({
      ...current,
      [tool]: history.present
    }))
  }
  function invertSelection() {
    setSelectedPaths(invertCzkawkaSelection(filterResult.groups, selectedPaths))
  }
  function selectAllVisible() {
    setSelectedPaths(selectAllCzkawkaEntries(filterResult.groups))
  }

  const view = {
    data,
    tool,
    result,
    filterState,
    filterResult,
    filterPresets,
    selectionConfig,
    selectionStats,
    selectionHistory,
    selectionAssistantOpen,
    activityLog,
    cardLayout,
    workspaceLayout,
    similarImagesViewMode,
    previewPanelEnabled: previewPanelEnabledByTool[tool] ?? false,
    thumbnailEnabled: thumbnailEnabledByTool[tool] ?? true,
    floatingAnalysisPanel,
    floatingViewport,
    floatingAvailable: !compact,
    canResizeWorkspace: !compact,
    running,
    selectedPaths,
    filterText,
    panel,
    t,
    language,
    getFileUrl: host.localFiles?.getUrl,
    pickDirectory: host.localFiles?.pickDirectory,
    pickDirectories: host.localFiles?.pickDirectories,
    copyText: host.clipboard?.writeText,
    copyFiles: host.clipboard?.writeFiles,
    openPath: host.localFiles?.openPath,
    revealPath: host.localFiles?.revealPath,
    patch,
    clearActivityLog,
    setCardLayout,
    setWorkspaceLayout,
    setSimilarImagesViewMode,
    setPreviewPanelEnabled,
    setThumbnailEnabled,
    setFloatingAnalysisPanel,
    setPanel,
    setSelectedPaths,
    setFilterState,
    setFilterPresets,
    setFilterText,
    setSelectionConfig,
    setSelectionAssistantOpen,
    applySelectionRule,
    undoSelection,
    redoSelection,
    invertSelection,
    selectAllVisible,
    executeScan,
    cancelScan,
    executeOperation,
    applySmartSelection
  }
  return (
    <TooltipProvider>
      <div ref={surface.ref} data-testid="czkawka-surface" data-surface-mode={surface.mode} data-surface-width={surface.width} data-host-theme={host.env.theme} className="@container/czkawka flex h-full min-h-0 w-full overflow-hidden bg-transparent text-foreground">
        {surface.mode === "collapsed" ? <Collapsed {...view} /> : compact ? <Compact {...view} /> : <Full {...view} />}
      </div>
    </TooltipProvider>
  )
}

type View = {
  data: CzkawkaCardState
  tool: CzkawkaTool
  result: CzkawkaData | null
  filterState: CzkawkaFilterState
  filterResult: CzkawkaFilterResult
  filterPresets: CzkawkaStoredFilterPreset[]
  selectionConfig: CzkawkaSelectionAssistantConfig
  selectionStats: CzkawkaSelectionStats
  selectionHistory: CzkawkaSelectionHistory
  selectionAssistantOpen: boolean
  activityLog: CzkawkaActivityLogEntry[]
  cardLayout: CzkawkaCardLayout
  workspaceLayout: CzkawkaWorkspaceLayout
  similarImagesViewMode: CzkawkaSimilarImagesViewMode
  previewPanelEnabled: boolean
  thumbnailEnabled: boolean
  floatingAnalysisPanel: CzkawkaFloatingPanelState
  floatingViewport: CzkawkaFloatingViewport
  floatingAvailable: boolean
  canResizeWorkspace: boolean
  running: boolean
  selectedPaths: string[]
  filterText: string
  panel: CzkawkaPanel
  t: (key: string, fallback: string, vars?: Record<string, unknown>) => string
  language: "zh" | "en"
  getFileUrl?: (path: string) => string
  pickDirectory?: () => Promise<string | undefined>
  pickDirectories?: () => Promise<string[]>
  copyText?: (text: string) => Promise<void>
  copyFiles?: (paths: string[]) => Promise<void>
  openPath?: (path: string) => Promise<void>
  revealPath?: (path: string) => Promise<void>
  patch: (next: Partial<CzkawkaCardState>) => void
  clearActivityLog: () => void
  setCardLayout: (layout: CzkawkaCardLayout) => void
  setWorkspaceLayout: (layout: CzkawkaWorkspaceLayout) => void
  setSimilarImagesViewMode: (mode: CzkawkaSimilarImagesViewMode) => void
  setPreviewPanelEnabled: (enabled: boolean) => void
  setThumbnailEnabled: (enabled: boolean) => void
  setFloatingAnalysisPanel: (state: CzkawkaFloatingPanelState) => void
  setPanel: (panel: CzkawkaPanel) => void
  setSelectedPaths: (paths: string[]) => void
  setFilterState: (value: CzkawkaFilterState) => void
  setFilterPresets: (value: CzkawkaStoredFilterPreset[]) => void
  setFilterText: (value: string) => void
  setSelectionConfig: (value: CzkawkaSelectionAssistantConfig) => void
  setSelectionAssistantOpen: (open: boolean) => void
  applySelectionRule: (kind: "group" | "text" | "directory") => CzkawkaSelectionResult
  undoSelection: () => void
  redoSelection: () => void
  invertSelection: () => void
  selectAllVisible: () => void
  executeScan: () => Promise<void>
  cancelScan: () => Promise<void>
  executeOperation: (action: CzkawkaAction, overrides?: Partial<CzkawkaInput>) => Promise<void>
  applySmartSelection: (strategy: CzkawkaSelectionStrategy) => void
}

function Full(props: View) {
  const floatingOpen = props.floatingAvailable && props.floatingAnalysisPanel.open
  const layout = props.workspaceLayout
  const columns = [layout.sourcePanelMinimized ? "28px" : `${layout.sourcePanelWidth}px`, "8px", "minmax(360px, 1fr)", ...(floatingOpen ? [] : ["8px", layout.analysisPanelMinimized ? "28px" : `${layout.analysisPanelWidth}px`])].join(" ")
  return (
    <div data-testid="czkawka-full-view" className="relative flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-2">
      <Header {...props} />
      <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: columns }}>
        {layout.sourcePanelMinimized ? (
          <MinimizedPanel
            label={props.t("workspace.restoreConditions", "恢复扫描条件")}
            side="left"
            onRestore={() =>
              props.setWorkspaceLayout(
                updateCzkawkaWorkspaceLayout(layout, {
                  sourcePanelMinimized: false
                })
              )
            }
          />
        ) : (
          <SourcePanel {...props} />
        )}
        <WorkspaceResizeHandle label={props.t("workspace.resizeConditions", "调整扫描条件宽度")} value={layout.sourcePanelWidth} defaultValue={CZKAWKA_WORKSPACE_DEFAULTS.sourcePanelWidth} disabled={layout.sourcePanelMinimized} onChange={(sourcePanelWidth) => props.setWorkspaceLayout(updateCzkawkaWorkspaceLayout(layout, { sourcePanelWidth }))} />
        <ResultTable {...props} />
        {floatingOpen ? null : (
          <>
            <WorkspaceResizeHandle label={props.t("workspace.resizeAnalysis", "调整分析面板宽度")} value={layout.analysisPanelWidth} defaultValue={CZKAWKA_WORKSPACE_DEFAULTS.analysisPanelWidth} disabled={layout.analysisPanelMinimized} invert onChange={(analysisPanelWidth) => props.setWorkspaceLayout(updateCzkawkaWorkspaceLayout(layout, { analysisPanelWidth }))} />
            {layout.analysisPanelMinimized ? (
              <MinimizedPanel
                label={props.t("workspace.restoreAnalysis", "恢复分析与操作")}
                side="right"
                onRestore={() =>
                  props.setWorkspaceLayout(
                    updateCzkawkaWorkspaceLayout(layout, {
                      analysisPanelMinimized: false
                    })
                  )
                }
              />
            ) : (
              <AnalysisPanel {...props} />
            )}
          </>
        )}
      </div>
      <StatusBar {...props} />
      {floatingOpen ? <CzkawkaFloatingAnalysisPanel state={props.floatingAnalysisPanel} viewport={props.floatingViewport} layout={props.cardLayout} onStateChange={props.setFloatingAnalysisPanel} onLayoutChange={props.setCardLayout} renderCard={(id) => <CzkawkaCardContent id={id} props={props} />} /> : null}
    </div>
  )
}

function WorkspaceResizeHandle({ label, value, defaultValue, disabled, invert = false, onChange }: { label: string; value: number; defaultValue: number; disabled?: boolean; invert?: boolean; onChange: (value: number) => void }) {
  const drag = useRef<{ x: number; value: number } | null>(null)
  function move(event: React.PointerEvent<HTMLDivElement>) {
    if (!drag.current) return
    const delta = (event.clientX - drag.current.x) * (invert ? -1 : 1)
    onChange(drag.current.value + delta)
  }
  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuenow={value}
      tabIndex={disabled ? -1 : 0}
      data-testid={`czkawka-resizer-${label}`}
      className={cn("group grid cursor-col-resize place-items-center outline-none", disabled && "pointer-events-none opacity-30")}
      onDoubleClick={() => onChange(defaultValue)}
      onPointerDown={(event) => {
        drag.current = { x: event.clientX, value }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={move}
      onPointerUp={(event) => {
        drag.current = null
        event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      onKeyDown={(event) => {
        const direction = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0
        if (!direction) return
        event.preventDefault()
        onChange(value + direction * (event.shiftKey ? 32 : 8) * (invert ? -1 : 1))
      }}
    >
      <div className="h-full w-px bg-border transition-colors group-hover:bg-primary group-focus-visible:bg-primary" />
    </div>
  )
}

function MinimizedPanel({ label, side, onRestore }: { label: string; side: "left" | "right"; onRestore: () => void }) {
  const Icon = side === "left" ? PanelLeftOpen : PanelRightOpen
  return (
    <div className="grid min-h-0 place-items-start rounded-md border bg-card py-1">
      <Button aria-label={label} size="icon-xs" variant="ghost" onClick={onRestore}>
        <Icon />
      </Button>
    </div>
  )
}

function Compact(props: View) {
  return (
    <div data-testid="czkawka-compact-view" className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 p-2">
      <CompactHeader {...props} />
      <Tabs value={props.panel} onValueChange={(value) => props.setPanel(value as CzkawkaPanel)}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="source">{props.t("tabs.conditions", "条件")}</TabsTrigger>
          <TabsTrigger value="results">
            {props.t("tabs.results", "结果")} <Badge variant="outline">{props.result?.fileCount ?? 0}</Badge>
          </TabsTrigger>
          <TabsTrigger value="analysis">{props.t("tabs.analysis", "统计")}</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        {props.panel === "source" ? (
          <SourcePanel {...props} />
        ) : props.panel === "results" ? (
          <ResultTable {...props} />
        ) : (
          <AnalysisPanel {...props} />
        )}
      </div>
      <StatusBar {...props} />
    </div>
  )
}

function Collapsed(props: View) {
  const meta = toolMeta(props.tool, props.t)
  return (
    <div data-testid="czkawka-collapsed-view" className="flex h-full w-full items-center gap-2 rounded-lg border bg-card px-3">
      <meta.icon className="size-5 text-primary" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">Czkawka · {meta.label}</div>
        <div className="truncate text-xs text-muted-foreground">{props.data.progressText || props.t("summary.resultCount", "{{count}} 个结果", { count: props.result?.fileCount ?? 0 })}</div>
      </div>
      <Badge variant={props.data.phase === "error" ? "destructive" : "outline"}>{props.data.phase ?? "idle"}</Badge>
      <Button aria-label={props.running ? props.t("actions.stopScan", "停止扫描") : props.t("actions.startScan", "开始扫描")} size="icon-sm" variant={props.running ? "destructive" : "default"} onClick={props.running ? props.cancelScan : props.executeScan}>
        {props.running ? <X /> : <Play />}
      </Button>
    </div>
  )
}

function Header(props: View) {
  const meta = toolMeta(props.tool, props.t)
  return (
    <header className="flex shrink-0 items-center justify-between gap-3 border-b pb-2">
      <div className="flex min-w-0 items-center gap-2">
        <div className="grid size-9 place-items-center rounded-md border bg-muted/40">
          <meta.icon className="size-5 text-primary" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2"><h3 className="shrink-0 text-base font-semibold tracking-tight">Czkawka</h3><ToolSelector props={props} /></div>
          <p className="truncate font-mono text-[11px] text-muted-foreground">FILE FORENSICS / 11 SCANNERS / TS CONTROL PLANE</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {props.tool === "similar-images" || props.tool === "similar-videos" ? <CzkawkaSimilarityReferenceDialog t={props.t} /> : null}
        <Button
          aria-label={props.floatingAnalysisPanel.open ? props.t("actions.closeFloatingAnalysis", "关闭浮动分析面板") : props.t("actions.openFloatingAnalysis", "打开浮动分析面板")}
          disabled={!props.floatingAvailable}
          size="icon-sm"
          variant={props.floatingAnalysisPanel.open ? "secondary" : "ghost"}
          onClick={() =>
            props.setFloatingAnalysisPanel({
              ...props.floatingAnalysisPanel,
              open: !props.floatingAnalysisPanel.open
            })
          }
        >
          <PanelTopOpen />
        </Button>
        <CzkawkaCardManager layout={props.cardLayout} onChange={props.setCardLayout} />
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label={props.t("filters.global", "Czkawka 全局筛选")} className="h-8 w-48 pl-7 pr-7 text-xs" placeholder={props.t("filters.searchCurrent", "搜索当前工具结果")} value={props.filterText} onChange={(event) => props.setFilterText(event.currentTarget.value)} />
          {props.filterText ? (
            <button type="button" aria-label={props.t("filters.clearSearch", "清除结果搜索")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => props.setFilterText("")}>
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
        <CzkawkaFilterPanel tool={props.tool} state={props.filterState} stats={props.filterResult.stats} pathPatternError={props.filterResult.pathPatternError} textPatternError={props.filterResult.textPatternError} presets={props.filterPresets} onChange={props.setFilterState} onPresetsChange={props.setFilterPresets} />
        <Badge variant="outline">{props.t("summary.selected", "{{count}} 已选", { count: props.selectedPaths.length })}</Badge>
        <Button size="sm" variant={props.running ? "destructive" : "default"} onClick={props.running ? props.cancelScan : props.executeScan}>
          {props.running ? <X /> : <Play />}
          {props.running ? props.t("actions.stopScan", "停止扫描") : props.t("actions.startScan", "开始扫描")}
        </Button>
      </div>
    </header>
  )
}

function CompactHeader(props: View) {
  const meta = toolMeta(props.tool, props.t)
  return (
    <header className="grid shrink-0 gap-2 border-b pb-2">
      <div className="flex min-w-0 items-center gap-2">
        <div className="grid size-8 shrink-0 place-items-center rounded-md border bg-muted/40">
          <meta.icon className="size-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1"><h3 className="shrink-0 text-sm font-semibold">Czkawka</h3><ToolSelector compact props={props} /></div>
          <p className="truncate font-mono text-[10px] text-muted-foreground">11 SCANNERS / TS CONTROL PLANE</p>
        </div>
        {props.tool === "similar-images" || props.tool === "similar-videos" ? <CzkawkaSimilarityReferenceDialog t={props.t} /> : null}
        <Button className="shrink-0" size="sm" variant={props.running ? "destructive" : "default"} onClick={props.running ? props.cancelScan : props.executeScan}>
          {props.running ? <X /> : <Play />}
          {props.running ? props.t("actions.stopScan", "停止扫描") : props.t("actions.startScan", "开始扫描")}
        </Button>
      </div>
      <div className="flex min-w-0 items-center gap-1">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label={props.t("filters.global", "Czkawka 全局筛选")} className="h-8 w-full pl-7 pr-7 text-xs" placeholder={props.t("filters.search", "搜索结果")} value={props.filterText} onChange={(event) => props.setFilterText(event.currentTarget.value)} />
          {props.filterText ? (
            <button type="button" aria-label={props.t("filters.clearSearch", "清除结果搜索")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => props.setFilterText("")}>
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
        <CzkawkaFilterPanel tool={props.tool} state={props.filterState} stats={props.filterResult.stats} pathPatternError={props.filterResult.pathPatternError} textPatternError={props.filterResult.textPatternError} presets={props.filterPresets} onChange={props.setFilterState} onPresetsChange={props.setFilterPresets} />
        <Badge className="shrink-0" variant="outline">
          {props.selectedPaths.length}
        </Badge>
        <CzkawkaCardManager layout={props.cardLayout} onChange={props.setCardLayout} />
      </div>
    </header>
  )
}

function ToolSelector({ compact = false, props }: { compact?: boolean; props: View }) {
  return (
    <Select value={props.tool} onValueChange={(tool) => props.patch({ tool: tool as CzkawkaTool })}>
      <SelectTrigger aria-label={props.t("tools.select", "选择扫描工具")} className={cn("h-8 text-xs", compact ? "w-40" : "w-52")}><SelectValue /></SelectTrigger>
      <SelectContent>{TOOLS.map((definition) => { const tool = toolMeta(definition.id, props.t); return <SelectItem key={tool.id} value={tool.id}><span className="flex items-center gap-2"><tool.icon className="size-3.5" />{tool.label}</span></SelectItem> })}</SelectContent>
    </Select>
  )
}

function SourcePanel(props: View) {
  return (
    <section className="flex min-h-0 flex-col rounded-md border bg-card">
      <SectionHeader
        icon={FolderSearch2}
        title={props.t("sections.conditions", "扫描条件")}
        action={
          props.canResizeWorkspace ? (
            <Button
              aria-label={props.t("workspace.minimizeConditions", "最小化扫描条件")}
              size="icon-xs"
              variant="ghost"
              onClick={() =>
                props.setWorkspaceLayout(
                  updateCzkawkaWorkspaceLayout(props.workspaceLayout, {
                    sourcePanelMinimized: true
                  })
                )
              }
            >
              <PanelLeftClose />
            </Button>
          ) : null
        }
      />
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-2">
          <CzkawkaCardStack layout={props.cardLayout} panel="source" onChange={props.setCardLayout} renderCard={(id) => <CzkawkaCardContent id={id} props={props} />} />
        </div>
      </ScrollArea>
    </section>
  )
}

function AlgorithmFields(props: View) {
  return (
    <div className="grid gap-2">
      {getCzkawkaToolOptions(props.tool).map((definition) => (
        <SchemaOptionField key={definition.id} definition={definition} {...props} />
      ))}
    </div>
  )
}

function SchemaOptionField({ data, definition, patch, language }: View & { definition: CzkawkaOptionDefinition }) {
  const value = data[definition.id as keyof CzkawkaCardState] ?? definition.defaultValue
  const label = definition.label[language]
  if (definition.kind === "boolean") return <SwitchLine label={label} checked={Boolean(value)} onChange={(checked) => patch({ [definition.id]: checked } as Partial<CzkawkaCardState>)} />
  if (definition.kind === "number")
    return (
      <Field label={label}>
        <Input
          type="number"
          min={definition.min}
          max={definition.max}
          value={String(value)}
          onChange={(event) =>
            patch({
              [definition.id]: event.currentTarget.value
            } as Partial<CzkawkaCardState>)
          }
        />
      </Field>
    )
  return (
    <Field label={label}>
      <Select value={String(value)} onValueChange={(next) => patch({ [definition.id]: next } as Partial<CzkawkaCardState>)}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {definition.choices?.map((choice) => (
            <SelectItem key={choice.value} value={choice.value}>
              {choice.label ?? choice.value}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}

function ResultTable(props: View) {
  const table = <CzkawkaResultTable tool={props.tool} groups={props.filterResult.groups} running={props.running} phase={props.data.phase} statusMessage={props.data.progressText} filterText={props.filterText} externalFiltering selectedPaths={props.selectedPaths} musicCheckType={props.data.musicCheckType} musicMaximumDifference={props.data.musicMaximumDifference} musicMinimumFragmentDuration={props.data.musicMinimumFragmentDuration} musicCompareFingerprintsOnlyWithSimilarTitles={props.data.musicCompareFingerprintsOnlyWithSimilarTitles} previewPanelEnabled={props.previewPanelEnabled} thumbnailEnabled={props.thumbnailEnabled} reversePathDisplay={props.data.reversePathDisplay} wrapText={props.data.tableWrapText} getFileUrl={props.getFileUrl} onCopyText={props.copyText} onCopyFiles={props.copyFiles} onOpenPath={props.openPath} onRevealPath={props.revealPath} onFilterTextChange={props.setFilterText} onPreviewPanelEnabledChange={props.setPreviewPanelEnabled} onRetry={props.executeScan} onSelectionChange={props.setSelectedPaths} />
  if (props.tool !== "similar-images") return table
  return <div className="flex min-h-0 min-w-0 flex-col gap-1"><Tabs value={props.similarImagesViewMode} onValueChange={(value) => props.setSimilarImagesViewMode(value as CzkawkaSimilarImagesViewMode)}><TabsList className="grid w-52 grid-cols-2"><TabsTrigger value="images">{props.t("views.images", "图片")}</TabsTrigger><TabsTrigger value="folders">{props.t("views.folders", "文件夹")} <Badge variant="outline">{props.result?.similarFolders?.length ?? 0}</Badge></TabsTrigger></TabsList></Tabs><div className="min-h-0 min-w-0 flex-1 overflow-hidden">{props.similarImagesViewMode === "folders" ? <CzkawkaSimilarFoldersView folders={props.result?.similarFolders ?? []} filterText={props.filterText} getFileUrl={props.getFileUrl} onCopyText={props.copyText} onOpenPath={props.openPath} onRevealPath={props.revealPath} /> : table}</div></div>
}

function AnalysisPanel(props: View) {
  const stats = props.result
  return (
    <section className="flex min-h-0 flex-col rounded-md border bg-card">
      <SectionHeader
        icon={Search}
        title={props.t("sections.analysisOperations", "分析与操作")}
        action={
          props.canResizeWorkspace ? (
            <Button
              aria-label={props.t("workspace.minimizeAnalysis", "最小化分析与操作")}
              size="icon-xs"
              variant="ghost"
              onClick={() =>
                props.setWorkspaceLayout(
                  updateCzkawkaWorkspaceLayout(props.workspaceLayout, {
                    analysisPanelMinimized: true
                  })
                )
              }
            >
              <PanelRightClose />
            </Button>
          ) : null
        }
      />
      <div className="grid grid-cols-2 gap-px border-b bg-border">
        <Metric label={props.t("metrics.files", "文件")} value={String(stats?.fileCount ?? 0)} />
        <Metric label={props.t("metrics.groups", "分组")} value={String(stats?.groupCount ?? 0)} />
        <Metric label={props.t("metrics.totalSize", "总大小")} value={formatBytes(stats?.totalBytes ?? 0)} />
        <Metric label={props.t("metrics.reclaimable", "可回收")} value={formatBytes(stats?.reclaimableBytes ?? 0)} accent />
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-2">
          <CzkawkaCardStack layout={props.cardLayout} panel="analysis" onChange={props.setCardLayout} renderCard={(id) => <CzkawkaCardContent id={id} props={props} />} />
        </div>
      </ScrollArea>
    </section>
  )
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
  return (
    <div className="grid gap-3">
      <ScanPresetManager {...props} />
      <CzkawkaDirectoryEditor kind="included" label={props.t("sources.included", "包含目录")} value={props.data.includedDirectoriesText} referenceValue={props.data.includedDirectoriesReferencedText} referenceKeywords={props.data.referencePathKeywords ?? "#compare"} pickDirectory={props.pickDirectory} pickDirectories={props.pickDirectories} onChange={(includedDirectoriesText) => props.patch({ includedDirectoriesText })} onReferenceChange={(includedDirectoriesReferencedText) => props.patch({ includedDirectoriesReferencedText })} />
      <CzkawkaDirectoryEditor kind="excluded" label={props.t("sources.excluded", "排除目录")} value={props.data.excludedDirectoriesText} pickDirectory={props.pickDirectory} pickDirectories={props.pickDirectories} onChange={(excludedDirectoriesText) => props.patch({ excludedDirectoriesText })} />
      <CzkawkaTokenEditor kind="rules" label={props.t("sources.excludedItems", "排除项目")} value={props.data.excludedItemsText} placeholder={props.t("sources.excludedItemsPlaceholder", "*/cache/*; *.part；每条规则需包含 *")} onChange={(excludedItemsText) => props.patch({ excludedItemsText })} />
      <div className="grid grid-cols-2 gap-2">
        <CzkawkaTokenEditor kind="extensions" label={props.t("sources.allowedExtensions", "允许扩展名")} value={props.data.allowedExtensions} placeholder="jpg,png,IMAGE" onChange={(allowedExtensions) => props.patch({ allowedExtensions })} />
        <CzkawkaTokenEditor kind="extensions" label={props.t("sources.excludedExtensions", "排除扩展名")} value={props.data.excludedExtensions} placeholder="tmp,bak" onChange={(excludedExtensions) => props.patch({ excludedExtensions })} />
      </div>
      {props.data.allowedExtensions?.trim() && props.data.excludedExtensions?.trim() ? <p className="text-[11px] text-amber-600 dark:text-amber-400">{props.t("sources.allowedPriority", "Czkawka core 在允许列表非空时优先使用允许列表；排除扩展名暂不参与匹配。")}</p> : null}
      <div className="grid grid-cols-2 gap-2">
        <Field label={props.t("sources.minimumSize", "最小文件大小（B）")}>
          <Input type="number" min={0} value={props.data.minimumFileSize ?? "1"} onChange={(event) => props.patch({ minimumFileSize: event.currentTarget.value })} />
        </Field>
        <Field label={props.t("sources.maximumSize", "最大文件大小（B）")}>
          <Input type="number" min={1} value={props.data.maximumFileSize ?? ""} placeholder={props.t("common.unlimited", "不限")} onChange={(event) => props.patch({ maximumFileSize: event.currentTarget.value })} />
        </Field>
      </div>
      <Field label={props.t("sources.threads", "扫描线程（0 = 自动）")}>
        <Input aria-label="czkawka scan threads" type="number" min={0} max={256} value={props.data.threadCount ?? "0"} onChange={(event) => props.patch({ threadCount: event.currentTarget.value })} />
        <p className="text-[11px] leading-relaxed text-muted-foreground">{props.t("sources.threadsHint", "线程池在本进程首次 native 扫描时初始化；修改后请重启桌面端再扫描。")}</p>
      </Field>
      <SwitchLine label={props.t("sources.recursive", "递归扫描")} checked={props.data.recursive ?? true} onChange={(recursive) => props.patch({ recursive })} />
      <SwitchLine label={props.t("sources.useCache", "使用缓存")} checked={props.data.useCache ?? true} onChange={(useCache) => props.patch({ useCache })} />
      <Field label={props.t("sources.referencePathKeywords", "参考路径关键词")}>
        <Input value={props.data.referencePathKeywords ?? "#compare"} placeholder="#compare" onChange={(event) => props.patch({ referencePathKeywords: event.currentTarget.value })} />
        <p className="text-[11px] leading-relaxed text-muted-foreground">{props.t("sources.referencePathKeywordsHint", "新增目录包含任一关键词时自动标记为参考；多个关键词用逗号、分号或换行分隔。")}</p>
      </Field>
      <SwitchLine label={props.t("sources.reversePathDisplay", "反向显示路径")} checked={props.data.reversePathDisplay ?? false} onChange={(reversePathDisplay) => props.patch({ reversePathDisplay })} />
      <SwitchLine label={props.t("sources.tableWrapText", "表格文字折行")} checked={props.data.tableWrapText ?? false} onChange={(tableWrapText) => props.patch({ tableWrapText })} />
      <AlgorithmFields {...props} />
    </div>
  )
}

function ScanPresetManager(props: View) {
  const presets = props.data.scanPresets ?? []
  const active = presets.find((preset) => preset.id === props.data.activeScanPresetId)
  const [name, setName] = useState(active?.name ?? "")
  const [transferText, setTransferText] = useState("")
  const [error, setError] = useState("")
  function apply(id: string) {
    const preset = presets.find((item) => item.id === id)
    if (!preset) return
    setName(preset.name)
    setError("")
    props.patch({
      ...(czkawkaScanPresetToValues(preset) as Partial<CzkawkaCardState>),
      activeScanPresetId: preset.id
    })
  }
  function save(overwrite: boolean) {
    try {
      const saved = czkawkaScanPresetFromValues(name, props.data as Record<string, unknown>, { presets, id: overwrite ? active?.id : undefined })
      setName(saved.preset.name)
      setError("")
      props.patch({
        scanPresets: saved.presets,
        activeScanPresetId: saved.preset.id
      })
    } catch (caught) {
      setError(message(caught))
    }
  }
  function remove() {
    if (!active) return
    props.patch({
      scanPresets: deleteCzkawkaScanPreset(presets, active.id),
      activeScanPresetId: undefined
    })
    setName("")
    setError("")
  }
  function importPresets() {
    try {
      const imported = importCzkawkaScanPresets(transferText, presets)
      props.patch({ scanPresets: imported })
      setError("")
    } catch (caught) {
      setError(message(caught))
    }
  }
  return (
    <details className="rounded-md border bg-muted/20 p-2">
      <summary className="cursor-pointer text-xs font-medium">{props.t("presets.title", "扫描配置预设")} · {presets.length}</summary>
      <div className="mt-2 grid gap-2">
        {presets.length ? (
          <Field label={props.t("presets.active", "活动预设")}>
            <Select value={active?.id ?? ""} onValueChange={apply}>
              <SelectTrigger aria-label="active scan preset">
                <SelectValue placeholder={props.t("presets.choose", "选择预设")} />
              </SelectTrigger>
              <SelectContent>
                {presets.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {preset.name} · {toolMeta(preset.tool, props.t).label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ) : null}
        <Field label={props.t("presets.name", "预设名称")}>
          <Input aria-label="scan preset name" value={name} onChange={(event) => setName(event.currentTarget.value)} />
        </Field>
        <div className="grid grid-cols-3 gap-1">
          <Button size="xs" variant="outline" onClick={() => save(false)}>
            {props.t("presets.create", "新建")}
          </Button>
          <Button disabled={!active} size="xs" variant="outline" onClick={() => save(true)}>
            {props.t("presets.overwrite", "覆盖")}
          </Button>
          <Button disabled={!active} size="xs" variant="ghost" onClick={remove}>
            {props.t("presets.delete", "删除")}
          </Button>
        </div>
        <Field label={props.t("presets.transfer", "导入 / 导出 JSON")}>
          <Textarea aria-label="scan preset transfer" className="min-h-24 font-mono text-[10px]" value={transferText} onChange={(event) => setTransferText(event.currentTarget.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-1">
          <Button
            disabled={!presets.length}
            size="xs"
            variant="outline"
            onClick={() => {
              setTransferText(exportCzkawkaScanPresets(presets))
              setError("")
            }}
          >
            {props.t("presets.export", "导出")}
          </Button>
          <Button disabled={!transferText.trim()} size="xs" variant="outline" onClick={importPresets}>
            {props.t("presets.importMerge", "导入合并")}
          </Button>
        </div>
        {error ? (
          <div role="alert" className="text-xs text-destructive">
            {error}
          </div>
        ) : null}
        <div className="text-[10px] text-muted-foreground">{props.t("presets.persistHint", "活动预设及已应用字段随节点状态持久化，重新打开时自动恢复。")}</div>
      </div>
    </details>
  )
}

function PreviewSettingsCard(props: View) {
  const supportsThumbnailToggle = props.tool === "duplicate-files" || props.tool === "similar-images" || props.tool === "similar-videos"
  return (
    <div className="grid gap-2 text-xs">
      {supportsThumbnailToggle ? <SwitchLine label={props.t("preview.thumbnails", "显示结果缩略图")} checked={props.thumbnailEnabled} onChange={props.setThumbnailEnabled} /> : null}
      <SwitchLine label={props.t("preview.fixed", "固定媒体预览")} checked={props.previewPanelEnabled} onChange={props.setPreviewPanelEnabled} />
      <div className="text-muted-foreground">
        {props.t("preview.currentTool", "当前工具：{{tool}}", { tool: toolMeta(props.tool, props.t).label })}
        {props.t("preview.hint", "。启用后图片、视频和音频在结果侧栏中打开。")}
      </div>
    </div>
  )
}

function SelectionCard(props: View) {
  return (
    <div className="grid gap-3">
      <div className="text-xs text-muted-foreground">
        {props.t("selection.selectedPrefix", "已选择")} <strong className="text-foreground">{props.selectedPaths.length}</strong> {props.t("selection.pathSuffix", "个路径。")}
      </div>
      <SelectionAssistantControl {...props} />
      <Field label={props.t("selection.smart", "智能选择")}>
        <div className="grid grid-cols-2 gap-1">
          <Button size="xs" variant="outline" onClick={() => props.applySmartSelection("all-except-first")}>
            {props.t("selection.allButFirst", "每组除首个")}
          </Button>
          <Button size="xs" variant="outline" onClick={() => props.applySmartSelection("all-except-newest")}>
            {props.t("selection.keepNewest", "保留最新")}
          </Button>
          <Button size="xs" variant="outline" onClick={() => props.applySmartSelection("all-except-biggest")}>
            {props.t("selection.keepLargest", "保留最大")}
          </Button>
          <Button size="xs" variant="ghost" onClick={() => props.patch({ operation: null })}>
            <X />
            {props.t("selection.clear", "清除操作")}
          </Button>
        </div>
      </Field>
    </div>
  )
}

function OperationsCard(props: View) {
  const liveDeleteDescription = props.data.deleteMode === "permanent" ? props.t("operations.deletePermanentDescription", "将永久删除 {{count}} 个路径，此操作不可撤销。", { count: props.selectedPaths.length }) : props.t("operations.deleteTrashDescription", "将把 {{count}} 个路径移入系统回收站。", { count: props.selectedPaths.length })
  const organizePlan = buildCzkawkaGroupOrganizePlan(props.filterResult.groups, props.selectedPaths, {
    subfolderTemplate: props.data.organizeSubfolderTemplate,
    skipSingleFileFolders: props.data.organizeSkipSingleFileFolders
  })
  const visibleEntries = props.filterResult.groups.flatMap((group) => group.entries)
  const exportEntries = props.data.exportScope === "all" ? (props.result?.entries ?? []) : props.data.exportScope === "visible" ? visibleEntries : (props.result?.entries ?? []).filter((entry) => props.selectedPaths.includes(entry.path))
  const renameItems = (props.result?.entries ?? [])
    .filter((entry) => props.selectedPaths.includes(entry.path) && entry.properExtension)
    .map((entry) => ({
      path: entry.path,
      properExtension: entry.properExtension!
    }))
  return (
    <div className="grid gap-3">
      <div className="text-xs text-muted-foreground">{props.t("operations.dryRunHint", "删除、移动和改名默认只生成可检查的逐项计划。")}</div>
      <SwitchLine label={props.t("operations.dryRun", "仅预演操作")} checked={props.data.dryRun ?? true} onChange={(dryRun) => props.patch({ dryRun })} />
      <Field label={props.t("operations.deleteMode", "删除方式")}>
        <Select
          value={props.data.deleteMode ?? "trash"}
          onValueChange={(deleteMode) =>
            props.patch({
              deleteMode: deleteMode as CzkawkaCardState["deleteMode"]
            })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="trash">{props.t("operations.trash", "移入回收站")}</SelectItem>
            <SelectItem value="permanent">{props.t("operations.permanent", "永久删除")}</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field label={props.t("operations.destination", "移动或复制到")}>
        <div className="flex gap-1">
          <Input value={props.data.destinationDirectory ?? ""} placeholder="D:/Review" onChange={(event) => props.patch({ destinationDirectory: event.currentTarget.value })} />
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button aria-label="move selected" disabled={!props.selectedPaths.length || !props.data.destinationDirectory || props.running} size="icon-sm" variant="outline">
                <MoveRight />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{(props.data.dryRun ?? true) ? props.t("operations.planMoveTitle", "生成移动/复制计划？") : props.t("operations.executeMoveTitle", "执行移动/复制？")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {props.t("operations.target", "目标：{{path}}。", { path: props.data.destinationDirectory })}{(props.data.dryRun ?? true) ? props.t("operations.noChanges", "当前不会修改文件。") : props.t("operations.liveMoveDescription", "将真实{{action}} {{count}} 项。", { action: props.data.copyMode ? props.t("operations.copyVerb", "复制") : props.t("operations.moveVerb", "移动"), count: props.selectedPaths.length })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{props.t("common.cancel", "取消")}</AlertDialogCancel>
                <AlertDialogAction onClick={() => void props.executeOperation("move")}>{props.t("operations.confirmMove", "确认移动")}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </Field>
      <SwitchLine label={props.t("operations.copyInstead", "复制而非移动")} checked={props.data.copyMode ?? false} onChange={(copyMode) => props.patch({ copyMode })} />
      <SwitchLine label={props.t("operations.preserveStructure", "保留原目录结构")} checked={props.data.preserveStructure ?? false} onChange={(preserveStructure) => props.patch({ preserveStructure })} />
      <Field label={props.t("operations.conflict", "目标冲突")}>
        <Select
          value={props.data.conflictPolicy ?? "skip"}
          onValueChange={(conflictPolicy) =>
            props.patch({
              conflictPolicy: conflictPolicy as CzkawkaCardState["conflictPolicy"]
            })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="skip">{props.t("operations.skip", "跳过")}</SelectItem>
            <SelectItem value="overwrite">{props.t("operations.overwrite", "覆盖")}</SelectItem>
            <SelectItem value="rename">{props.t("operations.autoRename", "自动改名")}</SelectItem>
            <SelectItem value="error">{props.t("operations.reportError", "报告错误")}</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      {props.tool === "similar-images" ? (
        <div className="grid gap-2 rounded-md border p-2">
          <Field label={props.t("operations.organizeTemplate", "相似组子目录模板")}>
            <Input
              value={props.data.organizeSubfolderTemplate ?? "variants_{groupId}"}
              onChange={(event) =>
                props.patch({
                  organizeSubfolderTemplate: event.currentTarget.value
                })
              }
            />
          </Field>
          <SwitchLine label={props.t("operations.skipSingleFolder", "跳过仅一个文件的来源目录")} checked={props.data.organizeSkipSingleFileFolders ?? true} onChange={(organizeSkipSingleFileFolders) => props.patch({ organizeSkipSingleFileFolders })} />
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button disabled={!organizePlan.items.length || props.running} size="sm" variant="outline">
                <ArchiveX />
                {props.t("operations.organizeGroups", "整理相似组（{{count}}）", { count: organizePlan.items.length })}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{(props.data.dryRun ?? true) ? props.t("operations.planOrganizeTitle", "生成相似组整理计划？") : props.t("operations.executeOrganizeTitle", "执行相似组整理？")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {props.t("operations.organizeDescription", "将 {{groups}} 组、{{items}} 项整理到 {{folders}} 个子目录。", { groups: organizePlan.selectedGroupCount, items: organizePlan.items.length, folders: organizePlan.targetFolderCount })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="grid max-h-48 gap-1 overflow-auto rounded-md border p-2 text-xs">
                {organizePlan.items.slice(0, 12).map((item) => (
                  <div key={item.path} className="grid">
                    <span className="truncate font-mono">{item.path}</span>
                    <span className="truncate font-mono text-muted-foreground">→ {item.destination}</span>
                  </div>
                ))}
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel>{props.t("common.cancel", "取消")}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() =>
                    void props.executeOperation("move", {
                      selectedPaths: organizePlan.items.map((item) => item.path),
                      destinationItems: organizePlan.items
                    })
                  }
                >
                  {props.t("operations.confirmOrganize", "确认整理")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ) : null}
      {props.tool === "bad-extensions" ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button disabled={!renameItems.length || props.running} size="sm" variant="outline">
              {props.t("operations.fixExtensions", "修正扩展名（{{count}}）", { count: renameItems.length })}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{(props.data.dryRun ?? true) ? props.t("operations.planRenameTitle", "生成扩展名修正计划？") : props.t("operations.executeRenameTitle", "执行扩展名修正？")}</AlertDialogTitle>
              <AlertDialogDescription>{props.t("operations.renameDescription", "将按扫描结果修正 {{count}} 项。执行后如需撤销，请根据操作详情中的源/目标路径反向改名。", { count: renameItems.length })}</AlertDialogDescription>
            </AlertDialogHeader>
            <div className="grid max-h-48 gap-1 overflow-auto rounded-md border p-2 text-xs">
              {renameItems.slice(0, 12).map((item) => (
                <div key={item.path} className="font-mono">
                  {item.path} → .{item.properExtension}
                </div>
              ))}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>{props.t("common.cancel", "取消")}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() =>
                  void props.executeOperation("rename", {
                    renameItems,
                    selectedPaths: renameItems.map((item) => item.path)
                  })
                }
              >
                {props.t("operations.confirmRename", "确认改名")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
      <Field label={props.t("operations.exportResults", "导出结果")}>
        <div className="grid gap-1">
          <Select
            value={props.data.exportScope ?? "selected"}
            onValueChange={(exportScope) =>
              props.patch({
                exportScope: exportScope as CzkawkaCardState["exportScope"]
              })
            }
          >
            <SelectTrigger aria-label="export scope">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="selected">{props.t("operations.scopeSelected", "选择项")}</SelectItem>
              <SelectItem value="visible">{props.t("operations.scopeVisible", "当前视图")}</SelectItem>
              <SelectItem value="all">{props.t("operations.scopeAll", "全部结果")}</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex gap-1">
            <Input value={props.data.outputPath ?? ""} placeholder="D:/result.json" onChange={(event) => props.patch({ outputPath: event.currentTarget.value })} />
            <Button
              aria-label="save selected"
              disabled={!exportEntries.length || !props.data.outputPath || props.running}
              size="icon-sm"
              variant="outline"
              onClick={() =>
                void props.executeOperation("save", {
                  exportEntries,
                  selectedPaths: exportEntries.map((entry) => entry.path),
                  exportScope: props.data.exportScope ?? "selected"
                })
              }
            >
              <Save />
            </Button>
          </div>
        </div>
      </Field>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button disabled={!props.selectedPaths.length || props.running} variant="destructive">
            <Trash2 />
            {props.t("operations.deleteSelected", "删除已选")}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{(props.data.dryRun ?? true) ? props.t("operations.planDeleteTitle", "生成删除计划？") : props.data.deleteMode === "permanent" ? props.t("operations.deletePermanentTitle", "永久删除已选文件？") : props.t("operations.deleteTrashTitle", "将已选文件移入回收站？")}</AlertDialogTitle>
            <AlertDialogDescription>{(props.data.dryRun ?? true) ? props.t("operations.dryRunDescription", "当前是预演模式，不会修改文件。") : liveDeleteDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{props.t("common.cancel", "取消")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void props.executeOperation("delete")}>
              {props.t("operations.confirmDelete", "确认删除")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {props.data.operation ? <OperationResultDetails data={props.data.operation} t={props.t} /> : null}
    </div>
  )
}

function OperationResultDetails({ data, t }: { data: CzkawkaData; t: View["t"] }) {
  return (
    <div className="grid gap-2 rounded-md border bg-muted/30 p-2 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-medium">{t("operations.lastDetails", "上次操作详情")}</span>
        <span className="text-muted-foreground">
          {t("operations.resultSummary", "{{affected}} 成功或计划 / {{errors}} 错误", { affected: data.affectedCount, errors: data.errorCount })}
        </span>
      </div>
      <div className="grid max-h-48 gap-1 overflow-auto">
        {data.entries.map((entry) => (
          <div key={entry.id} className="grid gap-0.5 rounded border bg-background/70 p-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-mono">{entry.path}</span>
              <Badge variant={entry.status === "error" ? "destructive" : entry.status === "skipped" ? "secondary" : "outline"}>{entry.status ?? "unknown"}</Badge>
            </div>
            {entry.secondaryPath ? <div className="truncate font-mono text-muted-foreground">→ {entry.secondaryPath}</div> : null}
            {entry.error ? <div className="text-destructive">{entry.error}</div> : null}
          </div>
        ))}
      </div>
    </div>
  )
}

function SelectionAssistantControl(props: View) {
  return <CzkawkaSelectionAssistant open={props.selectionAssistantOpen} config={props.selectionConfig} stats={props.selectionStats} canUndo={props.selectionHistory.past.length > 0} canRedo={props.selectionHistory.future.length > 0} onOpenChange={props.setSelectionAssistantOpen} onConfigChange={props.setSelectionConfig} onApply={props.applySelectionRule} onUndo={props.undoSelection} onRedo={props.redoSelection} onClear={() => props.setSelectedPaths([])} onInvert={props.invertSelection} onSelectAll={props.selectAllVisible} />
}

function StatusBar(props: View) {
  return (
    <div className="flex shrink-0 items-center gap-2 rounded-md border bg-muted/20 px-2 py-1">
      <Progress className="h-1.5 flex-1" value={props.data.progress ?? 0} />
      <span className="max-w-[55%] truncate text-[11px] text-muted-foreground">{props.data.progressText || props.t("progress.ready", "Czkawka 已就绪。")}</span>
      {props.data.phase === "error" ? <AlertTriangle className="size-3.5 text-destructive" /> : null}
    </div>
  )
}
function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-card p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("mt-1 font-mono text-sm font-semibold", accent && "text-primary")}>{value}</div>
    </div>
  )
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </label>
  )
}
function SwitchLine({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-2 rounded-md border bg-background/50 px-2 py-1.5 text-xs">
      <span>{label}</span>
      <Switch checked={checked} size="sm" onCheckedChange={onChange} />
    </label>
  )
}
function SectionHeader({ icon, title, action }: { icon: typeof Search; title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center border-b px-2 py-1">
      <div className="min-w-0 flex-1">
        <SectionTitle icon={icon} title={title} />
      </div>
      {action}
    </div>
  )
}
function SectionTitle({ icon: Icon, title }: { icon: typeof Search; title: string }) {
  return (
    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em]">
      <Icon className="size-3.5 text-primary" />
      {title}
    </div>
  )
}

export function scanInput(tool: CzkawkaTool, data: CzkawkaCardState): CzkawkaInput {
  return createCzkawkaScanInput(tool, data as Record<string, unknown>)
}
function toolMeta(tool: CzkawkaTool, t?: View["t"]) {
  const meta = TOOLS.find((item) => item.id === tool) ?? TOOLS[0]!
  return t ? { ...meta, label: t(meta.labelKey, meta.label), short: t(meta.shortKey, meta.short) } : meta
}
function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  const units = ["KB", "MB", "GB", "TB"]
  let value = bytes / 1024,
    unit = units[0]!
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024
    unit = units[index]!
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`
}
function getData(host: NodeComponentProps<CzkawkaCardState>["host"], compId: string): CzkawkaCardState {
  return host.state?.getData?.() ?? host.getData<CzkawkaCardState>(compId) ?? {}
}

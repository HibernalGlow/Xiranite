import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import type { NodeComponentProps } from "@xiranite/contract"
import { applyCzkawkaDirectorySelection, applyCzkawkaGroupSelection, applyCzkawkaTextSelection, calculateCzkawkaSelectionStats, createDefaultCzkawkaSelectionAssistantConfig, invertCzkawkaSelection, selectAllCzkawkaEntries } from "@xiranite/node-czkawka/selection-assistant"
import { applyCzkawkaFilters, normalizeCzkawkaFilterState } from "@xiranite/node-czkawka/filters"
import { normalizeCzkawkaCardLayout, type CzkawkaCardLayout } from "@xiranite/node-czkawka/card-layout"
import { createDefaultCzkawkaFloatingPanel, normalizeCzkawkaFloatingPanel, type CzkawkaFloatingPanelState, type CzkawkaFloatingViewport } from "@xiranite/node-czkawka/floating-panel"
import { createCzkawkaOperationInput } from "@xiranite/node-czkawka/tool-options"
import { createCzkawkaWorkbench, type CzkawkaWorkbench, type CzkawkaWorkbenchPersistencePatch } from "@xiranite/node-czkawka/workbench"
import { normalizeCzkawkaWorkspaceLayout, type CzkawkaWorkspaceLayout } from "@xiranite/node-czkawka/workspace-layout"
import { smartSelect, type CzkawkaAction, type CzkawkaInput, type CzkawkaRuntimeInfo, type CzkawkaTool } from "@xiranite/node-czkawka/core"

import { CZKAWKA_STATE_VERSION, czkawkaStateMigrationPatch, normalizeCzkawkaCardState } from "./state"
import type { CzkawkaCardState, CzkawkaSimilarImagesViewMode } from "./types"
import { scanInput, type CzkawkaView } from "./views/model"

type Host = NodeComponentProps<CzkawkaCardState>["host"]

interface UseCzkawkaWorkbenchOptions {
  compId: string
  host: Host
  surface: { width: number; height: number; mode: string }
  t: CzkawkaView["t"]
  language: CzkawkaView["language"]
}

export function useCzkawkaWorkbench({ compId, host, surface, t, language }: UseCzkawkaWorkbenchOptions): CzkawkaView {
  const rawData = getData(host, compId)
  const data = normalizeCzkawkaCardState(rawData)
  const tool = data.tool ?? "duplicate-files"
  const patch = useCallback((next: Partial<CzkawkaCardState>) => {
    if (host.state?.patchData) host.state.patchData(next)
    else host.patchData(compId, next)
  }, [compId, host])
  const persistWorkbenchPatch = useCallback((next: CzkawkaWorkbenchPersistencePatch) => {
    const { cacheRegeneration, imageComparison, ...cardPatch } = next
    patch({
      ...cardPatch,
      ...(cacheRegeneration ? {
        czkawkaCacheSourceVersion: cacheRegeneration.sourceVersion,
          czkawkaCacheRegenerationNoticeSourceVersion: cacheRegeneration.noticeSourceVersion,
      } : {}),
      ...(imageComparison ? {
        imageComparisonMode: imageComparison.mode,
        imageComparisonColorCoding: imageComparison.colorCoding,
      } : {}),
    })
  }, [patch])

  useEffect(() => {
    const migration = czkawkaStateMigrationPatch(rawData)
    if (migration) patch(migration)
  }, [patch, rawData])

  const workbenchRef = useRef<CzkawkaWorkbench>()
  if (!workbenchRef.current) {
    workbenchRef.current = createCzkawkaWorkbench({
      result: data.result,
      filterStatesByTool: data.filterStatesByTool,
      activityLog: data.activityLog,
      cacheRegeneration: {
        sourceVersion: data.czkawkaCacheSourceVersion,
        noticeSourceVersion: data.czkawkaCacheRegenerationNoticeSourceVersion,
      },
      imageComparison: {
        mode: data.imageComparisonMode,
        colorCoding: data.imageComparisonColorCoding,
      },
    }, { persist: persistWorkbenchPatch })
  }
  const workbench = workbenchRef.current
  workbench.updatePort({
    persist: persistWorkbenchPatch,
    run: host.runner?.run ?? host.actions?.run,
    cancel: host.runner?.cancelCurrent ?? host.actions?.cancelCurrent,
  })
  const subscribe = useCallback((listener: () => void) => workbench.subscribe(listener), [workbench])
  const state = useSyncExternalStore(subscribe, workbench.getState, workbench.getState)

  const [filterPresets, setFilterPresetsState] = useState(() => data.filterPresets ?? [])
  const [selectionConfig, setSelectionConfigState] = useState(() => data.selectionAssistantConfig ?? createDefaultCzkawkaSelectionAssistantConfig())
  const [selectionAssistantOpen, setSelectionAssistantOpenState] = useState(data.selectionAssistantOpen ?? false)
  const [cardLayout, setCardLayoutState] = useState<CzkawkaCardLayout>(() => normalizeCzkawkaCardLayout(data.cardLayout))
  const [workspaceLayout, setWorkspaceLayoutState] = useState<CzkawkaWorkspaceLayout>(() => normalizeCzkawkaWorkspaceLayout(data.workspaceLayout))
  const [previewPanelEnabledByTool, setPreviewPanelEnabledByTool] = useState<Partial<Record<CzkawkaTool, boolean>>>(() => data.previewPanelEnabledByTool ?? {})
  const [thumbnailEnabledByTool, setThumbnailEnabledByTool] = useState<Partial<Record<CzkawkaTool, boolean>>>(() => data.thumbnailEnabledByTool ?? {})
  const floatingViewport: CzkawkaFloatingViewport = {
    width: Math.max(320, surface.width || 1200),
    height: Math.max(240, surface.height || 760),
  }
  const [floatingAnalysisPanelState, setFloatingAnalysisPanelState] = useState<CzkawkaFloatingPanelState>(() => data.floatingAnalysisPanel ?? createDefaultCzkawkaFloatingPanel(floatingViewport))
  const [filterNow] = useState(Date.now)
  const [similarImagesViewMode, setSimilarImagesViewModeState] = useState<CzkawkaSimilarImagesViewMode>(() => data.similarImagesViewMode ?? "images")
  const [nativeCapabilities, setNativeCapabilities] = useState<ReadonlySet<string>>(() => new Set())

  useEffect(() => {
    let active = true
    void host.runner?.getInfo?.<CzkawkaRuntimeInfo>("czkawka").then(
      (info) => { if (active) setNativeCapabilities(new Set(info.capabilities)) },
      () => { if (active) setNativeCapabilities(new Set()) },
    )
    return () => { active = false }
  }, [host.runner])

  const result = workbench.getResult(tool, data.result)
  const selectedPaths = workbench.getSelectedPaths(tool)
  const filterState = normalizeCzkawkaFilterState(workbench.getFilterState(tool) ?? data.filterStatesByTool?.[tool])
  const filterResult = applyCzkawkaFilters(result?.groups ?? [], selectedPaths, filterState, filterNow, tool)
  const selectionHistory = workbench.getSelectionHistory(tool)
  const selectionStats = calculateCzkawkaSelectionStats(filterResult.groups, selectedPaths)
  const compact = surface.mode === "compact" || surface.mode === "portrait" || surface.width < 760

  function setCardLayout(next: CzkawkaCardLayout) {
    setCardLayoutState(next)
    patch({ cardLayout: next })
  }

  function setWorkspaceLayout(next: CzkawkaWorkspaceLayout) {
    const normalized = normalizeCzkawkaWorkspaceLayout(next)
    setWorkspaceLayoutState(normalized)
    patch({ schemaVersion: CZKAWKA_STATE_VERSION, workspaceLayout: normalized })
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

  function setSimilarImagesViewMode(mode: CzkawkaSimilarImagesViewMode) {
    setSimilarImagesViewModeState(mode)
    patch({ similarImagesViewMode: mode })
  }

  function setFloatingAnalysisPanel(next: CzkawkaFloatingPanelState) {
    const normalized = normalizeCzkawkaFloatingPanel(next, floatingViewport)
    setFloatingAnalysisPanelState(normalized)
    patch({ floatingAnalysisPanel: normalized })
  }

  function setFilterState(next: typeof filterState) {
    workbench.setFilterState(tool, next)
  }

  function setFilterText(value: string) {
    setFilterState({ ...filterState, text: { ...filterState.text, enabled: Boolean(value), pattern: value } })
  }

  function setFilterPresets(next: typeof filterPresets) {
    setFilterPresetsState(next)
    patch({ filterPresets: next })
  }

  function setSelectionConfig(next: typeof selectionConfig) {
    setSelectionConfigState(next)
    patch({ selectionAssistantConfig: next })
  }

  function setSelectionAssistantOpen(open: boolean) {
    setSelectionAssistantOpenState(open)
    patch({ selectionAssistantOpen: open })
  }

  function applySelectionRule(kind: "group" | "text" | "directory") {
    const mode = kind === "directory" && selectionConfig.directory.mode === "exclude-directory" ? "remove" : selectionConfig.applyMode
    const selection = kind === "group"
      ? applyCzkawkaGroupSelection(filterResult.groups, selectedPaths, selectionConfig.group, mode)
      : kind === "text"
        ? applyCzkawkaTextSelection(filterResult.groups, selectedPaths, selectionConfig.text, mode)
        : applyCzkawkaDirectorySelection(filterResult.groups, selectedPaths, selectionConfig.directory, mode)
    if (!selection.error) workbench.setSelectedPaths(tool, selection.paths)
    return selection
  }

  async function executeScan() {
    await workbench.executeScan(tool, scanInput(tool, data), {
      noRoots: t("errors.noRoots", "请至少添加一个包含目录。"),
      noRuntime: t("errors.noRuntime", "当前环境没有本地运行能力。"),
      cacheRegeneration: t("notices.cacheRegeneration", "Czkawka 12 将为本次扫描重新生成不兼容的缓存项。"),
      starting: t("progress.starting", "正在启动 Czkawka 扫描。"),
      stopping: t("progress.stopping", "正在请求停止 Czkawka 扫描..."),
    })
  }

  async function cancelScan() {
    await workbench.cancelScan(tool, { stopping: t("progress.stopping", "正在请求停止 Czkawka 扫描...") })
  }

  async function executeOperation(action: CzkawkaAction, overrides: Partial<CzkawkaInput> = {}) {
    const operationPaths = overrides.selectedPaths ?? selectedPaths
    const input = {
      ...createCzkawkaOperationInput(action as Exclude<CzkawkaAction, "scan">, { ...data, tool, selectedPaths: operationPaths }),
      ...overrides,
    }
    await workbench.executeOperation(tool, action, input, { description: (kind, count) => `${kind} ${count} item(s)...` })
  }

  return {
    data,
    tool,
    nativeCapabilities,
    result,
    filterState,
    filterResult,
    filterPresets,
    selectionConfig,
    selectionStats,
    selectionHistory,
    selectionAssistantOpen,
    activityLog: state.activityLog,
    cardLayout,
    workspaceLayout,
    similarImagesViewMode,
    imageComparison: state.imageComparison,
    previewPanelEnabled: previewPanelEnabledByTool[tool] ?? false,
    thumbnailEnabled: thumbnailEnabledByTool[tool] ?? true,
    floatingAnalysisPanel: normalizeCzkawkaFloatingPanel(floatingAnalysisPanelState, floatingViewport),
    floatingViewport,
    floatingAvailable: !compact,
    canResizeWorkspace: !compact,
    running: state.running,
    selectedPaths,
    filterText: filterState.text.pattern,
    panel: state.panel,
    t,
    language,
    getFileUrl: host.localFiles?.getUrl,
    pickFiles: host.localFiles?.pickFiles,
    pickDirectory: host.localFiles?.pickDirectory,
    pickDirectories: host.localFiles?.pickDirectories,
    copyText: host.clipboard?.writeText,
    copyFiles: host.clipboard?.writeFiles,
    openPath: host.localFiles?.openPath,
    revealPath: host.localFiles?.revealPath,
    patch,
    clearActivityLog: workbench.clearActivityLog,
    setCardLayout,
    setWorkspaceLayout,
    setSimilarImagesViewMode,
    openImageComparison: (path) => workbench.openImageComparison(result?.groups ?? [], path),
    closeImageComparison: () => workbench.closeImageComparison(),
    setImageComparisonMode: (mode) => workbench.setImageComparisonMode(mode),
    setImageComparisonColorCoding: (colorCoding) => workbench.setImageComparisonColorCoding(colorCoding),
    setImageComparisonTarget: (path) => workbench.setImageComparisonTarget(result?.groups ?? [], path),
    setImageComparisonSwipe: (swipePercent) => workbench.setImageComparisonSwipe(swipePercent),
    setImageComparisonOpacity: (onionOpacity) => workbench.setImageComparisonOpacity(onionOpacity),
    setPreviewPanelEnabled,
    setThumbnailEnabled,
    setFloatingAnalysisPanel,
    setPanel: workbench.setPanel,
    setSelectedPaths: (paths) => workbench.setSelectedPaths(tool, paths),
    setFilterState,
    setFilterPresets,
    setFilterText,
    setSelectionConfig,
    setSelectionAssistantOpen,
    applySelectionRule,
    undoSelection: () => workbench.undoSelection(tool),
    redoSelection: () => workbench.redoSelection(tool),
    invertSelection: () => workbench.setSelectedPaths(tool, invertCzkawkaSelection(filterResult.groups, selectedPaths)),
    selectAllVisible: () => workbench.setSelectedPaths(tool, selectAllCzkawkaEntries(filterResult.groups)),
    executeScan,
    cancelScan,
    executeOperation,
    applySmartSelection: (strategy) => result && workbench.setSelectedPaths(tool, smartSelect(result.groups, strategy)),
  }
}

function getData(host: Host, compId: string): CzkawkaCardState {
  return host.state?.getData?.() ?? host.getData<CzkawkaCardState>(compId) ?? {}
}

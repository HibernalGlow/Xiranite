import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import type { NodeComponentProps, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type { XlchemyAction, XlchemyData, XlchemyFormat, XlchemyInput } from "@xiranite/node-xlchemy/core"
import { DEFAULT_FILENAME_RULES, DEFAULT_RAM_OPTIMIZER_RULES, normalizeXlchemyInput } from "@xiranite/node-xlchemy/core"
import type { LucideIcon } from "lucide-react"
import { Activity, AlertTriangle, CheckCircle2, CircleCheck, CircleX, FileImage, Files, FolderInput, Gauge, Images, Play, RefreshCw, RotateCcw, Settings2, SlidersHorizontal, Sparkles, Square, Tags, Terminal, Wrench } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ChoiceControlField } from "@/components/ui/choice-control"
import { Field, FieldContent, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { NodeConfigPopover } from "@/nodes/shared/NodeConfigPopover"
import { ModulePanel } from "@/components/ui/module-panel"
import { useNodeI18n } from "@/nodes/shared/useNodeI18n"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import { ENVIRONMENT_TARGETS, FORMATS } from "./constants"
import type { XlchemyCardState, XlchemyCustomPreset } from "./types"
import { XL_CONFIG_FIELDS, XL_FILENAME_CONFIG_FIELDS } from "./types"
import { InputFilesWorkbench } from "./InputFilesWorkbench"
import { ConversionLog, ProgressWorkbench, WorkbenchTelemetry } from "./ProgressAndLogs"
import { DataAnalysis } from "./DataAnalysis"
import { FilenameRuleEditor } from "./FilenameRuleEditor"

export function Component({ compId, host }: NodeComponentProps<XlchemyCardState>) {
  const surface = useNodeSurface()
  const { t } = useNodeI18n("xlchemy")
  const data = getHostData(host, compId)
  const dataRef = useRef(data)
  dataRef.current = data
  const [running, setRunning] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const cancellationRequestedRef = useRef(false)
  const [defaults, setDefaults] = useState<Partial<XlchemyCardState>>()
  const [customPresets, setCustomPresets] = useState<XlchemyCustomPreset[]>([])
  const [configPath, setConfigPath] = useState<string>()
  const [configDirty, setConfigDirty] = useState(false)

  const paths = useMemo(() => splitLines(data.pathsText), [data.pathsText])
  const result = data.result ?? null
  const progress = data.progress ?? 0
  const format = data.format ?? "JPEG XL"
  const compact = surface.mode === "compact" || surface.mode === "portrait"
  const forceCollapsed = compact && surface.height > 0 && surface.height < 160

  async function reloadDefaults() {
    const pending = host.config?.get?.<XlchemyNodeConfig>() ?? host.getNodeConfig?.<XlchemyNodeConfig>()
    const pendingPresets = host.config?.getPresets?.<Record<string, unknown>>()
    try {
      const [response, presetResponse] = await Promise.all([pending, pendingPresets])
      if (response) {
        setDefaults(normalizeXlchemyDefaults(response.config)); setConfigPath(response.path)
        const startup: Partial<XlchemyCardState> = {}
        if (response.config?.disableDownscalingStartup) startup.downscaleEnabled = false
        if (response.config?.disableDeleteStartup) startup.deleteOriginal = false
        if (Object.keys(startup).length) patch(startup)
      }
      if (presetResponse) setCustomPresets(normalizeCustomPresets(presetResponse.presets))
    } catch { /* browser preview */ }
  }

  useEffect(() => { void reloadDefaults() }, [host])
  useEffect(() => {
    if (data.excludedFormatsText === undefined) patch({ excludedFormatsText: DEFAULT_EXCLUDED_FORMATS })
  }, [data.excludedFormatsText])
  useEffect(() => {
    if (!defaults) return
    setConfigDirty(XL_SAVED_FIELDS.some((field) => JSON.stringify(data[field] ?? null) !== JSON.stringify(defaults[field] ?? null)))
  }, [data, defaults])

  function patch(next: Partial<XlchemyCardState>) {
    dataRef.current = { ...dataRef.current, ...next }
    if (host.state?.patchData) host.state.patchData(next)
    else host.patchData(compId, next)
  }

  async function saveDefaults() {
    const config: XlchemyNodeConfig = {}
    for (const field of XL_SAVED_FIELDS) {
      const value = dataRef.current[field]
      if (value !== undefined) (config as Record<string, unknown>)[field] = value
    }
    if (host.config?.save) await host.config.save(config)
    else await host.saveNodeConfig?.(config)
    setDefaults(config)
    setConfigDirty(false)
  }

  function selectPreset(presetId: string) {
    const customPreset = customPresets.find((item) => item.id === presetId)
    if (customPreset) patch({ ...customPreset.values, selectedPreset: customPreset.id })
  }

  function snapshotPresetValues() {
    const values: Partial<XlchemyCardState> = {}
    for (const field of XL_SAVED_FIELDS) {
      if (field === "selectedPreset") continue
      const value = dataRef.current[field]
      if (value !== undefined) (values as Record<string, unknown>)[field] = value
    }
    return values
  }

  async function createCustomPreset(name: string) {
    const createPreset = host.config?.createPreset
    if (!createPreset) throw new Error("当前宿主不支持数据库预设管理。")
    const response = await createPreset({ name, values: snapshotPresetValues() as Record<string, unknown> })
    const preset = normalizeCustomPreset(response.preset)
    if (!preset) throw new Error("后端返回了无效的预设。")
    setCustomPresets((current) => [...current, preset])
    patch({ selectedPreset: preset.id })
  }

  async function renameCustomPreset(id: string, name: string) {
    const updatePreset = host.config?.updatePreset
    if (!updatePreset) throw new Error("当前宿主不支持数据库预设管理。")
    const response = await updatePreset(id, { name })
    const preset = normalizeCustomPreset(response.preset)
    if (!preset) throw new Error("后端返回了无效的预设。")
    setCustomPresets((current) => current.map((item) => item.id === id ? preset : item))
  }

  async function overwriteCustomPreset(id: string) {
    const updatePreset = host.config?.updatePreset
    if (!updatePreset) throw new Error("当前宿主不支持数据库预设管理。")
    const response = await updatePreset(id, { values: snapshotPresetValues() as Record<string, unknown> })
    const preset = normalizeCustomPreset(response.preset)
    if (!preset) throw new Error("后端返回了无效的预设。")
    setCustomPresets((current) => current.map((item) => item.id === id ? preset : item))
  }

  async function deleteCustomPreset(id: string) {
    const deletePreset = host.config?.deletePreset
    if (!deletePreset) throw new Error("当前宿主不支持数据库预设管理。")
    await deletePreset(id)
    setCustomPresets((current) => current.filter((preset) => preset.id !== id))
    if (dataRef.current.selectedPreset === id) patch({ selectedPreset: undefined })
  }

  async function exportCustomPresets() {
    await host.clipboard?.writeText?.(JSON.stringify({ version: 1, nodeId: "xlchemy", presets: customPresets.map(({ name, values }) => ({ name, values })) }, null, 2))
  }

  async function importCustomPresets(serialized: string) {
    const parsed = JSON.parse(serialized) as { nodeId?: string; presets?: Array<{ name?: unknown; values?: unknown }> }
    if (parsed.nodeId && parsed.nodeId !== "xlchemy") throw new Error(`预设属于 ${parsed.nodeId}，不能导入 Xlchemy。`)
    if (!Array.isArray(parsed.presets)) throw new Error("预设 JSON 缺少 presets 数组。")
    for (const item of parsed.presets) {
      if (typeof item.name !== "string" || !item.name.trim() || !item.values || typeof item.values !== "object" || Array.isArray(item.values)) throw new Error("预设名称或 values 无效。")
      const response = await host.config?.createPreset?.({ name: item.name.trim(), values: item.values as Record<string, unknown> })
      const preset = normalizeCustomPreset(response?.preset)
      if (preset) setCustomPresets((current) => [...current, preset])
    }
  }

  async function execute(nextAction: XlchemyAction) {
    if (running) return
    const selected = dataRef.current.selectedPaths
    const input = buildInput(nextAction, selected?.length ? { ...dataRef.current, pathsText: selected.join("\n") } : dataRef.current)
    input.filenameRules = dataRef.current.filenameRules ?? DEFAULT_FILENAME_RULES
    if (nextAction !== "diagnose" && !input.paths.length) { patch({ phase: "error", progressText: t("errors.paths", "请先添加图片文件或文件夹。") }); return }
    const run = host.runner?.run ?? host.actions?.run
    if (!run) { patch({ phase: "error", progressText: t("errors.backend", "GUI 已就绪，等待 Xlchemy 后端执行接口接入。") }); return }
    setRunning(true)
    if (nextAction === "diagnose") patch({ action: nextAction, environment: pendingEnvironment(), environmentCheckedAt: undefined, progressText: "正在检测 PATH 与 slimg CFFI 工具链…" })
    else patch({ action: nextAction, phase: "running", progress: 0, progressText: t("status.start", "正在准备 Xlchemy 转换任务…"), analysisTab: nextAction === "convert" ? "output" : dataRef.current.analysisTab, result: null })
    try {
      const response = await run<XlchemyInput, XlchemyData>("xlchemy", input, (event: NodeRunEvent) => {
        if (event.type === "progress") {
          const currentFile = /^Converting (.+)\.$/.exec(event.message)?.[1]
          const liveResult = readLiveResult(event.data)
          patch({ progress: event.progress ?? 0, progressText: event.message, ...(currentFile ? { currentFile } : {}), ...(liveResult ? { result: liveResult } : {}), logs: [...(dataRef.current.logs ?? []), `${new Date().toTimeString().slice(0, 8)} ${event.message ?? "Progress"}`] })
        }
      }) as NodeRunResult<XlchemyData>
      if (nextAction === "diagnose") patch({ environment: response.data?.environment?.length ? response.data.environment : unavailableEnvironment("运行端待刷新，请重新检测"), environmentCheckedAt: response.data?.environment?.length ? new Date().toISOString() : undefined, progressText: response.data?.environment?.length ? response.message : "运行端尚未加载新版工具检测，请刷新后重试。" })
      else {
        const cancelled = cancellationRequestedRef.current
        const lastFile = response.data?.files.at(-1)
        const sizeChange = lastFile?.sourceBytes !== undefined && lastFile.outputBytes !== undefined ? `${formatCompactBytes(lastFile.sourceBytes)} → ${formatCompactBytes(lastFile.outputBytes)}` : undefined
        const next: Partial<XlchemyCardState> = { phase: cancelled ? "cancelled" : response.success ? "completed" : "error", progress: response.success ? 100 : cancelled ? dataRef.current.progress ?? 0 : 0, progressText: sizeChange ? `${response.message} · ${sizeChange}` : response.message, ...(lastFile ? { currentFile: baseName(lastFile.sourcePath) } : {}), result: response.data ?? null }
        if (response.success && nextAction === "convert" && dataRef.current.autoClearCompleted && response.data) {
          const completed = new Set(response.data.files.filter((file) => file.status === "converted").map((file) => file.sourcePath))
          const remaining = splitLines(dataRef.current.pathsText).filter((path) => !completed.has(path))
          next.pathsText = remaining.join("\n"); next.selectedPaths = remaining
        }
        patch(next)
        if (response.success && nextAction === "convert" && dataRef.current.playSoundOnFinish !== false) playCompletionTone(dataRef.current.playSoundVolume ?? 0.5)
      }
    } catch (error) {
      patch(nextAction === "diagnose" ? { progressText: error instanceof Error ? error.message : String(error) } : { phase: "error", progress: 0, progressText: error instanceof Error ? error.message : String(error) })
    } finally { cancellationRequestedRef.current = false; setCancelling(false); setRunning(false) }
  }

  async function cancelCurrentRun() {
    if (!running || cancelling) return
    const cancel = host.runner?.cancelCurrent ?? host.actions?.cancelCurrent
    if (!cancel) { patch({ progressText: t("errors.cancelUnavailable", "当前宿主不支持从节点取消任务。") }); return }
    setCancelling(true)
    cancellationRequestedRef.current = true
    try {
      const cancelled = await cancel()
      if (cancelled) patch({ progressText: t("status.stopping", "正在停止 Xlchemy 转换…") })
      else { cancellationRequestedRef.current = false; patch({ progressText: t("errors.noActiveRun", "没有可取消的 Xlchemy 任务。") }) }
    } catch (error) {
      cancellationRequestedRef.current = false
      patch({ progressText: error instanceof Error ? error.message : String(error) })
    } finally { setCancelling(false) }
  }

  const props: ViewProps = {
    cancelling, configDirty, configPath, customPresets, data, defaults, format, paths, progress, result, running, surfaceMode: surface.mode, t, getFileUrl: host.localFiles?.getUrl, onListFiles: host.localFiles?.list, onPickFiles: host.localFiles?.pickFiles, onPickDirectory: host.localFiles?.pickDirectory, onSubscribeDrops: host.localFiles?.subscribeDrops,
    onCancel: cancelCurrentRun, onExecute: execute, onPatch: patch, onSelectPreset: selectPreset,
    onReloadDefaults: reloadDefaults, onRestoreDefaults: () => patch(defaults ?? XL_FACTORY_DEFAULTS), onSaveDefaults: saveDefaults,
    onOpenConfig: host.config?.openFile ?? host.openConfigFile, onCopyText: (text) => host.clipboard?.writeText?.(text), onCreatePreset: createCustomPreset, onDeletePreset: deleteCustomPreset, onOverwritePreset: overwriteCustomPreset, onRenamePreset: renameCustomPreset, onExportPresets: exportCustomPresets, onImportPresets: importCustomPresets,
  }

  return (
    <TooltipProvider>
      <div ref={surface.ref} className="@container/xlchemy flex h-full min-h-0 w-full overflow-hidden">
        {surface.mode === "collapsed" || forceCollapsed ? <CollapsedView {...props} /> : compact ? <CompactView {...props} portrait={surface.mode === "portrait"} /> : <FullView {...props} />}
      </div>
    </TooltipProvider>
  )
}

type NodeT = ReturnType<typeof useNodeI18n>["t"]
type XlchemyNodeConfig = Partial<XlchemyCardState>
const XL_SAVED_FIELDS = [...XL_CONFIG_FIELDS, ...XL_FILENAME_CONFIG_FIELDS] as const

const XL_FACTORY_DEFAULTS: Partial<XlchemyCardState> = {
  format: "JPEG XL", lossless: false, quality: 60, effort: 7, maxCompression: false, threads: 4,
  outputMode: "source", outputDir: "", filenameRules: DEFAULT_FILENAME_RULES, preserveMetadata: true, preserveStructure: true, preserveTimestamps: false,
  overwrite: false, recursive: true, existingPolicy: "skip", deleteOriginal: false, deleteOriginalMode: "trash",
  intelligentEffort: false, jxlModular: false, jxlVerify: false, jxlPngFallback: true, jxlNormalize: false, jxlNormalizeWhen: "on-fail",
  chromaSubsampling: "default", metadataMode: "encoder-preserve", keepIfLarger: false, copyIfLarger: false,
  smallestPng: true, smallestWebp: true, smallestJxl: true, jpegEncoder: "jpegli", avifEncoder: "aom", avifBitDepth: "auto",
  avifAomIqTune: false, disableProgressiveJpegli: false, autoLosslessJpeg: true, qualityPrecisionSnapping: true,
  disableSorting: false, disableDownscalingStartup: false, disableDeleteStartup: true, enableCustomArgs: false,
  cjxlArgs: "", avifencArgs: "", cjpegliArgs: "", imageMagickArgs: "", ramOptimizer: "dynamic", ramOptimizerRules: DEFAULT_RAM_OPTIMIZER_RULES,
  playSoundOnFinish: true, playSoundVolume: 0.5, autoClearCompleted: false, processingOrder: "original",
  excludedFormatsText: "avif,jxl,webp,gif", downscaleEnabled: false, downscaleMode: "resolution", downscaleWidth: 1920,
  downscaleHeight: 1080, downscalePercent: 50, downscaleFileSizeKb: 500, downscaleShortestSide: 1080,
  downscaleLongestSide: 1920, downscaleMegapixels: 2.1, downscaleResample: "default",
}

function normalizeCustomPresets(value: unknown): XlchemyCustomPreset[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((candidate) => {
    const preset = normalizeCustomPreset(candidate)
    return preset ? [preset] : []
  })
}

function normalizeXlchemyDefaults(value: unknown): Partial<XlchemyCardState> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const defaults: Partial<XlchemyCardState> = {}
  for (const field of XL_SAVED_FIELDS) {
    const fieldValue = (value as Record<string, unknown>)[field]
    if (fieldValue !== undefined) (defaults as Record<string, unknown>)[field] = fieldValue
  }
  return Object.keys(defaults).length ? defaults : undefined
}

function normalizeCustomPreset(candidate: unknown): XlchemyCustomPreset | undefined {
  if (!candidate || typeof candidate !== "object") return undefined
  const { id, name, values } = candidate as Record<string, unknown>
  if (typeof id !== "string" || !id.startsWith("custom-") || typeof name !== "string" || !name.trim() || !values || typeof values !== "object" || Array.isArray(values)) return undefined
  const filtered: Partial<XlchemyCardState> = {}
  for (const field of XL_SAVED_FIELDS) {
    if (field === "selectedPreset") continue
    const fieldValue = (values as Record<string, unknown>)[field]
    if (fieldValue !== undefined) (filtered as Record<string, unknown>)[field] = fieldValue
  }
  return { id, name: name.trim(), values: filtered }
}

interface ViewProps {
  cancelling: boolean; configDirty: boolean; configPath?: string; customPresets: XlchemyCustomPreset[]; data: XlchemyCardState; defaults?: Partial<XlchemyCardState>; format: XlchemyFormat; paths: string[]; progress: number; result: XlchemyData | null; running: boolean; surfaceMode: ReturnType<typeof useNodeSurface>["mode"]; t: NodeT; getFileUrl?: (path: string) => string; onPickFiles?: () => Promise<string[]>; onPickDirectory?: () => Promise<string | undefined>
  onCancel: () => void; onExecute: (action: XlchemyAction) => void; onPatch: (patch: Partial<XlchemyCardState>) => void; onSelectPreset: (presetId: string) => void; onReloadDefaults: () => Promise<void>; onRestoreDefaults: () => void; onSaveDefaults: () => Promise<void>; onOpenConfig?: () => Promise<void> | void; onCopyText: (text: string) => Promise<void> | void | undefined; onCreatePreset: (name: string) => Promise<void>; onDeletePreset: (id: string) => Promise<void>; onOverwritePreset: (id: string) => Promise<void>; onRenamePreset: (id: string, name: string) => Promise<void>; onExportPresets: () => Promise<void>; onImportPresets: (serialized: string) => Promise<void>; onListFiles?: NonNullable<NodeComponentProps<XlchemyCardState>["host"]["localFiles"]>["list"]; onSubscribeDrops?: NonNullable<NodeComponentProps<XlchemyCardState>["host"]["localFiles"]>["subscribeDrops"]
}

function CollapsedView(props: ViewProps) {
  return <div data-testid="xlchemy-collapsed-view" className="flex h-full w-full items-center gap-2 rounded-xl border bg-card px-3 py-2"><Images className="size-5 text-primary" /><div className="min-w-0 flex-1"><div className="flex items-center gap-2 text-xs font-semibold">Xlchemy <Badge variant="outline">{props.format}</Badge></div><div className="truncate text-xs text-muted-foreground">{props.paths.length} 项 · {props.data.lossless ? "无损" : `质量 ${props.data.quality ?? 60}`}</div></div><RunButton compact props={props} /></div>
}

function CompactView(props: ViewProps & { portrait: boolean }) {
  return <div data-testid={props.portrait ? "xlchemy-portrait-view" : "xlchemy-compact-view"} className="flex min-h-0 flex-1 flex-col gap-2 p-2"><Header props={props} /><ScrollArea className="min-h-0 flex-1"><div className="flex flex-col gap-2 pr-2"><WorkbenchCard title={props.t("sections.input", "输入文件")} grow><InputWorkbench props={props} /></WorkbenchCard><ConfigurationCard props={props} /><OperationsCard props={props} /><WorkbenchCard title="数据分析"><DataAnalysis paths={props.paths} result={props.result} activeTab={props.data.analysisTab} onTabChange={(analysisTab) => props.onPatch({ analysisTab })} /></WorkbenchCard><WorkbenchCard title="转换结果"><ResultPanel props={props} /></WorkbenchCard></div></ScrollArea></div>
}

function FullView(props: ViewProps) {
  if (props.surfaceMode === "workspace") return <WorkspaceWorkbench props={props} />
  return (
    <div data-testid="xlchemy-full-view" className="flex min-h-0 flex-1 flex-col gap-2 p-3">
      <Header props={props} />
      <div className="grid min-h-0 flex-1 gap-2 overflow-auto @2xl/xlchemy:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)] @2xl/xlchemy:overflow-hidden">
        <ScrollArea className="min-h-0 @2xl/xlchemy:h-full"><div className="flex flex-col gap-2 pr-2">
            <WorkbenchCard icon={FolderInput} title={props.t("sections.input", "输入文件")} badge={`${props.paths.length} 项`} grow><InputWorkbench props={props} /></WorkbenchCard>
            <OperationsCard props={props} />
            <WorkbenchCard title="数据分析"><DataAnalysis paths={props.paths} result={props.result} activeTab={props.data.analysisTab} onTabChange={(analysisTab) => props.onPatch({ analysisTab })} /></WorkbenchCard>
        </div></ScrollArea>
        <ScrollArea className="min-h-0 @2xl/xlchemy:h-full"><div className="flex flex-col gap-2 pr-2">
            <ConfigurationCard props={props} />
            <WorkbenchCard title="转换结果"><ResultPanel props={props} /></WorkbenchCard>
        </div></ScrollArea>
      </div>
    </div>
  )
}

function WorkspaceWorkbench({ props }: { props: ViewProps }) {
  return <div data-testid="xlchemy-full-view" className="xlchemy-grid flex min-h-0 flex-1 flex-col gap-2 p-3">
    <Header props={props} />
    <div data-testid="xlchemy-workspace-grid" className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)] gap-2 overflow-hidden pt-2">
      <div data-testid="xlchemy-workspace-left-column" className="grid min-h-0 grid-rows-[minmax(0,0.9fr)_minmax(280px,1.1fr)] gap-2">
        <WorkbenchCard fill grow icon={FolderInput} title={props.t("sections.input", "输入文件")} badge={`${props.paths.length} 项`}><InputWorkbench props={props} /></WorkbenchCard>
        <div className="grid min-h-0 grid-cols-[minmax(0,1.15fr)_minmax(240px,0.85fr)] gap-2">
          <OperationsCard fill props={props} />
          <WorkbenchCard fill title="数据分析"><ScrollArea className="h-full"><div className="pr-2"><DataAnalysis paths={props.paths} result={props.result} activeTab={props.data.analysisTab} onTabChange={(analysisTab) => props.onPatch({ analysisTab })} /></div></ScrollArea></WorkbenchCard>
        </div>
      </div>
      <div data-testid="xlchemy-workspace-right-column" className="grid min-h-0 grid-rows-[minmax(0,1fr)_minmax(220px,1fr)] gap-2">
        <ScrollArea className="h-full min-h-0"><div className="flex flex-col gap-2 pt-2 pr-2"><ConfigurationCard props={props} /></div></ScrollArea>
        <WorkbenchCard fill title="转换结果"><ResultPanel props={props} /></WorkbenchCard>
      </div>
    </div>
  </div>
}

function ConfigurationCard({ props }: { props: ViewProps }) {
  return <WorkbenchCard icon={Gauge} title={props.t("sections.formatHub", "校准矩阵")} badge={formatExtension(props.format)}>
    <div className="@container/xlchemy-settings flex flex-col gap-2">
      <WorkbenchTelemetry format={props.format} phase={props.data.phase ?? "idle"} progress={props.progress} result={props.result} running={props.running} threads={props.data.threads ?? 4} />
      <Tabs defaultValue={props.data.settingsTab ?? "common"} className="flex flex-col gap-2" data-testid="xlchemy-settings-tabs" onValueChange={(settingsTab) => props.onPatch({ settingsTab: settingsTab as XlchemyCardState["settingsTab"] })}>
        <TabsList layout="fill"><TabsTrigger aria-label="参数" value="common"><SlidersHorizontal /><span className="hidden @sm/xlchemy-settings:inline">参数</span></TabsTrigger><TabsTrigger aria-label="转换" value="conversion"><Sparkles /><span className="hidden @sm/xlchemy-settings:inline">转换</span></TabsTrigger><TabsTrigger aria-label="文件" value="files"><Files /><span className="hidden @sm/xlchemy-settings:inline">文件</span></TabsTrigger><TabsTrigger aria-label="常规" value="general"><Settings2 /><span className="hidden @sm/xlchemy-settings:inline">常规</span></TabsTrigger></TabsList>
        <TabsContent value="common" className="flex flex-col gap-2"><FormatControls props={props} /><CoreExecutionOptions props={props} /></TabsContent>
        <TabsContent value="conversion" className="grid gap-2 @xl/xlchemy-settings:grid-cols-2"><SettingsGroup label="输入格式"><InputFilterCard props={props} embedded /></SettingsGroup><SettingsGroup label="转换设置"><OriginalConversionSettings props={props} /></SettingsGroup><SettingsGroup label="当前格式优化"><EncoderTuning props={props} /></SettingsGroup></TabsContent>
        <TabsContent value="files" className="grid gap-2 @xl/xlchemy-settings:grid-cols-2"><SettingsGroup label="保存"><SourcePolicies props={props} /></SettingsGroup><SettingsGroup label="缩小"><DownscalingCard props={props} embedded /></SettingsGroup><SettingsGroup label="元数据"><MetadataCard props={props} embedded /></SettingsGroup></TabsContent>
        <TabsContent value="general"><GeneralSettings props={props} /></TabsContent>
      </Tabs>
    </div>
  </WorkbenchCard>
}

function OperationsCard({ fill = false, props }: { fill?: boolean; props: ViewProps }) {
  return <WorkbenchCard fill={fill} title="任务与维护"><div className="@container/xlchemy-operations flex min-h-0 flex-1 flex-col"><Tabs defaultValue="progress" className="flex min-h-0 flex-1 flex-col" data-testid="xlchemy-operations-tabs"><TabsList layout="fill"><TabsTrigger aria-label="进度" value="progress"><Activity /><span className="hidden @sm/xlchemy-operations:inline">进度</span></TabsTrigger><TabsTrigger aria-label="ExifTool" value="exiftool"><Tags /><span className="hidden @sm/xlchemy-operations:inline">ExifTool</span></TabsTrigger><TabsTrigger aria-label="高级" value="advanced"><SlidersHorizontal /><span className="hidden @sm/xlchemy-operations:inline">高级</span></TabsTrigger><TabsTrigger aria-label="环境" value="environment"><Wrench /><span className="hidden @sm/xlchemy-operations:inline">环境</span></TabsTrigger></TabsList><TabsContent value="progress" className="min-h-0 flex-1 pt-1"><ScrollArea className={cn(fill && "h-full")}><div className="pr-2"><ProgressWorkbench data={props.data} format={props.format} paths={props.paths} progress={props.progress} result={props.result} running={props.running} onPatch={props.onPatch} /></div></ScrollArea></TabsContent><TabsContent value="exiftool" className="min-h-0 flex-1 pt-1"><ScrollArea className={cn(fill && "h-full")}><div className="pr-2"><ExifToolSettings props={props} /></div></ScrollArea></TabsContent><TabsContent value="advanced" className="min-h-0 flex-1 pt-1"><ScrollArea className={cn(fill && "h-full")}><div className="pr-2"><AdvancedSettings props={props} /></div></ScrollArea></TabsContent><TabsContent value="environment" className="min-h-0 flex-1 pt-1"><ScrollArea className={cn(fill && "h-full")}><div className="pr-2"><EnvironmentSettings props={props} /></div></ScrollArea></TabsContent></Tabs></div></WorkbenchCard>
}

function Header({ props }: { props: ViewProps }) {
  const compactActions = props.surfaceMode === "compact" || props.surfaceMode === "portrait"
  return <div className="flex shrink-0 items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-2"><div className="grid size-9 place-items-center rounded-md bg-primary text-primary-foreground"><Images /></div><div className="min-w-0"><div className="flex items-center gap-2"><h3 className="truncate text-sm font-semibold">Xlchemy</h3><Badge variant={props.data.phase === "error" ? "destructive" : props.data.phase === "completed" ? "default" : "outline"}>{statusLabel(props)}</Badge></div><div className="truncate text-xs text-muted-foreground">{props.data.progressText || props.t("subtitle", "高性能图片批量转码工作台")}</div></div></div><div className="flex shrink-0 items-center gap-1"><FilenameRuleEditor compact={compactActions} disabled={props.running} rules={props.data.filenameRules} onChange={(filenameRules) => props.onPatch({ filenameRules })} /><RunButton compact={compactActions} label="转换" props={props} /><Button size="sm" variant="outline" onClick={() => props.onExecute("plan")} disabled={props.running || !props.paths.length}>预览计划</Button><NodeConfigPopover configPath={props.configPath} defaults={props.defaults} fallbackDefaults={XL_FACTORY_DEFAULTS} dirty={props.configDirty} disabled={props.running} t={props.t} onOpenFile={props.onOpenConfig} onReload={props.onReloadDefaults} onRestore={props.onRestoreDefaults} onSave={props.onSaveDefaults} preset={{ value: props.data.selectedPreset, options: props.customPresets.map((preset) => ({ value: preset.id, label: preset.name, editable: true, description: props.t("config.customPresetDescription", "此节点的自定义预设"), values: preset.values as Record<string, unknown> })), onValueChange: props.onSelectPreset, onCreate: props.onCreatePreset, onDelete: props.onDeletePreset, onOverwrite: props.onOverwritePreset, onRename: props.onRenamePreset, onExport: props.onExportPresets, onImport: props.onImportPresets }} /><Button aria-label="清空状态" size="icon-sm" variant="outline" onClick={() => props.onPatch({ phase: "idle", progress: 0, progressText: "", result: null })}><RotateCcw /></Button></div></div>
}

function InputWorkbench({ props }: { props: ViewProps }) {
  return <InputFilesWorkbench data={props.data} disabled={props.running} getFileUrl={props.getFileUrl} result={props.result} onCopyPath={(path) => void props.onCopyText(path)} onPatch={props.onPatch} onPickFiles={props.onPickFiles ?? (async () => [])} onPickDirectory={props.onPickDirectory ?? (async () => undefined)} onListFiles={props.onListFiles} onSubscribeDrops={props.onSubscribeDrops} />
}

function FormatControls({ props }: { props: ViewProps }) {
  const lossy = !(props.data.lossless ?? false), outputMode = props.data.outputMode ?? "source", supportsLosslessChoice = ["JPEG XL", "AVIF", "WebP", "TIFF"].includes(props.format), showQuality = props.format === "JPEG" || (supportsLosslessChoice && lossy), chromaUnavailable = props.format === "AVIF" && props.data.avifEncoder === "slimg"
  const selectFormat = (format: XlchemyFormat) => props.onPatch({ format, ...(format === "PNG" || format === "Lossless JPEG Transcoding" || format === "Smallest Lossless" ? { lossless: true } : format === "JPEG" || format === "JPEG Reconstruction" ? { lossless: false } : {}) })
  return <div className="flex flex-col gap-2">
    <div className="grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-2">
      <Field className="gap-1"><FieldLabel className="text-[10px]">目标格式</FieldLabel><Select value={props.format} onValueChange={(format) => selectFormat(format as XlchemyFormat)}><SelectTrigger className="w-full" size="sm" aria-label="目标格式"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{FORMATS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label} · {item.extension}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
      {supportsLosslessChoice && <ChoiceControlField label="压缩模式"><ToggleGroup type="single" value={lossy ? "lossy" : "lossless"} className="grid w-full grid-cols-2" size="sm" onValueChange={(value) => value && props.onPatch({ lossless: value === "lossless" })}><ToggleGroupItem value="lossless">无损</ToggleGroupItem><ToggleGroupItem value="lossy">有损</ToggleGroupItem></ToggleGroup></ChoiceControlField>}
      <ChoiceControlField label="输出位置"><ToggleGroup type="single" value={outputMode} className="grid w-full grid-cols-2" size="sm" variant="outline" onValueChange={(value) => value && props.onPatch({ outputMode: value as "source" | "directory" })}><ToggleGroupItem value="source">源文件旁</ToggleGroupItem><ToggleGroupItem value="directory">指定目录</ToggleGroupItem></ToggleGroup></ChoiceControlField>
      <Field className="gap-1"><FieldLabel className="text-[10px]">同名输出</FieldLabel><Select value={props.data.existingPolicy ?? (props.data.overwrite ? "replace" : "skip")} onValueChange={(existingPolicy) => props.onPatch({ existingPolicy: existingPolicy as XlchemyCardState["existingPolicy"], overwrite: existingPolicy === "replace" })}><SelectTrigger className="w-full" size="sm"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="replace">覆盖</SelectItem><SelectItem value="skip">跳过</SelectItem><SelectItem value="rename">自动改名</SelectItem></SelectGroup></SelectContent></Select></Field>
      {showsChromaSubsampling(props) && <ChromaSubsamplingField disabled={chromaUnavailable} props={props} />}
    </div>
    {outputMode === "directory" && <InputGroup><InputGroupInput aria-label="xlchemy output directory" placeholder="D:/output" value={props.data.outputDir ?? ""} onChange={(event) => props.onPatch({ outputDir: event.currentTarget.value })} /><InputGroupAddon align="inline-end"><InputGroupButton aria-label="选择输出目录" disabled={props.running || !props.onPickDirectory} size="icon-xs" onClick={async () => { const path = await props.onPickDirectory?.(); if (path) props.onPatch({ outputDir: path }) }}><FolderInput /></InputGroupButton></InputGroupAddon></InputGroup>}
    {props.format === "Smallest Lossless" && <ChoiceControlField label="最小格式池"><ToggleGroup type="multiple" value={[(props.data.smallestPng ?? true) ? "png" : "", (props.data.smallestWebp ?? true) ? "webp" : "", (props.data.smallestJxl ?? true) ? "jxl" : ""].filter(Boolean)} className="grid w-full grid-cols-3" size="sm" onValueChange={(values) => values.length && props.onPatch({ smallestPng: values.includes("png"), smallestWebp: values.includes("webp"), smallestJxl: values.includes("jxl") })}><ToggleGroupItem value="png">PNG</ToggleGroupItem><ToggleGroupItem value="webp">WebP</ToggleGroupItem><ToggleGroupItem value="jxl">JXL</ToggleGroupItem></ToggleGroup></ChoiceControlField>}
    {showQuality && <SliderField label="质量" value={props.data.quality ?? 60} min={1} max={100} step={props.data.qualityPrecisionSnapping === false ? 1 : 5} onChange={(quality) => props.onPatch({ quality })} />}
  </div>
}

function ChromaSubsamplingField({ disabled, props }: { disabled: boolean; props: ViewProps }) {
  return <Field className="gap-1"><FieldLabel className="text-[10px]">色度采样</FieldLabel><Select disabled={disabled} value={props.data.chromaSubsampling ?? "default"} onValueChange={(chromaSubsampling) => props.onPatch({ chromaSubsampling })}><SelectTrigger className="w-full" size="sm"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{[["default", "默认"], ["444", "4:4:4"], ["422", "4:2:2"], ["420", "4:2:0"]].map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectGroup></SelectContent></Select>{disabled && <span className="text-[10px] text-muted-foreground">slimg 编码器未提供色度采样控制</span>}</Field>
}

function InputFilterCard({ props, embedded = false }: { props: ViewProps; embedded?: boolean }) {
  const excluded = new Set(String(props.data.excludedFormatsText ?? DEFAULT_EXCLUDED_FORMATS).split(/[,;\s]+/).map((value) => value.toLowerCase()).filter(Boolean))
  const enabled = XL_INPUT_FORMATS.filter((format) => !excluded.has(format))
  const content = <><Field><FieldLabel>输入格式</FieldLabel><ToggleGroup type="multiple" value={enabled} variant="selection" size="sm" spacing={1} className="flex w-full flex-wrap justify-start" onValueChange={(values) => props.onPatch({ excludedFormatsText: XL_INPUT_FORMATS.filter((format) => !values.includes(format)).join(",") })}>{XL_INPUT_FORMATS.map((format) => <ToggleGroupItem key={format} value={format} aria-label={`${enabled.includes(format) ? "禁用" : "启用"} .${format.toUpperCase()}`} className="h-6 flex-none px-2 text-[10px] uppercase">.{format}</ToggleGroupItem>)}</ToggleGroup></Field><div className="grid grid-cols-2 gap-2"><SelectField label="处理顺序" value={props.data.processingOrder ?? "original"} options={[["original", "原始顺序"], ["path-asc", "路径升序"], ["path-desc", "路径降序"], ["size-asc", "大小升序"], ["size-desc", "大小降序"], ["random", "随机"], ["sequential", "顺序处理"]]} onChange={(processingOrder) => props.onPatch({ processingOrder: processingOrder as XlchemyCardState["processingOrder"] })} /><SwitchField label="递归子目录" checked={props.data.recursive ?? true} onChange={(recursive) => props.onPatch({ recursive })} /></div></>
  return embedded ? content : <WorkbenchCard title="输入过滤">{content}</WorkbenchCard>
}

function OriginalConversionSettings({ props }: { props: ViewProps }) {
  return <div className="flex flex-col gap-2">
    <div className="grid grid-cols-2 gap-2">
      {props.format === "JPEG" && <SelectField label="JPEG 编码器" value={props.data.jpegEncoder ?? "jpegli"} options={[["jpegli", "JPEGLI"], ["libjpeg", "libjpeg"]]} onChange={(jpegEncoder) => props.onPatch({ jpegEncoder: jpegEncoder as "jpegli" | "libjpeg" })} />}
      {props.format === "AVIF" && <><SelectField label="AVIF 编码器" value={props.data.avifEncoder ?? "aom"} options={[["aom", "AOM AV1"], ["svt", "SVT-AV1-PSY"], ["slimg", "slimg"]]} onChange={(avifEncoder) => props.onPatch({ avifEncoder: avifEncoder as "aom" | "svt" | "slimg" })} /><SelectField label="AVIF 位深" value={props.data.avifBitDepth ?? "auto"} options={[["auto", "自动"], ["12", "12-bit"], ["10", "10-bit"], ["8", "8-bit"]]} onChange={(avifBitDepth) => props.onPatch({ avifBitDepth: avifBitDepth as XlchemyCardState["avifBitDepth"] })} /></>}
    </div>
    <div className="grid grid-cols-2 gap-2">
      {props.format === "JPEG" && props.data.jpegEncoder !== "libjpeg" && <SwitchField label="禁用渐进式 JPEGli" checked={props.data.disableProgressiveJpegli ?? false} onChange={(disableProgressiveJpegli) => props.onPatch({ disableProgressiveJpegli })} />}
      {props.format === "AVIF" && (props.data.avifEncoder ?? "aom") === "aom" && <SwitchField label="AOM IQ 调优" checked={props.data.avifAomIqTune ?? false} onChange={(avifAomIqTune) => props.onPatch({ avifAomIqTune })} />}
      <SwitchField label="保留较大的原图" checked={props.data.keepIfLarger ?? false} onChange={(keepIfLarger) => props.onPatch({ keepIfLarger })} />
      <SwitchField label="较大时复制原图" checked={props.data.copyIfLarger ?? false} onChange={(copyIfLarger) => props.onPatch({ copyIfLarger })} />
      {props.format === "JPEG XL" && <><SwitchField label="JXL 有损 Modular" checked={props.data.jxlModular ?? false} onChange={(jxlModular) => props.onPatch({ jxlModular })} /><SwitchField label="自动无损 JPEG" checked={props.data.autoLosslessJpeg ?? true} onChange={(autoLosslessJpeg) => props.onPatch({ autoLosslessJpeg })} /></>}
    </div>
  </div>
}

function EncoderTuning({ props }: { props: ViewProps }) {
  if (props.format === "JPEG XL") return <div className="grid grid-cols-2 gap-2"><SwitchField label="最大压缩" checked={props.data.maxCompression ?? false} onChange={(maxCompression) => props.onPatch({ maxCompression })} /><SwitchField label="智能压缩力度" checked={props.data.intelligentEffort ?? false} onChange={(intelligentEffort) => props.onPatch({ intelligentEffort })} /><SwitchField label="校验完整性" checked={props.data.jxlVerify ?? false} onChange={(jxlVerify) => props.onPatch({ jxlVerify })} /><SwitchField label="PNG 回退" checked={props.data.jxlPngFallback ?? true} onChange={(jxlPngFallback) => props.onPatch({ jxlPngFallback })} /><SwitchField label="编码前标准化" checked={props.data.jxlNormalize ?? false} onChange={(jxlNormalize) => props.onPatch({ jxlNormalize })} />{props.data.jxlNormalize && <SelectField label="标准化时机" value={props.data.jxlNormalizeWhen ?? "on-fail"} options={[["on-fail", "失败时"], ["always", "始终"]]} onChange={(jxlNormalizeWhen) => props.onPatch({ jxlNormalizeWhen: jxlNormalizeWhen as "on-fail" | "always" })} />}</div>
  if (props.format === "Lossless JPEG Transcoding") return <div className="grid grid-cols-2 gap-2"><SwitchField label="最大压缩" checked={props.data.maxCompression ?? false} onChange={(maxCompression) => props.onPatch({ maxCompression })} /><SwitchField label="校验完整性" checked={props.data.jxlVerify ?? false} onChange={(jxlVerify) => props.onPatch({ jxlVerify })} /><SwitchField label="编码前标准化" checked={props.data.jxlNormalize ?? false} onChange={(jxlNormalize) => props.onPatch({ jxlNormalize })} />{props.data.jxlNormalize && <SelectField label="标准化时机" value={props.data.jxlNormalizeWhen ?? "on-fail"} options={[["on-fail", "失败时"], ["always", "始终"]]} onChange={(jxlNormalizeWhen) => props.onPatch({ jxlNormalizeWhen: jxlNormalizeWhen as "on-fail" | "always" })} />}</div>
  return null
}

function showsChromaSubsampling(props: ViewProps) {
  return props.format === "JPEG" || props.format === "AVIF"
}

function CoreExecutionOptions({ props }: { props: ViewProps }) {
  return <div className="grid grid-cols-2 gap-2"><SliderField label="压缩力度" value={props.data.effort ?? 7} min={1} max={10} onChange={(effort) => props.onPatch({ effort })} /><SliderField editable label="并行线程" value={props.data.threads ?? 4} min={1} max={32} onChange={(threads) => props.onPatch({ threads })} /></div>
}

function GeneralSettings({ props }: { props: ViewProps }) {
  return <div className="flex flex-col gap-2"><div className="grid grid-cols-2 gap-2"><SwitchField label="启动时关闭缩小" checked={props.data.disableDownscalingStartup ?? false} onChange={(disableDownscalingStartup) => props.onPatch({ disableDownscalingStartup })} /><SwitchField label="启动时关闭删除原图" checked={props.data.disableDeleteStartup ?? true} onChange={(disableDeleteStartup) => props.onPatch({ disableDeleteStartup })} /><SwitchField label="禁用自动排序" checked={props.data.disableSorting ?? false} onChange={(disableSorting) => props.onPatch({ disableSorting })} /><SwitchField label="质量按精度吸附" checked={props.data.qualityPrecisionSnapping ?? true} onChange={(qualityPrecisionSnapping) => props.onPatch({ qualityPrecisionSnapping })} /><SwitchField label="完成时提示音" checked={props.data.playSoundOnFinish ?? true} onChange={(playSoundOnFinish) => props.onPatch({ playSoundOnFinish })} /><SwitchField label="自动清除已完成" checked={props.data.autoClearCompleted ?? false} onChange={(autoClearCompleted) => props.onPatch({ autoClearCompleted })} /></div>{props.data.playSoundOnFinish !== false && <SliderField label="提示音音量" value={Math.round((props.data.playSoundVolume ?? 0.5) * 100)} min={0} max={100} onChange={(playSoundVolume) => props.onPatch({ playSoundVolume: playSoundVolume / 100 })} />}</div>
}

function ExifToolSettings({ props }: { props: ViewProps }) {
  const fields: Array<[keyof Pick<XlchemyCardState, "exiftoolWipeArgs" | "exiftoolPreserveArgs" | "exiftoolUnsafeWipeArgs" | "exiftoolCustomArgs">, string, string]> = [
    ["exiftoolWipeArgs", "清除命令", '-overwrite_original -all= --ICC_Profile:all "$dst"'],
    ["exiftoolPreserveArgs", "保留命令", '-overwrite_original -TagsFromFile "$src" -all:all "$dst"'],
    ["exiftoolUnsafeWipeArgs", "完全清除命令", '-overwrite_original -all= "$dst"'],
    ["exiftoolCustomArgs", "自定义命令", '"$dst"'],
  ]
  return <div className="@container/xlchemy-tool-panel"><div className="grid gap-2 @xl/xlchemy-tool-panel:grid-cols-2">{fields.map(([key, label, fallback]) => <Field key={key} className="gap-1"><FieldLabel className="text-[10px]">{label}</FieldLabel><Textarea className="min-h-16 font-mono text-xs" value={String(props.data[key] ?? fallback)} onChange={(event) => props.onPatch({ [key]: event.currentTarget.value })} /></Field>)}</div></div>
}

function AdvancedSettings({ props }: { props: ViewProps }) {
  const optimizer = props.data.ramOptimizer ?? "dynamic"
  return <div className="flex flex-col gap-2"><SelectField label="内存优化器" value={optimizer} options={[["dynamic", "动态规则"], ["static", "静态规则"], ["disabled", "关闭"]]} onChange={(ramOptimizer) => props.onPatch({ ramOptimizer: ramOptimizer as XlchemyCardState["ramOptimizer"] })} />{optimizer === "dynamic" && <Field className="gap-1"><div className="flex items-center justify-between"><FieldLabel className="text-[10px]">内存优化规则</FieldLabel><Button type="button" variant="ghost" size="xs" onClick={() => props.onPatch({ ramOptimizerRules: DEFAULT_RAM_OPTIMIZER_RULES })}><RotateCcw />恢复默认</Button></div><Textarea className="min-h-16 font-mono text-xs" placeholder={DEFAULT_RAM_OPTIMIZER_RULES} value={props.data.ramOptimizerRules ?? DEFAULT_RAM_OPTIMIZER_RULES} onChange={(event) => props.onPatch({ ramOptimizerRules: event.currentTarget.value })} /></Field>}<SwitchField label="启用额外编码参数" checked={props.data.enableCustomArgs ?? false} onChange={(enableCustomArgs) => props.onPatch({ enableCustomArgs })} />{props.data.enableCustomArgs && <div className="grid grid-cols-2 gap-2"><Input aria-label="cjxl 额外参数" placeholder="cjxl 参数" value={props.data.cjxlArgs ?? ""} onChange={(event) => props.onPatch({ cjxlArgs: event.currentTarget.value })} /><Input aria-label="avifenc 额外参数" placeholder="avifenc 参数" value={props.data.avifencArgs ?? ""} onChange={(event) => props.onPatch({ avifencArgs: event.currentTarget.value })} /><Input aria-label="cjpegli 额外参数" placeholder="cjpegli 参数" value={props.data.cjpegliArgs ?? ""} onChange={(event) => props.onPatch({ cjpegliArgs: event.currentTarget.value })} /><Input aria-label="ImageMagick 额外参数" placeholder="ImageMagick 参数" value={props.data.imageMagickArgs ?? ""} onChange={(event) => props.onPatch({ imageMagickArgs: event.currentTarget.value })} /></div>}</div>
}

function EnvironmentSettings({ props }: { props: ViewProps }) {
  const tools = props.data.environment?.length ? props.data.environment : pendingEnvironment(), ready = tools.filter((tool) => tool.runnable).length, pending = tools.filter((tool) => tool.detail === "等待检测" || tool.detail === "正在检测").length, unavailable = tools.filter((tool) => tool.detail?.startsWith("运行端待刷新")).length
  const cpuThreads = typeof navigator !== "undefined" ? navigator.hardwareConcurrency : undefined
  return <div className="@container/xlchemy-tool-panel"><div className="flex flex-col gap-2"><div className="flex flex-wrap items-center gap-2"><div className="min-w-48 flex-1"><div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold"><Wrench />工具链维护<Badge variant="outline">{pending ? `检测中 · ${tools.length}` : unavailable ? `待刷新 · ${tools.length}` : `${ready}/${tools.length}`}</Badge><Badge variant="secondary">CPU {cpuThreads ?? "—"} 线程</Badge><Badge variant="secondary">任务 {props.data.threads ?? 4} 线程</Badge><Badge variant="secondary">{activeEncoder(props.data)}</Badge></div><div className="mt-0.5 text-[10px] text-muted-foreground">检测 PATH 命令与 C:\Windows\System32\slimg_cffi.dll；不下载或安装二进制。{props.data.environmentCheckedAt ? ` 上次：${new Date(props.data.environmentCheckedAt).toLocaleTimeString()}` : ""}</div></div><Button size="sm" variant="outline" disabled={props.running} onClick={() => props.onExecute("diagnose")}><RefreshCw className={cn(props.running && "animate-spin motion-reduce:animate-none")} data-icon="inline-start" />{props.running ? "检测中" : "重新检测"}</Button></div><div className="grid gap-1.5 @xl/xlchemy-tool-panel:grid-cols-2">{tools.map((tool) => { const checking = tool.detail === "等待检测" || tool.detail === "正在检测", stale = tool.detail?.startsWith("运行端待刷新"); return <Item key={tool.id} size="sm" variant="outline" className="min-w-0 flex-nowrap px-2 py-1.5"><ItemMedia>{checking ? <RefreshCw className="animate-spin text-muted-foreground motion-reduce:animate-none" /> : stale ? <AlertTriangle className="text-muted-foreground" /> : tool.runnable ? <CircleCheck className="text-chart-2" /> : <CircleX className="text-destructive" />}</ItemMedia><ItemContent className="min-w-0 gap-0.5"><ItemTitle className="w-full min-w-0 text-xs"><span className="truncate">{tool.label}</span><Badge className="ml-auto" variant={checking || stale ? "outline" : tool.runnable ? "secondary" : "destructive"}>{checking ? "检测中" : stale ? "待刷新" : tool.runnable ? "可用" : tool.available ? "异常" : "缺失"}</Badge></ItemTitle><ItemDescription className="block truncate text-[10px]" title={tool.path ?? tool.detail}>{tool.purpose} · {tool.version ?? tool.path ?? tool.detail}</ItemDescription></ItemContent></Item> })}</div></div></div>
}

function SettingsGroup({ children, label }: { children: ReactNode; label: string }) {
  return <FieldSet className="min-w-0 gap-1.5 rounded-lg border px-2.5 pb-2.5"><FieldLegend className="mb-0 ml-1 w-fit px-1 text-[10px] text-muted-foreground" variant="label">{label}</FieldLegend><div className="flex min-w-0 flex-col gap-2">{children}</div></FieldSet>
}

function SliderField({ editable, label, value, min, max, step = 1, onChange }: { editable?: boolean; label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(value))
  const update = (next: number) => onChange(Math.min(max, Math.max(min, next)))
  const commit = () => {
    const next = Number(draft)
    if (Number.isFinite(next)) update(next)
    setEditing(false)
  }
  const editableValue = <Popover open={editing} onOpenChange={setEditing}>
    <PopoverAnchor className="inline-flex">
      <Badge aria-label={`${label}数值`} aria-valuemax={max} aria-valuemin={min} aria-valuenow={value} className="xiranite-no-drag cursor-text tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring" role="spinbutton" tabIndex={0} variant="outline" onClick={() => { setDraft(String(value)); setEditing(true) }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); setDraft(String(value)); setEditing(true) } else if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); update(value + (event.key === "ArrowUp" ? step : -step)) } }} onWheel={(event) => { event.preventDefault(); update(value + (event.deltaY < 0 ? step : -step)) }}>{value}</Badge>
    </PopoverAnchor>
    <PopoverContent className="w-28 p-2" onOpenAutoFocus={(event) => event.preventDefault()}>
      <Input autoFocus aria-label={`编辑${label}`} className="h-8 text-center tabular-nums" min={min} max={max} step={step} type="number" value={draft} onChange={(event) => setDraft(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit() } }} />
    </PopoverContent>
  </Popover>
  return <Field className="gap-1.5"><div className="flex items-center justify-between gap-2"><FieldLabel className="text-[10px]">{label}</FieldLabel>{editable ? editableValue : <Badge variant="outline">{value}</Badge>}</div><Slider aria-label={label} min={min} max={max} step={step} value={[value]} onValueChange={(values) => onChange(values[0] ?? value)} /></Field>
}

function activeEncoder(data: XlchemyCardState) { const format = data.format ?? "JPEG XL"; if (format === "AVIF") return data.avifEncoder === "svt" ? "SVT-AV1" : data.avifEncoder === "slimg" ? "slimg" : "AOM AV1"; if (format === "JPEG") return data.jpegEncoder === "libjpeg" ? "libjpeg" : "JPEGli"; if (format === "JPEG XL" || format === "Lossless JPEG Transcoding") return "cjxl"; if (format === "JPEG Reconstruction") return "djxl"; return format }

function SourcePolicies({ props }: { props: ViewProps }) {
  return <div className="flex flex-col gap-2"><div className="grid grid-cols-2 gap-2"><SwitchField label="保留目录结构" checked={props.data.preserveStructure ?? true} onChange={(preserveStructure) => props.onPatch({ preserveStructure })} /><SwitchField label="转换后删除原图" checked={props.data.deleteOriginal ?? false} onChange={(deleteOriginal) => props.onPatch({ deleteOriginal })} /></div>{props.data.deleteOriginal && <SelectField label="删除方式" value={props.data.deleteOriginalMode ?? "trash"} options={[["trash", "移到回收站"], ["permanent", "永久删除"]]} onChange={(deleteOriginalMode) => props.onPatch({ deleteOriginalMode: deleteOriginalMode as "trash" | "permanent" })} />}</div>
}

function DownscalingCard({ props, embedded = false }: { props: ViewProps; embedded?: boolean }) {
  const mode = props.data.downscaleMode ?? "resolution"
  const content = <><SwitchField label="启用缩小" checked={props.data.downscaleEnabled ?? false} onChange={(downscaleEnabled) => props.onPatch({ downscaleEnabled })} />{props.data.downscaleEnabled && <><SelectField label="缩小模式" value={mode} options={[["resolution", "分辨率"], ["percent", "百分比"], ["file-size", "目标文件大小"], ["shortest-side", "最短边"], ["longest-side", "最长边"], ["megapixels", "百万像素"]]} onChange={(downscaleMode) => props.onPatch({ downscaleMode: downscaleMode as XlchemyCardState["downscaleMode"] })} /><div className="grid grid-cols-2 gap-2">{mode === "resolution" && <><NumberField label="宽度" value={props.data.downscaleWidth ?? 1920} onChange={(downscaleWidth) => props.onPatch({ downscaleWidth })} /><NumberField label="高度" value={props.data.downscaleHeight ?? 1080} onChange={(downscaleHeight) => props.onPatch({ downscaleHeight })} /></>}{mode === "percent" && <NumberField label="百分比" value={props.data.downscalePercent ?? 50} onChange={(downscalePercent) => props.onPatch({ downscalePercent })} />}{mode === "file-size" && <NumberField label="目标 KB" value={props.data.downscaleFileSizeKb ?? 500} onChange={(downscaleFileSizeKb) => props.onPatch({ downscaleFileSizeKb })} />}{mode === "shortest-side" && <NumberField label="最短边" value={props.data.downscaleShortestSide ?? 1080} onChange={(downscaleShortestSide) => props.onPatch({ downscaleShortestSide })} />}{mode === "longest-side" && <NumberField label="最长边" value={props.data.downscaleLongestSide ?? 1920} onChange={(downscaleLongestSide) => props.onPatch({ downscaleLongestSide })} />}{mode === "megapixels" && <NumberField label="百万像素" value={props.data.downscaleMegapixels ?? 2.1} step={0.1} onChange={(downscaleMegapixels) => props.onPatch({ downscaleMegapixels })} />}</div><SelectField label="重采样" value={props.data.downscaleResample ?? "default"} options={[["default", "默认"], ["lanczos", "Lanczos"], ["mitchell", "Mitchell"], ["catrom", "Catmull-Rom"], ["box", "Box"]]} onChange={(downscaleResample) => props.onPatch({ downscaleResample })} /></>}</>
  return embedded ? content : <WorkbenchCard title="缩小">{content}</WorkbenchCard>
}

function MetadataCard({ props, embedded = false }: { props: ViewProps; embedded?: boolean }) {
  const content = <><SelectField label="元数据策略" value={props.data.metadataMode ?? "encoder-preserve"} options={[["encoder-wipe", "编码器 · 清除"], ["encoder-preserve", "编码器 · 保留"], ["exiftool-wipe", "ExifTool · 清除"], ["exiftool-preserve", "ExifTool · 保留"], ["exiftool-unsafe-wipe", "ExifTool · 完全清除"], ["exiftool-custom", "ExifTool · 自定义"]]} onChange={(metadataMode) => props.onPatch({ metadataMode: metadataMode as XlchemyCardState["metadataMode"], preserveMetadata: metadataMode.includes("preserve") })} /><SwitchField label="保留文件时间戳" checked={props.data.preserveTimestamps ?? false} onChange={(preserveTimestamps) => props.onPatch({ preserveTimestamps })} /></>
  return embedded ? content : <WorkbenchCard title="元数据与时间">{content}</WorkbenchCard>
}

function SwitchField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  const id = `xlchemy-${label}`
  return <Field orientation="horizontal" className="rounded-md border px-2 py-1.5"><FieldContent><FieldLabel htmlFor={id} className="text-xs">{label}</FieldLabel></FieldContent><Switch id={id} size="sm" checked={checked} onCheckedChange={onChange} /></Field>
}

function SelectField({ label, onChange, options, value }: { label: string; onChange: (value: string) => void; options: Array<[string, string]>; value: string }) { return <Field><FieldLabel>{label}</FieldLabel><Select value={value} onValueChange={onChange}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{options.map(([optionValue, optionLabel]) => <SelectItem key={optionValue} value={optionValue}>{optionLabel}</SelectItem>)}</SelectGroup></SelectContent></Select></Field> }
function NumberField({ label, onChange, step = 1, value }: { label: string; onChange: (value: number) => void; step?: number; value: number }) { return <Field><FieldLabel>{label}</FieldLabel><Input type="number" step={step} value={value} onChange={(event) => onChange(Number(event.currentTarget.value))} /></Field> }

function RunButton({ className, label, props, compact }: { className?: string; label?: string; props: ViewProps; compact?: boolean }) {
  if (props.running) return <Button className={className} aria-label="取消转换" disabled={props.cancelling} size={compact ? "icon-sm" : "sm"} variant="outline" onClick={props.onCancel}><Square />{!compact && (props.cancelling ? "正在取消…" : "取消转换")}</Button>
  const live = (props.data.overwrite ?? false) || (props.data.deleteOriginal ?? false)
  const button = <Button className={className} aria-label="开始转换" disabled={!props.paths.length} size={compact ? "icon-sm" : "sm"} variant={live ? "destructive" : "default"} onClick={live ? undefined : () => props.onExecute("convert")}><Play />{!compact && (label ?? "开始转换")}</Button>
  if (!live) return button
  return <AlertDialog><AlertDialogTrigger asChild>{button}</AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>确认覆盖并转换？</AlertDialogTitle><AlertDialogDescription>Xlchemy 将写入目标文件，并允许覆盖已存在的输出。请先检查目标格式和输出位置。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => props.onExecute("convert")}>确认转换</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
}

function ResultPanel({ props }: { props: ViewProps }) {
  return <Tabs defaultValue={props.data.resultTab ?? "results"} className="flex h-full min-h-0 flex-col" onValueChange={(resultTab) => props.onPatch({ resultTab: resultTab as XlchemyCardState["resultTab"] })}><TabsList variant="line"><TabsTrigger value="results"><CheckCircle2 />结果</TabsTrigger><TabsTrigger value="issues"><AlertTriangle />问题</TabsTrigger><TabsTrigger value="logs"><Terminal />日志</TabsTrigger></TabsList><TabsContent value="results" className="min-h-0 flex-1 overflow-hidden"><ScrollArea className="h-full"><div className="grid gap-1.5 p-2">{props.result?.files.length ? props.result.files.map((file) => <div key={file.sourcePath} className="flex items-center gap-2 rounded-md border px-2 py-1.5"><FileImage className="size-4 text-muted-foreground" /><div className="min-w-0 flex-1"><div className="truncate text-xs">{baseName(file.sourcePath)}</div><div className="truncate text-[10px] text-muted-foreground">{file.outputPath}</div></div><Badge variant={file.status === "error" ? "destructive" : "outline"}>{file.status}</Badge></div>) : <div className="p-4 text-center text-xs text-muted-foreground">预览后显示输出路径和编码结果</div>}</div></ScrollArea></TabsContent><TabsContent value="issues" className="min-h-0 flex-1 overflow-hidden pt-2"><ScrollArea className="h-full rounded-md border bg-muted/30" data-testid="xlchemy-result-issues-scroll"><pre className="min-w-0 whitespace-pre-wrap break-all p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">{props.result?.errors.join("\n") || "暂无问题"}</pre></ScrollArea></TabsContent><TabsContent value="logs" className="min-h-0 flex-1 overflow-hidden pt-2"><ConversionLog logs={props.data.logs ?? []} onClear={() => props.onPatch({ logs: [] })} onCopy={(text) => void props.onCopyText(text)} /></TabsContent></Tabs>
}

function WorkbenchCard({ badge, children, fill = false, grow = false, icon: Icon, title }: { badge?: string; children: ReactNode; fill?: boolean; grow?: boolean; icon?: LucideIcon; title: string }) {
  return <ModulePanel badge={badge} fill={fill} grow={grow} icon={Icon} title={title} titleClassName="!border-transparent !bg-transparent !text-foreground px-0" contentClassName="pt-1">{children}</ModulePanel>
}

function splitLines(value?: string) { return String(value ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean) }
function readLiveResult(value: unknown): XlchemyData | undefined {
  if (!value || typeof value !== "object" || (value as { kind?: unknown }).kind !== "xlchemy-live-result") return undefined
  const result = (value as { result?: unknown }).result
  if (!result || typeof result !== "object" || !Array.isArray((result as { files?: unknown }).files)) return undefined
  return result as XlchemyData
}
function pendingEnvironment() { return ENVIRONMENT_TARGETS.map(([id, label, purpose]) => ({ id, label, purpose, available: false, runnable: false, detail: "等待检测" })) }
function unavailableEnvironment(detail: string) { return ENVIRONMENT_TARGETS.map(([id, label, purpose]) => ({ id, label, purpose, available: false, runnable: false, detail })) }
function baseName(path: string) { return path.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? path }
function formatCompactBytes(bytes: number) { if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`; return `${(bytes / 1024 ** 2).toFixed(1)} MB` }
function formatExtension(format: XlchemyFormat) { return FORMATS.find((item) => item.value === format)?.extension ?? "" }
function statusLabel(props: ViewProps) { if (props.running || props.data.phase === "running") return "运行中"; if (props.data.phase === "completed") return "完成"; if (props.data.phase === "cancelled") return "已取消"; if (props.data.phase === "error") return "错误"; return "在线" }
function buildInput(action: XlchemyAction, data: XlchemyCardState): XlchemyInput { return normalizeXlchemyInput({ action, paths: splitLines(data.pathsText), format: data.format, lossless: data.lossless, quality: data.quality, effort: data.effort, maxCompression: data.maxCompression, threads: data.threads, outputMode: data.outputMode, outputDir: data.outputDir, preserveMetadata: data.preserveMetadata, preserveStructure: data.preserveStructure, preserveTimestamps: data.preserveTimestamps, overwrite: data.overwrite, existingPolicy: data.existingPolicy, recursive: data.recursive, deleteOriginal: data.deleteOriginal, deleteOriginalMode: data.deleteOriginalMode, intelligentEffort: data.intelligentEffort, jxlModular: data.jxlModular, jxlVerify: data.jxlVerify, jxlPngFallback: data.jxlPngFallback, jxlNormalize: data.jxlNormalize, jxlNormalizeWhen: data.jxlNormalizeWhen, chromaSubsampling: data.chromaSubsampling, metadataMode: data.metadataMode, keepIfLarger: data.keepIfLarger, copyIfLarger: data.copyIfLarger, smallestFormatPool: { png: data.smallestPng ?? true, webp: data.smallestWebp ?? true, jxl: data.smallestJxl ?? true }, jpegEncoder: data.jpegEncoder, avifEncoder: data.avifEncoder, avifBitDepth: data.avifBitDepth, avifAomIqTune: data.avifAomIqTune, disableProgressiveJpegli: data.disableProgressiveJpegli, autoLosslessJpeg: data.autoLosslessJpeg, enableCustomArgs: data.enableCustomArgs, cjxlArgs: data.cjxlArgs, avifencArgs: data.avifencArgs, cjpegliArgs: data.cjpegliArgs, imageMagickArgs: data.imageMagickArgs, ramOptimizer: data.ramOptimizer, ramOptimizerRules: data.ramOptimizerRules, exiftoolWipeArgs: data.exiftoolWipeArgs, exiftoolPreserveArgs: data.exiftoolPreserveArgs, exiftoolUnsafeWipeArgs: data.exiftoolUnsafeWipeArgs, exiftoolCustomArgs: data.exiftoolCustomArgs, processingOrder: data.processingOrder, excludedFormats: String(data.excludedFormatsText ?? "avif,jxl,webp,gif").split(/[,;\s]+/).filter(Boolean), downscale: { enabled: data.downscaleEnabled ?? false, mode: data.downscaleMode ?? "resolution", width: data.downscaleWidth ?? 1920, height: data.downscaleHeight ?? 1080, percent: data.downscalePercent ?? 50, fileSizeKb: data.downscaleFileSizeKb ?? 500, shortestSide: data.downscaleShortestSide ?? 1080, longestSide: data.downscaleLongestSide ?? 1920, megapixels: data.downscaleMegapixels ?? 2.1, resample: data.downscaleResample ?? "default" } }) }
function playCompletionTone(volume: number) { const AudioContextCtor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext; if (!AudioContextCtor) return; const context = new AudioContextCtor(), oscillator = context.createOscillator(), gain = context.createGain(); oscillator.frequency.value = 660; gain.gain.setValueAtTime(Math.max(0, Math.min(1, volume)) * 0.12, context.currentTime); gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.22); oscillator.connect(gain).connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + 0.22); oscillator.addEventListener("ended", () => void context.close()) }
function getHostData(host: NodeComponentProps<XlchemyCardState>["host"], compId: string): XlchemyCardState { return host.state?.getData?.() ?? host.getData<XlchemyCardState>(compId) ?? {} }

const XL_INPUT_FORMATS = ["jxl", "jpg", "jpeg", "jfif", "jif", "jpe", "png", "apng", "gif", "webp", "jp2", "bmp", "ico", "tiff", "tif", "avif", "psd", "psb", "clip"]
const DEFAULT_EXCLUDED_FORMATS = "avif,jxl,webp,gif"

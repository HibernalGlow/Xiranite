import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import type { NodeComponentProps, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type { XlchemyAction, XlchemyData, XlchemyFormat, XlchemyInput } from "@xiranite/node-xlchemy/core"
import { compressionRatio, normalizeXlchemyInput } from "@xiranite/node-xlchemy/core"
import type { LucideIcon } from "lucide-react"
import { AlertTriangle, CheckCircle2, FileImage, FolderInput, Gauge, Images, Play, RotateCcw, Square, Terminal } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardHeader } from "@/components/ui/card"
import { Field, FieldContent, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { NodeConfigPopover } from "@/nodes/shared/NodeConfigPopover"
import { useNodeI18n } from "@/nodes/shared/useNodeI18n"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import { FORMATS, PRESETS } from "./constants"
import type { XlchemyCardState } from "./types"
import { XL_CONFIG_FIELDS } from "./types"
import { InputFilesWorkbench } from "./InputFilesWorkbench"
import { ConversionLog, ProgressWorkbench } from "./ProgressAndLogs"

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
  const [configPath, setConfigPath] = useState<string>()
  const [configDirty, setConfigDirty] = useState(false)

  const paths = useMemo(() => splitLines(data.pathsText), [data.pathsText])
  const result = data.result ?? null
  const progress = data.progress ?? 0
  const format = data.format ?? "JPEG XL"
  const compact = surface.mode === "compact" || surface.mode === "portrait"
  const forceCollapsed = compact && surface.height > 0 && surface.height < 160

  async function reloadDefaults() {
    const pending = host.config?.get?.<Partial<XlchemyCardState>>() ?? host.getNodeConfig?.<Partial<XlchemyCardState>>()
    try {
      const response = await pending
      if (response) { setDefaults(response.config); setConfigPath(response.path) }
    } catch { /* browser preview */ }
  }

  useEffect(() => { void reloadDefaults() }, [host])
  useEffect(() => {
    if (!defaults) return
    setConfigDirty(XL_CONFIG_FIELDS.some((field) => String(data[field] ?? "") !== String(defaults[field] ?? "")))
  }, [data.format, data.lossless, data.quality, data.effort, data.threads, data.outputMode, data.outputDir, data.preserveMetadata, data.preserveStructure, data.overwrite, data.recursive, data.selectedPreset, defaults])

  function patch(next: Partial<XlchemyCardState>) {
    dataRef.current = { ...dataRef.current, ...next }
    if (host.state?.patchData) host.state.patchData(next)
    else host.patchData(compId, next)
  }

  async function saveDefaults() {
    const config: Partial<XlchemyCardState> = {}
    for (const field of XL_CONFIG_FIELDS) {
      const value = dataRef.current[field]
      if (value !== undefined) (config as Record<string, unknown>)[field] = value
    }
    if (host.config?.save) await host.config.save(config)
    else await host.saveNodeConfig?.(config)
    setDefaults(config)
    setConfigDirty(false)
  }

  async function execute(nextAction: XlchemyAction) {
    if (running) return
    const selected = dataRef.current.selectedPaths
    const input = buildInput(nextAction, selected?.length ? { ...dataRef.current, pathsText: selected.join("\n") } : dataRef.current)
    if (!input.paths.length) { patch({ phase: "error", progressText: t("errors.paths", "请先添加图片文件或文件夹。") }); return }
    const run = host.runner?.run ?? host.actions?.run
    if (!run) { patch({ phase: "error", progressText: t("errors.backend", "GUI 已就绪，等待 Xlchemy 后端执行接口接入。") }); return }
    setRunning(true)
    patch({ action: nextAction, phase: "running", progress: 0, progressText: t("status.start", "正在准备 Xlchemy 转换任务…"), result: null })
    try {
      const response = await run<XlchemyInput, XlchemyData>("xlchemy", input, (event: NodeRunEvent) => {
        if (event.type === "progress") patch({ progress: event.progress ?? 0, progressText: event.message, currentFile: event.message, logs: [...(dataRef.current.logs ?? []), `${new Date().toTimeString().slice(0, 8)} ${event.message ?? "Progress"}`] })
      }) as NodeRunResult<XlchemyData>
      const cancelled = cancellationRequestedRef.current
      patch({ phase: cancelled ? "cancelled" : response.success ? "completed" : "error", progress: response.success ? 100 : cancelled ? dataRef.current.progress ?? 0 : 0, progressText: response.message, result: response.data ?? null })
    } catch (error) {
      patch({ phase: "error", progress: 0, progressText: error instanceof Error ? error.message : String(error) })
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
    cancelling, configDirty, configPath, data, defaults, format, paths, progress, result, running, surfaceMode: surface.mode, t, getFileUrl: host.localFiles?.getUrl,
    onCancel: cancelCurrentRun, onExecute: execute, onPatch: patch,
    onReloadDefaults: reloadDefaults, onRestoreDefaults: () => defaults && patch(defaults), onSaveDefaults: saveDefaults,
    onOpenConfig: host.config?.openFile ?? host.openConfigFile, onCopyText: (text) => host.clipboard?.writeText?.(text),
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
interface ViewProps {
  cancelling: boolean; configDirty: boolean; configPath?: string; data: XlchemyCardState; defaults?: Partial<XlchemyCardState>; format: XlchemyFormat; paths: string[]; progress: number; result: XlchemyData | null; running: boolean; surfaceMode: ReturnType<typeof useNodeSurface>["mode"]; t: NodeT; getFileUrl?: (path: string) => string
  onCancel: () => void; onExecute: (action: XlchemyAction) => void; onPatch: (patch: Partial<XlchemyCardState>) => void; onReloadDefaults: () => Promise<void>; onRestoreDefaults: () => void; onSaveDefaults: () => Promise<void>; onOpenConfig?: () => Promise<void> | void; onCopyText: (text: string) => Promise<void> | void | undefined
}

function CollapsedView(props: ViewProps) {
  return <div data-testid="xlchemy-collapsed-view" className="flex h-full w-full items-center gap-2 rounded-xl border bg-card px-3 py-2"><Images className="size-5 text-primary" /><div className="min-w-0 flex-1"><div className="flex items-center gap-2 text-xs font-semibold">Xlchemy <Badge variant="outline">{props.format}</Badge></div><div className="truncate text-xs text-muted-foreground">{props.paths.length} 项 · {props.data.lossless ? "无损" : `质量 ${props.data.quality ?? 90}`}</div></div><RunButton compact props={props} /></div>
}

function CompactView(props: ViewProps & { portrait: boolean }) {
  return <div data-testid={props.portrait ? "xlchemy-portrait-view" : "xlchemy-compact-view"} className="flex min-h-0 flex-1 flex-col gap-2 p-2"><Header props={props} /><ScrollArea className="min-h-0 flex-1"><div className="flex flex-col gap-2 pr-2"><WorkbenchCard title={props.t("sections.input", "输入文件")} grow><InputWorkbench props={props} /></WorkbenchCard><WorkbenchCard title="目标格式与过滤"><FormatControls props={props} compact /><Separator /><InputFilterCard props={props} embedded /></WorkbenchCard><WorkbenchCard title="转换进度"><ProgressWorkbench data={props.data} format={props.format} paths={props.paths} progress={props.progress} result={props.result} running={props.running} onPatch={props.onPatch} /></WorkbenchCard><WorkbenchCard title="转换结果"><ResultPanel props={props} /></WorkbenchCard><WorkbenchCard title="转换日志"><ConversionLog logs={props.data.logs ?? []} onClear={() => props.onPatch({ logs: [] })} onCopy={(text) => void props.onCopyText(text)} /></WorkbenchCard></div></ScrollArea></div>
}

function FullView(props: ViewProps) {
  if (props.surfaceMode === "workspace") return <WorkspaceWorkbench props={props} />
  return (
    <div data-testid="xlchemy-full-view" className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <Header props={props} />
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1" data-testid="xlchemy-workbench-layout">
        <ResizablePanel id="xlchemy-input" defaultSize={58} minSize={44}>
        <ScrollArea className="h-full min-h-0"><div className="flex flex-col gap-3 pr-2">
          <WorkbenchCard icon={FolderInput} title={props.t("sections.input", "输入文件")} badge={`${props.paths.length} 项`} grow>
            <InputWorkbench props={props} />
          </WorkbenchCard>
          <WorkbenchCard title="转换进度"><ProgressWorkbench data={props.data} format={props.format} paths={props.paths} progress={props.progress} result={props.result} running={props.running} onPatch={props.onPatch} /></WorkbenchCard>
          <DataAnalysisCard props={props} />
        </div></ScrollArea>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel id="xlchemy-configuration" defaultSize={42} minSize={32}>
        <ScrollArea className="h-full min-h-0"><div className="flex flex-col gap-3 pl-3 pr-2">
            <PresetMatrix props={props} />
            <WorkbenchCard icon={Gauge} title={props.t("sections.formatHub", "校准矩阵")} badge={formatExtension(props.format)}>
              <SectionLabel>目标格式</SectionLabel>
              <FormatControls props={props} />
              <EncoderTuning props={props} />
              <Separator />
              <SectionLabel>输入过滤</SectionLabel>
              <InputFilterCard props={props} embedded />
              <Separator />
              <SectionLabel>转换设置</SectionLabel>
              <ConversionOptions props={props} />
              <Separator />
              <SectionLabel>保存到</SectionLabel>
              <OutputOptions props={props} />
              <Separator />
              <SectionLabel>缩小</SectionLabel>
              <DownscalingCard props={props} embedded />
              <Separator />
              <SectionLabel>元数据与时间</SectionLabel>
              <MetadataCard props={props} embedded />
            </WorkbenchCard>
            <Button variant="outline" onClick={() => props.onExecute("plan")} disabled={props.running || !props.paths.length}>预览计划</Button>
            <WorkbenchCard title="转换结果" defaultOpen><ResultPanel props={props} /></WorkbenchCard>
            <WorkbenchCard title="转换日志"><ConversionLog logs={props.data.logs ?? []} onClear={() => props.onPatch({ logs: [] })} onCopy={(text) => void props.onCopyText(text)} /></WorkbenchCard>
        </div></ScrollArea>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}

function WorkspaceWorkbench({ props }: { props: ViewProps }) {
  return <div data-testid="xlchemy-full-view" className="flex min-h-0 flex-1 flex-col gap-3 p-3">
    <Header props={props} />
    <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1" data-testid="xlchemy-workbench-layout">
      <ResizablePanel id="xlchemy-workspace-input" defaultSize={58} minSize={46}>
        <ResizablePanelGroup orientation="vertical" className="min-h-0 pr-3">
          <ResizablePanel id="xlchemy-input-files" defaultSize={58} minSize={42}>
            <WorkbenchCard fill grow icon={FolderInput} title={props.t("sections.input", "输入文件")} badge={`${props.paths.length} 项`}><InputWorkbench props={props} /></WorkbenchCard>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel id="xlchemy-run-feedback" defaultSize={42} minSize={30}>
            <div className="grid h-full min-h-0 grid-cols-[minmax(0,1.15fr)_minmax(240px,0.85fr)] gap-3 pt-3">
              <WorkbenchCard fill title="转换进度"><ScrollArea className="h-full"><div className="pr-2"><ProgressWorkbench data={props.data} format={props.format} paths={props.paths} progress={props.progress} result={props.result} running={props.running} onPatch={props.onPatch} /></div></ScrollArea></WorkbenchCard>
              <WorkbenchCard fill title="数据分析"><ScrollArea className="h-full"><div className="pr-2"><DataAnalysisCard props={props} embedded /></div></ScrollArea></WorkbenchCard>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel id="xlchemy-workspace-configuration" defaultSize={42} minSize={32}>
        <ResizablePanelGroup orientation="vertical" className="min-h-0 pl-3">
          <ResizablePanel id="xlchemy-settings" defaultSize={60} minSize={42}>
            <ScrollArea className="h-full"><div className="flex flex-col gap-3 pr-2"><PresetMatrix props={props} /><ConfigurationCard props={props} /><Button variant="outline" onClick={() => props.onExecute("plan")} disabled={props.running || !props.paths.length}>预览计划</Button></div></ScrollArea>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel id="xlchemy-results-and-log" defaultSize={40} minSize={28}>
            <div className="grid h-full min-h-0 grid-rows-[minmax(8rem,0.8fr)_minmax(10rem,1.2fr)] gap-3 pt-3">
              <WorkbenchCard fill title="转换结果"><ResultPanel props={props} /></WorkbenchCard>
              <WorkbenchCard fill title="转换日志"><ConversionLog logs={props.data.logs ?? []} onClear={() => props.onPatch({ logs: [] })} onCopy={(text) => void props.onCopyText(text)} /></WorkbenchCard>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>
    </ResizablePanelGroup>
  </div>
}

function ConfigurationCard({ props }: { props: ViewProps }) {
  return <WorkbenchCard icon={Gauge} title={props.t("sections.formatHub", "校准矩阵")} badge={formatExtension(props.format)}>
    <SectionLabel>目标格式</SectionLabel><FormatControls props={props} /><EncoderTuning props={props} /><Separator />
    <SectionLabel>输入过滤</SectionLabel><InputFilterCard props={props} embedded /><Separator />
    <SectionLabel>转换设置</SectionLabel><ConversionOptions props={props} /><Separator />
    <SectionLabel>保存到</SectionLabel><OutputOptions props={props} /><Separator />
    <SectionLabel>缩小</SectionLabel><DownscalingCard props={props} embedded /><Separator />
    <SectionLabel>元数据与时间</SectionLabel><MetadataCard props={props} embedded />
  </WorkbenchCard>
}

function Header({ props }: { props: ViewProps }) {
  return <div className="flex shrink-0 items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-2"><div className="grid size-9 place-items-center rounded-md bg-primary text-primary-foreground"><Images /></div><div className="min-w-0"><div className="flex items-center gap-2"><h3 className="truncate text-sm font-semibold">Xlchemy</h3><Badge variant={props.data.phase === "error" ? "destructive" : props.data.phase === "completed" ? "default" : "outline"}>{statusLabel(props)}</Badge></div><div className="truncate text-xs text-muted-foreground">{props.data.progressText || props.t("subtitle", "高性能图片批量转码工作台")}</div></div></div><div className="flex items-center gap-1"><NodeConfigPopover configPath={props.configPath} defaults={props.defaults} dirty={props.configDirty} disabled={props.running} t={props.t} onOpenFile={props.onOpenConfig} onReload={props.onReloadDefaults} onRestore={props.onRestoreDefaults} onSave={props.onSaveDefaults} /><Button aria-label="清空状态" size="icon-sm" variant="outline" onClick={() => props.onPatch({ phase: "idle", progress: 0, progressText: "", result: null })}><RotateCcw /></Button></div></div>
}

function InputWorkbench({ props }: { props: ViewProps }) {
  return <InputFilesWorkbench data={props.data} disabled={props.running} footer={<RunButton className="w-full" label={`转换 (${props.paths.length})`} props={props} />} getFileUrl={props.getFileUrl} result={props.result} onCopyPath={(path) => void props.onCopyText(path)} onPatch={props.onPatch} />
}

function PresetMatrix({ props }: { props: ViewProps }) {
  return <WorkbenchCard icon={Gauge} title={props.t("sections.presets", "预设")}><div className="grid grid-cols-2 gap-2">{PRESETS.map((preset) => <Button key={preset.id} className="h-auto justify-start px-3 py-2" variant={props.data.selectedPreset === preset.id ? "secondary" : "outline"} onClick={() => props.onPatch({ selectedPreset: preset.id, format: preset.format, lossless: preset.lossless, quality: preset.quality, effort: preset.effort })}><preset.icon data-icon="inline-start" /><span className="min-w-0 text-left"><span className="block truncate text-xs font-semibold">{preset.label}</span><span className="block truncate text-[10px] text-muted-foreground">{preset.format} · {preset.lossless ? "无损" : `质量 ${preset.quality}`}</span></span></Button>)}</div></WorkbenchCard>
}

function FormatControls({ props, compact }: { props: ViewProps; compact?: boolean }) {
  const lossy = !(props.data.lossless ?? false)
  return <div className="flex flex-col gap-3"><ToggleGroup type="single" value={props.format} className="grid grid-cols-3" size="sm" variant="outline" onValueChange={(value) => value && props.onPatch({ format: value as XlchemyFormat })}>{FORMATS.map((item) => <ToggleGroupItem key={item.value} value={item.value}>{item.label}</ToggleGroupItem>)}</ToggleGroup><ToggleGroup type="single" value={lossy ? "lossy" : "lossless"} className="grid grid-cols-2" size="sm" onValueChange={(value) => value && props.onPatch({ lossless: value === "lossless" })}><ToggleGroupItem value="lossless">无损</ToggleGroupItem><ToggleGroupItem value="lossy">有损 Modular</ToggleGroupItem></ToggleGroup>{lossy && <SliderField label="质量" value={props.data.quality ?? 90} min={1} max={100} onChange={(quality) => props.onPatch({ quality })} />}<SliderField label="压缩力度" value={props.data.effort ?? 7} min={1} max={10} onChange={(effort) => props.onPatch({ effort })} />{compact && <SliderField label="线程" value={props.data.threads ?? 4} min={1} max={32} onChange={(threads) => props.onPatch({ threads })} />}</div>
}

function InputFilterCard({ props, embedded = false }: { props: ViewProps; embedded?: boolean }) {
  const excluded = new Set(String(props.data.excludedFormatsText ?? "avif,jxl,webp,gif").split(/[,;\s]+/).map((value) => value.toLowerCase()).filter(Boolean))
  const enabled = XL_INPUT_FORMATS.filter((format) => !excluded.has(format))
  const content = <><Field><FieldLabel>输入格式</FieldLabel><ToggleGroup type="multiple" value={enabled} variant="outline" size="sm" spacing={1} className="flex w-full flex-wrap justify-start" onValueChange={(values) => props.onPatch({ excludedFormatsText: XL_INPUT_FORMATS.filter((format) => !values.includes(format)).join(",") })}>{XL_INPUT_FORMATS.map((format) => <ToggleGroupItem key={format} value={format} aria-label={`${enabled.includes(format) ? "禁用" : "启用"} .${format.toUpperCase()}`} className="h-6 flex-none px-2 text-[10px] uppercase data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">.{format}</ToggleGroupItem>)}</ToggleGroup></Field><div className="grid grid-cols-2 gap-2"><SelectField label="处理顺序" value={props.data.processingOrder ?? "original"} options={[["original", "原始顺序"], ["path-asc", "路径升序"], ["path-desc", "路径降序"], ["size-asc", "大小升序"], ["size-desc", "大小降序"], ["random", "随机"], ["sequential", "顺序处理"]]} onChange={(processingOrder) => props.onPatch({ processingOrder: processingOrder as XlchemyCardState["processingOrder"] })} /><SwitchField label="递归子目录" checked={props.data.recursive ?? true} onChange={(recursive) => props.onPatch({ recursive })} /></div></>
  return embedded ? content : <WorkbenchCard title="输入过滤">{content}</WorkbenchCard>
}

function EncoderTuning({ props }: { props: ViewProps }) {
  if (props.format === "JPEG XL") return <div className="grid grid-cols-2 gap-2"><SwitchField label="智能压缩力度" checked={props.data.intelligentEffort ?? false} onChange={(intelligentEffort) => props.onPatch({ intelligentEffort })} /><SwitchField label="有损 Modular" checked={props.data.jxlModular ?? false} onChange={(jxlModular) => props.onPatch({ jxlModular })} /><SwitchField label="校验完整性" checked={props.data.jxlVerify ?? false} onChange={(jxlVerify) => props.onPatch({ jxlVerify })} /><SwitchField label="PNG 回退" checked={props.data.jxlPngFallback ?? true} onChange={(jxlPngFallback) => props.onPatch({ jxlPngFallback })} /><SwitchField label="编码前标准化" checked={props.data.jxlNormalize ?? false} onChange={(jxlNormalize) => props.onPatch({ jxlNormalize })} />{props.data.jxlNormalize && <SelectField label="标准化时机" value={props.data.jxlNormalizeWhen ?? "on-fail"} options={[["on-fail", "失败时"], ["always", "始终"]]} onChange={(jxlNormalizeWhen) => props.onPatch({ jxlNormalizeWhen: jxlNormalizeWhen as "on-fail" | "always" })} />}</div>
  if (props.format === "AVIF") return <div className="grid grid-cols-2 gap-2"><SelectField label="AVIF 编码器" value={props.data.avifEncoder ?? "aom"} options={[["aom", "AOM AV1"], ["svt", "SVT-AV1"]]} onChange={(avifEncoder) => props.onPatch({ avifEncoder: avifEncoder as "aom" | "svt" })} /><SelectField label="位深" value={props.data.avifBitDepth ?? "auto"} options={[["auto", "自动"], ["8", "8-bit"], ["10", "10-bit"], ["12", "12-bit"]]} onChange={(avifBitDepth) => props.onPatch({ avifBitDepth: avifBitDepth as XlchemyCardState["avifBitDepth"] })} /><SelectField label="色度采样" value={props.data.chromaSubsampling ?? "default"} options={[["default", "默认"], ["444", "4:4:4"], ["422", "4:2:2"], ["420", "4:2:0"]]} onChange={(chromaSubsampling) => props.onPatch({ chromaSubsampling })} /></div>
  if (props.format === "JPEG") return <div className="grid grid-cols-2 gap-2"><SelectField label="JPEG 编码器" value={props.data.jpegEncoder ?? "jpegli"} options={[["jpegli", "JPEGLI"], ["libjpeg", "libjpeg"]]} onChange={(jpegEncoder) => props.onPatch({ jpegEncoder: jpegEncoder as "jpegli" | "libjpeg" })} /><SelectField label="色度采样" value={props.data.chromaSubsampling ?? "default"} options={[["default", "默认"], ["444", "4:4:4"], ["422", "4:2:2"], ["420", "4:2:0"]]} onChange={(chromaSubsampling) => props.onPatch({ chromaSubsampling })} /></div>
  return null
}

function ConversionOptions({ props }: { props: ViewProps }) {
  return <div className="flex flex-col gap-3"><SliderField label="并行线程" value={props.data.threads ?? 4} min={1} max={32} onChange={(threads) => props.onPatch({ threads })} /><SelectField label="同名输出" value={props.data.existingPolicy ?? (props.data.overwrite ? "replace" : "skip")} options={[["replace", "覆盖"], ["skip", "跳过"], ["rename", "自动改名"]]} onChange={(existingPolicy) => props.onPatch({ existingPolicy: existingPolicy as XlchemyCardState["existingPolicy"], overwrite: existingPolicy === "replace" })} /><div className="grid grid-cols-2 gap-2"><SwitchField label="保留较大结果" checked={props.data.keepIfLarger ?? false} onChange={(keepIfLarger) => props.onPatch({ keepIfLarger })} /><SwitchField label="较大时复制原图" checked={props.data.copyIfLarger ?? false} onChange={(copyIfLarger) => props.onPatch({ copyIfLarger })} /></div></div>
}

function SliderField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return <Field><div className="flex items-center justify-between"><FieldLabel>{label}</FieldLabel><Badge variant="outline">{value}</Badge></div><Slider min={min} max={max} step={1} value={[value]} onValueChange={(values) => onChange(values[0] ?? value)} /></Field>
}

function OutputOptions({ props }: { props: ViewProps }) {
  return <div className="grid gap-2"><ToggleGroup type="single" value={props.data.outputMode ?? "source"} className="grid grid-cols-2" size="sm" variant="outline" onValueChange={(value) => value && props.onPatch({ outputMode: value as "source" | "directory" })}><ToggleGroupItem value="source">源文件旁</ToggleGroupItem><ToggleGroupItem value="directory">指定目录</ToggleGroupItem></ToggleGroup>{props.data.outputMode === "directory" && <Input aria-label="xlchemy output directory" placeholder="D:/output" value={props.data.outputDir ?? ""} onChange={(event) => props.onPatch({ outputDir: event.currentTarget.value })} />}<div className="grid grid-cols-2 gap-2"><SwitchField label="保留目录结构" checked={props.data.preserveStructure ?? true} onChange={(preserveStructure) => props.onPatch({ preserveStructure })} /><SwitchField label="转换后删除原图" checked={props.data.deleteOriginal ?? false} onChange={(deleteOriginal) => props.onPatch({ deleteOriginal })} /></div>{props.data.deleteOriginal && <SelectField label="删除方式" value={props.data.deleteOriginalMode ?? "trash"} options={[["trash", "移到回收站"], ["permanent", "永久删除"]]} onChange={(deleteOriginalMode) => props.onPatch({ deleteOriginalMode: deleteOriginalMode as "trash" | "permanent" })} />}</div>
}

function DownscalingCard({ props, embedded = false }: { props: ViewProps; embedded?: boolean }) {
  const mode = props.data.downscaleMode ?? "resolution"
  const content = <><SwitchField label="启用缩小" checked={props.data.downscaleEnabled ?? false} onChange={(downscaleEnabled) => props.onPatch({ downscaleEnabled })} />{props.data.downscaleEnabled && <><SelectField label="缩小模式" value={mode} options={[["resolution", "分辨率"], ["percent", "百分比"], ["file-size", "目标文件大小"], ["shortest-side", "最短边"], ["longest-side", "最长边"], ["megapixels", "百万像素"]]} onChange={(downscaleMode) => props.onPatch({ downscaleMode: downscaleMode as XlchemyCardState["downscaleMode"] })} /><div className="grid grid-cols-2 gap-2">{mode === "resolution" && <><NumberField label="宽度" value={props.data.downscaleWidth ?? 1920} onChange={(downscaleWidth) => props.onPatch({ downscaleWidth })} /><NumberField label="高度" value={props.data.downscaleHeight ?? 1080} onChange={(downscaleHeight) => props.onPatch({ downscaleHeight })} /></>}{mode === "percent" && <NumberField label="百分比" value={props.data.downscalePercent ?? 50} onChange={(downscalePercent) => props.onPatch({ downscalePercent })} />}{mode === "file-size" && <NumberField label="目标 KB" value={props.data.downscaleFileSizeKb ?? 500} onChange={(downscaleFileSizeKb) => props.onPatch({ downscaleFileSizeKb })} />}{mode === "shortest-side" && <NumberField label="最短边" value={props.data.downscaleShortestSide ?? 1080} onChange={(downscaleShortestSide) => props.onPatch({ downscaleShortestSide })} />}{mode === "longest-side" && <NumberField label="最长边" value={props.data.downscaleLongestSide ?? 1920} onChange={(downscaleLongestSide) => props.onPatch({ downscaleLongestSide })} />}{mode === "megapixels" && <NumberField label="百万像素" value={props.data.downscaleMegapixels ?? 2.1} step={0.1} onChange={(downscaleMegapixels) => props.onPatch({ downscaleMegapixels })} />}</div><SelectField label="重采样" value={props.data.downscaleResample ?? "default"} options={[["default", "默认"], ["lanczos", "Lanczos"], ["mitchell", "Mitchell"], ["catrom", "Catmull-Rom"], ["box", "Box"]]} onChange={(downscaleResample) => props.onPatch({ downscaleResample })} /></>}</>
  return embedded ? content : <WorkbenchCard title="缩小">{content}</WorkbenchCard>
}

function MetadataCard({ props, embedded = false }: { props: ViewProps; embedded?: boolean }) {
  const content = <><SelectField label="元数据策略" value={props.data.metadataMode ?? "encoder-preserve"} options={[["encoder-wipe", "编码器 · 清除"], ["encoder-preserve", "编码器 · 保留"], ["exiftool-wipe", "ExifTool · 清除"], ["exiftool-preserve", "ExifTool · 保留"], ["exiftool-unsafe-wipe", "ExifTool · 完全清除"]]} onChange={(metadataMode) => props.onPatch({ metadataMode: metadataMode as XlchemyCardState["metadataMode"], preserveMetadata: metadataMode.includes("preserve") })} /><SwitchField label="保留文件时间戳" checked={props.data.preserveTimestamps ?? false} onChange={(preserveTimestamps) => props.onPatch({ preserveTimestamps })} /></>
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
  return <Tabs defaultValue="results" className="flex h-full min-h-0 flex-col"><TabsList variant="line"><TabsTrigger value="results"><CheckCircle2 />结果</TabsTrigger><TabsTrigger value="issues"><AlertTriangle />问题</TabsTrigger><TabsTrigger value="logs"><Terminal />日志</TabsTrigger></TabsList><TabsContent value="results" className="min-h-0 flex-1"><ScrollArea className="h-full"><div className="grid gap-1.5 p-2">{props.result?.files.length ? props.result.files.map((file) => <div key={file.sourcePath} className="flex items-center gap-2 rounded-md border px-2 py-1.5"><FileImage className="size-4 text-muted-foreground" /><div className="min-w-0 flex-1"><div className="truncate text-xs">{baseName(file.sourcePath)}</div><div className="truncate text-[10px] text-muted-foreground">{file.outputPath}</div></div><Badge variant={file.status === "error" ? "destructive" : "outline"}>{file.status}</Badge></div>) : <div className="p-4 text-center text-xs text-muted-foreground">预览后显示输出路径和编码结果</div>}</div></ScrollArea></TabsContent><TabsContent value="issues" className="p-3 text-xs text-muted-foreground">{props.result?.errors.join("\n") || "暂无问题"}</TabsContent><TabsContent value="logs"><pre className="p-3 text-xs text-muted-foreground">{props.data.logs?.join("\n") || "运行日志将在这里显示"}</pre></TabsContent></Tabs>
}

function WorkbenchCard({ badge, children, fill = false, grow = false, icon: Icon, title }: { badge?: string; children: ReactNode; defaultOpen?: boolean; fill?: boolean; grow?: boolean; icon?: LucideIcon; title: string }) {
  return <Card className={cn("gap-0 py-0 shadow-none", (fill || grow) && "min-h-0", fill && "h-full")}><CardHeader className="min-h-9 grid-cols-[1fr_auto] items-center gap-2 border-b px-3 py-2"><span className="flex items-center gap-2 text-xs font-semibold">{Icon && <Icon />}{title}</span><CardAction>{badge && <Badge variant="outline">{badge}</Badge>}</CardAction></CardHeader><CardContent className={cn("flex flex-col gap-3 px-3 py-3", fill && "min-h-0 flex-1 overflow-hidden")}>{children}</CardContent></Card>
}

function DataAnalysisCard({ props, embedded = false }: { props: ViewProps; embedded?: boolean }) {
  const ratio = props.result ? compressionRatio(props.result) : 0
  const input = props.result?.inputBytes ?? 0
  const output = props.result?.outputBytes ?? 0
  const content = <><div className="grid grid-cols-3 gap-2"><Metric label="节省空间" value={`${ratio}%`} /><Metric label="处理成功" value={`${props.result?.convertedCount ?? 0}/${props.result?.inputCount ?? props.paths.length}`} /><Metric label="耗时" value={formatDuration(props.result?.elapsedMs)} /></div><div className="flex flex-col gap-2"><SizeBar label="转换前" bytes={input} ratio={100} /><SizeBar label="转换后" bytes={output} ratio={input > 0 ? Math.max(3, output / input * 100) : 0} /></div></>
  return embedded ? content : <WorkbenchCard title="数据分析">{content}</WorkbenchCard>
}

function SizeBar({ bytes, label, ratio }: { bytes: number; label: string; ratio: number }) { return <div className="grid grid-cols-[3.5rem_minmax(0,1fr)_4.5rem] items-center gap-2 text-[10px]"><span className="text-muted-foreground">{label}</span><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary/70" style={{ width: `${ratio}%` }} /></div><span className="text-right tabular-nums">{formatBytes(bytes)}</span></div> }
function SectionLabel({ children }: { children: ReactNode }) { return <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{children}</div> }
function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-md border bg-card px-2 py-1.5"><div className="text-[10px] text-muted-foreground">{label}</div><div className="text-sm font-semibold tabular-nums">{value}</div></div> }
function splitLines(value?: string) { return String(value ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean) }
function baseName(path: string) { return path.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? path }
function formatExtension(format: XlchemyFormat) { return FORMATS.find((item) => item.value === format)?.extension ?? "" }
function formatBytes(bytes: number) { if (!bytes) return "0 B"; const units = ["B", "KB", "MB", "GB"]; const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1); return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}` }
function formatDuration(milliseconds?: number) { if (!milliseconds) return "--"; const seconds = Math.round(milliseconds / 1000); return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s` }
function statusLabel(props: ViewProps) { if (props.running || props.data.phase === "running") return "运行中"; if (props.data.phase === "completed") return "完成"; if (props.data.phase === "cancelled") return "已取消"; if (props.data.phase === "error") return "错误"; return "在线" }
function buildInput(action: XlchemyAction, data: XlchemyCardState): XlchemyInput { return normalizeXlchemyInput({ action, paths: splitLines(data.pathsText), format: data.format, lossless: data.lossless, quality: data.quality, effort: data.effort, threads: data.threads, outputMode: data.outputMode, outputDir: data.outputDir, preserveMetadata: data.preserveMetadata, preserveStructure: data.preserveStructure, preserveTimestamps: data.preserveTimestamps, overwrite: data.overwrite, existingPolicy: data.existingPolicy, recursive: data.recursive, deleteOriginal: data.deleteOriginal, deleteOriginalMode: data.deleteOriginalMode, intelligentEffort: data.intelligentEffort, jxlModular: data.jxlModular, jxlVerify: data.jxlVerify, jxlPngFallback: data.jxlPngFallback, jxlNormalize: data.jxlNormalize, jxlNormalizeWhen: data.jxlNormalizeWhen, chromaSubsampling: data.chromaSubsampling, metadataMode: data.metadataMode, keepIfLarger: data.keepIfLarger, copyIfLarger: data.copyIfLarger, jpegEncoder: data.jpegEncoder, avifEncoder: data.avifEncoder, avifBitDepth: data.avifBitDepth, processingOrder: data.processingOrder, excludedFormats: String(data.excludedFormatsText ?? "avif,jxl,webp,gif").split(/[,;\s]+/).filter(Boolean), downscale: { enabled: data.downscaleEnabled ?? false, mode: data.downscaleMode ?? "resolution", width: data.downscaleWidth ?? 1920, height: data.downscaleHeight ?? 1080, percent: data.downscalePercent ?? 50, fileSizeKb: data.downscaleFileSizeKb ?? 500, shortestSide: data.downscaleShortestSide ?? 1080, longestSide: data.downscaleLongestSide ?? 1920, megapixels: data.downscaleMegapixels ?? 2.1, resample: data.downscaleResample ?? "default" } }) }
function getHostData(host: NodeComponentProps<XlchemyCardState>["host"], compId: string): XlchemyCardState { return host.state?.getData?.() ?? host.getData<XlchemyCardState>(compId) ?? {} }

const XL_INPUT_FORMATS = ["jxl", "jpg", "jpeg", "jfif", "jif", "jpe", "png", "apng", "gif", "webp", "jp2", "bmp", "ico", "tiff", "tif", "avif"]

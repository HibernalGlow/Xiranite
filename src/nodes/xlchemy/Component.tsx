import { useEffect, useMemo, useRef, useState } from "react"
import type { NodeComponentProps, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type { XlchemyAction, XlchemyData, XlchemyFormat, XlchemyInput } from "@xiranite/node-xlchemy/core"
import { compressionRatio, normalizeXlchemyInput } from "@xiranite/node-xlchemy/core"
import { AlertTriangle, CheckCircle2, Clipboard, FileImage, FolderInput, Gauge, Images, Play, RotateCcw, Square, Terminal } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldContent, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { NodeConfigPopover } from "@/nodes/shared/NodeConfigPopover"
import { useNodeI18n } from "@/nodes/shared/useNodeI18n"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import { FORMATS, PRESETS } from "./constants"
import type { XlchemyCardState } from "./types"
import { XL_CONFIG_FIELDS } from "./types"

export function Component({ compId, host }: NodeComponentProps<XlchemyCardState>) {
  const surface = useNodeSurface()
  const { t } = useNodeI18n("xlchemy")
  const data = getHostData(host, compId)
  const dataRef = useRef(data)
  dataRef.current = data
  const [running, setRunning] = useState(false)
  const [defaults, setDefaults] = useState<Partial<XlchemyCardState>>()
  const [configPath, setConfigPath] = useState<string>()
  const [configDirty, setConfigDirty] = useState(false)

  const paths = useMemo(() => splitLines(data.pathsText), [data.pathsText])
  const result = data.result ?? null
  const progress = data.progress ?? 0
  const format = data.format ?? "JPEG XL"
  const action = data.action ?? "plan"
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

  async function pastePaths() {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ pathsText: text.trim() })
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
    const input = buildInput(nextAction, dataRef.current)
    if (!input.paths.length) { patch({ phase: "error", progressText: t("errors.paths", "请先添加图片文件或文件夹。") }); return }
    const run = host.runner?.run ?? host.actions?.run
    if (!run) { patch({ phase: "error", progressText: t("errors.backend", "GUI 已就绪，等待 Xlchemy 后端执行接口接入。") }); return }
    setRunning(true)
    patch({ action: nextAction, phase: "running", progress: 0, progressText: t("status.start", "正在准备 Xlchemy 转换任务…"), result: null })
    try {
      const response = await run<XlchemyInput, XlchemyData>("xlchemy", input, (event: NodeRunEvent) => {
        if (event.type === "progress") patch({ progress: event.progress ?? 0, progressText: event.message })
      }) as NodeRunResult<XlchemyData>
      patch({ phase: response.success ? "completed" : "error", progress: response.success ? 100 : 0, progressText: response.message, result: response.data ?? null })
    } catch (error) {
      patch({ phase: "error", progress: 0, progressText: error instanceof Error ? error.message : String(error) })
    } finally { setRunning(false) }
  }

  const props: ViewProps = {
    action, configDirty, configPath, data, defaults, format, paths, progress, result, running, t,
    onExecute: execute, onPastePaths: pastePaths, onPatch: patch,
    onReloadDefaults: reloadDefaults, onRestoreDefaults: () => defaults && patch(defaults), onSaveDefaults: saveDefaults,
    onOpenConfig: host.config?.openFile ?? host.openConfigFile,
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
  action: XlchemyAction; configDirty: boolean; configPath?: string; data: XlchemyCardState; defaults?: Partial<XlchemyCardState>; format: XlchemyFormat; paths: string[]; progress: number; result: XlchemyData | null; running: boolean; t: NodeT
  onExecute: (action: XlchemyAction) => void; onPastePaths: () => void; onPatch: (patch: Partial<XlchemyCardState>) => void; onReloadDefaults: () => Promise<void>; onRestoreDefaults: () => void; onSaveDefaults: () => Promise<void>; onOpenConfig?: () => Promise<void> | void
}

function CollapsedView(props: ViewProps) {
  return <div data-testid="xlchemy-collapsed-view" className="flex h-full w-full items-center gap-2 rounded-xl border bg-card px-3 py-2"><Images className="size-5 text-primary" /><div className="min-w-0 flex-1"><div className="flex items-center gap-2 text-xs font-semibold">Xlchemy <Badge variant="outline">{props.format}</Badge></div><div className="truncate text-xs text-muted-foreground">{props.paths.length} 项 · {props.data.lossless ? "无损" : `质量 ${props.data.quality ?? 90}`}</div></div><RunButton compact props={props} /></div>
}

function CompactView(props: ViewProps & { portrait: boolean }) {
  return <div data-testid={props.portrait ? "xlchemy-portrait-view" : "xlchemy-compact-view"} className="flex min-h-0 flex-1 flex-col gap-2 p-2"><Header props={props} compact /><FormatControls props={props} compact /><PathEditor props={props} compact /><RunButton props={props} /><ResultPanel props={props} /></div>
}

function FullView(props: ViewProps) {
  return (
    <div data-testid="xlchemy-full-view" className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <Header props={props} />
      <div className="grid min-h-0 flex-1 gap-3 @2xl/xlchemy:grid-cols-[minmax(280px,0.82fr)_minmax(0,1.45fr)]">
        <div className="grid min-h-0 gap-3 grid-rows-[minmax(0,1fr)_auto]">
          <section className="flex min-h-0 flex-col gap-3 rounded-lg border bg-card p-3">
            <PanelTitle icon={FolderInput} title={props.t("sections.input", "输入端口")} badge={`${props.paths.length} 项`} />
            <PathEditor props={props} />
            <InputQueue paths={props.paths} />
          </section>
          <PresetMatrix props={props} />
        </div>
        <section className="grid min-h-0 gap-3 rounded-lg border bg-card p-3 @5xl/xlchemy:grid-cols-[minmax(260px,1fr)_minmax(230px,0.9fr)]">
          <div className="flex min-h-0 flex-col gap-3">
            <PanelTitle icon={Gauge} title={props.t("sections.formatHub", "格式工作台")} badge={formatExtension(props.format)} />
            <FormatControls props={props} />
            <OutputOptions props={props} />
            <div className="min-h-0 flex-1"><ResultPanel props={props} /></div>
          </div>
          <BatchGate props={props} />
        </section>
      </div>
    </div>
  )
}

function Header({ props, compact }: { props: ViewProps; compact?: boolean }) {
  return <div className="flex shrink-0 items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-2"><div className="grid size-9 place-items-center rounded-md bg-primary text-primary-foreground"><Images /></div><div className="min-w-0"><div className="flex items-center gap-2"><h3 className="truncate text-sm font-semibold">Xlchemy</h3><Badge variant={props.data.phase === "error" ? "destructive" : props.data.phase === "completed" ? "default" : "outline"}>{statusLabel(props)}</Badge></div><div className="truncate text-xs text-muted-foreground">{props.data.progressText || props.t("subtitle", "高性能图片批量转码工作台")}</div></div></div><div className="flex items-center gap-1">{!compact && <NodeConfigPopover configPath={props.configPath} defaults={props.defaults} dirty={props.configDirty} disabled={props.running} t={props.t} onOpenFile={props.onOpenConfig} onReload={props.onReloadDefaults} onRestore={props.onRestoreDefaults} onSave={props.onSaveDefaults} />}<Button aria-label="清空状态" size="icon-sm" variant="outline" onClick={() => props.onPatch({ phase: "idle", progress: 0, progressText: "", result: null })}><RotateCcw /></Button></div></div>
}

function PathEditor({ props, compact }: { props: ViewProps; compact?: boolean }) {
  return <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_auto] gap-2"><Textarea aria-label="xlchemy input paths" className={cn("resize-none font-mono text-xs", compact ? "h-16" : "min-h-24 flex-1")} disabled={props.running} placeholder={"每行一个图片或文件夹\nD:/images"} value={props.data.pathsText ?? ""} onChange={(event) => props.onPatch({ pathsText: event.currentTarget.value })} /><div className="flex flex-col gap-1"><Button aria-label="粘贴路径" size="icon-sm" variant="outline" onClick={props.onPastePaths}><Clipboard /></Button><Button aria-label="清空路径" size="icon-sm" variant="outline" onClick={() => props.onPatch({ pathsText: "" })}><RotateCcw /></Button></div></div>
}

function InputQueue({ paths }: { paths: string[] }) {
  if (!paths.length) return <div className="flex min-h-24 flex-1 items-center justify-center rounded-md border border-dashed text-center text-xs text-muted-foreground">拖放由宿主接管；也可以粘贴文件或文件夹路径</div>
  return <ScrollArea className="min-h-0 flex-1"><div className="grid gap-1.5">{paths.map((path) => <div key={path} className="flex items-center gap-2 rounded-md border px-2 py-1.5"><FileImage className="size-4 text-muted-foreground" /><span className="min-w-0 flex-1 truncate text-xs">{baseName(path)}</span><Badge variant="outline">待处理</Badge></div>)}</div></ScrollArea>
}

function PresetMatrix({ props }: { props: ViewProps }) {
  return <section className="rounded-lg border bg-card p-3"><PanelTitle icon={Gauge} title={props.t("sections.presets", "预设矩阵")} /><div className="mt-3 grid grid-cols-2 gap-2">{PRESETS.map((preset) => <Button key={preset.id} className="h-auto justify-start px-3 py-2" variant={props.data.selectedPreset === preset.id ? "secondary" : "outline"} onClick={() => props.onPatch({ selectedPreset: preset.id, format: preset.format, lossless: preset.lossless, quality: preset.quality, effort: preset.effort })}><preset.icon data-icon="inline-start" /><span className="min-w-0 text-left"><span className="block truncate text-xs font-semibold">{preset.label}</span><span className="block truncate text-[10px] text-muted-foreground">{preset.format} · {preset.lossless ? "无损" : `质量 ${preset.quality}`}</span></span></Button>)}</div></section>
}

function FormatControls({ props, compact }: { props: ViewProps; compact?: boolean }) {
  const lossy = !(props.data.lossless ?? false)
  return <div className="flex flex-col gap-3"><div className="grid grid-cols-3 gap-1">{FORMATS.map((item) => <Button key={item.value} size="sm" variant={props.format === item.value ? "secondary" : "outline"} onClick={() => props.onPatch({ format: item.value })}>{item.label}</Button>)}</div><ToggleGroup type="single" value={lossy ? "lossy" : "lossless"} className="grid grid-cols-2" size="sm" onValueChange={(value) => value && props.onPatch({ lossless: value === "lossless" })}><ToggleGroupItem value="lossless">无损</ToggleGroupItem><ToggleGroupItem value="lossy">有损 Modular</ToggleGroupItem></ToggleGroup>{lossy && <SliderField label="质量" value={props.data.quality ?? 90} min={1} max={100} onChange={(quality) => props.onPatch({ quality })} />}<SliderField label="压缩力度" value={props.data.effort ?? 7} min={1} max={10} onChange={(effort) => props.onPatch({ effort })} />{!compact && <SliderField label="线程" value={props.data.threads ?? 4} min={1} max={32} onChange={(threads) => props.onPatch({ threads })} />}</div>
}

function SliderField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return <Field><div className="flex items-center justify-between"><FieldLabel>{label}</FieldLabel><Badge variant="outline">{value}</Badge></div><Slider min={min} max={max} step={1} value={[value]} onValueChange={(values) => onChange(values[0] ?? value)} /></Field>
}

function OutputOptions({ props }: { props: ViewProps }) {
  return <div className="grid gap-2"><div className="grid grid-cols-2 gap-2"><Button size="sm" variant={(props.data.outputMode ?? "source") === "source" ? "secondary" : "outline"} onClick={() => props.onPatch({ outputMode: "source" })}>源文件旁</Button><Button size="sm" variant={props.data.outputMode === "directory" ? "secondary" : "outline"} onClick={() => props.onPatch({ outputMode: "directory" })}>指定目录</Button></div>{props.data.outputMode === "directory" && <Input aria-label="xlchemy output directory" placeholder="D:/output" value={props.data.outputDir ?? ""} onChange={(event) => props.onPatch({ outputDir: event.currentTarget.value })} />}<div className="grid grid-cols-2 gap-2"><SwitchField label="保留元数据" checked={props.data.preserveMetadata ?? true} onChange={(preserveMetadata) => props.onPatch({ preserveMetadata })} /><SwitchField label="保留目录结构" checked={props.data.preserveStructure ?? true} onChange={(preserveStructure) => props.onPatch({ preserveStructure })} /><SwitchField label="递归目录" checked={props.data.recursive ?? true} onChange={(recursive) => props.onPatch({ recursive })} /><SwitchField label="覆盖已有文件" checked={props.data.overwrite ?? false} onChange={(overwrite) => props.onPatch({ overwrite })} /></div></div>
}

function SwitchField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  const id = `xlchemy-${label}`
  return <Field orientation="horizontal" className="rounded-md border px-2 py-1.5"><FieldContent><FieldLabel htmlFor={id} className="text-xs">{label}</FieldLabel></FieldContent><Switch id={id} size="sm" checked={checked} onCheckedChange={onChange} /></Field>
}

function BatchGate({ props }: { props: ViewProps }) {
  const ratio = props.result ? compressionRatio(props.result) : 0
  return <div className="flex min-h-0 flex-col gap-3 border-l pl-3"><div className="rounded-md border bg-muted/20 p-3"><div className="text-xs text-muted-foreground">批次遥测</div><div className="mt-2 grid grid-cols-2 gap-2"><Metric label="输入" value={String(props.result?.inputCount ?? props.paths.length)} /><Metric label="线程" value={String(props.data.threads ?? 4)} /><Metric label="节省" value={`${ratio}%`} /><Metric label="错误" value={String(props.result?.errorCount ?? 0)} /></div></div><div className="flex min-h-32 flex-1 flex-col items-center justify-center rounded-md border bg-muted/10 p-4"><div className="grid size-28 place-items-center rounded-full border-8 border-muted text-center"><span><strong className="block text-2xl text-primary">{props.progress}%</strong><span className="text-[10px] text-muted-foreground">BATCH</span></span></div>{props.data.currentFile && <div className="mt-3 max-w-full truncate text-xs text-muted-foreground">{baseName(props.data.currentFile)}</div>}</div><div className="grid gap-2"><Button variant="outline" onClick={() => props.onExecute("plan")} disabled={props.running || !props.paths.length}>预览计划</Button><RunButton props={props} /></div></div>
}

function RunButton({ props, compact }: { props: ViewProps; compact?: boolean }) {
  if (props.running) return <Button disabled size={compact ? "icon-sm" : "sm"} variant="secondary"><Square />{!compact && "转换中"}</Button>
  const live = props.action === "convert" && (props.data.overwrite ?? false)
  const button = <Button aria-label="开始转换" disabled={!props.paths.length} size={compact ? "icon-sm" : "sm"} variant={live ? "destructive" : "default"} onClick={live ? undefined : () => props.onExecute("convert")}><Play />{!compact && "开始转换"}</Button>
  if (!live) return button
  return <AlertDialog><AlertDialogTrigger asChild>{button}</AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>确认覆盖并转换？</AlertDialogTitle><AlertDialogDescription>Xlchemy 将写入目标文件，并允许覆盖已存在的输出。请先检查目标格式和输出位置。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => props.onExecute("convert")}>确认转换</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
}

function ResultPanel({ props }: { props: ViewProps }) {
  return <Tabs defaultValue="results" className="flex h-full min-h-0 flex-col"><TabsList variant="line"><TabsTrigger value="results"><CheckCircle2 />结果</TabsTrigger><TabsTrigger value="issues"><AlertTriangle />问题</TabsTrigger><TabsTrigger value="logs"><Terminal />日志</TabsTrigger></TabsList><TabsContent value="results" className="min-h-0 flex-1"><ScrollArea className="h-full"><div className="grid gap-1.5 p-2">{props.result?.files.length ? props.result.files.map((file) => <div key={file.sourcePath} className="flex items-center gap-2 rounded-md border px-2 py-1.5"><FileImage className="size-4 text-muted-foreground" /><div className="min-w-0 flex-1"><div className="truncate text-xs">{baseName(file.sourcePath)}</div><div className="truncate text-[10px] text-muted-foreground">{file.outputPath}</div></div><Badge variant={file.status === "error" ? "destructive" : "outline"}>{file.status}</Badge></div>) : <div className="p-4 text-center text-xs text-muted-foreground">预览后显示输出路径和编码结果</div>}</div></ScrollArea></TabsContent><TabsContent value="issues" className="p-3 text-xs text-muted-foreground">{props.result?.errors.join("\n") || "暂无问题"}</TabsContent><TabsContent value="logs"><pre className="p-3 text-xs text-muted-foreground">{props.data.logs?.join("\n") || "运行日志将在这里显示"}</pre></TabsContent></Tabs>
}

function PanelTitle({ icon: Icon, title, badge }: { icon: typeof FolderInput; title: string; badge?: string }) { return <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2"><Icon className="size-4 text-muted-foreground" /><span className="text-sm font-semibold">{title}</span></div>{badge && <Badge variant="outline">{badge}</Badge>}</div> }
function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-md border bg-card px-2 py-1.5"><div className="text-[10px] text-muted-foreground">{label}</div><div className="text-sm font-semibold tabular-nums">{value}</div></div> }
function splitLines(value?: string) { return String(value ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean) }
function baseName(path: string) { return path.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? path }
function formatExtension(format: XlchemyFormat) { return FORMATS.find((item) => item.value === format)?.extension ?? "" }
function statusLabel(props: ViewProps) { if (props.running || props.data.phase === "running") return "运行中"; if (props.data.phase === "completed") return "完成"; if (props.data.phase === "error") return "错误"; return "在线" }
function buildInput(action: XlchemyAction, data: XlchemyCardState): XlchemyInput { return normalizeXlchemyInput({ action, paths: splitLines(data.pathsText), format: data.format, lossless: data.lossless, quality: data.quality, effort: data.effort, threads: data.threads, outputMode: data.outputMode, outputDir: data.outputDir, preserveMetadata: data.preserveMetadata, preserveStructure: data.preserveStructure, overwrite: data.overwrite, recursive: data.recursive }) }
function getHostData(host: NodeComponentProps<XlchemyCardState>["host"], compId: string): XlchemyCardState { return host.state?.getData?.() ?? host.getData<XlchemyCardState>(compId) ?? {} }

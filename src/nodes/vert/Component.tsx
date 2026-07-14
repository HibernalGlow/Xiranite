import { useRef, useState } from "react"
import type { ChangeEvent } from "react"
import type { NodeComponentProps, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type { VertData, VertEnginePreference, VertFormatCategory, VertInput } from "@xiranite/node-vert/core"
import { chooseConverter, detectVertCategory, VERT_FORMAT_GROUPS } from "@xiranite/node-vert/core"
import { Check, Download, FileAudio, FileCog, FileImage, FileText, FileVideo, FolderOpen, Gauge, LoaderCircle, RefreshCw, RotateCcw, Upload, Zap } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldTitle } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { useLocalFileDrop } from "@/nodes/shared/useLocalFileDrop"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import type { VertBrowserOutput } from "./browserWasm"
import type { VertCardState } from "./types"

type OutputCategory = Exclude<VertFormatCategory, "unknown">
const DEFAULTS = { outputCategory: "image" as OutputCategory, targetFormat: "webp", engine: "auto" as const, overwrite: false, quality: 90 }
const DEFAULT_FORMAT: Record<OutputCategory, string> = { image: "webp", audio: "mp3", video: "mp4", document: "docx" }
const PICKER_CATEGORY_LABEL: Record<OutputCategory, string> = { image: "图片", audio: "音频", video: "视频", document: "文档" }
const VERT_PICKER_FILTERS = [
  { displayName: "所有支持的格式", pattern: Object.values(VERT_FORMAT_GROUPS).flat().map((format) => `*.${format}`).join(";") },
  ...Object.entries(VERT_FORMAT_GROUPS).map(([category, formats]) => ({ displayName: `${PICKER_CATEGORY_LABEL[category as OutputCategory]}文件`, pattern: formats.map((format) => `*.${format}`).join(";") })),
  { displayName: "所有文件", pattern: "*.*" },
]

export function Component({ compId, host }: NodeComponentProps<VertCardState>) {
  const surface = useNodeSurface()
  const data = getHostData(host, compId)
  const dataRef = useRef(data); dataRef.current = data
  const browserInputRef = useRef<HTMLInputElement>(null)
  const [browserFiles, setBrowserFiles] = useState<File[]>([])
  const [browserOutputs, setBrowserOutputs] = useState<VertBrowserOutput[]>([])
  const [running, setRunning] = useState(false)
  const drop = useLocalFileDrop({ disabled: running, onDropPaths: (paths) => appendPaths(paths), onDropFiles: ingestBrowserFiles, onUnsupported: () => browserInputRef.current?.click(), subscribeDrops: host.localFiles?.subscribeDrops })
  const paths = splitPaths(data.pathsText)
  const engine = data.engine ?? DEFAULTS.engine
  const outputCategory = data.outputCategory ?? detectPreferredCategory([...paths, ...browserFiles.map((file) => file.name)])
  const target = data.targetFormat ?? DEFAULTS.targetFormat
  const compact = surface.mode === "compact" || surface.mode === "portrait"
  const denseCompact = compact && surface.height > 0 && surface.height < 320

  function patch(value: Partial<VertCardState>) { dataRef.current = { ...dataRef.current, ...value }; if (host.state?.patchData) host.state.patchData(value); else host.patchData(compId, value) }
  function appendPaths(next: string[]) { const combined = [...new Set([...splitPaths(dataRef.current.pathsText), ...next])]; const detected = detectPreferredCategory(combined); patch({ pathsText: combined.join("\n"), ...categoryPatch(detected, dataRef.current.outputCategory, dataRef.current.targetFormat) }) }
  function pushLog(message: string) { patch({ logs: [...(dataRef.current.logs ?? []), message].slice(-160) }) }
  function ingestBrowserFiles(next: File[]) { if (!next.length) return; setBrowserFiles((current) => [...current, ...next.filter((file) => !current.some((item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified))]); setBrowserOutputs([]); const detected = detectPreferredCategory(next.map((file) => file.name)); patch(categoryPatch(detected, dataRef.current.outputCategory, dataRef.current.targetFormat)); pushLog(`Wasm queue: ${next.length} browser file(s).`) }
  function onBrowserFiles(event: ChangeEvent<HTMLInputElement>) { ingestBrowserFiles(Array.from(event.target.files ?? [])); event.target.value = "" }
  async function chooseNativeFiles() { const next = await host.localFiles?.pickFiles?.({ title: "选择要转换的文件", filters: VERT_PICKER_FILTERS }); if (next?.length) appendPaths(next); else if (!host.localFiles?.pickFiles) browserInputRef.current?.click() }
  function reset() { patch({ result: null, logs: [], phase: "idle", progress: 0, progressText: "" }); setBrowserOutputs([]) }

  async function runWasm() {
    if (!browserFiles.length) { browserInputRef.current?.click(); patch({ phase: "error", progressText: "Wasm 模式需要先选择浏览器文件。" }); return }
    setRunning(true); patch({ phase: "running", progress: 0, progressText: "正在按需加载 Wasm 引擎…" })
    try {
      const { convertFilesWithWasm } = await import("./browserWasm")
      const outputs = await convertFilesWithWasm(browserFiles, target, dataRef.current.quality ?? 90, (progress, message) => { patch({ progress, progressText: message }); pushLog(`[${progress}%] ${message}`) })
      setBrowserOutputs(outputs); patch({ phase: "completed", progress: 100, progressText: `Wasm 已转换 ${outputs.length} 个文件。` }); pushLog(`Wasm converted ${outputs.length} file(s).`)
    } catch (error) { const message = error instanceof Error ? error.message : String(error); patch({ phase: "error", progressText: message }); pushLog(message) } finally { setRunning(false) }
  }

  function planBrowserFiles() {
    if (!browserFiles.length) {
      patch({ phase: "error", progress: 0, progressText: "Wasm 预演需要浏览器文件；请重新选择或拖入文件。" })
      return
    }
    const commands = browserFiles.map((file) => {
      const converter = chooseConverter(file.name, target)
      return { converter, command: `wasm:${converter}`, args: [file.name, `output.${target}`], inputPath: file.name, outputPath: browserOutputName(file.name, target) }
    })
    const result: VertData = { capabilities: { wasm: true }, commands, commandResults: [], selectedPaths: browserFiles.map((file) => file.name), outputPaths: commands.map((command) => command.outputPath), errors: [], engineUsed: "wasm", wasmFallbackRequired: true }
    patch({ result, phase: "completed", progress: 100, progressText: `已预演 ${commands.length} 个 Wasm 转换；没有写入文件。` })
    pushLog(`Planned ${commands.length} Wasm conversion(s).`)
  }

  async function execute(action: "plan" | "convert") {
    if (running) return
    if (action === "plan" && (engine === "wasm" || (!paths.length && browserFiles.length))) { planBrowserFiles(); return }
    if (engine === "wasm") { await runWasm(); return }
    if (!paths.length) { patch({ phase: "error", progressText: "请先选择本地文件。" }); return }
    const run = host.runner?.run ?? host.actions?.run
    if (!run) { if (engine === "auto" && browserFiles.length) await runWasm(); else patch({ phase: "error", progressText: "当前环境没有 CLI 运行能力；可切换 Wasm 并选择浏览器文件。" }); return }
    setRunning(true); patch({ phase: "running", progress: 0, progressText: action === "plan" ? "正在生成原生命令计划…" : "正在调用本机转换工具…", result: null })
    try {
      const input: VertInput = { action, paths, targetFormat: target, outputDirectory: dataRef.current.outputDirectory, engine, overwrite: dataRef.current.overwrite ?? false, quality: dataRef.current.quality ?? 90 }
      const response = await run<VertInput, VertData>("vert", input, (event: NodeRunEvent) => { if (event.type === "progress") patch({ progress: event.progress ?? 0, progressText: event.message }); pushLog(event.message) }) as NodeRunResult<VertData>
      patch({ result: response.data, phase: response.success ? "completed" : response.data?.wasmFallbackRequired ? "idle" : "error", progress: response.success ? 100 : 0, progressText: response.message }); pushLog(response.message)
      if (action === "convert" && response.data?.wasmFallbackRequired && engine === "auto" && browserFiles.length) await runWasm()
    } catch (error) { const message = error instanceof Error ? error.message : String(error); patch({ phase: "error", progressText: message }); pushLog(message) } finally { setRunning(false) }
  }

  const queueCount = paths.length + browserFiles.length
  const phase = running ? "running" : data.phase ?? "idle"
  return (
    <div ref={surface.ref} className="@container/vert relative flex h-full min-h-0 w-full overflow-hidden">
      <input ref={browserInputRef} className="hidden" type="file" multiple onChange={onBrowserFiles} />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_8%,color-mix(in_oklch,var(--primary)_13%,transparent),transparent_34%),radial-gradient(circle_at_88%_92%,color-mix(in_oklch,var(--chart-2)_10%,transparent),transparent_30%)]" />
      <div className="relative flex min-h-0 w-full flex-col">
        {surface.mode === "collapsed" ? <Collapsed phase={phase} progress={data.progress ?? 0} queueCount={queueCount} target={target} onRun={() => execute("convert")} /> : compact ? <Compact dense={denseCompact} data={data} browserFiles={browserFiles} browserOutputs={browserOutputs} drop={drop} engine={engine} outputCategory={outputCategory} paths={paths} running={running} target={target} onBrowserPick={() => browserInputRef.current?.click()} onChooseNative={chooseNativeFiles} onCategory={(value) => patch({ outputCategory: value, targetFormat: DEFAULT_FORMAT[value] })} onEngine={(value) => patch({ engine: value })} onReset={reset} onRun={() => execute("convert")} onTarget={(value) => patch({ targetFormat: value })} /> : <Full data={data} browserFiles={browserFiles} browserOutputs={browserOutputs} drop={drop} engine={engine} outputCategory={outputCategory} paths={paths} running={running} target={target} onBrowserPick={() => browserInputRef.current?.click()} onChooseNative={chooseNativeFiles} onCategory={(value) => patch({ outputCategory: value, targetFormat: DEFAULT_FORMAT[value] })} onDownload={downloadOutput} onEngine={(value) => patch({ engine: value })} onPatch={patch} onPlan={() => execute("plan")} onReset={reset} onRun={() => execute("convert")} onTarget={(value) => patch({ targetFormat: value })} />}
      </div>
    </div>
  )
}

function Collapsed(props: { phase: string; progress: number; queueCount: number; target: string; onRun: () => void }) { return <div data-testid="vert-collapsed-view" className="flex min-h-0 flex-1 items-center gap-2 px-2"><div className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground"><RefreshCw /></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="truncate text-sm font-semibold">VERT · .{props.target}</span><Badge variant="outline">{props.queueCount}</Badge></div><Progress value={props.progress} className="mt-1 h-1" /></div><Button size="icon-sm" disabled={!props.queueCount || props.phase === "running"} onClick={props.onRun}><Zap /><span className="sr-only">转换</span></Button></div> }

interface SharedViewProps { dense?: boolean; data: VertCardState; browserFiles: File[]; browserOutputs: VertBrowserOutput[]; drop: ReturnType<typeof useLocalFileDrop>; engine: VertEnginePreference; outputCategory: OutputCategory; paths: string[]; running: boolean; target: string; onBrowserPick: () => void; onChooseNative: () => void; onCategory: (value: OutputCategory) => void; onEngine: (value: VertEnginePreference) => void; onReset: () => void; onRun: () => void; onTarget: (value: string) => void }
function Compact(props: SharedViewProps) { return <div data-testid="vert-compact-view" className={cn("flex min-h-0 flex-1 flex-col p-2", props.dense ? "gap-1.5" : "gap-2")}><Header data={props.data} engine={props.engine} running={props.running} /><UploadPanel compact dense={props.dense} {...props} /><div className="grid grid-cols-2 gap-2"><CategorySelect value={props.outputCategory} onChange={props.onCategory} /><FormatSelect category={props.outputCategory} value={props.target} onChange={props.onTarget} /></div>{props.dense ? <Button className="w-full" size="sm" disabled={props.running || (!props.paths.length && !props.browserFiles.length)} onClick={props.onRun}>{props.running ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <RefreshCw data-icon="inline-start" />}转换 · {props.engine === "auto" ? "CLI 优先" : props.engine.toUpperCase()}</Button> : <><div className="flex items-center gap-2"><EngineSelect value={props.engine} onChange={props.onEngine} /><Button className="ml-auto" disabled={props.running || (!props.paths.length && !props.browserFiles.length)} onClick={props.onRun}>{props.running ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <RefreshCw data-icon="inline-start" />}转换</Button></div><Progress value={props.data.progress ?? 0} label="VERT progress" /><QueuePanel compact paths={props.paths} browserFiles={props.browserFiles} outputs={props.browserOutputs} /></>}</div> }

function Full(props: SharedViewProps & { onDownload: (output: VertBrowserOutput) => void; onPatch: (value: Partial<VertCardState>) => void; onPlan: () => void }) {
  return <div data-testid="vert-full-view" className="flex min-h-0 flex-1 flex-col gap-3 p-3"><Header data={props.data} engine={props.engine} running={props.running} /><div className="grid min-h-0 flex-1 grid-cols-[minmax(18rem,0.9fr)_minmax(22rem,1.3fr)] gap-3"><div className="flex min-h-0 flex-col gap-3"><div><div className="mb-2 flex items-center gap-2 text-sm font-semibold"><span className="grid size-6 place-items-center rounded-full bg-secondary">1</span>输入 · 自动识别格式</div><UploadPanel {...props} /></div><div><div className="mb-2 flex items-center gap-2 text-sm font-semibold"><span className="grid size-6 place-items-center rounded-full bg-secondary">2</span>输出 · 先选大类再选格式</div><FieldGroup className="grid grid-cols-2 gap-2"><Field><FieldLabel>输出大类</FieldLabel><CategorySelect value={props.outputCategory} onChange={props.onCategory} /></Field><Field><FieldLabel>输出格式</FieldLabel><FormatSelect category={props.outputCategory} value={props.target} onChange={props.onTarget} /></Field><Field><FieldLabel>执行引擎</FieldLabel><EngineSelect value={props.engine} onChange={props.onEngine} /></Field><Field><FieldLabel htmlFor="vert-output-directory">输出目录</FieldLabel><Input id="vert-output-directory" value={props.data.outputDirectory ?? ""} placeholder="默认与源文件相同" onChange={(event) => props.onPatch({ outputDirectory: event.target.value })} /></Field>{props.outputCategory === "image" ? <Field><FieldLabel htmlFor="vert-quality">图像质量 · {props.data.quality ?? 90}</FieldLabel><Input id="vert-quality" type="range" min={1} max={100} value={props.data.quality ?? 90} onChange={(event) => props.onPatch({ quality: Number(event.target.value) })} /></Field> : null}<Field orientation="horizontal" className="rounded-lg border p-2"><FieldContent><FieldTitle>覆盖同名文件</FieldTitle><FieldDescription>默认安全跳过</FieldDescription></FieldContent><Switch checked={props.data.overwrite ?? false} onCheckedChange={(overwrite) => props.onPatch({ overwrite })} /></Field></FieldGroup></div><div className="flex items-center gap-2"><Button variant="outline" disabled={props.running || (!props.paths.length && !props.browserFiles.length)} onClick={props.onPlan}><Gauge data-icon="inline-start" />预演方案</Button><Button className="flex-1" disabled={props.running || (!props.paths.length && !props.browserFiles.length)} onClick={props.onRun}>{props.running ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <RefreshCw data-icon="inline-start" />}全部转换</Button><Button size="icon" variant="ghost" onClick={props.onReset}><RotateCcw /><span className="sr-only">重置</span></Button></div><Progress value={props.data.progress ?? 0} label="VERT progress" /></div><ResultTabs data={props.data} browserFiles={props.browserFiles} outputs={props.browserOutputs} paths={props.paths} onDownload={props.onDownload} /></div></div>
}

function Header({ data, engine, running }: { data: VertCardState; engine: VertEnginePreference; running: boolean }) { const status = running ? "转换中" : data.phase === "completed" ? "完成" : data.phase === "error" ? "失败" : "就绪"; return <header className="flex shrink-0 items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground"><RefreshCw /></div><div className="min-w-0"><div className="flex items-center gap-2"><h3 className="text-lg font-semibold leading-none">VERT</h3><Badge variant={data.phase === "error" ? "destructive" : running ? "secondary" : "outline"}>{status}</Badge></div><p className="mt-1 truncate text-xs text-muted-foreground">{data.progressText || "文件转换，直接在你的设备上完成。"}</p></div></div><Badge variant="secondary"><Zap data-icon="inline-start" />{engine === "auto" ? "CLI → Wasm" : engine.toUpperCase()}</Badge></header> }

function UploadPanel(props: SharedViewProps & { compact?: boolean; dense?: boolean }) { const count = props.paths.length + props.browserFiles.length; return <section {...props.drop.targetProps} data-testid="vert-upload-dropzone" className={cn("relative flex shrink-0 flex-col items-center justify-center rounded-2xl border border-dashed bg-background/70 text-center transition-colors", props.dense ? "min-h-16 p-2" : props.compact ? "min-h-24 p-3" : "min-h-44 p-6", props.drop.dragging && "border-primary bg-accent")}><div className={cn("grid place-items-center rounded-full bg-primary text-primary-foreground", props.dense ? "size-8" : props.compact ? "size-10" : "size-14")}><Upload /></div>{props.dense ? null : <h4 className={cn("font-semibold", props.compact ? "mt-2 text-sm" : "mt-3 text-lg")}>{count ? `${count} 个文件已准备` : "选择或拖入文件开始转换"}</h4>}{props.compact ? null : <p className="mt-1 text-xs text-muted-foreground">桌面文件走 CLI；浏览器文件自动进入 Wasm 队列</p>}<div className={cn("flex flex-wrap justify-center gap-2", props.dense ? "mt-1" : "mt-3")}><Button size="sm" variant="outline" onClick={props.onChooseNative}><FolderOpen data-icon="inline-start" />{props.dense ? "选择/拖入" : "选择任意文件"}</Button>{props.dense ? null : <Button size="sm" variant="ghost" onClick={props.onBrowserPick}><FileCog data-icon="inline-start" />Wasm 文件</Button>}</div></section> }

function CategorySelect({ value, onChange }: { value: OutputCategory; onChange: (value: OutputCategory) => void }) { return <Select value={value} onValueChange={(next) => onChange(next as OutputCategory)}><SelectTrigger className="w-full"><SelectValue placeholder="输出大类" /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>格式大类</SelectLabel><SelectItem value="image">图片</SelectItem><SelectItem value="audio">音频</SelectItem><SelectItem value="video">视频</SelectItem><SelectItem value="document">文档</SelectItem></SelectGroup></SelectContent></Select> }
function FormatSelect({ category, value, onChange }: { category: OutputCategory; value: string; onChange: (value: string) => void }) { const formats = VERT_FORMAT_GROUPS[category]; return <Select value={formats.includes(value as never) ? value : DEFAULT_FORMAT[category]} onValueChange={onChange}><SelectTrigger className="w-full"><SelectValue placeholder="输出格式" /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>{categoryLabel(category)}格式</SelectLabel>{formats.map((format) => <SelectItem key={format} value={format}>.{format}</SelectItem>)}</SelectGroup></SelectContent></Select> }
function EngineSelect({ value, onChange }: { value: VertEnginePreference; onChange: (value: VertEnginePreference) => void }) { return <Select value={value} onValueChange={(next) => onChange(next as VertEnginePreference)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>执行方式</SelectLabel><SelectItem value="auto">自动 · CLI 优先</SelectItem><SelectItem value="cli">仅 CLI</SelectItem><SelectItem value="wasm">仅 Wasm</SelectItem></SelectGroup></SelectContent></Select> }

function QueuePanel({ compact, paths, browserFiles, outputs }: { compact?: boolean; paths: string[]; browserFiles: File[]; outputs: VertBrowserOutput[] }) { const rows = [...paths.map((name) => ({ name, type: "CLI" })), ...browserFiles.map((file) => ({ name: file.name, type: "Wasm" }))]; return <ScrollArea className={cn("min-h-0 rounded-xl border bg-background/70", compact ? "flex-1" : "h-full")}><div className="flex flex-col gap-1 p-2">{rows.length ? rows.map((row, index) => { const category = detectVertCategory(row.name); const Icon = categoryIcon(category); return <div key={`${row.name}-${index}`} className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-muted/50"><Icon className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate font-mono text-xs" title={row.name}>{row.name}</span><Badge variant="secondary">{inputFormat(row.name)} · {categoryLabel(category)}</Badge><Badge variant="outline">{row.type}</Badge>{outputs[index] ? <Check className="size-4 text-primary" /> : null}</div> }) : <div className="grid min-h-28 place-items-center text-sm text-muted-foreground">添加文件后自动识别输入格式</div>}</div></ScrollArea> }

function ResultTabs(props: { data: VertCardState; browserFiles: File[]; outputs: VertBrowserOutput[]; paths: string[]; onDownload: (output: VertBrowserOutput) => void }) { return <Tabs defaultValue="queue" className="flex min-h-0 flex-col"><TabsList variant="line"><TabsTrigger value="queue">文件</TabsTrigger><TabsTrigger value="plan">命令</TabsTrigger><TabsTrigger value="logs">日志</TabsTrigger></TabsList><TabsContent value="queue" className="min-h-0 flex-1"><QueuePanel paths={props.paths} browserFiles={props.browserFiles} outputs={props.outputs} />{props.outputs.length ? <div className="mt-2 flex flex-wrap gap-2">{props.outputs.map((output) => <Button key={output.name} size="sm" variant="outline" onClick={() => props.onDownload(output)}><Download data-icon="inline-start" />{output.name}</Button>)}</div> : null}</TabsContent><TabsContent value="plan" className="min-h-0 flex-1"><ScrollArea className="h-full rounded-xl border bg-background/70"><div className="p-3 font-mono text-xs">{props.data.result?.commands.map((command, index) => <div key={`${command.inputPath}-${index}`} className="mb-3"><div className="text-primary">{command.converter} → {command.outputPath}</div><div className="break-all text-muted-foreground">{command.command} {command.args.join(" ")}</div></div>) ?? <span className="text-muted-foreground">点击“预演命令”查看 CLI 计划。</span>}</div></ScrollArea></TabsContent><TabsContent value="logs" className="min-h-0 flex-1"><ScrollArea className="h-full rounded-xl border bg-background/70"><pre className="p-3 text-xs leading-5 text-muted-foreground">{props.data.logs?.join("\n") || "转换日志会显示在这里。"}</pre></ScrollArea></TabsContent></Tabs> }

async function downloadOutput(output: VertBrowserOutput) { const { downloadBrowserOutput } = await import("./browserWasm"); downloadBrowserOutput(output) }
function splitPaths(value?: string): string[] { return (value ?? "").split(/[\r\n;]+/).map((item) => item.trim()).filter(Boolean) }
function detectPreferredCategory(names: string[]): OutputCategory { return (names.map(detectVertCategory).find((category) => category !== "unknown") ?? DEFAULTS.outputCategory) as OutputCategory }
function categoryPatch(detected: OutputCategory, currentCategory?: OutputCategory, currentFormat?: string): Partial<VertCardState> { if (currentCategory && currentFormat) return {}; return { outputCategory: detected, targetFormat: DEFAULT_FORMAT[detected] } }
function categoryLabel(category: VertFormatCategory): string { return category === "image" ? "图片" : category === "audio" ? "音频" : category === "video" ? "视频" : category === "document" ? "文档" : "未知" }
function categoryIcon(category: VertFormatCategory) { return category === "image" ? FileImage : category === "audio" ? FileAudio : category === "video" ? FileVideo : category === "document" ? FileText : FileCog }
function inputFormat(name: string): string { const base = name.split(/[\\/]/).at(-1) ?? name; const dot = base.lastIndexOf("."); return dot > 0 ? `.${base.slice(dot + 1).toLowerCase()}` : "无扩展名" }
function browserOutputName(name: string, target: string): string { const dot = name.lastIndexOf("."); return `${dot > 0 ? name.slice(0, dot) : name}.${target}` }
function getHostData(host: NodeComponentProps<VertCardState>["host"], compId: string): VertCardState { return host.state?.getData?.() ?? host.getData<VertCardState>(compId) ?? {} }

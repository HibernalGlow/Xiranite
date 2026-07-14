import { useEffect, useRef, useState } from "react"
import type { ChangeEvent } from "react"
import type { NodeComponentProps, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type { VertData, VertEnginePreference, VertFormatCategory, VertInput } from "@xiranite/node-vert/core"
import { chooseConverter, detectVertCategory, VERT_INPUT_FORMAT_GROUPS } from "@xiranite/node-vert/core"
import { Check, Download, FileAudio, FileCog, FileImage, FileText, FileVideo, FolderOpen, Gauge, LoaderCircle, RefreshCw, RotateCcw, Trash2, Upload, Zap } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldTitle } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useLocalFileDrop } from "@/nodes/shared/useLocalFileDrop"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import { NodeConfigPopover } from "@/nodes/shared/NodeConfigPopover"
import { useNodeI18n } from "@/nodes/shared/useNodeI18n"
import type { VertBrowserOutput } from "./browserWasm"
import { ConversionTopology, compatibleCategories, defaultFormat, type VertConversionRoute, type VertInputFileGroup } from "./ConversionTopology"
import { CONFIG_FIELDS, type VertCardState, type VertConversionGroupConfig } from "./types"

type OutputCategory = Exclude<VertFormatCategory, "unknown">
const DEFAULTS = { outputCategory: "image" as OutputCategory, targetFormat: "webp", engine: "auto" as const, overwrite: false, quality: 90 }
const PICKER_CATEGORY_LABEL: Record<OutputCategory, string> = { image: "图片", audio: "音频", video: "视频", document: "文档" }
const VERT_PICKER_FILTERS = [
  { displayName: "所有支持的输入格式", pattern: Object.values(VERT_INPUT_FORMAT_GROUPS).flat().map((format) => `*.${format}`).join(";") },
  ...Object.entries(VERT_INPUT_FORMAT_GROUPS).map(([category, formats]) => ({ displayName: `${PICKER_CATEGORY_LABEL[category as OutputCategory]}输入文件`, pattern: formats.map((format) => `*.${format}`).join(";") })),
  { displayName: "所有文件", pattern: "*.*" },
]

export function Component({ compId, host }: NodeComponentProps<VertCardState>) {
  "use no memo"
  const surface = useNodeSurface()
  const data = getHostData(host, compId)
  const dataRef = useRef(data); dataRef.current = data
  const browserInputRef = useRef<HTMLInputElement>(null)
  const [browserFiles, setBrowserFiles] = useState<File[]>([])
  const [browserOutputs, setBrowserOutputs] = useState<VertBrowserOutput[]>([])
  const [topologyToolbarTarget, setTopologyToolbarTarget] = useState<HTMLDivElement | null>(null)
  const [running, setRunning] = useState(false)
  const [defaults, setDefaults] = useState<Partial<VertCardState>>({ ...DEFAULTS })
  const [configFilePath, setConfigFilePath] = useState<string | undefined>()
  const [configDirty, setConfigDirty] = useState(false)
  const drop = useLocalFileDrop({ disabled: running, onDropPaths: (paths) => appendPaths(paths), onDropFiles: ingestBrowserFiles, onUnsupported: () => browserInputRef.current?.click(), subscribeDrops: host.localFiles?.subscribeDrops })
  const paths = splitPaths(data.pathsText)
  const engine = data.engine ?? DEFAULTS.engine
  const fileGroups = buildInputFileGroups(paths, browserFiles)
  const routes = buildConversionRoutes(fileGroups, data)
  const target = routes[0]?.config.targetFormat ?? data.targetFormat ?? DEFAULTS.targetFormat
  const compact = surface.mode === "compact" || surface.mode === "portrait"
  const denseCompact = compact && surface.height > 0 && surface.height < 320

  async function reloadDefaults() {
    const loadConfig = host.config?.get?.<Partial<VertCardState>>() ?? host.getNodeConfig?.<Partial<VertCardState>>()
    if (!loadConfig) return
    try {
      const response = await loadConfig
      setDefaults({ ...DEFAULTS, ...(response.config ?? {}) })
      setConfigFilePath(response.path)
    } catch {
      // Configuration management is optional in lightweight hosts.
    }
  }

  useEffect(() => { void reloadDefaults() }, [host])
  const configValuesKey = CONFIG_FIELDS.map((field) => JSON.stringify(data[field] ?? "")).join("\u0001")
  useEffect(() => {
    setConfigDirty(CONFIG_FIELDS.some((field) => {
      const factoryDefault = (DEFAULTS as Partial<VertCardState>)[field]
      return JSON.stringify(data[field] ?? factoryDefault) !== JSON.stringify(defaults[field] ?? factoryDefault)
    }))
  }, [configValuesKey, defaults])

  async function saveAsDefault() {
    const config: Partial<VertCardState> = {}
    for (const field of CONFIG_FIELDS) {
      const value = dataRef.current[field]
      if (value !== undefined) (config as Record<string, unknown>)[field] = value
    }
    await host.saveNodeConfig?.(config)
    setDefaults({ ...DEFAULTS, ...config })
    setConfigDirty(false)
  }

  function restoreDefault() { patch(defaults) }
  function resetOverride() {
    const override: Partial<VertCardState> = {}
    for (const field of CONFIG_FIELDS) (override as Record<string, unknown>)[field] = undefined
    patch(override)
  }

  function patch(value: Partial<VertCardState>) { dataRef.current = { ...dataRef.current, ...value }; if (host.state?.patchData) host.state.patchData(value); else host.patchData(compId, value) }
  function appendPaths(next: string[]) { const combined = [...new Set([...splitPaths(dataRef.current.pathsText), ...next])]; patch({ pathsText: combined.join("\n") }) }
  function pushLog(message: string) { patch({ logs: [...(dataRef.current.logs ?? []), message].slice(-160) }) }
  function ingestBrowserFiles(next: File[]) { if (!next.length) return; setBrowserFiles((current) => [...current, ...next.filter((file) => !current.some((item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified))]); setBrowserOutputs([]); pushLog(`Wasm queue: ${next.length} browser file(s).`) }
  function onBrowserFiles(event: ChangeEvent<HTMLInputElement>) { ingestBrowserFiles(Array.from(event.target.files ?? [])); event.target.value = "" }
  async function chooseNativeFiles() { const next = await host.localFiles?.pickFiles?.({ title: "选择要转换的文件", filters: VERT_PICKER_FILTERS }); if (next?.length) appendPaths(next); else if (!host.localFiles?.pickFiles) browserInputRef.current?.click() }
  function reset() { patch({ result: null, logs: [], phase: "idle", progress: 0, progressText: "" }); setBrowserOutputs([]) }
  function materializedConversionGroups(): Record<string, VertConversionGroupConfig> { return dataRef.current.conversionGroups ?? Object.fromEntries(routes.map((route) => [route.key, { ...route.config, sourceFormat: route.group.extension }])) }
  function changeConversionGroup(key: string, config: VertConversionGroupConfig) { patch({ conversionGroups: { ...materializedConversionGroups(), [key]: config } }) }
  function addConversionGroup(sourceFormat = fileGroups[0]?.extension, requestedCategory?: OutputCategory) {
    const group = fileGroups.find((item) => item.extension === sourceFormat)
    if (!group) return
    const outputCategory = requestedCategory ?? compatibleCategories(group.category)[0]
    const current = materializedConversionGroups()
    const key = `manual-${Date.now().toString(36)}-${Object.keys(current).length}`
    patch({
      conversionGroups: { ...current, [key]: { sourceFormat: group.extension, outputCategory, targetFormat: defaultFormat(outputCategory) } },
      result: null,
      phase: "idle",
      progress: 0,
      progressText: "",
    })
  }
  function removeConversionGroup(key: string) { const next = { ...materializedConversionGroups() }; delete next[key]; patch({ conversionGroups: next, result: null, phase: "idle", progress: 0, progressText: "" }) }
  function removePath(path: string) { patch({ pathsText: splitPaths(dataRef.current.pathsText).filter((item) => item !== path).join("\n"), result: null, phase: "idle", progress: 0, progressText: "" }); setBrowserOutputs([]) }
  function removeBrowserFile(file: File) { setBrowserFiles((current) => current.filter((item) => !sameBrowserFile(item, file))); setBrowserOutputs([]); patch({ result: null, phase: "idle", progress: 0, progressText: "" }) }
  function removeGroup(group: VertInputFileGroup) { if (group.paths.length) patch({ pathsText: splitPaths(dataRef.current.pathsText).filter((path) => !group.paths.includes(path)).join("\n"), result: null, phase: "idle", progress: 0, progressText: "" }); if (group.files.length) setBrowserFiles((current) => current.filter((file) => !group.files.some((item) => sameBrowserFile(item, file)))); setBrowserOutputs([]) }

  async function execute(action: "plan" | "convert") {
    if (running) return
    if (!routes.length) { patch({ phase: "error", progressText: "请先选择或拖入文件。" }); return }
    const run = host.runner?.run ?? host.actions?.run
    if (!run && routes.some((route) => route.group.paths.length) && engine !== "wasm") { patch({ phase: "error", progressText: "当前环境没有 CLI 运行能力；浏览器文件仍可使用 Wasm。" }); return }
    setRunning(true); patch({ phase: "running", progress: 0, progressText: action === "plan" ? "正在生成原生命令计划…" : "正在调用本机转换工具…", result: null })
    try {
      const aggregate: VertData = { capabilities: { wasm: true }, commands: [], commandResults: [], selectedPaths: [], outputPaths: [], errors: [], wasmFallbackRequired: false }
      const wasmOutputs: VertBrowserOutput[] = []
      let usedCli = false
      let usedWasm = false
      const deletionRouteIndexes = new Set<number>()
      for (const route of routes) {
        if (!route.config.deleteSourceAfterSuccess) continue
        let lastIndex = -1
        for (let candidate = 0; candidate < routes.length; candidate += 1) if (routes[candidate]?.group.key === route.group.key) lastIndex = candidate
        if (lastIndex >= 0) deletionRouteIndexes.add(lastIndex)
      }
      for (let index = 0; index < routes.length; index += 1) {
        const route = routes[index]!
        if (route.group.paths.length) {
          if (engine === "wasm") aggregate.errors.push(`.${route.group.extension}: 本地路径不能直接交给浏览器 Wasm，请使用“Wasm 文件”重新选择。`)
          else if (run) {
            usedCli = true
            const input: VertInput = { action, paths: route.group.paths, targetFormat: route.config.targetFormat, outputDirectory: dataRef.current.outputDirectory, engine, overwrite: dataRef.current.overwrite ?? false, quality: dataRef.current.quality ?? 90, deleteSourceAfterSuccess: deletionRouteIndexes.has(index) }
            const response = await run<VertInput, VertData>("vert", input, (event: NodeRunEvent) => {
              const progress = event.type === "progress" ? Math.round(((index + (event.progress ?? 0) / 100) / routes.length) * 100) : Math.round((index / routes.length) * 100)
              patch({ progress, progressText: event.message }); pushLog(event.message)
            }) as NodeRunResult<VertData>
            mergeVertData(aggregate, response.data)
            if (!response.success && !response.data?.wasmFallbackRequired) aggregate.errors.push(response.message)
            if (response.data?.wasmFallbackRequired) aggregate.errors.push(`.${route.group.extension}: 本机缺少 ${response.data.commands[0]?.converter ?? "转换"} CLI；若要回退 Wasm，请通过“Wasm 文件”选择源文件。`)
          }
        }
        if (route.group.files.length) {
          usedWasm = true
          if (engine === "cli") aggregate.errors.push(`.${route.group.extension}: 浏览器文件没有本地路径，不能交给 CLI。`)
          else if (action === "plan") {
            for (const file of route.group.files) {
              const converter = chooseConverter(file.name, route.config.targetFormat)
              aggregate.commands.push({ converter, command: `wasm:${converter}`, args: [file.name, `output.${route.config.targetFormat}`], inputPath: file.name, outputPath: browserOutputName(file.name, route.config.targetFormat) })
              aggregate.selectedPaths.push(file.name)
            }
          } else {
            const { convertFilesWithWasm } = await import("./browserWasm")
            const outputs = await convertFilesWithWasm(route.group.files, route.config.targetFormat, dataRef.current.quality ?? 90, (groupProgress, message) => {
              const progress = Math.round(((index + groupProgress / 100) / routes.length) * 100)
              patch({ progress, progressText: message }); pushLog(`[${progress}%] ${message}`)
            })
            wasmOutputs.push(...outputs)
            aggregate.selectedPaths.push(...route.group.files.map((file) => file.name))
            aggregate.outputPaths.push(...outputs.map((output) => output.name))
          }
        }
      }
      aggregate.engineUsed = usedWasm ? "wasm" : usedCli ? "cli" : undefined
      aggregate.wasmFallbackRequired = usedWasm
      if (wasmOutputs.length) setBrowserOutputs(wasmOutputs)
      const success = aggregate.errors.length === 0
      const message = action === "plan" ? `已生成 ${aggregate.commands.length} 个命令，覆盖 ${routes.length} 个转换组。` : success ? `已完成 ${routes.length} 个转换组，输出 ${aggregate.outputPaths.length} 个文件。` : `${routes.length} 个转换组执行完成，发现 ${aggregate.errors.length} 个问题。`
      patch({ result: aggregate, phase: success ? "completed" : "error", progress: success ? 100 : dataRef.current.progress ?? 0, progressText: message }); pushLog(message)
    } catch (error) { const message = error instanceof Error ? error.message : String(error); patch({ phase: "error", progressText: message }); pushLog(message) } finally { setRunning(false) }
  }

  const queueCount = paths.length + browserFiles.length
  const phase = running ? "running" : data.phase ?? "idle"
  return (
    <TooltipProvider>
    <div ref={surface.ref} className="@container/vert relative flex h-full min-h-0 w-full overflow-hidden">
      <input ref={browserInputRef} className="hidden" type="file" multiple onChange={onBrowserFiles} />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_8%,color-mix(in_oklch,var(--primary)_13%,transparent),transparent_34%),radial-gradient(circle_at_88%_92%,color-mix(in_oklch,var(--chart-2)_10%,transparent),transparent_30%)]" />
      <div className="relative flex min-h-0 w-full flex-col">
        {surface.mode === "collapsed" ? <Collapsed phase={phase} progress={data.progress ?? 0} queueCount={queueCount} target={target} onRun={() => execute("convert")} /> : compact ? <Compact dense={denseCompact} data={data} browserFiles={browserFiles} browserOutputs={browserOutputs} drop={drop} engine={engine} groups={fileGroups} paths={paths} routes={routes} running={running} target={target} configDirty={configDirty} configFilePath={configFilePath} defaults={defaults} onAddConversion={() => addConversionGroup()} onConnectConversion={addConversionGroup} onBrowserPick={() => browserInputRef.current?.click()} onChooseNative={chooseNativeFiles} onEngine={(value) => patch({ engine: value })} onGroupChange={changeConversionGroup} onRemoveBrowserFile={removeBrowserFile} onRemoveConversion={removeConversionGroup} onRemoveGroup={removeGroup} onRemovePath={removePath} onReset={reset} onRun={() => execute("convert")} onReloadDefaults={reloadDefaults} onResetOverride={resetOverride} onRestoreDefault={restoreDefault} onSaveDefault={saveAsDefault} /> : <Full data={data} browserFiles={browserFiles} browserOutputs={browserOutputs} drop={drop} engine={engine} groups={fileGroups} paths={paths} routes={routes} running={running} target={target} configDirty={configDirty} configFilePath={configFilePath} defaults={defaults} toolbarTarget={topologyToolbarTarget} onAddConversion={() => addConversionGroup()} onConnectConversion={addConversionGroup} onBrowserPick={() => browserInputRef.current?.click()} onChooseNative={chooseNativeFiles} onDownload={downloadOutput} onEngine={(value) => patch({ engine: value })} onGroupChange={changeConversionGroup} onPatch={patch} onPlan={() => execute("plan")} onRemoveBrowserFile={removeBrowserFile} onRemoveConversion={removeConversionGroup} onRemoveGroup={removeGroup} onRemovePath={removePath} onReset={reset} onRun={() => execute("convert")} onToolbarTarget={setTopologyToolbarTarget} onReloadDefaults={reloadDefaults} onResetOverride={resetOverride} onRestoreDefault={restoreDefault} onSaveDefault={saveAsDefault} />}
      </div>
    </div>
    </TooltipProvider>
  )
}

function Collapsed(props: { phase: string; progress: number; queueCount: number; target: string; onRun: () => void }) { return <div data-testid="vert-collapsed-view" className="flex min-h-0 flex-1 items-center gap-2 px-2"><div className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground"><RefreshCw /></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="truncate text-sm font-semibold">VERT · .{props.target}</span><Badge variant="outline">{props.queueCount}</Badge></div><Progress value={props.progress} className="mt-1 h-1" /></div><Button size="icon-sm" disabled={!props.queueCount || props.phase === "running"} onClick={props.onRun}><Zap /><span className="sr-only">转换</span></Button></div> }

interface SharedViewProps { dense?: boolean; data: VertCardState; browserFiles: File[]; browserOutputs: VertBrowserOutput[]; drop: ReturnType<typeof useLocalFileDrop>; engine: VertEnginePreference; groups: VertInputFileGroup[]; paths: string[]; routes: VertConversionRoute[]; running: boolean; target: string; configDirty: boolean; configFilePath?: string; defaults?: Partial<VertCardState>; onAddConversion: () => void; onConnectConversion: (sourceFormat: string, outputCategory: OutputCategory) => void; onBrowserPick: () => void; onChooseNative: () => void; onEngine: (value: VertEnginePreference) => void; onGroupChange: (key: string, config: VertConversionGroupConfig) => void; onRemoveBrowserFile: (file: File) => void; onRemoveConversion: (key: string) => void; onRemoveGroup: (group: VertInputFileGroup) => void; onRemovePath: (path: string) => void; onReset: () => void; onRun: () => void; onReloadDefaults: () => Promise<void>; onResetOverride: () => void; onRestoreDefault: () => void; onSaveDefault: () => Promise<void> }
function Compact(props: SharedViewProps) { return <div data-testid="vert-compact-view" className={cn("flex min-h-0 flex-1 flex-col p-2", props.dense ? "gap-1.5" : "gap-2")}><Header {...props} /><UploadPanel compact dense={props.dense} {...props} /><ConversionTopology compact dense={props.dense} groups={props.groups} routes={props.routes} running={props.running} onAddConversion={props.onAddConversion} onConnectConversion={props.onConnectConversion} onChange={props.onGroupChange} onRemoveConversion={props.onRemoveConversion} onRemoveFile={props.onRemoveBrowserFile} onRemoveGroup={props.onRemoveGroup} onRemovePath={props.onRemovePath} /><div className="flex items-center gap-2">{props.dense ? null : <EngineSelect value={props.engine} onChange={props.onEngine} />}<Button className="flex-1" size="sm" disabled={props.running || !props.routes.length} onClick={props.onRun}>{props.running ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <RefreshCw data-icon="inline-start" />}转换 {props.routes.length} 组 · {props.engine === "auto" ? "CLI 优先" : props.engine.toUpperCase()}</Button></div><Progress value={props.data.progress ?? 0} label="VERT progress" /></div> }

function Full(props: SharedViewProps & { toolbarTarget: HTMLDivElement | null; onDownload: (output: VertBrowserOutput) => void; onPatch: (value: Partial<VertCardState>) => void; onPlan: () => void; onToolbarTarget: (node: HTMLDivElement | null) => void }) {
  return <div data-testid="vert-full-view" className="flex min-h-0 flex-1 flex-col gap-3 p-3"><Header {...props} actionsRef={props.onToolbarTarget} /><div className="grid min-h-0 flex-1 grid-cols-[15rem_minmax(0,1fr)] gap-3"><aside className="flex min-h-0 flex-col gap-3"><UploadPanel compact {...props} /><FieldGroup className="gap-2"><Field><FieldLabel>执行引擎</FieldLabel><EngineSelect value={props.engine} onChange={props.onEngine} /></Field><Field><FieldLabel htmlFor="vert-output-directory">输出目录</FieldLabel><Input id="vert-output-directory" value={props.data.outputDirectory ?? ""} placeholder="与源文件相同" onChange={(event) => props.onPatch({ outputDirectory: event.target.value })} /></Field><Field orientation="horizontal" className="rounded-lg border p-2"><FieldContent><FieldTitle>覆盖同名文件</FieldTitle><FieldDescription>默认安全跳过</FieldDescription></FieldContent><Switch checked={props.data.overwrite ?? false} onCheckedChange={(overwrite) => props.onPatch({ overwrite })} /></Field></FieldGroup><div className="flex items-center gap-2"><Button size="sm" variant="outline" disabled={props.running || !props.routes.length} onClick={props.onPlan}><Gauge data-icon="inline-start" />预演</Button><Button className="flex-1" size="sm" disabled={props.running || !props.routes.length} onClick={props.onRun}>{props.running ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <RefreshCw data-icon="inline-start" />}转换 {props.routes.length} 组</Button><Button size="icon-sm" variant="ghost" onClick={props.onReset}><RotateCcw /><span className="sr-only">重置</span></Button></div><Progress value={props.data.progress ?? 0} label="VERT progress" /><div className="min-h-0 flex-1"><ResultTabs data={props.data} browserFiles={props.browserFiles} outputs={props.browserOutputs} paths={props.paths} onDownload={props.onDownload} onRemoveFile={props.onRemoveBrowserFile} onRemovePath={props.onRemovePath} /></div></aside><ConversionTopology groups={props.groups} routes={props.routes} running={props.running} toolbarTarget={props.toolbarTarget} onAddConversion={props.onAddConversion} onConnectConversion={props.onConnectConversion} onChange={props.onGroupChange} onRemoveConversion={props.onRemoveConversion} onRemoveFile={props.onRemoveBrowserFile} onRemoveGroup={props.onRemoveGroup} onRemovePath={props.onRemovePath} /></div></div>
}

function Header(props: SharedViewProps & { actionsRef?: (node: HTMLDivElement | null) => void }) { const { t } = useNodeI18n("vert"); const { data, engine, running } = props; const status = running ? "转换中" : data.phase === "completed" ? "完成" : data.phase === "error" ? "失败" : "就绪"; const engineLabel = engine === "auto" ? "自动 · 本地 CLI 优先" : engine === "cli" ? "仅本地 CLI" : "仅浏览器 Wasm"; return <header className="flex shrink-0 items-center gap-3"><div className="flex min-w-0 items-center gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground"><RefreshCw /></div><div className="min-w-0"><div className="flex items-center gap-2"><h3 className="text-lg font-semibold leading-none">VERT</h3><Badge variant={data.phase === "error" ? "destructive" : running ? "secondary" : "outline"}>{status}</Badge></div><p className="mt-1 truncate text-xs text-muted-foreground">{data.progressText || "文件转换，直接在你的设备上完成。"}</p></div></div><div className="ml-auto flex items-center gap-1"><NodeConfigPopover autoRestoreKey="vert" configPath={props.configFilePath} defaults={props.defaults} dirty={props.configDirty} disabled={running} t={t} onReload={props.onReloadDefaults} onRestore={props.onRestoreDefault} onSave={props.onSaveDefault} onClearOverride={props.onResetOverride} />{props.actionsRef ? <div ref={props.actionsRef} className="flex min-w-0 items-center" /> : null}</div><Badge className="shrink-0" variant="secondary"><Zap data-icon="inline-start" />{engineLabel}</Badge></header> }

function UploadPanel(props: SharedViewProps & { compact?: boolean; dense?: boolean }) { const count = props.paths.length + props.browserFiles.length; return <section {...props.drop.targetProps} data-testid="vert-upload-dropzone" className={cn("relative flex shrink-0 flex-col items-center justify-center rounded-2xl border border-dashed bg-background/70 text-center transition-colors", props.dense ? "min-h-16 p-2" : props.compact ? "min-h-24 p-3" : "min-h-44 p-6", props.drop.dragging && "border-primary bg-accent")}><div className={cn("grid place-items-center rounded-full bg-primary text-primary-foreground", props.dense ? "size-8" : props.compact ? "size-10" : "size-14")}><Upload /></div>{props.dense ? null : <h4 className={cn("font-semibold", props.compact ? "mt-2 text-sm" : "mt-3 text-lg")}>{count ? `${count} 个文件已准备` : "选择或拖入文件开始转换"}</h4>}{props.compact ? null : <p className="mt-1 text-xs text-muted-foreground">拖入或选择本地文件时使用 CLI；浏览器文件才进入 Wasm</p>}<div className={cn("flex flex-wrap justify-center gap-2", props.dense ? "mt-1" : "mt-3")}><Button size="sm" variant="outline" onClick={props.onChooseNative}><FolderOpen data-icon="inline-start" />{props.dense ? "本地/拖入" : "本地文件 · CLI"}</Button>{props.dense ? null : <Button size="sm" variant="ghost" onClick={props.onBrowserPick}><FileCog data-icon="inline-start" />浏览器文件 · Wasm</Button>}</div></section> }

function EngineSelect({ value, onChange }: { value: VertEnginePreference; onChange: (value: VertEnginePreference) => void }) { return <Select value={value} onValueChange={(next) => onChange(next as VertEnginePreference)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>执行方式</SelectLabel><SelectItem value="auto">自动 · CLI 优先</SelectItem><SelectItem value="cli">仅 CLI</SelectItem><SelectItem value="wasm">仅 Wasm</SelectItem></SelectGroup></SelectContent></Select> }

function QueuePanel({ browserFiles, compact, onRemoveFile, onRemovePath, outputs, paths }: { browserFiles: File[]; compact?: boolean; onRemoveFile: (file: File) => void; onRemovePath: (path: string) => void; outputs: VertBrowserOutput[]; paths: string[] }) { const rows = [...paths.map((path) => ({ key: `path:${path}`, name: path, type: "CLI", remove: () => onRemovePath(path) })), ...browserFiles.map((file) => ({ key: `file:${browserFileKey(file)}`, name: file.name, type: "Wasm", remove: () => onRemoveFile(file) }))]; return <ScrollArea className={cn("min-h-0 rounded-xl border bg-background/70", compact ? "flex-1" : "h-full")}><div className="flex flex-col gap-1 p-2">{rows.length ? rows.map((row, index) => { const category = detectVertCategory(row.name); const Icon = categoryIcon(category); return <div key={row.key} className="group flex items-center gap-1.5 rounded-lg px-2 py-2 transition-colors hover:bg-muted/50"><Icon className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate font-mono text-xs" title={`${row.name} · ${row.type}`}>{row.name}</span>{outputs[index] ? <Check className="size-4 shrink-0 text-primary" /> : null}<Button aria-label={`移除 ${fileName(row.name)}`} className="shrink-0 opacity-55 transition-opacity group-hover:opacity-100 focus-visible:opacity-100" size="icon-xs" variant="ghost" onClick={row.remove}><Trash2 /></Button><Badge className="shrink-0" variant="secondary">{inputFormat(row.name)} · {categoryLabel(category)}</Badge></div> }) : <div className="grid min-h-28 place-items-center text-sm text-muted-foreground">添加文件后自动识别输入格式</div>}</div></ScrollArea> }

function ResultTabs(props: { data: VertCardState; browserFiles: File[]; outputs: VertBrowserOutput[]; paths: string[]; onDownload: (output: VertBrowserOutput) => void; onRemoveFile: (file: File) => void; onRemovePath: (path: string) => void }) { return <Tabs defaultValue="queue" className="flex min-h-0 flex-col"><TabsList variant="line"><TabsTrigger value="queue">文件</TabsTrigger><TabsTrigger value="plan">命令</TabsTrigger><TabsTrigger value="logs">日志</TabsTrigger></TabsList><TabsContent value="queue" className="min-h-0 flex-1"><QueuePanel paths={props.paths} browserFiles={props.browserFiles} outputs={props.outputs} onRemoveFile={props.onRemoveFile} onRemovePath={props.onRemovePath} />{props.outputs.length ? <div className="mt-2 flex flex-wrap gap-2">{props.outputs.map((output) => <Button key={output.name} size="sm" variant="outline" onClick={() => props.onDownload(output)}><Download data-icon="inline-start" />{output.name}</Button>)}</div> : null}</TabsContent><TabsContent value="plan" className="min-h-0 flex-1"><ScrollArea className="h-full rounded-xl border bg-background/70"><div className="p-3 font-mono text-xs">{props.data.result?.commands.map((command, index) => <div key={`${command.inputPath}-${index}`} className="mb-3"><div className="text-primary">{command.converter} → {command.outputPath}</div><div className="break-all text-muted-foreground">{command.command} {command.args.join(" ")}</div></div>) ?? <span className="text-muted-foreground">点击“预演命令”查看 CLI 计划。</span>}</div></ScrollArea></TabsContent><TabsContent value="logs" className="min-h-0 flex-1"><ScrollArea className="h-full rounded-xl border bg-background/70"><pre className="p-3 text-xs leading-5 text-muted-foreground">{props.data.logs?.join("\n") || "转换日志会显示在这里。"}</pre></ScrollArea></TabsContent></Tabs> }

async function downloadOutput(output: VertBrowserOutput) { const { downloadBrowserOutput } = await import("./browserWasm"); downloadBrowserOutput(output) }
function splitPaths(value?: string): string[] { return (value ?? "").split(/[\r\n;]+/).map((item) => item.trim()).filter(Boolean) }
function categoryLabel(category: VertFormatCategory): string { return category === "image" ? "图片" : category === "audio" ? "音频" : category === "video" ? "视频" : category === "document" ? "文档" : "未知" }
function categoryIcon(category: VertFormatCategory) { return category === "image" ? FileImage : category === "audio" ? FileAudio : category === "video" ? FileVideo : category === "document" ? FileText : FileCog }
function inputFormat(name: string): string { const base = name.split(/[\\/]/).at(-1) ?? name; const dot = base.lastIndexOf("."); return dot > 0 ? `.${base.slice(dot + 1).toLowerCase()}` : "无扩展名" }
function browserOutputName(name: string, target: string): string { const dot = name.lastIndexOf("."); return `${dot > 0 ? name.slice(0, dot) : name}.${target}` }
function buildInputFileGroups(paths: string[], files: File[]): VertInputFileGroup[] {
  const groups = new Map<string, VertInputFileGroup>()
  const ensure = (name: string) => {
    const extension = bareExtension(name) || "unknown"
    const current = groups.get(extension)
    if (current) return current
    const group: VertInputFileGroup = { key: extension, extension, category: detectVertCategory(name), paths: [], files: [] }
    groups.set(extension, group)
    return group
  }
  for (const path of paths) ensure(path).paths.push(path)
  for (const file of files) ensure(file.name).files.push(file)
  return [...groups.values()].sort((a, b) => {
    const categoryOrder = ["image", "video", "audio", "document", "unknown"]
    return categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category) || a.extension.localeCompare(b.extension)
  })
}
function buildConversionRoutes(groups: VertInputFileGroup[], data: VertCardState): VertConversionRoute[] {
  if (data.conversionGroups === undefined) return groups.map((group) => { const outputCategory = compatibleCategories(group.category)[0]; return { key: group.key, group, config: { sourceFormat: group.extension, outputCategory, targetFormat: defaultFormat(outputCategory) } } })
  return Object.entries(data.conversionGroups).flatMap(([key, config]) => { const sourceFormat = config.sourceFormat ?? key; const group = groups.find((item) => item.extension === sourceFormat); return group ? [{ key, group, config: { ...config, sourceFormat } }] : [] })
}
function bareExtension(name: string): string { const base = name.split(/[\\/]/).at(-1) ?? name; const dot = base.lastIndexOf("."); return dot > 0 ? base.slice(dot + 1).toLowerCase() : "" }
function fileName(path: string): string { return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path }
function browserFileKey(file: File): string { return `${file.name}:${file.size}:${file.lastModified}` }
function sameBrowserFile(left: File, right: File): boolean { return browserFileKey(left) === browserFileKey(right) }
function mergeVertData(target: VertData, source?: VertData) {
  if (!source) return
  target.capabilities = { ...target.capabilities, ...source.capabilities, wasm: true }
  target.commands.push(...source.commands)
  target.commandResults.push(...source.commandResults)
  target.selectedPaths.push(...source.selectedPaths)
  target.outputPaths.push(...source.outputPaths)
  target.errors.push(...source.errors)
  target.wasmFallbackRequired ||= source.wasmFallbackRequired
}
function getHostData(host: NodeComponentProps<VertCardState>["host"], compId: string): VertCardState { return host.state?.getData?.() ?? host.getData<VertCardState>(compId) ?? {} }

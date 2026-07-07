import { useEffect, useMemo, useRef, useState } from "react"
import type { NodeComponentProps, NodeRunResult } from "@xiranite/contract"
import type { BandiaAction, BandiaData, BandiaInput, BandiaPathMapping } from "@xiranite/node-bandia/core"
import { mappingsToText, parseBandiaPaths, parsePathMappings } from "@xiranite/node-bandia/core"
import { Archive, Copy, ExternalLink, FileArchive, Play, RotateCcw, Square } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import { DEFAULT_OUTPUT_PREFIX, MODES } from "./constants"
import {
  ActionIconButton,
  ConfigDefaultsPopover,
  MappingInput,
  ModePicker,
  OptionsFields,
  OptionsPopover,
  PathInput,
  PrimarySwitches,
  StatusStrip,
} from "./controls"
import { QueuePreview, ResultTabs, StatsPanel } from "./ResultPanels"
import type { BandiaCardState, BandiaMode, BandiaStatusMeta } from "./types"
import { CONFIG_FIELDS } from "./types"

export function Component({ compId, host }: NodeComponentProps) {
  const surface = useNodeSurface()
  const data = host.getData<BandiaCardState>(compId) ?? {}
  const dataRef = useRef<BandiaCardState>(data)
  dataRef.current = data

  const [running, setRunning] = useState(false)
  const [defaults, setDefaults] = useState<Partial<BandiaCardState> | undefined>(undefined)
  const [configFilePath, setConfigFilePath] = useState<string | undefined>(undefined)
  const [configDirty, setConfigDirty] = useState(false)

  const mode = data.mode ?? "extract"
  const modeMeta = MODES.find((item) => item.value === mode) ?? MODES[0]!
  const logs = data.logs ?? []
  const result = data.result ?? null
  const progress = data.progress ?? 0
  const archivePaths = useMemo(() => parseBandiaPaths(data.pathText ?? ""), [data.pathText])
  const rawPaths = useMemo(() => parseRawPaths(data.pathText ?? ""), [data.pathText])
  const paths = mode === "extract" ? archivePaths : rawPaths
  const mappings = useMemo(() => parsePathMappings(data.mappingText ?? ""), [data.mappingText])
  const dryRun = data.dryRun ?? true
  const status = statusFromState(data, running)
  const compactSurface = surface.mode === "compact" || surface.mode === "portrait"
  const forceCollapsedSurface = compactSurface && surface.height > 0 && surface.height < 160
  const portraitCompact = surface.mode === "portrait" || (surface.mode === "compact" && surface.width < 560 && surface.height >= 300)

  useEffect(() => {
    host.getNodeConfig?.<Partial<BandiaCardState>>()
      .then((response) => {
        setDefaults(response.config)
        setConfigFilePath(response.path)
      })
      .catch(() => undefined)
  }, [host])

  useEffect(() => {
    if (!defaults) return
    setConfigDirty(CONFIG_FIELDS.some((field) => String(data[field] ?? "") !== String(defaults[field] ?? "")))
  }, [
    data.compressFormat,
    data.deleteAfter,
    data.deleteSource,
    data.dryRun,
    data.extractMode,
    data.mappingText,
    data.mode,
    data.outputDir,
    data.outputPrefix,
    data.overwriteMode,
    data.parallel,
    data.useTrash,
    data.workers,
    defaults,
  ])

  function patch(patchData: Partial<BandiaCardState>) {
    dataRef.current = { ...dataRef.current, ...patchData }
    host.patchData(compId, patchData)
  }

  function pushLog(message: string) {
    const nextLogs = [...(dataRef.current.logs ?? []), message].slice(-100)
    patch({ logs: nextLogs })
  }

  async function pasteInput() {
    const text = await host.clipboard?.readText?.()
    if (!text) return
    if (mode !== "extract" && (text.trim().startsWith("{") || text.includes("=>"))) {
      patch({ mappingText: text })
    } else {
      patch({ pathText: text.trim() })
    }
  }

  async function execute(action: BandiaAction = mode) {
    if (running) return
    const input = buildInput(action, dataRef.current, paths, mappings)
    const run = host.actions?.run
    if (!run) {
      patch({ phase: "error", progress: 0, progressText: "当前环境没有本地运行能力，请使用桌面模式或 CLI。" })
      pushLog("Native action is unavailable in this host.")
      return
    }

    setRunning(true)
    try {
      patch({ phase: "running", progress: 0, progressText: `${labelForAction(action)}开始`, result: null })
      const response = await run<BandiaInput, BandiaData>("bandia", input, (event) => {
        if (event.type === "progress") {
          patch({ progress: event.progress ?? 0, progressText: event.message })
        } else {
          pushLog(event.message)
        }
      }) as NodeRunResult<BandiaData>

      patch({
        phase: response.success ? "completed" : "error",
        progress: response.success ? 100 : 0,
        progressText: response.message,
        result: response.data ?? null,
        mappingText: response.data?.pathMappings.length ? mappingsToText(response.data.pathMappings) : dataRef.current.mappingText,
        mode: response.data?.pathMappings.length ? "repack" : dataRef.current.mode,
      })
      pushLog(response.message)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      patch({ phase: "error", progress: 0, progressText: message })
      pushLog(message)
    } finally {
      setRunning(false)
    }
  }

  async function requestStop() {
    if (!running) return
    await host.actions?.run?.("bandia", { action: "stop" })
    patch({ phase: "error", progressText: "已请求停止" })
    pushLog("Stop requested.")
  }

  async function copyResults() {
    const lines = [
      ...(result?.pathMappings ?? []).map((mapping) => `${mapping.archivePath} => ${mapping.extractedPath}`),
      ...(result?.results ?? []).map((item) => `${item.success ? "ok" : "fail"} ${item.sourcePath}${resultTarget(item) ? ` -> ${resultTarget(item)}` : ""}${item.error ? ` / ${item.error}` : ""}`),
    ]
    await host.clipboard?.writeText?.(lines.join("\n"))
  }

  async function copyLogs() {
    await host.clipboard?.writeText?.(logs.join("\n"))
  }

  function reset() {
    patch({ phase: "idle", progress: 0, progressText: "", result: null, logs: [] })
  }

  async function saveAsDefault() {
    const config: Partial<BandiaCardState> = {}
    for (const field of CONFIG_FIELDS) {
      const value = dataRef.current[field]
      if (value !== undefined) (config as Record<string, unknown>)[field] = value
    }
    await host.saveNodeConfig?.(config)
    setDefaults(config)
    setConfigDirty(false)
  }

  function restoreDefault() {
    if (defaults) patch(defaults)
  }

  function resetOverride() {
    patch({
      mode: undefined,
      mappingText: undefined,
      outputDir: undefined,
      deleteAfter: undefined,
      useTrash: undefined,
      parallel: undefined,
      workers: undefined,
      extractMode: undefined,
      overwriteMode: undefined,
      outputPrefix: undefined,
      compressFormat: undefined,
      deleteSource: undefined,
      dryRun: undefined,
    })
  }

  const commonProps = createViewProps({
    archivePaths,
    configDirty,
    configFilePath,
    data,
    defaults,
    dryRun,
    host,
    logs,
    mappings,
    mode,
    modeMeta,
    paths,
    progress,
    result,
    running,
    status,
    onCopyLogs: copyLogs,
    onCopyResults: copyResults,
    onExecute: (value?: BandiaAction) => execute(value),
    onModeChange: (value: BandiaMode) => patch({ mode: value }),
    onOpenConfigFile: host.openConfigFile,
    onPaste: pasteInput,
    onPatch: patch,
    onReset: reset,
    onResetOverride: resetOverride,
    onRestoreDefault: restoreDefault,
    onSaveDefault: saveAsDefault,
    onStop: requestStop,
  })

  return (
    <TooltipProvider>
      <div ref={surface.ref} className="@container/bandia relative flex h-full min-h-0 w-full overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(circle_at_12%_0%,hsl(var(--primary)/0.15),transparent_36%),radial-gradient(circle_at_88%_8%,hsl(var(--chart-3)/0.16),transparent_34%)]" />
        <div className="relative flex min-h-0 w-full flex-col">
          {surface.mode === "collapsed" || forceCollapsedSurface ? (
            <CollapsedView {...commonProps} />
          ) : compactSurface ? (
            portraitCompact ? <PortraitCompactView {...commonProps} /> : <CompactView {...commonProps} />
          ) : (
            <FullView {...commonProps} />
          )}
        </div>
      </div>
    </TooltipProvider>
  )
}

type ViewProps = ReturnType<typeof createViewProps>

function createViewProps(props: {
  archivePaths: string[]
  configDirty: boolean
  configFilePath?: string
  data: BandiaCardState
  defaults?: Partial<BandiaCardState>
  dryRun: boolean
  host: NodeComponentProps["host"]
  logs: string[]
  mappings: BandiaPathMapping[]
  mode: BandiaMode
  modeMeta: typeof MODES[number]
  paths: string[]
  progress: number
  result: BandiaData | null
  running: boolean
  status: BandiaStatusMeta
  onCopyLogs: () => void
  onCopyResults: () => void
  onExecute: (value?: BandiaAction) => void
  onModeChange: (value: BandiaMode) => void
  onOpenConfigFile?: () => Promise<void> | void
  onPaste: () => void
  onPatch: (patch: Partial<BandiaCardState>) => void
  onReset: () => void
  onResetOverride: () => void
  onRestoreDefault: () => void
  onSaveDefault: () => void
  onStop: () => void
}) {
  return props
}

function CollapsedView(props: ViewProps) {
  const Icon = props.modeMeta.icon
  return (
    <div className="relative flex h-full min-h-0 items-center gap-2 overflow-hidden rounded-xl border bg-background/85 px-3 py-2 shadow-sm">
      <div className={cn("absolute inset-0 opacity-70 transition-opacity", props.status.tone === "running" && "animate-pulse bg-primary/10", props.status.tone === "error" && "bg-destructive/10", props.status.tone === "success" && "bg-primary/10")} />
      <div className={cn("relative grid size-8 shrink-0 place-items-center rounded-lg", props.status.iconClass)}>
        <FileArchive />
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="flex items-center gap-1 text-xs font-semibold leading-none">
          <span>Bandia</span>
          <Badge variant={props.status.badgeVariant}>{props.status.label}</Badge>
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-1 truncate text-xs text-muted-foreground">
          <Icon className="size-3.5 shrink-0" />
          <span className="truncate">{summaryText(props)}</span>
        </div>
      </div>
      <RunActionButton compact props={props} />
      {props.status.tone === "running" && <div className="relative text-xs tabular-nums text-muted-foreground">{props.progress}%</div>}
    </div>
  )
}

function CompactView(props: ViewProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-2 p-3 pb-2">
        <HeaderLine modeMeta={props.modeMeta} status={props.status} subtitle={props.data.progressText || props.modeMeta.description} />
        <div className="flex shrink-0 items-center gap-1">
          <OptionsPopover data={props.data} disabled={props.running} mode={props.mode} onPatch={props.onPatch} />
          {props.running ? <ActionIconButton destructive icon={Square} label="停止" onClick={props.onStop} /> : <RunActionButton compact props={props} />}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
        <ModePicker disabled={props.running} mode={props.mode} onModeChange={props.onModeChange} />
        <PathInput compact archiveCount={props.archivePaths.length} data={props.data} disabled={props.running} mode={props.mode} pathCount={props.paths.length} onPaste={props.onPaste} onPatch={props.onPatch} />
        {props.mode !== "extract" && (
          <MappingInput compact data={props.data} disabled={props.running} mappingCount={props.mappings.length} mode={props.mode} onPatch={props.onPatch} />
        )}
        <PrimarySwitches compact data={props.data} disabled={props.running} mode={props.mode} onPatch={props.onPatch} />
        <ToolbarActions {...props} compact />
        {(props.status.tone === "running" || props.status.tone === "error") && (
          <StatusStrip compact progress={props.progress} status={props.status} text={props.data.progressText} />
        )}
        <div className="min-h-0 flex-1">
          <QueuePreview archivePaths={props.archivePaths} mappings={props.mappings} mode={props.mode} paths={props.paths} result={props.result} />
        </div>
      </div>
    </div>
  )
}

function PortraitCompactView(props: ViewProps) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="flex shrink-0 items-start justify-between gap-2">
        <HeaderLine modeMeta={props.modeMeta} status={props.status} subtitle={props.data.progressText || props.modeMeta.description} />
        <div className="flex shrink-0 items-center gap-1">
          <OptionsPopover data={props.data} disabled={props.running} mode={props.mode} onPatch={props.onPatch} />
          {props.running ? <ActionIconButton destructive icon={Square} label="停止" onClick={props.onStop} /> : <RunActionButton compact props={props} />}
        </div>
      </div>
      <div className="grid shrink-0 gap-2">
        <ModePicker disabled={props.running} mode={props.mode} onModeChange={props.onModeChange} />
        <PathInput compact archiveCount={props.archivePaths.length} data={props.data} disabled={props.running} mode={props.mode} pathCount={props.paths.length} onPaste={props.onPaste} onPatch={props.onPatch} />
        <PrimarySwitches compact data={props.data} disabled={props.running} mode={props.mode} onPatch={props.onPatch} />
        <ToolbarActions {...props} compact />
      </div>
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(112px,1fr)_minmax(128px,0.85fr)] gap-2">
        <QueuePreview archivePaths={props.archivePaths} mappings={props.mappings} mode={props.mode} paths={props.paths} result={props.result} />
        <ResultTabs compact logs={props.logs} result={props.result} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} />
      </div>
    </div>
  )
}

function FullView(props: ViewProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <div className="flex shrink-0 flex-col gap-3 @4xl/bandia:flex-row @4xl/bandia:items-center @4xl/bandia:justify-between">
        <div className="flex min-w-0 flex-col gap-2 @4xl/bandia:flex-row @4xl/bandia:items-center">
          <HeaderLine
            modeMeta={props.modeMeta}
            status={props.status}
            subtitle={props.data.progressText || `${props.modeMeta.label} / ${props.dryRun ? "预演" : "真实执行"} / ${props.paths.length || props.mappings.length} 项`}
          />
          <div data-testid="bandia-header-toolbar" className="flex min-w-0 flex-wrap items-center gap-2">
            <ToolbarActions {...props} />
          </div>
        </div>
        <StatsPanel archiveCount={props.archivePaths.length} mappingCount={props.mappings.length} pathCount={props.paths.length} progress={props.progress} result={props.result} />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 @5xl/bandia:grid-cols-[minmax(320px,380px)_minmax(0,1fr)]">
        <section className="flex min-h-0 flex-col gap-3 overflow-auto pr-1">
          <div className="grid gap-3 border-b pb-3">
            <div>
              <div className="text-sm font-semibold">任务</div>
              <div className="text-xs text-muted-foreground">选择解压、压缩或重打包；危险写入默认以预演保护。</div>
            </div>
            <ModePicker disabled={props.running} mode={props.mode} onModeChange={props.onModeChange} />
            <PathInput archiveCount={props.archivePaths.length} data={props.data} disabled={props.running} mode={props.mode} pathCount={props.paths.length} onPaste={props.onPaste} onPatch={props.onPatch} />
            {props.mode !== "extract" && (
              <MappingInput data={props.data} disabled={props.running} mappingCount={props.mappings.length} mode={props.mode} onPatch={props.onPatch} />
            )}
          </div>
          <div className="grid gap-3 border-b pb-3">
            <div className="text-sm font-semibold">关键开关</div>
            <PrimarySwitches data={props.data} disabled={props.running} mode={props.mode} onPatch={props.onPatch} />
          </div>
          <div className="grid gap-3 border-b pb-3">
            <div className="text-sm font-semibold">高级选项</div>
            <OptionsFields data={props.data} disabled={props.running} mode={props.mode} onPatch={props.onPatch} />
          </div>
          <StatusStrip progress={props.progress} status={props.status} text={props.data.progressText} />
        </section>

        <div className="grid min-h-0 gap-3 @4xl/bandia:grid-rows-[minmax(180px,0.9fr)_minmax(220px,1fr)]">
          <QueuePreview archivePaths={props.archivePaths} mappings={props.mappings} mode={props.mode} paths={props.paths} result={props.result} />
          <ResultTabs logs={props.logs} result={props.result} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} />
        </div>
      </div>
    </div>
  )
}

function ToolbarActions(props: ViewProps & { compact?: boolean }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-1", props.compact && "justify-between")}>
      {!props.compact && (
        props.running ? (
          <ActionIconButton destructive icon={Square} label="停止" onClick={props.onStop} />
        ) : (
          <RunActionButton compact props={props} />
        )
      )}
      <ActionIconButton
        disabled={!props.paths.length && !props.mappings.length}
        icon={ExternalLink}
        label="导出 EFU"
        onClick={() => props.onExecute("export_efu")}
      />
      <ActionIconButton disabled={!props.result} icon={Copy} label="复制结果" onClick={props.onCopyResults} />
      <ActionIconButton disabled={!props.logs.length} icon={Archive} label="复制日志" onClick={props.onCopyLogs} />
      <ActionIconButton icon={RotateCcw} label="清空状态" onClick={props.onReset} />
      {!props.compact && (
        <ConfigDefaultsPopover
          configDirty={props.configDirty}
          configFilePath={props.configFilePath}
          defaults={props.defaults}
          disabled={props.running}
          onOpenConfigFile={props.onOpenConfigFile}
          onResetOverride={props.onResetOverride}
          onRestoreDefault={props.onRestoreDefault}
          onSaveDefault={props.onSaveDefault}
        />
      )}
    </div>
  )
}

function RunActionButton({ compact, props }: { compact?: boolean; props: ViewProps }) {
  const disabled = props.running || !canRun(props.mode, props.paths, props.mappings)
  const dangerous = isDangerous(props)
  const label = `${props.dryRun ? "预演" : "执行"}${props.modeMeta.shortLabel}`
  if (dangerous) {
    return (
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button aria-label={label} disabled={disabled} size={compact ? "icon-sm" : "sm"} variant="destructive">
            <Play />
            {!compact && <span>{label}</span>}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认真实执行 Bandia？</AlertDialogTitle>
            <AlertDialogDescription>
              当前关闭了预演，并启用了删除源文件相关选项。请确认路径、映射和回收站策略无误后再继续。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => props.onExecute(props.mode)}>确认执行</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
  }

  return (
    <Button aria-label={label} disabled={disabled} size={compact ? "icon-sm" : "sm"} onClick={() => props.onExecute(props.mode)}>
      <Play />
      {!compact && <span>{label}</span>}
    </Button>
  )
}

function HeaderLine({ modeMeta, status, subtitle }: {
  modeMeta: typeof MODES[number]
  status: BandiaStatusMeta
  subtitle: string
}) {
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-2">
        <div className={cn("grid size-8 shrink-0 place-items-center rounded-lg", status.iconClass)}>
          <modeMeta.icon />
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-sm font-semibold leading-none">Bandia</h3>
            <Badge variant={status.badgeVariant}>{status.label}</Badge>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>
    </div>
  )
}

function buildInput(action: BandiaAction, data: BandiaCardState, paths: string[], mappings: BandiaPathMapping[]): BandiaInput {
  return {
    action,
    paths,
    mappings,
    mappingText: data.mappingText,
    deleteAfter: data.deleteAfter ?? true,
    useTrash: data.useTrash ?? true,
    parallel: data.parallel ?? false,
    workers: data.workers ?? 2,
    extractMode: data.extractMode ?? "auto",
    outputPrefix: data.outputPrefix ?? DEFAULT_OUTPUT_PREFIX,
    overwriteMode: data.overwriteMode ?? "overwrite",
    outputDir: data.outputDir,
    compressFormat: data.compressFormat ?? "zip",
    deleteSource: data.deleteSource ?? true,
    dryRun: data.dryRun ?? true,
    openInEverything: action === "export_efu",
  }
}

function statusFromState(data: BandiaCardState, running: boolean): BandiaStatusMeta {
  if (running || data.phase === "running") {
    return {
      label: "运行中",
      description: "Bandia 正在处理当前队列。",
      tone: "running",
      badgeVariant: "secondary",
      iconClass: "bg-primary text-primary-foreground",
    }
  }
  if (data.phase === "completed") {
    return {
      label: "完成",
      description: "上次任务已完成。",
      tone: "success",
      badgeVariant: "default",
      iconClass: "bg-primary text-primary-foreground",
    }
  }
  if (data.phase === "error") {
    return {
      label: "失败",
      description: "上次任务失败，请查看结果和日志。",
      tone: "error",
      badgeVariant: "destructive",
      iconClass: "bg-destructive text-destructive-foreground",
    }
  }
  return {
    label: "就绪",
    description: "粘贴路径或映射后即可预演。",
    tone: "idle",
    badgeVariant: "outline",
    iconClass: "bg-secondary text-secondary-foreground",
  }
}

function canRun(mode: BandiaMode, paths: string[], mappings: BandiaPathMapping[]): boolean {
  return mode === "extract" ? paths.length > 0 : paths.length > 0 || mappings.length > 0
}

function isDangerous(props: ViewProps): boolean {
  if (props.dryRun) return false
  if (props.mode === "extract") return props.data.deleteAfter ?? true
  return props.data.deleteSource ?? true
}

function labelForAction(action: BandiaAction): string {
  if (action === "extract") return "解压"
  if (action === "compress") return "压缩"
  if (action === "repack") return "重打包"
  if (action === "export_efu") return "导出"
  return action
}

function resultTarget(item: { outputPath?: string; archivePath?: string }): string | undefined {
  return item.outputPath ?? item.archivePath
}

function summaryText(props: ViewProps): string {
  if (props.data.progressText) return props.data.progressText
  if (props.result?.failedCount) return `${props.result.failedCount} 个失败`
  if (props.mode === "extract") return `${props.archivePaths.length} 个归档 / ${props.dryRun ? "预演" : "真实"}`
  return `${props.paths.length || props.mappings.length} 项 / ${props.dryRun ? "预演" : "真实"}`
}

function parseRawPaths(text: string): string[] {
  const seen = new Set<string>()
  return text
    .split(/\r?\n|[;]/)
    .map((item) => stripOuterQuotes(item.trim()))
    .filter((item) => item && !seen.has(item) && Boolean(seen.add(item)))
}

function stripOuterQuotes(value: string): string {
  let result = value.trim()
  while (result.length >= 2 && isQuote(result[0]!) && isQuote(result[result.length - 1]!)) {
    result = result.slice(1, -1).trim()
  }
  if (result && isQuote(result[0]!)) result = result.slice(1).trim()
  if (result && isQuote(result[result.length - 1]!)) result = result.slice(0, -1).trim()
  return result
}

function isQuote(value: string): boolean {
  return value === "\"" || value === "'"
}

import { useEffect, useMemo, useRef, useState } from "react"
import type { NodeComponentProps, NodeRunResult } from "@xiranite/contract"
import type { EncodebAction, EncodebData, EncodebInput } from "@xiranite/node-encodeb/core"
import { parseEncodebPaths } from "@xiranite/node-encodeb/core"
import { Copy, FileText, Languages, RotateCcw, ScanSearch, ShieldAlert, Square, Zap } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import { ACTIONS, PRESETS } from "./constants"
import { ActionIconButton, ConfigDefaultsPopover, EncodingFields, OptionsPopover, PathInput, PresetPicker, StatusStrip, StrategyPicker } from "./controls"
import type { EncodebCardState, EncodebPhase, EncodebPreset, EncodebStatusMeta, EncodebStrategy } from "./types"
import { CONFIG_FIELDS } from "./types"

export function Component({ compId, host }: NodeComponentProps) {
  const surface = useNodeSurface()
  const data = host.getData<EncodebCardState>(compId) ?? {}
  const dataRef = useRef<EncodebCardState>(data)
  dataRef.current = data

  const [running, setRunning] = useState(false)
  const [defaults, setDefaults] = useState<Partial<EncodebCardState> | undefined>(undefined)
  const [configFilePath, setConfigFilePath] = useState<string | undefined>(undefined)
  const [configDirty, setConfigDirty] = useState(false)

  const logs = data.logs ?? []
  const mappings = data.mappings ?? []
  const matches = data.matches ?? []
  const pathCount = useMemo(() => parseEncodebPaths(data.pathText ?? "").length, [data.pathText])
  const preset = data.preset ?? "cn"
  const presetMeta = PRESETS.find((item) => item.value === preset) ?? PRESETS[0]!
  const srcEncoding = data.srcEncoding ?? presetMeta.srcEncoding ?? "cp437"
  const dstEncoding = data.dstEncoding ?? presetMeta.dstEncoding ?? "cp936"
  const strategy = data.strategy ?? "replace"
  const phase = phaseFromState(data, running)
  const progress = data.progress ?? 0
  const status = statusFromState(data, running)
  const compactSurface = surface.mode === "compact" || surface.mode === "portrait"
  const forceCollapsedSurface = compactSurface && surface.height > 0 && surface.height < 160
  const portraitCompact = surface.mode === "portrait" || (surface.mode === "compact" && surface.width < 560 && surface.height >= 300)

  useEffect(() => {
    host.getNodeConfig?.<Partial<EncodebCardState>>()
      .then((response) => {
        setDefaults(response.config)
        setConfigFilePath(response.path)
      })
      .catch(() => undefined)
  }, [host])

  useEffect(() => {
    if (!defaults) return
    setConfigDirty(CONFIG_FIELDS.some((field) => String(data[field] ?? "") !== String(defaults[field] ?? "")))
  }, [data.pathText, data.preset, data.srcEncoding, data.dstEncoding, data.strategy, defaults])

  function patch(patchData: Partial<EncodebCardState>) {
    dataRef.current = { ...dataRef.current, ...patchData }
    host.patchData(compId, patchData)
  }

  function pushLog(message: string) {
    const nextLogs = [...(dataRef.current.logs ?? []), message].slice(-100)
    patch({ logs: nextLogs })
  }

  async function pastePath() {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ pathText: text.trim() })
  }

  async function copyResults() {
    const lines = [
      ...mappings.map((item) => `map ${item.src} -> ${item.dst}`),
      ...matches.map((item) => `match ${item}`),
    ]
    await host.clipboard?.writeText?.(lines.join("\n"))
  }

  async function copyLogs() {
    await host.clipboard?.writeText?.(logs.join("\n"))
  }

  function selectPreset(next: EncodebPreset) {
    const meta = PRESETS.find((item) => item.value === next)
    patch({
      preset: next,
      ...(meta?.srcEncoding ? { srcEncoding: meta.srcEncoding } : {}),
      ...(meta?.dstEncoding ? { dstEncoding: meta.dstEncoding } : {}),
    })
  }

  async function execute(action: EncodebAction) {
    if (running) return
    const paths = parseEncodebPaths(dataRef.current.pathText ?? "")
    if (!paths.length) {
      patch({ phase: "error", progress: 0, progressText: "请先输入至少一个源路径。" })
      return
    }

    const run = host.actions?.run
    if (!run) {
      patch({ phase: "error", progress: 0, progressText: "当前环境没有本地运行能力，请使用桌面模式或 CLI。" })
      pushLog("Native action is unavailable in this host.")
      return
    }

    const input: EncodebInput = {
      action,
      paths,
      srcEncoding,
      dstEncoding,
      strategy,
    }

    setRunning(true)
    try {
      patch({ phase: phaseForAction(action), progress: 0, progressText: `${actionLabel(action)}开始`, mappings: [], matches: [] })
      const response = await run<EncodebInput, EncodebData>("encodeb", input, (event) => {
        if (event.type === "progress") {
          patch({ progress: event.progress ?? 0, progressText: event.message })
          pushLog(`[${event.progress ?? 0}%] ${event.message}`)
        } else {
          pushLog(event.message)
        }
      }) as NodeRunResult<EncodebData>

      const next = response.data ?? null
      patch({
        phase: response.success ? "completed" : "error",
        progress: response.success ? 100 : 0,
        progressText: response.message,
        mappings: next?.mappings ?? [],
        matches: next?.matches ?? [],
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

  function reset() {
    patch({ phase: "idle", progress: 0, progressText: "", mappings: [], matches: [], logs: [] })
  }

  async function saveAsDefault() {
    const config: Partial<EncodebCardState> = {}
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
    patch({ pathText: undefined, preset: undefined, srcEncoding: undefined, dstEncoding: undefined, strategy: undefined })
  }

  const commonProps = createViewProps({
    configDirty,
    configFilePath,
    data,
    defaults,
    dstEncoding,
    host,
    logs,
    mappings,
    matches,
    pathCount,
    phase,
    preset,
    progress,
    running,
    srcEncoding,
    status,
    strategy,
    onCopyLogs: copyLogs,
    onCopyResults: copyResults,
    onExecute: execute,
    onOpenConfigFile: host.openConfigFile,
    onPaste: pastePath,
    onPatch: patch,
    onPresetChange: selectPreset,
    onReset: reset,
    onResetOverride: resetOverride,
    onRestoreDefault: restoreDefault,
    onSaveDefault: saveAsDefault,
    onStrategyChange: (next: EncodebStrategy) => patch({ strategy: next }),
  })

  return (
    <TooltipProvider>
      <div ref={surface.ref} className="@container/encodeb relative flex h-full min-h-0 w-full overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(circle_at_12%_0%,color-mix(in_oklch,var(--primary)_12%,transparent),transparent_36%),radial-gradient(circle_at_88%_8%,color-mix(in_oklch,var(--chart-2)_14%,transparent),transparent_34%)]" />
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
  configDirty: boolean
  configFilePath?: string
  data: EncodebCardState
  defaults?: Partial<EncodebCardState>
  dstEncoding: string
  host: NodeComponentProps["host"]
  logs: string[]
  mappings: EncodebCardState["mappings"]
  matches: string[]
  pathCount: number
  phase: EncodebPhase
  preset: EncodebPreset
  progress: number
  running: boolean
  srcEncoding: string
  status: EncodebStatusMeta
  strategy: EncodebStrategy
  onCopyLogs: () => void
  onCopyResults: () => void
  onExecute: (action: EncodebAction) => void
  onOpenConfigFile?: () => Promise<void> | void
  onPaste: () => void
  onPatch: (patch: Partial<EncodebCardState>) => void
  onPresetChange: (preset: EncodebPreset) => void
  onReset: () => void
  onResetOverride: () => void
  onRestoreDefault: () => void
  onSaveDefault: () => void
  onStrategyChange: (strategy: EncodebStrategy) => void
}) {
  return props
}

function CollapsedView(props: ViewProps) {
  return (
    <div data-testid="encodeb-collapsed-view" className="relative flex h-full min-h-0 items-center gap-2 overflow-hidden rounded-xl border bg-background/85 px-3 py-2 shadow-sm">
      <div className={cn("absolute inset-0 opacity-70 transition-opacity", props.status.tone === "running" && "animate-pulse bg-primary/10", props.status.tone === "error" && "bg-destructive/10", props.status.tone === "success" && "bg-primary/10")} />
      <div className={cn("relative grid size-8 shrink-0 place-items-center rounded-lg", props.status.iconClass)}>
        <Languages />
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="flex items-center gap-1 text-xs font-semibold leading-none">
          <span>Encodeb</span>
          <Badge variant={props.status.badgeVariant}>{props.status.label}</Badge>
        </div>
        <div className="mt-1 truncate text-xs text-muted-foreground">{summaryText(props)}</div>
      </div>
      <PrimaryActionButton compact props={props} />
      {props.status.tone === "running" && <div className="relative text-xs tabular-nums text-muted-foreground">{props.progress}%</div>}
    </div>
  )
}

function CompactView(props: ViewProps) {
  return (
    <div data-testid="encodeb-compact-view" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-2 p-3 pb-2">
        <HeaderLine status={props.status} subtitle={props.data.progressText || summaryText(props)} />
        <div className="flex shrink-0 items-center gap-1">
          <OptionsPopover
            data={props.data}
            disabled={props.running}
            preset={props.preset}
            srcEncoding={props.srcEncoding}
            dstEncoding={props.dstEncoding}
            strategy={props.strategy}
            onPatch={props.onPatch}
            onPresetChange={props.onPresetChange}
            onStrategyChange={props.onStrategyChange}
          />
          <PrimaryActionButton compact props={props} />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
        <PresetPicker disabled={props.running} preset={props.preset} onPresetChange={props.onPresetChange} />
        <PathInput compact disabled={props.running} pathCount={props.pathCount} value={props.data.pathText ?? ""} onChange={(pathText) => props.onPatch({ pathText })} onClear={() => props.onPatch({ pathText: "" })} onPaste={props.onPaste} />
        <ToolbarActions {...props} compact />
        {(props.status.tone === "running" || props.status.tone === "error") && (
          <StatusStrip compact progress={props.progress} status={props.status} text={props.data.progressText} />
        )}
        <div className="min-h-0 flex-1">
          <ResultTabs compact logs={props.logs} mappings={props.mappings} matches={props.matches} running={props.running} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} />
        </div>
      </div>
    </div>
  )
}

function PortraitCompactView(props: ViewProps) {
  return (
    <div data-testid="encodeb-portrait-view" className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="flex shrink-0 items-start justify-between gap-2">
        <HeaderLine status={props.status} subtitle={props.data.progressText || summaryText(props)} />
        <div className="flex shrink-0 items-center gap-1">
          <OptionsPopover
            data={props.data}
            disabled={props.running}
            preset={props.preset}
            srcEncoding={props.srcEncoding}
            dstEncoding={props.dstEncoding}
            strategy={props.strategy}
            onPatch={props.onPatch}
            onPresetChange={props.onPresetChange}
            onStrategyChange={props.onStrategyChange}
          />
          <PrimaryActionButton compact props={props} />
        </div>
      </div>
      <div className="grid shrink-0 gap-2">
        <PresetPicker disabled={props.running} preset={props.preset} onPresetChange={props.onPresetChange} />
        <PathInput compact disabled={props.running} pathCount={props.pathCount} value={props.data.pathText ?? ""} onChange={(pathText) => props.onPatch({ pathText })} onClear={() => props.onPatch({ pathText: "" })} onPaste={props.onPaste} />
        <ToolbarActions {...props} compact />
      </div>
      <div className="min-h-0 flex-1">
        <ResultTabs compact logs={props.logs} mappings={props.mappings} matches={props.matches} running={props.running} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} />
      </div>
    </div>
  )
}

function FullView(props: ViewProps) {
  return (
    <div data-testid="encodeb-full-view" className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <div className="flex shrink-0 flex-col gap-3 @4xl/encodeb:flex-row @4xl/encodeb:items-center @4xl/encodeb:justify-between">
        <div className="flex min-w-0 flex-col gap-2 @4xl/encodeb:flex-row @4xl/encodeb:items-center">
          <HeaderLine status={props.status} subtitle={props.data.progressText || `${props.pathCount} 路径 / ${props.srcEncoding} -> ${props.dstEncoding} / ${props.strategy === "copy" ? "复制" : "重命名"}`} />
          <div data-testid="encodeb-header-toolbar" className="flex min-w-0 flex-wrap items-center gap-2">
            <ToolbarActions {...props} />
          </div>
        </div>
        <StatsPanel mappings={props.mappings} matches={props.matches} progress={props.progress} />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 @5xl/encodeb:grid-cols-[minmax(320px,380px)_minmax(0,1fr)]">
        <section className="flex min-h-0 flex-col gap-3 overflow-auto pr-1">
          <div className="grid gap-3 border-b pb-3">
            <div>
              <div className="text-sm font-semibold">输入</div>
              <div className="text-xs text-muted-foreground">粘贴包含乱码文件名的目录，选择编码预设后预览或修复。</div>
            </div>
            <PathInput disabled={props.running} pathCount={props.pathCount} value={props.data.pathText ?? ""} onChange={(pathText) => props.onPatch({ pathText })} onClear={() => props.onPatch({ pathText: "" })} onPaste={props.onPaste} />
            <PresetPicker disabled={props.running} preset={props.preset} onPresetChange={props.onPresetChange} />
          </div>
          <div className="grid gap-3 border-b pb-3">
            <div className="text-sm font-semibold">编码与策略</div>
            <EncodingFields disabled={props.running} preset={props.preset} srcEncoding={props.srcEncoding} dstEncoding={props.dstEncoding} onPatch={props.onPatch} />
            <StrategyPicker disabled={props.running} strategy={props.strategy} onStrategyChange={props.onStrategyChange} />
          </div>
          <StatusStrip progress={props.progress} status={props.status} text={props.data.progressText} />
        </section>

        <div className="h-[clamp(12rem,32vh,20rem)] min-h-0 overflow-hidden @5xl/encodeb:h-full">
          <ResultTabs logs={props.logs} mappings={props.mappings} matches={props.matches} running={props.running} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} />
        </div>
      </div>
    </div>
  )
}

function ToolbarActions(props: ViewProps & { compact?: boolean }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-1", props.compact && "justify-between")}>
      <ActionIconButton disabled={props.running || !props.pathCount} icon={ScanSearch} label="扫描乱码" onClick={() => props.onExecute("find")} />
      <ActionIconButton disabled={props.running || !props.pathCount} icon={FileText} label="预览转换" onClick={() => props.onExecute("preview")} />
      {!props.compact && <PrimaryActionButton props={props} />}
      <ActionIconButton disabled={props.running || (!props.mappings.length && !props.matches.length)} icon={Copy} label="复制结果" onClick={props.onCopyResults} />
      <ActionIconButton disabled={!props.logs.length} icon={RotateCcw} label="清空状态" onClick={props.onReset} />
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

function PrimaryActionButton({ compact, props }: { compact?: boolean; props: ViewProps }) {
  if (props.running) {
    return (
      <Button aria-label="encodeb running" disabled size={compact ? "icon-sm" : "sm"} variant="secondary">
        <Square />
        {!compact && <span>运行中</span>}
      </Button>
    )
  }

  const disabled = !props.pathCount
  const label = "执行修复"
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button aria-label={label} disabled={disabled} size={compact ? "icon-sm" : "sm"} variant="destructive">
          <ShieldAlert />
          {!compact && <span>{label}</span>}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认执行 Encodeb 修复？</AlertDialogTitle>
          <AlertDialogDescription>
            当前将对 {props.pathCount} 个路径执行真实文件名修复，策略为 {props.strategy === "copy" ? "复制副本" : "原地重命名"}，编码 {props.srcEncoding} -&gt; {props.dstEncoding}。该操作不可撤销，请确认路径无误。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => props.onExecute("recover")}>确认执行</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function HeaderLine({ status, subtitle }: {
  status: EncodebStatusMeta
  subtitle: string
}) {
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-2">
        <div className={cn("grid size-8 shrink-0 place-items-center rounded-lg", status.iconClass)}>
          <Languages />
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-sm font-semibold leading-none">Encodeb</h3>
            <Badge variant={status.badgeVariant}>{status.label}</Badge>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>
    </div>
  )
}

function StatsPanel(props: {
  mappings: EncodebCardState["mappings"]
  matches: string[]
  progress: number
}) {
  const stats = [
    ["预览", props.mappings?.length ?? 0],
    ["乱码", props.matches.length],
    ["进度", `${props.progress}%`],
  ] as const

  return (
    <div className="grid shrink-0 grid-cols-3 gap-1">
      {stats.map(([label, value]) => (
        <div key={label} className="min-w-0 rounded-md bg-muted/35 px-2 py-1.5 text-center">
          <div className="truncate text-[11px] text-muted-foreground">{label}</div>
          <div className="text-sm font-semibold tabular-nums">{value}</div>
        </div>
      ))}
    </div>
  )
}

function ResultTabs(props: {
  compact?: boolean
  logs: string[]
  mappings: EncodebCardState["mappings"]
  matches: string[]
  running?: boolean
  onCopyLogs: () => void
  onCopyResults: () => void
}) {
  const mappingLines = (props.mappings ?? []).map((item) => `map ${item.src} -> ${item.dst}`)
  const matchLines = props.matches.map((item) => `match ${item}`)
  const resultLines = [...mappingLines, ...matchLines]
  const preferredTab = props.running
    ? "results"
    : resultLines.length
      ? "results"
      : props.logs.length
        ? "logs"
        : "results"

  return (
    <Tabs defaultValue={preferredTab} className="flex h-full min-h-0 flex-col">
      <TabsList className="shrink-0">
        <TabsTrigger value="results">结果</TabsTrigger>
        <TabsTrigger value="logs">日志</TabsTrigger>
      </TabsList>
      <TabsContent value="results" className="min-h-0 flex-1">
        <TextPanel
          compact={props.compact}
          emptyText="扫描或预览后会显示乱码匹配和转码映射。"
          icon={FileText}
          lines={resultLines}
          onCopy={props.onCopyResults}
        />
      </TabsContent>
      <TabsContent value="logs" className="min-h-0 flex-1">
        <TextPanel compact={props.compact} emptyText="运行日志会显示在这里。" icon={Zap} lines={props.logs} onCopy={props.onCopyLogs} />
      </TabsContent>
    </Tabs>
  )
}

function TextPanel(props: {
  compact?: boolean
  emptyText: string
  icon: typeof FileText
  lines: string[]
  onCopy: () => void
}) {
  const Icon = props.icon
  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border bg-background/70">
      <div className={props.compact ? "flex shrink-0 items-center justify-between gap-2 px-2 py-1.5" : "flex shrink-0 items-center justify-between gap-2 px-3 py-2"}>
        <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
          <Icon className="size-3.5" />
          <span>{props.lines.length ? `${props.lines.length} 项` : "等待运行"}</span>
        </div>
        <Button disabled={!props.lines.length} size="xs" variant="ghost" onClick={props.onCopy}>
          <Copy data-icon="inline-start" />
          复制
        </Button>
      </div>
      <Separator />
      <ScrollArea className="min-h-0 flex-1">
        {props.lines.length ? (
          <pre className={props.compact ? "p-2 text-xs leading-5 text-muted-foreground" : "p-3 text-xs leading-5 text-muted-foreground"}>
            {props.lines.join("\n")}
          </pre>
        ) : (
          <div className={props.compact ? "flex min-h-16 items-center justify-center p-3 text-center text-xs text-muted-foreground" : "flex min-h-36 items-center justify-center p-6 text-center text-sm text-muted-foreground"}>
            {props.emptyText}
          </div>
        )}
      </ScrollArea>
    </section>
  )
}

function statusFromState(data: EncodebCardState, running: boolean): EncodebStatusMeta {
  if (running || data.phase === "scanning" || data.phase === "previewing" || data.phase === "executing") {
    return {
      label: "运行中",
      description: data.progressText || "Encodeb 正在处理文件名。",
      tone: "running",
      badgeVariant: "secondary",
      iconClass: "bg-primary text-primary-foreground",
    }
  }
  if (data.phase === "error") {
    return {
      label: "失败",
      description: data.progressText || "上次任务失败，请查看日志。",
      tone: "error",
      badgeVariant: "destructive",
      iconClass: "bg-destructive text-destructive-foreground",
    }
  }
  if (data.phase === "completed") {
    return {
      label: "完成",
      description: data.progressText || "上次任务已完成。",
      tone: "success",
      badgeVariant: "default",
      iconClass: "bg-primary text-primary-foreground",
    }
  }
  return {
    label: "就绪",
    description: "粘贴路径后扫描乱码或预览转码。",
    tone: "idle",
    badgeVariant: "outline",
    iconClass: "bg-secondary text-secondary-foreground",
  }
}

function phaseFromState(data: EncodebCardState, running: boolean): EncodebPhase {
  if (running) return data.phase ?? "scanning"
  return data.phase ?? "idle"
}

function phaseForAction(action: EncodebAction): EncodebPhase {
  if (action === "find") return "scanning"
  if (action === "preview") return "previewing"
  return "executing"
}

function actionLabel(action: EncodebAction): string {
  if (action === "find") return "扫描"
  if (action === "preview") return "预览"
  return "修复"
}

function summaryText(props: ViewProps): string {
  if (props.data.progressText) return props.data.progressText
  if (props.mappings?.length) return `${props.mappings.length} 个转码映射`
  if (props.matches.length) return `${props.matches.length} 个乱码`
  if (props.pathCount) return `${props.pathCount} 条路径等待扫描`
  return "粘贴路径后扫描乱码文件名"
}

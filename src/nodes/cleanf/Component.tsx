import { useEffect, useMemo, useRef, useState } from "react"
import type { NodeComponentProps, NodeRunResult } from "@xiranite/contract"
import type { CleanfData, CleanfInput, CleanfPresetId } from "@xiranite/node-cleanf/core"
import { parseCleanfPaths } from "@xiranite/node-cleanf/core"
import { Brush, Copy, Eye, Play, RotateCcw, ShieldAlert, Square, Trash2 } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import { DEFAULT_SELECTED_PRESETS, NODE_ICON } from "./constants"
import { ActionIconButton, AdvancedOptionsPopover, ConfigDefaultsPopover, LogPanel, PathInput, PresetPicker, PrimarySwitches, ResultList, StatusStrip } from "./controls"
import type { CleanfCardState, CleanfPhase, CleanfStatusMeta } from "./types"
import { CONFIG_FIELDS } from "./types"

export function Component({ compId, host }: NodeComponentProps) {
  const surface = useNodeSurface()
  const data = host.getData<CleanfCardState>(compId) ?? {}
  const dataRef = useRef<CleanfCardState>(data)
  dataRef.current = data

  const [running, setRunning] = useState(false)
  const [defaults, setDefaults] = useState<Partial<CleanfCardState> | undefined>(undefined)
  const [configFilePath, setConfigFilePath] = useState<string | undefined>(undefined)
  const [configDirty, setConfigDirty] = useState(false)

  const logs = data.logs ?? []
  const result = data.result ?? null
  const progress = data.progress ?? 0
  const pathCount = useMemo(() => parseCleanfPaths(data.pathText ?? "").length, [data.pathText])
  const selectedPresets = data.selectedPresets ?? DEFAULT_SELECTED_PRESETS
  const previewMode = data.previewMode ?? true
  const phase = phaseFromState(data, running)
  const status = statusFromState(data, running)
  const compactSurface = surface.mode === "compact" || surface.mode === "portrait"
  const forceCollapsedSurface = compactSurface && surface.height > 0 && surface.height < 160
  const portraitCompact = surface.mode === "portrait" || (surface.mode === "compact" && surface.width < 560 && surface.height >= 300)

  useEffect(() => {
    host.getNodeConfig?.<Partial<CleanfCardState>>()
      .then((response) => {
        setDefaults(response.config)
        setConfigFilePath(response.path)
      })
      .catch(() => undefined)
  }, [host])

  useEffect(() => {
    if (!defaults) return
    setConfigDirty(CONFIG_FIELDS.some((field) => String(data[field] ?? "") !== String(defaults[field] ?? "")))
  }, [data.pathText, data.selectedPresets, data.excludeKeywords, data.previewMode, defaults])

  function patch(patchData: Partial<CleanfCardState>) {
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

  function togglePreset(id: CleanfPresetId) {
    const next = selectedPresets.includes(id)
      ? selectedPresets.filter((preset) => preset !== id)
      : [...selectedPresets, id]
    patch({ selectedPresets: next })
  }

  async function execute(override: Partial<CleanfCardState> = {}) {
    if (running) return
    const current = { ...dataRef.current, ...override }
    const paths = parseCleanfPaths(current.pathText ?? "")
    if (!paths.length) {
      patch({ phase: "error", progress: 0, progressText: "请先输入至少一个扫描路径。" })
      return
    }

    const input: CleanfInput = {
      paths,
      presets: current.selectedPresets ?? DEFAULT_SELECTED_PRESETS,
      exclude: current.excludeKeywords,
      preview: current.previewMode ?? true,
    }

    const run = host.actions?.run
    if (!run) {
      patch({ phase: "error", progress: 0, progressText: "当前环境没有本地运行能力，请使用桌面模式或 CLI。" })
      pushLog("Native action is unavailable in this host.")
      return
    }

    setRunning(true)
    try {
      const actionLabel = input.preview ? "预演" : "清理"
      patch({ phase: "scanning", progress: 0, progressText: `${actionLabel}开始`, result: null, ...override })
      const response = await run<CleanfInput, CleanfData>("cleanf", input, (event) => {
        if (event.type === "progress") {
          patch({ progress: event.progress ?? 0, progressText: event.message })
          pushLog(`[${event.progress ?? 0}%] ${event.message}`)
        } else {
          pushLog(event.message)
        }
      }) as NodeRunResult<CleanfData>

      patch({
        phase: response.success ? "completed" : "error",
        progress: response.success ? 100 : 0,
        progressText: response.message,
        result: response.data ?? null,
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

  async function copyLogs() {
    await host.clipboard?.writeText?.(logs.join("\n"))
  }

  async function copyResults() {
    const lines = result?.previewFiles.length
      ? result.previewFiles
      : Object.entries(result?.removedDetails ?? []).map(([key, count]) => `${key}: ${count}`)
    await host.clipboard?.writeText?.(lines.join("\n"))
  }

  function reset() {
    patch({ phase: "idle", progress: 0, progressText: "", result: null, logs: [] })
  }

  async function saveAsDefault() {
    const config: Partial<CleanfCardState> = {}
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
      pathText: undefined,
      selectedPresets: undefined,
      excludeKeywords: undefined,
      previewMode: undefined,
    })
  }

  const commonProps = createViewProps({
    configDirty,
    configFilePath,
    data,
    defaults,
    host,
    logs,
    pathCount,
    phase,
    previewMode,
    progress,
    result,
    running,
    selectedPresets,
    status,
    onCopyLogs: copyLogs,
    onCopyResults: copyResults,
    onExecute: execute,
    onOpenConfigFile: host.openConfigFile,
    onPastePath: pastePath,
    onPatch: patch,
    onReset: reset,
    onResetOverride: resetOverride,
    onRestoreDefault: restoreDefault,
    onSaveDefault: saveAsDefault,
    onTogglePreset: togglePreset,
  })

  return (
    <TooltipProvider>
      <div ref={surface.ref} className="@container/cleanf relative flex h-full min-h-0 w-full overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(circle_at_12%_0%,color-mix(in_oklch,var(--primary)_14%,transparent),transparent_36%),radial-gradient(circle_at_88%_8%,color-mix(in_oklch,var(--chart-4)_14%,transparent),transparent_34%)]" />
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
  data: CleanfCardState
  defaults?: Partial<CleanfCardState>
  host: NodeComponentProps["host"]
  logs: string[]
  pathCount: number
  phase: CleanfPhase
  previewMode: boolean
  progress: number
  result: CleanfData | null
  running: boolean
  selectedPresets: CleanfPresetId[]
  status: CleanfStatusMeta
  onCopyLogs: () => void
  onCopyResults: () => void
  onExecute: (override?: Partial<CleanfCardState>) => void
  onOpenConfigFile?: () => Promise<void> | void
  onPastePath: () => void
  onPatch: (patch: Partial<CleanfCardState>) => void
  onReset: () => void
  onResetOverride: () => void
  onRestoreDefault: () => void
  onSaveDefault: () => void
  onTogglePreset: (id: CleanfPresetId) => void
}) {
  return props
}

function CollapsedView(props: ViewProps) {
  const Icon = NODE_ICON
  return (
    <div data-testid="cleanf-collapsed-view" className="relative flex h-full min-h-0 items-center gap-2 overflow-hidden rounded-xl border bg-background/85 px-3 py-2 shadow-sm">
      <div className={cn("absolute inset-0 opacity-70 transition-opacity", props.status.tone === "running" && "animate-pulse bg-primary/10", props.status.tone === "error" && "bg-destructive/10", props.status.tone === "success" && "bg-primary/10")} />
      <div className={cn("relative grid size-8 shrink-0 place-items-center rounded-lg", props.status.iconClass)}>
        <Icon />
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="flex items-center gap-1 text-xs font-semibold leading-none">
          <span>Cleanf</span>
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
    <div data-testid="cleanf-compact-view" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-2 p-3 pb-2">
        <HeaderLine status={props.status} subtitle={props.data.progressText || summaryText(props)} />
        <div className="flex shrink-0 items-center gap-1">
          <AdvancedOptionsPopover data={props.data} disabled={props.running} onPatch={props.onPatch} />
          <PrimaryActionButton compact props={props} />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
        <PathInput compact disabled={props.running} pathCount={props.pathCount} value={props.data.pathText ?? ""} onChange={(pathText) => props.onPatch({ pathText })} onClear={() => props.onPatch({ pathText: "" })} onPaste={props.onPastePath} />
        <PrimarySwitches compact data={props.data} disabled={props.running} onPatch={props.onPatch} />
        <ToolbarActions {...props} compact />
        {(props.status.tone === "running" || props.status.tone === "error") && (
          <StatusStrip compact progress={props.progress} status={props.status} text={props.data.progressText} />
        )}
        <div className="min-h-0 flex-1">
          <CleanfDisplayTabs compact logs={props.logs} phase={props.phase} result={props.result} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} />
        </div>
      </div>
    </div>
  )
}

function PortraitCompactView(props: ViewProps) {
  return (
    <div data-testid="cleanf-portrait-view" className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="flex shrink-0 items-start justify-between gap-2">
        <HeaderLine status={props.status} subtitle={props.data.progressText || summaryText(props)} />
        <div className="flex shrink-0 items-center gap-1">
          <AdvancedOptionsPopover data={props.data} disabled={props.running} onPatch={props.onPatch} />
          <PrimaryActionButton compact props={props} />
        </div>
      </div>
      <div className="grid shrink-0 gap-2">
        <PathInput compact disabled={props.running} pathCount={props.pathCount} value={props.data.pathText ?? ""} onChange={(pathText) => props.onPatch({ pathText })} onClear={() => props.onPatch({ pathText: "" })} onPaste={props.onPastePath} />
        <PrimarySwitches compact data={props.data} disabled={props.running} onPatch={props.onPatch} />
        <ToolbarActions {...props} compact />
      </div>
      <div className="min-h-0 flex-1">
        <CleanfDisplayTabs compact logs={props.logs} phase={props.phase} result={props.result} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} />
      </div>
    </div>
  )
}

function FullView(props: ViewProps) {
  return (
    <div data-testid="cleanf-full-view" className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <div className="flex shrink-0 flex-col gap-3 @4xl/cleanf:flex-row @4xl/cleanf:items-center @4xl/cleanf:justify-between">
        <div className="flex min-w-0 flex-col gap-2 @4xl/cleanf:flex-row @4xl/cleanf:items-center">
          <HeaderLine status={props.status} subtitle={props.data.progressText || `${props.pathCount} 路径 / ${props.selectedPresets.length} 预设 / ${props.previewMode ? "预演" : "真实执行"}`} />
          <div data-testid="cleanf-header-toolbar" className="flex min-w-0 flex-wrap items-center gap-2">
            <ToolbarActions {...props} />
          </div>
        </div>
        <StatsPanel progress={props.progress} result={props.result} />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 @5xl/cleanf:grid-cols-[minmax(320px,380px)_minmax(0,1fr)]">
        <section className="flex min-h-0 flex-col gap-3 overflow-auto pr-1">
          <div className="grid gap-3 border-b pb-3">
            <div>
              <div className="text-sm font-semibold">输入</div>
              <div className="text-xs text-muted-foreground">粘贴目录，选择清理预设，预演确认后再执行真实删除。</div>
            </div>
            <PathInput disabled={props.running} pathCount={props.pathCount} value={props.data.pathText ?? ""} onChange={(pathText) => props.onPatch({ pathText })} onClear={() => props.onPatch({ pathText: "" })} onPaste={props.onPastePath} />
          </div>
          <div className="grid gap-3 border-b pb-3">
            <div className="text-sm font-semibold">清理预设</div>
            <PresetPicker disabled={props.running} selected={props.selectedPresets} onToggle={props.onTogglePreset} />
          </div>
          <div className="grid gap-3 border-b pb-3">
            <div className="text-sm font-semibold">关键开关</div>
            <PrimarySwitches data={props.data} disabled={props.running} onPatch={props.onPatch} />
          </div>
          <StatusStrip progress={props.progress} status={props.status} text={props.data.progressText} />
        </section>

        <div className="h-[clamp(12rem,32vh,20rem)] min-h-0 overflow-hidden @5xl/cleanf:h-full">
          <CleanfDisplayTabs logs={props.logs} phase={props.phase} result={props.result} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} />
        </div>
      </div>
    </div>
  )
}

function ToolbarActions(props: ViewProps & { compact?: boolean }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-1", props.compact && "justify-between")}>
      {!props.compact && <PrimaryActionButton props={props} />}
      <ActionIconButton disabled={!props.result} icon={Copy} label="复制结果" onClick={props.onCopyResults} />
      <ActionIconButton disabled={!props.logs.length} icon={Eye} label="复制日志" onClick={props.onCopyLogs} />
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

function PrimaryActionButton({ compact, props }: { compact?: boolean; props: ViewProps }) {
  if (props.running) {
    return (
      <Button aria-label="cleanf running" disabled size={compact ? "icon-sm" : "sm"} variant="secondary">
        <Square />
        {!compact && <span>运行中</span>}
      </Button>
    )
  }

  const disabled = !props.pathCount
  const label = props.previewMode ? "预演清理" : "真实清理"
  if (!props.previewMode) {
    return (
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button aria-label={label} disabled={disabled} size={compact ? "icon-sm" : "sm"} variant="destructive">
            <Trash2 />
            {!compact && <span>{label}</span>}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认真实执行 Cleanf？</AlertDialogTitle>
            <AlertDialogDescription>
              当前将真实删除扫描到的文件和文件夹，启用了 {props.selectedPresets.length} 个预设，共 {props.pathCount} 条路径。删除后无法恢复，请确认路径和排除关键词无误。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => props.onExecute()}>确认执行</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
  }

  return (
    <Button aria-label={label} disabled={disabled} size={compact ? "icon-sm" : "sm"} onClick={() => props.onExecute()}>
      <Play />
      {!compact && <span>{label}</span>}
    </Button>
  )
}

function HeaderLine({ status, subtitle }: {
  status: CleanfStatusMeta
  subtitle: string
}) {
  const Icon = NODE_ICON
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-2">
        <div className={cn("grid size-8 shrink-0 place-items-center rounded-lg", status.iconClass)}>
          <Icon />
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-sm font-semibold leading-none">Cleanf</h3>
            <Badge variant={status.badgeVariant}>{status.label}</Badge>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>
    </div>
  )
}

function StatsPanel(props: {
  progress: number
  result: CleanfData | null
}) {
  const stats = [
    ["总计", props.result?.totalRemoved ?? 0],
    ["跳过", props.result?.skipped ?? 0],
    ["预演项", props.result?.previewFiles.length ?? 0],
    ["进度", `${props.progress}%`],
  ] as const

  return (
    <div className="grid shrink-0 grid-cols-2 gap-1 @3xl/cleanf:grid-cols-4">
      {stats.map(([label, value]) => (
        <div key={label} className="min-w-0 rounded-md bg-muted/35 px-2 py-1.5 text-center">
          <div className="truncate text-[11px] text-muted-foreground">{label}</div>
          <div className="text-sm font-semibold tabular-nums">{value}</div>
        </div>
      ))}
    </div>
  )
}

function CleanfDisplayTabs(props: {
  compact?: boolean
  logs: string[]
  phase: CleanfPhase
  result: CleanfData | null
  onCopyLogs: () => void
  onCopyResults: () => void
}) {
  const hasResult = Boolean(props.result)
  const preferredTab = hasResult ? "results" : props.logs.length ? "logs" : "results"
  const [tab, setTab] = useState(preferredTab)

  useEffect(() => {
    setTab(preferredTab)
  }, [preferredTab])

  return (
    <Tabs value={tab} onValueChange={setTab} className="flex h-full min-h-0 flex-col">
      <TabsList className="shrink-0">
        <TabsTrigger value="results">结果</TabsTrigger>
        <TabsTrigger value="logs">日志</TabsTrigger>
      </TabsList>
      <TabsContent value="results" className="min-h-0 flex-1">
        <ResultList compact={props.compact} result={props.result} />
      </TabsContent>
      <TabsContent value="logs" className="min-h-0 flex-1">
        <LogPanel compact={props.compact} logs={props.logs} onCopy={props.onCopyLogs} />
      </TabsContent>
    </Tabs>
  )
}

function statusFromState(data: CleanfCardState, running: boolean): CleanfStatusMeta {
  if (running || data.phase === "scanning") {
    return {
      label: "运行中",
      description: data.progressText || "Cleanf 正在扫描并清理。",
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
    description: "粘贴目录并选择预设后预演或清理。",
    tone: "idle",
    badgeVariant: "outline",
    iconClass: "bg-secondary text-secondary-foreground",
  }
}

function phaseFromState(data: CleanfCardState, running: boolean): CleanfPhase {
  if (running) return data.phase ?? "scanning"
  return data.phase ?? "idle"
}

function summaryText(props: ViewProps): string {
  if (props.data.progressText) return props.data.progressText
  if (props.result?.totalRemoved) return `删除 ${props.result.totalRemoved} 项 / 跳过 ${props.result.skipped} 项`
  if (props.pathCount) return `${props.pathCount} 条路径 / ${props.selectedPresets.length} 预设 / ${props.previewMode ? "预演" : "真实"}`
  return "粘贴目录后预演清理结果"
}

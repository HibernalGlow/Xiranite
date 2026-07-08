import { useEffect, useMemo, useRef, useState } from "react"
import type { NodeComponentProps, NodeRunResult } from "@xiranite/contract"
import type { CrashuConflictPolicy, CrashuData, CrashuInput, CrashuMoveDirection } from "@xiranite/node-crashu/core"
import { Copy, MoveRight, RotateCcw, Search, Square } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import { DEFAULT_THRESHOLD, NODE_ICON } from "./constants"
import { ActionIconButton, AdvancedOptionsPopover, ConfigDefaultsPopover, LogPanel, MatchList, PrimarySwitches, SourcePathsInput, StatusStrip, TargetNamesInput } from "./controls"
import type { CrashuAction, CrashuCardState, CrashuPhase, CrashuStatusMeta } from "./types"
import { CONFIG_FIELDS } from "./types"

export function Component({ compId, host }: NodeComponentProps) {
  const surface = useNodeSurface()
  const data = host.getData<CrashuCardState>(compId) ?? {}
  const dataRef = useRef<CrashuCardState>(data)
  dataRef.current = data

  const [running, setRunning] = useState(false)
  const [defaults, setDefaults] = useState<Partial<CrashuCardState> | undefined>(undefined)
  const [configFilePath, setConfigFilePath] = useState<string | undefined>(undefined)
  const [configDirty, setConfigDirty] = useState(false)

  const logs = data.logs ?? []
  const result = data.result ?? null
  const progress = data.progress ?? 0
  const sourcePaths = useMemo(() => splitLines(data.sourcePathsText), [data.sourcePathsText])
  const targetNames = useMemo(() => splitLines(data.targetNamesText), [data.targetNamesText])
  const threshold = data.similarityThreshold ?? DEFAULT_THRESHOLD
  const dryRun = data.dryRun ?? true
  const autoMove = data.autoMove ?? false
  const direction = data.moveDirection ?? "to_target"
  const conflict = data.conflictPolicy ?? "skip"
  const phase = phaseFromState(data, running)
  const status = statusFromState(data, running, result)
  const compactSurface = surface.mode === "compact" || surface.mode === "portrait"
  const forceCollapsedSurface = compactSurface && surface.height > 0 && surface.height < 160
  const portraitCompact = surface.mode === "portrait" || (surface.mode === "compact" && surface.width < 560 && surface.height >= 300)

  useEffect(() => {
    host.getNodeConfig?.<Partial<CrashuCardState>>()
      .then((response) => {
        setDefaults(response.config)
        setConfigFilePath(response.path)
      })
      .catch(() => undefined)
  }, [host])

  useEffect(() => {
    if (!defaults) return
    setConfigDirty(CONFIG_FIELDS.some((field) => String(data[field] ?? "") !== String(defaults[field] ?? "")))
  }, [data.sourcePathsText, data.targetPath, data.targetNamesText, data.destinationPath, data.similarityThreshold, data.autoMove, data.moveDirection, data.conflictPolicy, defaults])

  function patch(patchData: Partial<CrashuCardState>) {
    dataRef.current = { ...dataRef.current, ...patchData }
    host.patchData(compId, patchData)
  }

  function pushLog(message: string) {
    const nextLogs = [...(dataRef.current.logs ?? []), message].slice(-100)
    patch({ logs: nextLogs })
  }

  async function pasteSources() {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ sourcePathsText: text.trim() })
  }

  async function execute(action: CrashuAction) {
    if (running) return
    if (!sourcePaths.length) {
      patch({ phase: "error", progress: 0, progressText: "请先输入至少一个源目录。" })
      return
    }

    const input: CrashuInput = {
      action,
      sourcePaths,
      targetPath: data.targetPath,
      targetNames,
      destinationPath: data.destinationPath,
      similarityThreshold: threshold,
      autoMove: action === "move",
      moveDirection: direction,
      conflictPolicy: conflict,
      dryRun,
    }

    const run = host.actions?.run
    if (!run) {
      patch({ phase: "error", progress: 0, progressText: "当前环境没有本地运行能力，请使用桌面模式或 CLI。" })
      pushLog("Native action is unavailable in this host.")
      return
    }

    setRunning(true)
    try {
      patch({ phase: phaseForAction(action), progress: 0, progressText: `${actionLabel(action)}开始`, result: null })
      const response = await run<CrashuInput, CrashuData>("crashu", input, (event) => {
        if (event.type === "progress") {
          patch({ progress: event.progress ?? 0, progressText: event.message })
          pushLog(`[${event.progress ?? 0}%] ${event.message}`)
        } else {
          pushLog(event.message)
        }
      }) as NodeRunResult<CrashuData>

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

  async function copyResults() {
    const matches = result?.similarFolders ?? []
    const lines = matches.map((item) => `${item.path} -> ${item.target} (${Math.round(item.similarity * 100)}%)`)
    await host.clipboard?.writeText?.(lines.join("\n"))
  }

  async function copyLogs() {
    await host.clipboard?.writeText?.(logs.join("\n"))
  }

  function reset() {
    patch({ phase: "idle", progress: 0, progressText: "", result: null, logs: [] })
  }

  async function saveAsDefault() {
    const config: Partial<CrashuCardState> = {}
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
      sourcePathsText: undefined,
      targetPath: undefined,
      targetNamesText: undefined,
      destinationPath: undefined,
      similarityThreshold: undefined,
      autoMove: undefined,
      moveDirection: undefined,
      conflictPolicy: undefined,
    })
  }

  const commonProps = createViewProps({
    compactSurface,
    configDirty,
    configFilePath,
    data,
    defaults,
    dryRun,
    host,
    logs,
    progress,
    result,
    running,
    sourcePaths,
    status,
    targetNames,
    onCopyLogs: copyLogs,
    onCopyResults: copyResults,
    onExecute: execute,
    onOpenConfigFile: host.openConfigFile,
    onPatch: patch,
    onPasteSources: pasteSources,
    onReset: reset,
    onResetOverride: resetOverride,
    onRestoreDefault: restoreDefault,
    onSaveDefault: saveAsDefault,
  })

  return (
    <TooltipProvider>
      <div ref={surface.ref} className="@container/crashu relative flex h-full min-h-0 w-full overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(circle_at_12%_0%,hsl(var(--primary)/0.14),transparent_36%),radial-gradient(circle_at_88%_8%,hsl(var(--chart-2)/0.14),transparent_34%)]" />
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
  compactSurface: boolean
  configDirty: boolean
  configFilePath?: string
  data: CrashuCardState
  defaults?: Partial<CrashuCardState>
  dryRun: boolean
  host: NodeComponentProps["host"]
  logs: string[]
  progress: number
  result: CrashuData | null
  running: boolean
  sourcePaths: string[]
  status: CrashuStatusMeta
  targetNames: string[]
  onCopyLogs: () => void
  onCopyResults: () => void
  onExecute: (action: CrashuAction) => void
  onOpenConfigFile?: () => Promise<void> | void
  onPatch: (patch: Partial<CrashuCardState>) => void
  onPasteSources: () => void
  onReset: () => void
  onResetOverride: () => void
  onRestoreDefault: () => void
  onSaveDefault: () => void
}) {
  return props
}

function CollapsedView(props: ViewProps) {
  const Icon = NODE_ICON
  return (
    <div data-testid="crashu-collapsed-view" className="relative flex h-full min-h-0 items-center gap-2 overflow-hidden rounded-xl border bg-background/85 px-3 py-2 shadow-sm">
      <div className={cn("absolute inset-0 opacity-70 transition-opacity", props.status.tone === "running" && "animate-pulse bg-primary/10", props.status.tone === "error" && "bg-destructive/10", props.status.tone === "success" && "bg-primary/10")} />
      <div className={cn("relative grid size-8 shrink-0 place-items-center rounded-lg", props.status.iconClass)}>
        <Icon />
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="flex items-center gap-1 text-xs font-semibold leading-none">
          <span>Crashu</span>
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
    <div data-testid="crashu-compact-view" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-2 p-3 pb-2">
        <HeaderLine status={props.status} subtitle={props.data.progressText || summaryText(props)} />
        <div className="flex shrink-0 items-center gap-1">
          <AdvancedOptionsPopover data={props.data} disabled={props.running} onPatch={props.onPatch} />
          <PrimaryActionButton compact props={props} />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
        <SourcePathsInput compact disabled={props.running} pathCount={props.sourcePaths.length} value={props.data.sourcePathsText ?? ""} onChange={(sourcePathsText) => props.onPatch({ sourcePathsText })} onClear={() => props.onPatch({ sourcePathsText: "" })} onPaste={props.onPasteSources} />
        <TargetNamesInput compact disabled={props.running || Boolean(props.data.targetPath?.trim())} targetCount={props.targetNames.length} value={props.data.targetNamesText ?? ""} onChange={(targetNamesText) => props.onPatch({ targetNamesText })} />
        <PrimarySwitches compact data={props.data} disabled={props.running} onPatch={props.onPatch} />
        <ToolbarActions {...props} compact />
        {(props.status.tone === "running" || props.status.tone === "error") && (
          <StatusStrip compact progress={props.progress} status={props.status} text={props.data.progressText} />
        )}
        <div className="min-h-0 flex-1">
          <CrashuDisplayTabs compact logs={props.logs} result={props.result} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} />
        </div>
      </div>
    </div>
  )
}

function PortraitCompactView(props: ViewProps) {
  return (
    <div data-testid="crashu-portrait-view" className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="flex shrink-0 items-start justify-between gap-2">
        <HeaderLine status={props.status} subtitle={props.data.progressText || summaryText(props)} />
        <div className="flex shrink-0 items-center gap-1">
          <AdvancedOptionsPopover data={props.data} disabled={props.running} onPatch={props.onPatch} />
          <PrimaryActionButton compact props={props} />
        </div>
      </div>
      <div className="grid shrink-0 gap-2">
        <SourcePathsInput compact disabled={props.running} pathCount={props.sourcePaths.length} value={props.data.sourcePathsText ?? ""} onChange={(sourcePathsText) => props.onPatch({ sourcePathsText })} onClear={() => props.onPatch({ sourcePathsText: "" })} onPaste={props.onPasteSources} />
        <TargetNamesInput compact disabled={props.running || Boolean(props.data.targetPath?.trim())} targetCount={props.targetNames.length} value={props.data.targetNamesText ?? ""} onChange={(targetNamesText) => props.onPatch({ targetNamesText })} />
        <PrimarySwitches compact data={props.data} disabled={props.running} onPatch={props.onPatch} />
        <ToolbarActions {...props} compact />
      </div>
      <div className="min-h-0 flex-1">
        <CrashuDisplayTabs compact logs={props.logs} result={props.result} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} />
      </div>
    </div>
  )
}

function FullView(props: ViewProps) {
  return (
    <div data-testid="crashu-full-view" className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <div className="flex shrink-0 flex-col gap-3 @4xl/crashu:flex-row @4xl/crashu:items-center @4xl/crashu:justify-between">
        <div className="flex min-w-0 flex-col gap-2 @4xl/crashu:flex-row @4xl/crashu:items-center">
          <HeaderLine status={props.status} subtitle={props.data.progressText || `${props.sourcePaths.length} 源 / ${props.targetNames.length} 目标 / ${props.dryRun ? "预演" : "真实执行"}`} />
          <div data-testid="crashu-header-toolbar" className="flex min-w-0 flex-wrap items-center gap-2">
            <ToolbarActions {...props} />
          </div>
        </div>
        <StatsPanel progress={props.progress} result={props.result} />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 @5xl/crashu:grid-cols-[minmax(320px,380px)_minmax(0,1fr)]">
        <section className="flex min-h-0 flex-col gap-3 overflow-auto pr-1">
          <div className="grid gap-3 border-b pb-3">
            <div>
              <div className="text-sm font-semibold">输入</div>
              <div className="text-xs text-muted-foreground">源目录与目标名称用于相似度匹配；目标目录可自动读取子文件夹。</div>
            </div>
            <SourcePathsInput disabled={props.running} pathCount={props.sourcePaths.length} value={props.data.sourcePathsText ?? ""} onChange={(sourcePathsText) => props.onPatch({ sourcePathsText })} onClear={() => props.onPatch({ sourcePathsText: "" })} onPaste={props.onPasteSources} />
            <TargetNamesInput disabled={props.running || Boolean(props.data.targetPath?.trim())} targetCount={props.targetNames.length} value={props.data.targetNamesText ?? ""} onChange={(targetNamesText) => props.onPatch({ targetNamesText })} />
          </div>
          <div className="grid gap-3 border-b pb-3">
            <div className="text-sm font-semibold">关键开关</div>
            <PrimarySwitches data={props.data} disabled={props.running} onPatch={props.onPatch} />
          </div>
          <div className="grid gap-3 border-b pb-3">
            <div className="text-sm font-semibold">高级选项</div>
            <AdvancedOptionsFields data={props.data} disabled={props.running} onPatch={props.onPatch} />
          </div>
          <PrimaryActionButton props={props} />
          <StatusStrip progress={props.progress} status={props.status} text={props.data.progressText} />
        </section>

        <div className="h-[clamp(12rem,32vh,20rem)] min-h-0 overflow-hidden @5xl/crashu:h-full">
          <CrashuDisplayTabs logs={props.logs} result={props.result} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} />
        </div>
      </div>
    </div>
  )
}

function AdvancedOptionsFields(props: {
  data: CrashuCardState
  disabled?: boolean
  onPatch: (patch: Partial<CrashuCardState>) => void
}) {
  return (
    <div className="grid gap-3" data-testid="crashu-options-fields">
      <DirectionField disabled={props.disabled} value={props.data.moveDirection ?? "to_target"} onChange={(moveDirection) => props.onPatch({ moveDirection: moveDirection as CrashuMoveDirection })} />
      <ConflictField disabled={props.disabled} value={props.data.conflictPolicy ?? "skip"} onChange={(conflictPolicy) => props.onPatch({ conflictPolicy: conflictPolicy as CrashuConflictPolicy })} />
    </div>
  )
}

function DirectionField(props: {
  disabled?: boolean
  value: CrashuMoveDirection
  onChange: (value: CrashuMoveDirection) => void
}) {
  return (
    <div className="grid gap-1.5">
      <div className="text-xs font-medium text-muted-foreground">移动方向</div>
      <div className="grid grid-cols-2 gap-1">
        {MOVE_DIRECTION_OPTIONS.map((item) => (
          <Button
            key={item.value}
            aria-label={item.label}
            disabled={props.disabled}
            size="sm"
            variant={props.value === item.value ? "secondary" : "outline"}
            onClick={() => props.onChange(item.value)}
          >
            <span className="truncate">{item.label}</span>
          </Button>
        ))}
      </div>
    </div>
  )
}

function ConflictField(props: {
  disabled?: boolean
  value: CrashuConflictPolicy
  onChange: (value: CrashuConflictPolicy) => void
}) {
  return (
    <div className="grid gap-1.5">
      <div className="text-xs font-medium text-muted-foreground">冲突策略</div>
      <div className="grid grid-cols-3 gap-1">
        {CONFLICT_POLICY_OPTIONS.map((item) => (
          <Button
            key={item.value}
            aria-label={item.label}
            disabled={props.disabled}
            size="sm"
            variant={props.value === item.value ? "secondary" : "outline"}
            onClick={() => props.onChange(item.value)}
          >
            <span className="truncate">{item.label}</span>
          </Button>
        ))}
      </div>
    </div>
  )
}

const MOVE_DIRECTION_OPTIONS: Array<{ value: CrashuMoveDirection; label: string }> = [
  { value: "to_target", label: "源→目标" },
  { value: "to_source", label: "目标→源" },
]

const CONFLICT_POLICY_OPTIONS: Array<{ value: CrashuConflictPolicy; label: string }> = [
  { value: "skip", label: "跳过" },
  { value: "rename", label: "改名" },
  { value: "overwrite", label: "覆盖" },
]

function ToolbarActions(props: ViewProps & { compact?: boolean }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-1", props.compact && "justify-between")}>
      <ActionIconButton disabled={props.running || !props.sourcePaths.length} icon={Search} label="扫描匹配" onClick={() => props.onExecute("scan")} />
      <ActionIconButton disabled={props.running || !props.sourcePaths.length} icon={Search} label="生成计划" onClick={() => props.onExecute("plan")} />
      <ActionIconButton disabled={!props.result} icon={Copy} label="复制结果" onClick={props.onCopyResults} />
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
      <Button aria-label="crashu running" disabled size={compact ? "icon-sm" : "sm"} variant="secondary">
        <Square />
        {!compact && <span>运行中</span>}
      </Button>
    )
  }

  const disabled = !props.sourcePaths.length || !props.data.destinationPath
  const label = props.dryRun ? "预演移动" : "真实移动"
  const Icon = MoveRight
  if (!props.dryRun) {
    return (
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button aria-label={label} disabled={disabled} size={compact ? "icon-sm" : "sm"} variant="destructive">
            <Icon />
            {!compact && <span>{label}</span>}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认真实执行 Crashu？</AlertDialogTitle>
            <AlertDialogDescription>
              当前将真实移动匹配的文件夹到 {props.data.destinationPath || "未指定"}，共 {props.sourcePaths.length} 个源目录，相似度阈值 {(props.data.similarityThreshold ?? DEFAULT_THRESHOLD) * 100}%。移动后无法撤销，请确认目标和冲突策略。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => props.onExecute("move")}>确认执行</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
  }

  return (
    <Button aria-label={label} disabled={disabled} size={compact ? "icon-sm" : "sm"} onClick={() => props.onExecute("move")}>
      <Icon />
      {!compact && <span>{label}</span>}
    </Button>
  )
}

function HeaderLine({ status, subtitle }: {
  status: CrashuStatusMeta
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
            <h3 className="truncate text-sm font-semibold leading-none">Crashu</h3>
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
  result: CrashuData | null
}) {
  const stats = [
    ["源", props.result?.sourceCount ?? 0],
    ["目标", props.result?.targetCount ?? 0],
    ["匹配", props.result?.similarFound ?? 0],
    ["移动", props.result?.movedCount ?? 0],
    ["跳过", props.result?.skippedCount ?? 0],
    ["进度", `${props.progress}%`],
  ] as const

  return (
    <div className="grid shrink-0 grid-cols-3 gap-1 @3xl/crashu:grid-cols-6">
      {stats.map(([label, value]) => (
        <div key={label} className="min-w-0 rounded-md bg-muted/35 px-2 py-1.5 text-center">
          <div className="truncate text-[11px] text-muted-foreground">{label}</div>
          <div className={cn("text-sm font-semibold tabular-nums", label === "错误" && Number(value) > 0 && "text-destructive")}>{value}</div>
        </div>
      ))}
    </div>
  )
}

function CrashuDisplayTabs(props: {
  compact?: boolean
  logs: string[]
  result: CrashuData | null
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
        <MatchList compact={props.compact} result={props.result} />
      </TabsContent>
      <TabsContent value="logs" className="min-h-0 flex-1">
        <LogPanel compact={props.compact} logs={props.logs} onCopy={props.onCopyLogs} />
      </TabsContent>
    </Tabs>
  )
}

function statusFromState(data: CrashuCardState, running: boolean, result: CrashuData | null): CrashuStatusMeta {
  if (running || data.phase === "scanning" || data.phase === "planning" || data.phase === "moving") {
    return {
      label: "运行中",
      description: data.progressText || "Crashu 正在匹配或移动文件夹。",
      tone: "running",
      badgeVariant: "secondary",
      iconClass: "bg-primary text-primary-foreground",
    }
  }
  if (data.phase === "error" || result?.errors.length) {
    return {
      label: "失败",
      description: data.progressText || result?.errors[0] || "上次任务失败，请查看结果和日志。",
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
    description: "粘贴源目录和目标名称后开始匹配。",
    tone: "idle",
    badgeVariant: "outline",
    iconClass: "bg-secondary text-secondary-foreground",
  }
}

function phaseFromState(data: CrashuCardState, running: boolean): CrashuPhase {
  if (running) return data.phase ?? "scanning"
  return data.phase ?? "idle"
}

function phaseForAction(action: CrashuAction): CrashuPhase {
  if (action === "scan") return "scanning"
  if (action === "plan") return "planning"
  if (action === "move") return "moving"
  return "scanning"
}

function actionLabel(action: CrashuAction): string {
  if (action === "scan") return "扫描"
  if (action === "plan") return "计划"
  if (action === "move") return "移动"
  return action
}

function summaryText(props: ViewProps): string {
  if (props.data.progressText) return props.data.progressText
  if (props.result?.similarFound) return `匹配 ${props.result.similarFound} / 移动 ${props.result.movedCount}`
  if (props.sourcePaths.length) return `${props.sourcePaths.length} 源 / ${props.targetNames.length} 目标 / ${props.dryRun ? "预演" : "真实"}`
  return "粘贴源目录后开始匹配"
}

function splitLines(text?: string): string[] {
  return (text ?? "").split(/\r?\n|[;]/).map((item) => item.trim()).filter(Boolean)
}

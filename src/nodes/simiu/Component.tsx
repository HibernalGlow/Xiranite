import { useEffect, useMemo, useRef, useState } from "react"
import type { NodeComponentProps, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type { SimiuAction, SimiuData, SimiuInput } from "@xiranite/node-simiu/core"
import { Images, Play, RotateCcw, Square } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { RunningTint } from "@/nodes/shared/controls"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import { ACTIONS } from "./constants"
import {
  ActionIconButton,
  ActionPicker,
  ConfigDefaultsPopover,
  GroupFields,
  OptionsPopover,
  RootsInput,
  RuntimeOptions,
  StatusStrip,
} from "./controls"
import { SimiuResultTabs, SimiuStatsPanel } from "./results"
import type { SimiuCardState, SimiuStatusMeta } from "./types"
import { CONFIG_FIELDS } from "./types"

type SimiuProps = NodeComponentProps<SimiuCardState, Partial<SimiuCardState>>

export function Component({ compId, host }: SimiuProps) {
  const surface = useNodeSurface()
  const data = getHostData(host, compId)
  const dataRef = useRef<SimiuCardState>(data)
  dataRef.current = data

  const [running, setRunning] = useState(false)
  const [defaults, setDefaults] = useState<Partial<SimiuCardState> | undefined>(undefined)
  const [configFilePath, setConfigFilePath] = useState<string | undefined>(undefined)
  const [configDirty, setConfigDirty] = useState(false)

  const action = data.action ?? "plan"
  const actionMeta = ACTIONS.find((item) => item.value === action) ?? ACTIONS[1]!
  const result = data.result ?? null
  const logs = data.logs ?? []
  const progress = data.progress ?? 0
  const status = statusFromState(data, running)
  const compactSurface = surface.mode === "compact" || surface.mode === "portrait"
  const forceCollapsedSurface = compactSurface && surface.height > 0 && surface.height < 160
  const portraitCompact = surface.mode === "portrait" || (surface.mode === "compact" && surface.width < 560 && surface.height >= 300)
  const rootCount = useMemo(() => parseLines(data.rootsText).length, [data.rootsText])
  const canRun = !running

  useEffect(() => {
    const loadConfig = host.config?.get?.() ?? host.getNodeConfig?.<Partial<SimiuCardState>>()
    loadConfig
      ?.then((response) => {
        setDefaults(response.config)
        setConfigFilePath(response.path)
      })
      .catch(() => undefined)
  }, [host])

  useEffect(() => {
    if (!defaults) return
    setConfigDirty(CONFIG_FIELDS.some((field) => String(data[field] ?? "") !== String(defaults[field] ?? "")))
  }, [
    data.rootsText,
    data.configPath,
    data.databasePath,
    data.mode,
    data.scanOrder,
    data.namePrefix,
    data.minGroupSize,
    data.sizeToleranceBytes,
    data.dryRun,
    data.recordRun,
    defaults,
  ])

  function patch(patchData: Partial<SimiuCardState>) {
    dataRef.current = { ...dataRef.current, ...patchData }
    if (host.state?.patchData) host.state.patchData(patchData)
    else host.patchData(compId, patchData)
  }

  function pushLog(message: string) {
    const nextLogs = [...(dataRef.current.logs ?? []), message].slice(-120)
    patch({ logs: nextLogs })
  }

  async function pasteRoots() {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ rootsText: text.trim() })
  }

  async function copyLogs() {
    await host.clipboard?.writeText?.(logs.join("\n"))
  }

  async function copyResults() {
    const current = dataRef.current.result
    if (!current) return
    const groupLines = current.groups.map((group) => `GROUP\t${group.parentDir}\t${group.name}\t${group.files.length}`)
    const operationLines = current.operations.map((operation) => `${operation.status}\t${operation.mode}\t${operation.sourcePath}\t${operation.targetPath}`)
    await host.clipboard?.writeText?.([...groupLines, ...operationLines].join("\n"))
  }

  function reset() {
    patch({ logs: [], phase: "idle", progress: 0, progressText: "", result: null })
  }

  async function saveAsDefault() {
    const config: Partial<SimiuCardState> = {}
    for (const field of CONFIG_FIELDS) {
      const value = dataRef.current[field]
      if (value !== undefined) (config as Record<string, unknown>)[field] = value
    }
    if (host.config?.save) await host.config.save(config)
    else await host.saveNodeConfig?.(config)
    setDefaults(config)
    setConfigDirty(false)
  }

  function restoreDefault() {
    if (defaults) patch(defaults)
  }

  function resetOverride() {
    const empty: Partial<SimiuCardState> = {}
    for (const field of CONFIG_FIELDS) empty[field] = undefined
    patch(empty)
  }

  async function execute(nextAction: SimiuAction = action) {
    if (running) return
    const current = dataRef.current
    if (!parseLines(current.rootsText).length) {
      const message = "请先输入至少一个图片根目录。"
      patch({ phase: "error", progress: 0, progressText: message })
      pushLog(message)
      return
    }

    const run = host.runner?.run ?? host.actions?.run
    if (!run) {
      const message = "当前环境没有本地运行能力，请使用桌面模式或 CLI。"
      patch({ phase: "error", progress: 0, progressText: message })
      pushLog("Native action is unavailable in this host.")
      return
    }

    setRunning(true)
    patch({ action: nextAction, phase: "running", progress: 0, progressText: `${actionLabel(nextAction)}开始`, result: null })
    try {
      const response = await run<SimiuInput, SimiuData>("simiu", buildInput(nextAction, current), (event: NodeRunEvent) => {
        if (event.type === "progress") {
          patch({ progress: event.progress ?? 0, progressText: event.message })
          pushLog(`[${event.progress ?? 0}%] ${event.message}`)
          return
        }
        pushLog(event.message)
      }) as NodeRunResult<SimiuData>

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

  const commonProps = {
    action,
    actionMeta,
    canRun,
    configDirty,
    configFilePath,
    data,
    defaults,
    logs,
    progress,
    result,
    rootCount,
    running,
    status,
    onActionChange: (value: SimiuAction) => patch({ action: value }),
    onCopyLogs: copyLogs,
    onCopyResults: copyResults,
    onExecute: execute,
    onOpenConfigFile: host.config?.openFile ?? host.openConfigFile,
    onPasteRoots: pasteRoots,
    onPatch: patch,
    onReset: reset,
    onResetOverride: resetOverride,
    onRestoreDefault: restoreDefault,
    onSaveDefault: saveAsDefault,
  }

  return (
    <TooltipProvider>
      <div ref={surface.ref} className="@container/simiu relative flex h-full min-h-0 w-full overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(circle_at_16%_0%,color-mix(in_oklch,var(--primary)_14%,transparent),transparent_36%),radial-gradient(circle_at_86%_8%,color-mix(in_oklch,var(--chart-3)_14%,transparent),transparent_34%)]" />
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
  action: SimiuAction
  actionMeta: typeof ACTIONS[number]
  canRun: boolean
  configDirty: boolean
  configFilePath?: string
  data: SimiuCardState
  defaults?: Partial<SimiuCardState>
  logs: string[]
  progress: number
  result: SimiuData | null
  rootCount: number
  running: boolean
  status: SimiuStatusMeta
  onActionChange: (value: SimiuAction) => void
  onCopyLogs: () => void
  onCopyResults: () => void
  onExecute: (action?: SimiuAction) => void
  onOpenConfigFile?: () => Promise<void> | void
  onPasteRoots: () => void
  onPatch: (patch: Partial<SimiuCardState>) => void
  onReset: () => void
  onResetOverride: () => void
  onRestoreDefault: () => void
  onSaveDefault: () => void
}) {
  return props
}

function CollapsedView(props: ViewProps) {
  const Icon = props.actionMeta.icon
  return (
    <div data-testid="simiu-collapsed-view" className="relative flex h-full min-h-0 items-center gap-2 overflow-hidden rounded-xl border bg-background/85 px-3 py-2 shadow-sm">
      <RunningTint tone={props.status.tone} />
      <div className={cn("relative grid size-8 shrink-0 place-items-center rounded-lg", props.status.iconClass)}>
        <Images />
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="flex items-center gap-1 text-xs font-semibold leading-none">
          <span>Simiu</span>
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
    <div data-testid="simiu-compact-view" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-2 p-3 pb-2">
        <HeaderLine actionMeta={props.actionMeta} status={props.status} subtitle={props.data.progressText || summaryText(props)} />
        <div className="flex shrink-0 items-center gap-1">
          <OptionsPopover data={props.data} disabled={props.running} onPatch={props.onPatch} />
          <RunActionButton compact props={props} />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
        <ActionPicker action={props.action} disabled={props.running} onActionChange={props.onActionChange} />
        <RootsInput compact data={props.data} disabled={props.running} onPaste={props.onPasteRoots} onPatch={props.onPatch} />
        {(props.status.tone === "running" || props.status.tone === "error") && (
          <StatusStrip compact progress={props.progress} status={props.status} text={props.data.progressText} />
        )}
        <div className="min-h-0 flex-1">
          <SimiuResultTabs compact logs={props.logs} result={props.result} running={props.running} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} />
        </div>
      </div>
    </div>
  )
}

function PortraitCompactView(props: ViewProps) {
  return (
    <div data-testid="simiu-portrait-view" className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="flex shrink-0 items-start justify-between gap-2">
        <HeaderLine actionMeta={props.actionMeta} status={props.status} subtitle={props.data.progressText || summaryText(props)} />
        <div className="flex shrink-0 items-center gap-1">
          <OptionsPopover data={props.data} disabled={props.running} onPatch={props.onPatch} />
          <RunActionButton compact props={props} />
        </div>
      </div>
      <div className="grid shrink-0 gap-2">
        <ActionPicker action={props.action} disabled={props.running} onActionChange={props.onActionChange} />
        <RootsInput compact data={props.data} disabled={props.running} onPaste={props.onPasteRoots} onPatch={props.onPatch} />
      </div>
      <div className="min-h-0 flex-1">
        <SimiuResultTabs compact logs={props.logs} result={props.result} running={props.running} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} />
      </div>
    </div>
  )
}

function FullView(props: ViewProps) {
  return (
    <div data-testid="simiu-full-view" className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <div className="flex shrink-0 flex-col gap-3 @4xl/simiu:flex-row @4xl/simiu:items-center @4xl/simiu:justify-between">
        <div className="flex min-w-0 flex-col gap-2 @4xl/simiu:flex-row @4xl/simiu:items-center">
          <HeaderLine actionMeta={props.actionMeta} status={props.status} subtitle={props.data.progressText || summaryText(props)} />
          <div data-testid="simiu-header-toolbar" className="flex min-w-0 flex-wrap items-center gap-2">
            <ActionPicker action={props.action} disabled={props.running} triggerClassName="@4xl/simiu:w-80" onActionChange={props.onActionChange} />
            <RunActionButton props={props} />
            <ActionIconButton disabled={props.running} icon={RotateCcw} label="清空状态" onClick={props.onReset} />
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
          </div>
        </div>
        <SimiuStatsPanel result={props.result} />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 @5xl/simiu:grid-cols-[minmax(320px,380px)_minmax(0,1fr)]">
        <section className="flex min-h-0 flex-col gap-3 overflow-auto pr-1">
          <div className="grid gap-3 border-b pb-3">
            <div>
              <div className="text-sm font-semibold">输入</div>
              <div className="text-xs text-muted-foreground">图片根目录固定在左侧，扫描、计划和应用共用同一批输入。</div>
            </div>
            <RootsInput data={props.data} disabled={props.running} onPaste={props.onPasteRoots} onPatch={props.onPatch} />
          </div>
          <div className="grid gap-3 border-b pb-3">
            <div className="text-sm font-semibold">分组</div>
            <GroupFields data={props.data} disabled={props.running} onPatch={props.onPatch} />
          </div>
          <div className="grid gap-3 border-b pb-3">
            <div className="text-sm font-semibold">运行</div>
            <RuntimeOptions data={props.data} disabled={props.running} onPatch={props.onPatch} />
          </div>
          <StatusStrip progress={props.progress} status={props.status} text={props.data.progressText} />
        </section>
        <div className="min-h-0">
          <SimiuResultTabs logs={props.logs} result={props.result} running={props.running} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} />
        </div>
      </div>
    </div>
  )
}

function RunActionButton({ compact, props }: { compact?: boolean; props: ViewProps }) {
  if (props.running) {
    return (
      <Button aria-label="simiu running" disabled size={compact ? "icon-sm" : "sm"} variant="secondary">
        <Square />
        {!compact && <span>运行中</span>}
      </Button>
    )
  }

  const label = props.action === "apply" ? "运行应用" : props.action === "scan" ? "运行扫描" : "运行计划"
  const destructive = props.action === "apply" && !(props.data.dryRun ?? true)
  if (destructive) {
    return (
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button aria-label={label} disabled={!props.canRun} size={compact ? "icon-sm" : "sm"} variant="destructive">
            <Play />
            {!compact && <span>{label}</span>}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认真实应用分组？</AlertDialogTitle>
            <AlertDialogDescription>
              当前已关闭预演，会按选择的应用方式移动、复制或链接图片文件。请确认根目录和分组规则无误。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => props.onExecute(props.action)}>确认应用</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
  }

  return (
    <Button aria-label={label} disabled={!props.canRun} size={compact ? "icon-sm" : "sm"} onClick={() => props.onExecute(props.action)}>
      <Play />
      {!compact && <span>{label}</span>}
    </Button>
  )
}

function HeaderLine({ actionMeta, status, subtitle }: {
  actionMeta: typeof ACTIONS[number]
  status: SimiuStatusMeta
  subtitle: string
}) {
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-2">
        <div className={cn("grid size-8 shrink-0 place-items-center rounded-lg", status.iconClass)}>
          <actionMeta.icon />
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-sm font-semibold leading-none">Simiu</h3>
            <Badge variant={status.badgeVariant}>{status.label}</Badge>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>
    </div>
  )
}

function buildInput(action: SimiuAction, data: SimiuCardState): SimiuInput {
  const roots = parseLines(data.rootsText)
  return {
    action,
    root: roots[0],
    roots,
    configPath: clean(data.configPath),
    databasePath: clean(data.databasePath),
    mode: data.mode ?? "move",
    scanOrder: data.scanOrder ?? "path",
    namePrefix: clean(data.namePrefix),
    minGroupSize: numberValue(data.minGroupSize),
    sizeToleranceBytes: numberValue(data.sizeToleranceBytes),
    dryRun: data.dryRun ?? true,
    recordRun: data.recordRun ?? false,
    recursive: true,
  }
}

function statusFromState(data: SimiuCardState, running: boolean): SimiuStatusMeta {
  if (running || data.phase === "running") {
    return {
      label: "运行中",
      description: data.progressText || "Simiu 正在扫描或规划相似图片分组。",
      tone: "running",
      badgeVariant: "secondary",
      iconClass: "bg-primary text-primary-foreground",
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
  if (data.phase === "error") {
    return {
      label: "失败",
      description: data.progressText || "上次任务失败，请查看日志。",
      tone: "error",
      badgeVariant: "destructive",
      iconClass: "bg-destructive text-destructive-foreground",
    }
  }
  return {
    label: "就绪",
    description: "输入图片根目录后即可扫描或生成计划。",
    tone: "idle",
    badgeVariant: "outline",
    iconClass: "bg-secondary text-secondary-foreground",
  }
}

function summaryText(props: ViewProps): string {
  if (props.data.progressText) return props.data.progressText
  if (props.result?.groupCount) return `${props.result.imageCount} 图片 / ${props.result.groupCount} 分组 / ${props.result.operations.length} 操作`
  if (props.rootCount) return `${props.rootCount} 个根目录等待${props.actionMeta.shortLabel}`
  return props.actionMeta.description
}

function actionLabel(action: SimiuAction): string {
  return ACTIONS.find((item) => item.value === action)?.label ?? action
}

function parseLines(value: unknown): string[] {
  return String(value ?? "")
    .split(/\r?\n|;/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function numberValue(value: unknown): number | undefined {
  const raw = String(value ?? "").trim()
  if (!raw) return undefined
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : undefined
}

function clean(value: unknown): string | undefined {
  const text = String(value ?? "").trim()
  return text || undefined
}

function getHostData(host: SimiuProps["host"], compId: string): SimiuCardState {
  return host.state?.getData?.() ?? host.getData<SimiuCardState>(compId) ?? {}
}

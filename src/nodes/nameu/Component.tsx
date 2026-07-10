import { useEffect, useMemo, useRef, useState } from "react"
import type { NodeComponentProps, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type { NameuAction, NameuData, NameuInput } from "@xiranite/node-nameu/core"
import type { LucideIcon } from "lucide-react"
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  DatabaseZap,
  FilePenLine,
  FolderInput,
  GitCompare,
  HardDrive,
  RotateCcw,
  ScanLine,
  Settings2,
  ShieldAlert,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { RunningTint } from "@/nodes/shared/controls"
import { useNodeI18n } from "@/nodes/shared/useNodeI18n"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import { ACTIONS, NODE_ICON } from "./constants"
import {
  ActionMode,
  actionLabel,
  ModeToggle,
  PathField,
  PlanTable,
  ResultTabs,
  RunButton,
  SettingsPopover,
  StatusStrip,
  SwitchPanel,
  TechLatch,
  Metric,
} from "./controls"
import type { NameuCardState, NameuStatusMeta } from "./types"
import { CONFIG_FIELDS } from "./types"

export function Component({ compId, host }: NodeComponentProps<NameuCardState>) {
  const surface = useNodeSurface()
  const { t } = useNodeI18n("nameu")
  const data = getHostData(host, compId)
  const dataRef = useRef<NameuCardState>(data)
  dataRef.current = data

  const [running, setRunning] = useState(false)
  const [defaults, setDefaults] = useState<Partial<NameuCardState> | undefined>()
  const [configDirty, setConfigDirty] = useState(false)

  const action = data.action ?? "plan"
  const actionMeta = ACTIONS.find((item) => item.value === action) ?? ACTIONS[1]!
  const paths = useMemo(() => splitLines(data.pathsText), [data.pathsText])
  const result = data.result ?? null
  const logs = data.logs ?? []
  const progress = data.progress ?? 0
  const status = statusFromState(data, running, result, t)
  const compactSurface = surface.mode === "compact" || surface.mode === "portrait"
  const forceCollapsedSurface = compactSurface && surface.height > 0 && surface.height < 160
  const portraitCompact = surface.mode === "portrait" || (surface.mode === "compact" && surface.width < 560 && surface.height >= 300)

  useEffect(() => {
    const loadConfig = host.config?.get?.<Partial<NameuCardState>>() ?? host.getNodeConfig?.<Partial<NameuCardState>>()
    loadConfig?.then((response) => setDefaults(response.config)).catch(() => undefined)
  }, [host])

  useEffect(() => {
    if (!defaults) return
    setConfigDirty(CONFIG_FIELDS.some((field) => String(data[field] ?? "") !== String(defaults[field] ?? "")))
  }, [data.pathsText, data.mode, data.recursive, data.addArtistName, data.normalizeFolders, data.keepTimestamp, data.dryRun, defaults])

  function patch(patchData: Partial<NameuCardState>) {
    dataRef.current = { ...dataRef.current, ...patchData }
    if (host.state?.patchData) host.state.patchData(patchData)
    else host.patchData(compId, patchData)
  }

  function pushLog(message: string) {
    patch({ logs: [...(dataRef.current.logs ?? []), message].slice(-120) })
  }

  async function pastePaths() {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ pathsText: text.trim() })
  }

  async function copyResults() {
    const lines = (dataRef.current.result?.items ?? []).map((item) => `${item.status}\t${item.sourcePath}\t${item.targetName}\t${item.reason ?? ""}`)
    await host.clipboard?.writeText?.(lines.join("\n"))
  }

  async function copyLogs() {
    await host.clipboard?.writeText?.(logs.join("\n"))
  }

  function reset() {
    patch({ logs: [], phase: "idle", progress: 0, progressText: "", result: null })
  }

  async function saveAsDefault() {
    const config: Partial<NameuCardState> = {}
    for (const field of CONFIG_FIELDS) {
      const value = dataRef.current[field]
      if (value !== undefined) (config as Record<string, unknown>)[field] = value
    }
    if (host.config?.save) await host.config.save(config)
    else await host.saveNodeConfig?.(config)
    setDefaults(config)
    setConfigDirty(false)
  }

  async function execute(nextAction: NameuAction = action) {
    if (running) return
    if (!splitLines(dataRef.current.pathsText).length) {
      const message = t("errors.noPaths", "请先输入至少一个库目录或艺术家目录。")
      patch({ phase: "error", progress: 0, progressText: message })
      pushLog(message)
      return
    }
    const run = host.runner?.run ?? host.actions?.run
    if (!run) {
      const message = t("errors.backendUnavailable", "当前环境没有本地运行能力，请使用桌面模式或 CLI。")
      patch({ phase: "error", progress: 0, progressText: message })
      pushLog("Native action is unavailable in this host.")
      return
    }

    setRunning(true)
    patch({ action: nextAction, phase: "running", progress: 0, progressText: t("status.starting", "{{action}}开始", { action: actionLabel(nextAction) }), result: null })
    try {
      const response = await run<NameuInput, NameuData>("nameu", buildInput(nextAction, dataRef.current), (event: NodeRunEvent) => {
        if (event.type === "progress") {
          patch({ progress: event.progress ?? 0, progressText: event.message })
          pushLog(`[${event.progress ?? 0}%] ${event.message}`)
        } else {
          pushLog(event.message)
        }
      }) as NodeRunResult<NameuData>
      patch({ phase: response.success ? "completed" : "error", progress: response.success ? 100 : 0, progressText: response.message, result: response.data ?? null })
      pushLog(response.message)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      patch({ phase: "error", progress: 0, progressText: message })
      pushLog(message)
    } finally {
      setRunning(false)
    }
  }

  const props: ViewProps = {
    action,
    actionMeta,
    configDirty,
    data,
    defaults,
    logs,
    paths,
    progress,
    result,
    running,
    status,
    t,
    onActionChange: (value) => patch({ action: value }),
    onCopyLogs: copyLogs,
    onCopyResults: copyResults,
    onExecute: execute,
    onPastePaths: pastePaths,
    onPatch: patch,
    onReset: reset,
    onRestoreDefault: () => defaults && patch(defaults),
    onSaveDefault: saveAsDefault,
  }

  return (
    <TooltipProvider>
      <div ref={surface.ref} className="@container/nameu flex h-full min-h-0 w-full overflow-hidden">
        {surface.mode === "collapsed" || forceCollapsedSurface ? (
          <CollapsedView {...props} />
        ) : compactSurface ? (
          portraitCompact ? <PortraitView {...props} /> : <CompactView {...props} />
        ) : (
          <FullView {...props} wide={surface.width >= 860} />
        )}
      </div>
    </TooltipProvider>
  )
}

interface ViewProps {
  action: NameuAction
  actionMeta: (typeof ACTIONS)[number]
  configDirty: boolean
  data: NameuCardState
  defaults?: Partial<NameuCardState>
  logs: string[]
  paths: string[]
  progress: number
  result: NameuData | null
  running: boolean
  status: NameuStatusMeta
  t: ReturnType<typeof useNodeI18n>["t"]
  onActionChange: (value: NameuAction) => void
  onCopyLogs: () => void
  onCopyResults: () => void
  onExecute: (action?: NameuAction) => void
  onPastePaths: () => void
  onPatch: (patch: Partial<NameuCardState>) => void
  onReset: () => void
  onRestoreDefault: () => void
  onSaveDefault: () => void
}

function CollapsedView(props: ViewProps) {
  const Icon = NODE_ICON
  return (
    <div
      data-testid="nameu-collapsed-view"
      className="relative flex h-full min-h-0 w-full items-center gap-2 overflow-hidden rounded-xl border border-border/60 bg-background/85 px-3 py-2 shadow-sm backdrop-blur-sm"
    >
      <RunningTint tone={props.status.tone} />
      <div className={cn("relative grid size-8 shrink-0 place-items-center rounded-lg", props.status.iconClass)}>
        <Icon />
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="flex items-center gap-1 text-xs font-semibold leading-none">
          <span>NameU</span>
          <Badge variant={props.status.badgeVariant}>{props.status.label}</Badge>
        </div>
        <div className="mt-1 truncate text-xs text-muted-foreground">{summaryText(props)}</div>
      </div>
      <div className="relative flex shrink-0 items-center gap-1">
        <SettingsPopover
          t={props.t}
          data={props.data}
          disabled={props.running}
          action={props.action}
          onActionChange={props.onActionChange}
          onPatch={props.onPatch}
          onPaste={props.onPastePaths}
        />
        <RunButton t={props.t} compact running={props.running} action={props.action} dryRun={props.data.dryRun ?? true} onExecute={props.onExecute} />
      </div>
    </div>
  )
}

function CompactView(props: ViewProps) {
  return (
    <div data-testid="nameu-compact-view" className="flex min-h-0 flex-1 flex-col gap-2 p-2">
      <div className="flex shrink-0 items-start justify-between gap-2">
        <HeaderLine t={props.t} status={props.status} subtitle={props.data.progressText || summaryText(props)} />
        <div className="flex shrink-0 items-center gap-1">
          <ActionTools {...props} compact />
          <RunButton t={props.t} compact running={props.running} action={props.action} dryRun={props.data.dryRun ?? true} onExecute={props.onExecute} />
        </div>
      </div>
      <ActionMode t={props.t} value={props.action} disabled={props.running} onChange={props.onActionChange} />
      <ModeToggle t={props.t} value={props.data.mode ?? "multi"} disabled={props.running} onChange={(mode) => props.onPatch({ mode })} />
      <PathField t={props.t} compact data={props.data} disabled={props.running} onPaste={props.onPastePaths} onPatch={props.onPatch} />
      <SwitchPanel t={props.t} compact data={props.data} disabled={props.running} onPatch={props.onPatch} />
      <div className="min-h-0 flex-1">
        <ResultTabs t={props.t} compact logs={props.logs} result={props.result} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} />
      </div>
    </div>
  )
}

function PortraitView(props: ViewProps) {
  return (
    <div data-testid="nameu-portrait-view" className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="flex shrink-0 items-start justify-between gap-2">
        <HeaderLine t={props.t} status={props.status} subtitle={props.data.progressText || summaryText(props)} />
        <RunButton t={props.t} compact running={props.running} action={props.action} dryRun={props.data.dryRun ?? true} onExecute={props.onExecute} />
      </div>
      <ActionMode t={props.t} value={props.action} disabled={props.running} onChange={props.onActionChange} />
      <ModeToggle t={props.t} value={props.data.mode ?? "multi"} disabled={props.running} onChange={(mode) => props.onPatch({ mode })} />
      <PathField t={props.t} compact data={props.data} disabled={props.running} onPaste={props.onPastePaths} onPatch={props.onPatch} />
      <SwitchPanel t={props.t} compact data={props.data} disabled={props.running} onPatch={props.onPatch} />
      <div className="min-h-0 flex-1">
        <ResultTabs t={props.t} compact logs={props.logs} result={props.result} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} />
      </div>
    </div>
  )
}

function FullView(props: ViewProps & { wide: boolean }) {
  return (
    <div data-testid="nameu-full-view" className="flex min-h-0 flex-1 flex-col gap-2 p-3">
      <div className="flex shrink-0 flex-col gap-2 @3xl/nameu:flex-row @3xl/nameu:items-center @3xl/nameu:justify-between">
        <div className="flex min-w-0 flex-col gap-2 @3xl/nameu:flex-row @3xl/nameu:items-center">
          <HeaderLine t={props.t} status={props.status} subtitle={props.data.progressText || summaryText(props)} />
          <div data-testid="nameu-header-toolbar" className="flex min-w-0 flex-wrap items-center gap-1">
            <ActionTools {...props} />
          </div>
        </div>
        <StatsPanel t={props.t} paths={props.paths} progress={props.progress} result={props.result} />
      </div>
      {(props.status.tone === "running" || props.status.tone === "error") && (
        <StatusStrip t={props.t} progress={props.progress} status={props.status} text={props.data.progressText} />
      )}
      {props.wide ? <FullViewWide {...props} /> : <FullViewRegular {...props} />}
    </div>
  )
}

function FullViewRegular(props: ViewProps) {
  return (
    <div className="grid min-h-0 flex-1 gap-2 @2xl/nameu:grid-cols-[minmax(250px,330px)_minmax(0,1fr)] @4xl/nameu:grid-cols-[minmax(250px,330px)_minmax(0,1fr)_minmax(260px,330px)]">
      <ConfigCard {...props} />
      <ReviewCard {...props} />
      <div className="grid min-h-0 gap-2 grid-rows-[auto_minmax(0,1fr)] @2xl/nameu:col-span-2 @4xl/nameu:col-span-1">
        <OperationsCard {...props} />
        <ResultTabs logs={props.logs} result={props.result} t={props.t} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} />
      </div>
    </div>
  )
}

function FullViewWide(props: ViewProps) {
  return (
    <div className="flex min-h-0 flex-1">
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 overflow-hidden rounded-xl border border-border/60 bg-background/35 backdrop-blur-sm">
        <ResizablePanel defaultSize={27} minSize={22}>
          <div className="h-full min-h-0 p-2">
            <ConfigCard {...props} />
          </div>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={43} minSize={30}>
          <div className="h-full min-h-0 p-2">
            <ReviewCard {...props} />
          </div>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={30} minSize={24}>
          <div className="flex h-full min-h-0 flex-col gap-2 p-2">
            <OperationsCard {...props} />
            <div className="min-h-0 flex-1">
              <ResultTabs logs={props.logs} result={props.result} t={props.t} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} />
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}

function ConfigCard(props: ViewProps) {
  const queueCount = props.result?.items.length ?? props.paths.length
  return (
    <Card className="relative flex h-full min-h-0 flex-col gap-0 border-border/60 bg-card/40 py-0 shadow-sm backdrop-blur-sm" data-testid="nameu-config-panel">
      <TechLatch label={props.t("latch.config", "CFG_R")} />
      <CardHeader className="border-b border-border/60 px-3 py-3 !pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Settings2 className="size-4" />
          {props.t("cards.rules", "规则矩阵")}
        </CardTitle>
        <CardDescription className="text-xs">
          {props.t("cards.rulesDescription", "配置路径、模式和改名规则。")}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-3">
        <PathField t={props.t} data={props.data} disabled={props.running} onPaste={props.onPastePaths} onPatch={props.onPatch} />
        <ModeToggle t={props.t} value={props.data.mode ?? "multi"} disabled={props.running} onChange={(mode) => props.onPatch({ mode })} />
        <SwitchPanel t={props.t} data={props.data} disabled={props.running} onPatch={props.onPatch} />
      </CardContent>
      <div className="flex shrink-0 items-center justify-between border-t border-border/60 bg-muted/20 px-3 py-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {props.t("labels.queue", "Queue")}
        </span>
        <Badge variant="outline" className="font-mono text-xs">
          {queueCount} items
        </Badge>
      </div>
    </Card>
  )
}

function ReviewCard(props: ViewProps) {
  const readyCount = props.result?.readyCount ?? 0
  const conflictCount = props.result?.conflictCount ?? 0
  const flagCount = (props.result?.items ?? []).filter((i) => i.status === "error" || i.status === "skipped").length
  const hasItems = (props.result?.items.length ?? 0) > 0
  return (
    <Card className="relative flex h-full min-h-0 flex-col gap-0 border-border/60 bg-card/40 py-0 shadow-sm backdrop-blur-sm" data-testid="nameu-review-panel">
      <TechLatch label={props.t("latch.review", "DIFF_VIEW")} />
      <CardHeader className="border-b border-border/60 px-3 py-3 !pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-sm">
              <GitCompare className="size-4" />
              {props.t("cards.review", "审查台")}
            </CardTitle>
            <CardDescription className="text-xs">
              {props.t("cards.reviewDescription", "源名称 → 目标投影，差异高亮显示。")}
            </CardDescription>
          </div>
          <CardAction>
            <Badge variant="outline" className="font-mono text-xs">
              {props.result?.items.length ?? props.paths.length}
            </Badge>
          </CardAction>
        </div>
      </CardHeader>
      {hasItems && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border/60 bg-muted/20 px-3 py-2">
          <Badge variant="secondary" className="gap-1 text-xs">
            <CheckCircle2 className="size-3" />
            {readyCount} Auto-Match
          </Badge>
          {(conflictCount > 0 || flagCount > 0) && (
            <Badge variant="destructive" className="gap-1 text-xs">
              <AlertTriangle className="size-3" />
              {conflictCount + flagCount} Flag
            </Badge>
          )}
        </div>
      )}
      <CardContent className="min-h-0 flex-1 p-0">
        <PlanTable t={props.t} items={props.result?.items ?? []} paths={props.paths} />
      </CardContent>
    </Card>
  )
}

function OperationsCard(props: ViewProps) {
  const live = props.action === "rename" && !(props.data.dryRun ?? true)
  const dryRunPassed = (props.data.dryRun ?? true) || props.action !== "rename"
  const estTime = (props.result?.items.length ?? 0) > 0 ? (props.result!.items.length * 0.008 + 0.2).toFixed(1) : "0.0"
  return (
    <Card
      className={cn("relative shrink-0 gap-0 border-border/60 bg-card/40 py-0 shadow-sm backdrop-blur-sm", live && "border-destructive/50")}
      data-testid="nameu-operations-panel"
    >
      <TechLatch label={props.t("latch.exec", "EXEC")} />
      <CardHeader className="border-b border-border/60 px-3 py-3 !pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-sm">
              {live ? <AlertTriangle className="size-4 text-destructive" /> : <ShieldAlert className="size-4" />}
              {props.t("cards.operations", "操作台")}
            </CardTitle>
          </div>
          <CardAction>
            <Badge variant={live ? "destructive" : "outline"} className="text-xs">
              {props.data.dryRun ?? true ? props.t("badge.preview", "预览") : props.t("badge.live", "写入")}
            </Badge>
          </CardAction>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 p-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1 rounded-md border border-border/60 bg-background/50 p-2">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {props.t("labels.dryRunStatus", "Dry Run Status")}
            </span>
            <Badge variant={dryRunPassed ? "default" : "destructive"} className="w-fit gap-1 text-xs">
              {dryRunPassed ? <CheckCircle2 className="size-3" /> : <AlertTriangle className="size-3" />}
              {dryRunPassed ? "PASSED" : "ACTIVE"}
            </Badge>
          </div>
          <div className="flex flex-col gap-1 rounded-md border border-border/60 bg-background/50 p-2">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {props.t("labels.estTime", "Est. Time")}
            </span>
            <span className="flex items-center gap-1 text-xs font-medium tabular-nums">
              <Clock className="size-3 text-muted-foreground" />
              ~{estTime}s
            </span>
          </div>
        </div>
        <ActionMode t={props.t} value={props.action} disabled={props.running} onChange={props.onActionChange} />
        <div className="flex flex-col gap-2">
          <RunButton t={props.t} running={props.running} action={props.action} dryRun={props.data.dryRun ?? true} onExecute={props.onExecute} />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="flex-1 gap-1 text-xs"
              disabled={props.running}
              onClick={props.onReset}
            >
              <RotateCcw className="size-3.5" />
              {props.t("actions.rollback", "Rollback Last")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1 gap-1 text-xs"
              disabled={!props.result}
              onClick={props.onCopyResults}
            >
              <Copy className="size-3.5" />
              {props.t("actions.copy", "复制结果")}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function ActionTools(props: ViewProps & { compact?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <IconButton disabled={props.running} active={props.configDirty} icon={DatabaseZap} label={props.t("actions.saveDefault", "保存默认")} onClick={props.onSaveDefault} />
      <IconButton disabled={props.running || !props.defaults} icon={Settings2} label={props.t("actions.restoreDefault", "恢复默认")} onClick={props.onRestoreDefault} />
      <IconButton icon={RotateCcw} label={props.t("actions.reset", "清空状态")} onClick={props.onReset} />
    </div>
  )
}

function HeaderLine(props: { t: ReturnType<typeof useNodeI18n>["t"]; status: NameuStatusMeta; subtitle: string }) {
  const Icon = NODE_ICON
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-2">
        <div className={cn("grid size-8 shrink-0 place-items-center rounded-lg", props.status.iconClass)}>
          <Icon />
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-sm font-semibold leading-none">NameU</h3>
            <Badge variant={props.status.badgeVariant}>{props.status.label}</Badge>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">{props.subtitle}</p>
        </div>
      </div>
    </div>
  )
}

function StatsPanel(props: {
  t: ReturnType<typeof useNodeI18n>["t"]
  paths: string[]
  progress: number
  result: NameuData | null
}) {
  const { t } = props
  const stats: Array<{ icon: LucideIcon; label: string; value: string | number; suffix?: string }> = [
    { icon: FolderInput, label: t("metrics.paths", "路径"), value: props.paths.length },
    { icon: ScanLine, label: t("metrics.scanned", "扫描"), value: props.result?.scannedCount ?? 0 },
    { icon: GitCompare, label: t("metrics.ready", "待改"), value: props.result?.readyCount ?? 0 },
    { icon: FilePenLine, label: t("metrics.renamed", "已改"), value: props.result?.renamedCount ?? 0 },
    { icon: AlertTriangle, label: t("metrics.conflict", "冲突"), value: props.result?.conflictCount ?? 0 },
    { icon: HardDrive, label: t("metrics.progress", "进度"), value: props.progress, suffix: "%" },
  ]
  return (
    <div className="grid shrink-0 grid-cols-2 gap-1.5 @3xl/nameu:grid-cols-3 @4xl/nameu:grid-cols-6">
      {stats.map((item) => (
        <Metric key={item.label} icon={item.icon} label={item.label} value={item.value} suffix={item.suffix} />
      ))}
    </div>
  )
}

function IconButton(props: { active?: boolean; disabled?: boolean; icon: LucideIcon; label: string; onClick: () => void }) {
  const Icon = props.icon
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button aria-label={props.label} disabled={props.disabled} size="icon-sm" variant={props.active ? "secondary" : "outline"} onClick={props.onClick}>
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{props.label}</TooltipContent>
    </Tooltip>
  )
}

function statusFromState(data: NameuCardState, running: boolean, result: NameuData | null, t: ReturnType<typeof useNodeI18n>["t"]): NameuStatusMeta {
  if (running || data.phase === "running") {
    return {
      label: t("status.running", "运行中"),
      description: data.progressText || t("status.runningDescription", "NameU 正在扫描或改名。"),
      tone: "running",
      badgeVariant: "secondary",
      iconClass: "bg-primary text-primary-foreground",
    }
  }
  if (data.phase === "error" || result?.errorCount) {
    return {
      label: t("status.error", "失败"),
      description: data.progressText || result?.errors[0] || t("status.errorDescription", "上次任务失败，请查看问题列表。"),
      tone: "error",
      badgeVariant: "destructive",
      iconClass: "bg-destructive text-destructive-foreground",
    }
  }
  if (data.phase === "completed") {
    return {
      label: t("status.completed", "完成"),
      description: data.progressText || t("status.completedDescription", "上次 NameU 任务已完成。"),
      tone: "success",
      badgeVariant: "default",
      iconClass: "bg-primary text-primary-foreground",
    }
  }
  return {
    label: t("status.idle", "就绪"),
    description: t("status.idleDescription", "输入目录后预览改名计划。"),
    tone: "idle",
    badgeVariant: "outline",
    iconClass: "bg-secondary text-secondary-foreground",
  }
}

function summaryText(props: ViewProps): string {
  const { t } = props
  if (props.data.progressText) return props.data.progressText
  if (props.result) {
    return t("summary.result", "{{count}} 项 / 待改 {{ready}} / 冲突 {{conflict}}", {
      count: props.result.items.length,
      ready: props.result.readyCount,
      conflict: props.result.conflictCount,
    })
  }
  if (props.paths.length) {
    return t("summary.paths", "{{count}} 条路径 / {{action}}", { count: props.paths.length, action: props.actionMeta.shortLabel })
  }
  return props.actionMeta.description
}

function buildInput(action: NameuAction, data: NameuCardState): NameuInput {
  return {
    action,
    paths: splitLines(data.pathsText),
    mode: data.mode ?? "multi",
    recursive: data.recursive ?? true,
    addArtistName: data.addArtistName ?? true,
    normalizeFolders: data.normalizeFolders ?? true,
    keepTimestamp: data.keepTimestamp ?? true,
    dryRun: data.dryRun ?? true,
  }
}

function splitLines(value: unknown): string[] {
  return String(value ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

function getHostData(host: NodeComponentProps<NameuCardState>["host"], compId: string): NameuCardState {
  return host.state?.getData?.() ?? host.getData<NameuCardState>(compId) ?? {}
}

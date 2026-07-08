import { useEffect, useMemo, useRef, useState } from "react"
import type { NodeComponentProps, NodeRunResult } from "@xiranite/contract"
import type { RawfilterAction, RawfilterData, RawfilterInput } from "@xiranite/node-rawfilter/core"
import { Copy, FileSearch, Layers, ListChecks, Play, RotateCcw, Square } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import { RunningTint } from "@/nodes/shared/controls"
import { ACTIONS, DEFAULT_MIN_SIMILARITY } from "./constants"
import {
  ActionIconButton,
  ActionPicker,
  ConfigDefaultsPopover,
  OptionsPopover,
  PathInput,
  PrimarySwitches,
  StatusStrip,
} from "./controls"
import type { RawfilterCardState, RawfilterStatusMeta } from "./types"
import { CONFIG_FIELDS } from "./types"

export function Component({ compId, host }: NodeComponentProps) {
  "use memo"
  const surface = useNodeSurface()
  const data = host.getData<RawfilterCardState>(compId) ?? {}
  const dataRef = useRef<RawfilterCardState>(data)
  dataRef.current = data

  const [running, setRunning] = useState(false)
  const [defaults, setDefaults] = useState<Partial<RawfilterCardState> | undefined>(undefined)
  const [configFilePath, setConfigFilePath] = useState<string | undefined>(undefined)
  const [configDirty, setConfigDirty] = useState(false)

  const action = data.action ?? "execute"
  const actionMeta = ACTIONS.find((item) => item.value === action) ?? ACTIONS[ACTIONS.length - 1]!
  const logs = data.logs ?? []
  const result = data.result ?? null
  const progress = data.progress ?? 0
  const dryRun = data.dryRun ?? false
  const status = statusFromState(data, running)
  const compactSurface = surface.mode === "compact" || surface.mode === "portrait"
  const forceCollapsedSurface = compactSurface && surface.height > 0 && surface.height < 160
  const portraitCompact = surface.mode === "portrait" || (surface.mode === "compact" && surface.width < 560 && surface.height >= 300)

  useEffect(() => {
    host.getNodeConfig?.<Partial<RawfilterCardState>>()
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
    data.action,
    data.createShortcuts,
    data.dryRun,
    data.minSimilarity,
    data.nameOnlyMode,
    data.path,
    data.trashOnly,
    defaults,
  ])

  function patch(patchData: Partial<RawfilterCardState>) {
    dataRef.current = { ...dataRef.current, ...patchData }
    host.patchData(compId, patchData)
  }

  function pushLog(message: string) {
    const nextLogs = [...(dataRef.current.logs ?? []), message].slice(-120)
    patch({ logs: nextLogs })
  }

  async function pastePath() {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ path: text.trim().split(/\r?\n/)[0]?.trim() ?? "" })
  }

  async function copyResults() {
    const lines = (result?.plan ?? []).map((item) => `${item.status} ${item.destination} ${item.sourcePath}${item.targetPath ? ` -> ${item.targetPath}` : ` / ${item.reason}`}`)
    await host.clipboard?.writeText?.(lines.join("\n"))
  }

  async function copyLogs() {
    await host.clipboard?.writeText?.(logs.join("\n"))
  }

  async function execute(nextAction: RawfilterAction = action) {
    if (running) return
    if (!dataRef.current.path?.trim()) {
      patch({ phase: "error", progress: 0, progressText: "请先输入待过滤的目录路径。" })
      return
    }
    const run = host.actions?.run
    if (!run) {
      patch({ phase: "error", progress: 0, progressText: "当前环境没有本地运行能力，请使用桌面模式或 CLI。" })
      pushLog("Native action is unavailable in this host.")
      return
    }

    const input = buildInput(nextAction, dataRef.current)
    setRunning(true)
    try {
      patch({ phase: "scanning", progress: 0, progressText: `${labelForAction(nextAction)}开始`, result: null, action: nextAction })
      const response = await run<RawfilterInput, RawfilterData>("rawfilter", input, (event) => {
        if (event.type === "progress") {
          patch({ progress: event.progress ?? 0, progressText: event.message })
          pushLog(`[${event.progress ?? 0}%] ${event.message}`)
        } else {
          pushLog(event.message)
        }
      }) as NodeRunResult<RawfilterData>

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

  function reset() {
    patch({ phase: "idle", progress: 0, progressText: "", result: null, logs: [] })
  }

  async function saveAsDefault() {
    const config: Partial<RawfilterCardState> = {}
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
      action: undefined,
      path: undefined,
      nameOnlyMode: undefined,
      createShortcuts: undefined,
      trashOnly: undefined,
      minSimilarity: undefined,
      dryRun: undefined,
    })
  }

  const commonProps = createViewProps({
    action,
    actionMeta,
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
    status,
    onCopyLogs: copyLogs,
    onCopyResults: copyResults,
    onExecute: execute,
    onOpenConfigFile: host.openConfigFile,
    onPaste: pastePath,
    onPatch: patch,
    onReset: reset,
    onResetOverride: resetOverride,
    onRestoreDefault: restoreDefault,
    onSaveDefault: saveAsDefault,
  })

  return (
    <TooltipProvider>
      <div ref={surface.ref} className="@container/rawfilter relative flex h-full min-h-0 w-full overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(circle_at_12%_0%,color-mix(in_oklch,var(--primary)_14%,transparent),transparent_36%),radial-gradient(circle_at_88%_8%,color-mix(in_oklch,var(--chart-2)_16%,transparent),transparent_34%)]" />
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
  action: RawfilterAction
  actionMeta: typeof ACTIONS[number]
  configDirty: boolean
  configFilePath?: string
  data: RawfilterCardState
  defaults?: Partial<RawfilterCardState>
  dryRun: boolean
  host: NodeComponentProps["host"]
  logs: string[]
  progress: number
  result: RawfilterData | null
  running: boolean
  status: RawfilterStatusMeta
  onCopyLogs: () => void
  onCopyResults: () => void
  onExecute: (action?: RawfilterAction) => void
  onOpenConfigFile?: () => Promise<void> | void
  onPaste: () => void
  onPatch: (patch: Partial<RawfilterCardState>) => void
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
    <div data-testid="rawfilter-collapsed-view" className="relative flex h-full min-h-0 items-center gap-2 overflow-hidden rounded-xl border bg-background/85 px-3 py-2 shadow-sm">
      <RunningTint tone={props.status.tone} />
      <div className={cn("relative grid size-8 shrink-0 place-items-center rounded-lg", props.status.iconClass)}>
        <FileSearch />
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="flex items-center gap-1 text-xs font-semibold leading-none">
          <span>Rawfilter</span>
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
    <div data-testid="rawfilter-compact-view" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-2 p-3 pb-2">
        <HeaderLine actionMeta={props.actionMeta} status={props.status} subtitle={props.data.progressText || summaryText(props)} />
        <div className="flex shrink-0 items-center gap-1">
          <OptionsPopover data={props.data} disabled={props.running} onPatch={props.onPatch} />
          {props.running ? <ActionIconButton destructive icon={Square} label="运行中" onClick={() => undefined} /> : <RunActionButton compact props={props} />}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
        <ActionPicker disabled={props.running} value={props.action} onActionChange={(value) => props.onPatch({ action: value })} />
        <PathInput compact data={props.data} disabled={props.running} onPaste={props.onPaste} onPatch={props.onPatch} />
        <PrimarySwitches compact data={props.data} disabled={props.running} onPatch={props.onPatch} />
        <ToolbarActions {...props} compact />
        {(props.status.tone === "running" || props.status.tone === "error") && (
          <StatusStrip compact progress={props.progress} status={props.status} text={props.data.progressText} />
        )}
        <div className="min-h-0 flex-1">
          <RawfilterResultTabs compact logs={props.logs} result={props.result} running={props.running} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} />
        </div>
      </div>
    </div>
  )
}

function PortraitCompactView(props: ViewProps) {
  return (
    <div data-testid="rawfilter-portrait-view" className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="flex shrink-0 items-start justify-between gap-2">
        <HeaderLine actionMeta={props.actionMeta} status={props.status} subtitle={props.data.progressText || summaryText(props)} />
        <div className="flex shrink-0 items-center gap-1">
          <OptionsPopover data={props.data} disabled={props.running} onPatch={props.onPatch} />
          {props.running ? <ActionIconButton destructive icon={Square} label="运行中" onClick={() => undefined} /> : <RunActionButton compact props={props} />}
        </div>
      </div>
      <div className="grid shrink-0 gap-2">
        <ActionPicker disabled={props.running} value={props.action} onActionChange={(value) => props.onPatch({ action: value })} />
        <PathInput compact data={props.data} disabled={props.running} onPaste={props.onPaste} onPatch={props.onPatch} />
        <PrimarySwitches compact data={props.data} disabled={props.running} onPatch={props.onPatch} />
        <ToolbarActions {...props} compact />
      </div>
      <div className="min-h-0 flex-1">
        <RawfilterResultTabs compact logs={props.logs} result={props.result} running={props.running} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} />
      </div>
    </div>
  )
}

function FullView(props: ViewProps) {
  return (
    <div data-testid="rawfilter-full-view" className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <div className="flex shrink-0 flex-col gap-3 @4xl/rawfilter:flex-row @4xl/rawfilter:items-center @4xl/rawfilter:justify-between">
        <div className="flex min-w-0 flex-col gap-2 @4xl/rawfilter:flex-row @4xl/rawfilter:items-center">
          <HeaderLine
            actionMeta={props.actionMeta}
            status={props.status}
            subtitle={props.data.progressText || `${props.actionMeta.label} / ${props.dryRun ? "预演" : "真实"} / ${props.data.path ? "已设路径" : "待输入"}`}
          />
          <div data-testid="rawfilter-header-toolbar" className="flex min-w-0 flex-wrap items-center gap-2">
            <ToolbarActions {...props} />
          </div>
        </div>
        <StatsPanel progress={props.progress} result={props.result} />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 @5xl/rawfilter:grid-cols-[minmax(320px,380px)_minmax(0,1fr)]">
        <section className="flex min-h-0 flex-col gap-3 overflow-auto pr-1">
          <div className="grid gap-3 border-b pb-3">
            <div>
              <div className="text-sm font-semibold">任务</div>
              <div className="text-xs text-muted-foreground">选择动作，粘贴目录路径，调整去重开关。</div>
            </div>
            <ActionPicker disabled={props.running} value={props.action} onActionChange={(value) => props.onPatch({ action: value })} />
            <PathInput data={props.data} disabled={props.running} onPaste={props.onPaste} onPatch={props.onPatch} />
          </div>
          <div className="grid gap-3 border-b pb-3">
            <div className="text-sm font-semibold">关键开关</div>
            <PrimarySwitches data={props.data} disabled={props.running} onPatch={props.onPatch} />
          </div>
          <StatusStrip progress={props.progress} status={props.status} text={props.data.progressText} />
        </section>

        <div className="min-h-0">
          <RawfilterResultTabs logs={props.logs} result={props.result} running={props.running} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} />
        </div>
      </div>
    </div>
  )
}

function ToolbarActions(props: ViewProps & { compact?: boolean }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-1", props.compact && "justify-between")}>
      {!props.compact && (props.running ? <ActionIconButton destructive icon={Square} label="运行中" onClick={() => undefined} /> : <RunActionButton props={props} />)}
      <ActionIconButton disabled={!props.result} icon={Copy} label="复制结果" onClick={props.onCopyResults} />
      <ActionIconButton disabled={!props.logs.length} icon={FileSearch} label="复制日志" onClick={props.onCopyLogs} />
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
  if (props.running) {
    return (
      <Button aria-label="rawfilter running" disabled size={compact ? "icon-sm" : "sm"} variant="secondary">
        <Square />
        {!compact && <span>运行中</span>}
      </Button>
    )
  }
  const label = `运行${props.actionMeta.shortLabel}`
  const dangerous = isDangerous(props)
  const disabled = !props.data.path?.trim()
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
            <AlertDialogTitle>确认真实执行 Rawfilter？</AlertDialogTitle>
            <AlertDialogDescription>
              当前关闭了预演并选择执行过滤，将按计划真实移动重复/原始归档到 trash 或 multi 目录，操作不可撤销。请确认目录路径和回收策略无误后再继续。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => props.onExecute(props.action)}>确认执行</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
  }

  return (
    <Button aria-label={label} disabled={disabled} size={compact ? "icon-sm" : "sm"} onClick={() => props.onExecute(props.action)}>
      <Play />
      {!compact && <span>{label}</span>}
    </Button>
  )
}

function HeaderLine({ actionMeta, status, subtitle }: {
  actionMeta: typeof ACTIONS[number]
  status: RawfilterStatusMeta
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
            <h3 className="truncate text-sm font-semibold leading-none">Rawfilter</h3>
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
  result: RawfilterData | null
}) {
  const stats = [
    ["归档", props.result?.archiveCount ?? 0],
    ["分组", props.result?.totalGroups ?? 0],
    ["重复", props.result?.duplicateGroups ?? 0],
    ["回收", props.result?.movedToTrash ?? 0],
    ["多媒体", props.result?.movedToMulti ?? 0],
    ["快捷", props.result?.createdShortcuts ?? 0],
    ["保留", props.result?.keptCount ?? 0],
    ["错误", props.result?.errorCount ?? 0],
    ["进度", `${props.progress}%`],
  ] as const

  return (
    <div className="grid shrink-0 grid-cols-3 gap-1 @4xl/rawfilter:grid-cols-9">
      {stats.map(([label, value]) => (
        <div key={label} className="min-w-0 rounded-md bg-muted/35 px-2 py-1.5 text-center">
          <div className="truncate text-[11px] text-muted-foreground">{label}</div>
          <div className={cn("text-sm font-semibold tabular-nums", label === "错误" && Number(value) > 0 && "text-destructive")}>{value}</div>
        </div>
      ))}
    </div>
  )
}

function RawfilterResultTabs(props: {
  compact?: boolean
  logs: string[]
  result: RawfilterData | null
  running?: boolean
  onCopyLogs: () => void
  onCopyResults: () => void
}) {
  const planLines = useMemo(() => (props.result?.plan ?? []).slice(0, 500).map((item) => `${item.status} ${item.destination} ${item.fileName}${item.targetPath ? ` -> ${item.targetPath}` : ` / ${item.reason}`}`), [props.result])
  const groupLines = useMemo(() => (props.result?.groups ?? []).map((group) => `${group.files.length} ${group.label}`), [props.result])
  const hasPlan = planLines.length > 0
  const hasGroups = groupLines.length > 0

  const preferredTab = props.running ? "logs" : hasPlan ? "plan" : hasGroups ? "groups" : props.logs.length ? "logs" : "plan"
  const [tab, setTab] = useState(preferredTab)
  useEffect(() => { setTab(preferredTab) }, [preferredTab])

  return (
    <Tabs value={tab} onValueChange={setTab} className="flex h-full min-h-0 flex-col">
      <TabsList className="shrink-0">
        <TabsTrigger value="plan">计划</TabsTrigger>
        <TabsTrigger value="groups">分组</TabsTrigger>
        <TabsTrigger value="logs">日志</TabsTrigger>
      </TabsList>
      <TabsContent value="plan" className="min-h-0 flex-1">
        <TextPanel compact={props.compact} emptyText="运行后会显示保留/移动/快捷方式计划。" icon={ListChecks} lines={planLines} onCopy={props.onCopyResults} />
      </TabsContent>
      <TabsContent value="groups" className="min-h-0 flex-1">
        <TextPanel compact={props.compact} emptyText="扫描后按相似度归组的结果会显示在这里。" icon={Layers} lines={groupLines} onCopy={props.onCopyResults} />
      </TabsContent>
      <TabsContent value="logs" className="min-h-0 flex-1">
        <TextPanel compact={props.compact} emptyText="运行日志会显示在这里。" icon={FileSearch} lines={props.logs} onCopy={props.onCopyLogs} />
      </TabsContent>
    </Tabs>
  )
}

function TextPanel(props: {
  compact?: boolean
  emptyText: string
  icon: typeof FileSearch
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
          <pre className={props.compact ? "whitespace-pre-wrap p-2 text-xs leading-5 text-muted-foreground" : "whitespace-pre-wrap p-3 text-xs leading-5 text-muted-foreground"}>
            {props.lines.join("\n")}
          </pre>
        ) : (
          <div className="flex h-full min-h-16 items-center justify-center p-3 text-center text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><Icon className="size-3.5" />{props.emptyText}</span>
          </div>
        )}
      </ScrollArea>
    </section>
  )
}

function buildInput(action: RawfilterAction, data: RawfilterCardState): RawfilterInput {
  return {
    action,
    path: data.path,
    nameOnlyMode: data.nameOnlyMode ?? false,
    createShortcuts: data.createShortcuts ?? false,
    trashOnly: data.trashOnly ?? false,
    minSimilarity: data.minSimilarity ?? DEFAULT_MIN_SIMILARITY,
    dryRun: data.dryRun ?? false,
  }
}

function statusFromState(data: RawfilterCardState, running: boolean): RawfilterStatusMeta {
  if (running || data.phase === "scanning") {
    return {
      label: "运行中",
      description: data.progressText || "Rawfilter 正在扫描并归组。",
      tone: "running",
      badgeVariant: "secondary",
      iconClass: "bg-primary text-primary-foreground",
    }
  }
  if (data.phase === "completed") {
    return {
      label: "完成",
      description: data.progressText || "上次过滤已完成。",
      tone: "success",
      badgeVariant: "default",
      iconClass: "bg-primary text-primary-foreground",
    }
  }
  if (data.phase === "error") {
    return {
      label: "失败",
      description: data.progressText || "上次过滤失败，请查看日志。",
      tone: "error",
      badgeVariant: "destructive",
      iconClass: "bg-destructive text-destructive-foreground",
    }
  }
  return {
    label: "就绪",
    description: "粘贴目录路径后开始归组去重。",
    tone: "idle",
    badgeVariant: "outline",
    iconClass: "bg-secondary text-secondary-foreground",
  }
}

function isDangerous(props: ViewProps): boolean {
  if (props.dryRun) return false
  return props.action === "execute"
}

function labelForAction(action: RawfilterAction): string {
  if (action === "scan") return "扫描"
  if (action === "plan") return "生成计划"
  if (action === "execute") return "执行过滤"
  return action
}

function summaryText(props: ViewProps): string {
  if (props.data.progressText) return props.data.progressText
  if (props.result) {
    const moved = (props.result.movedToTrash ?? 0) + (props.result.movedToMulti ?? 0) + (props.result.createdShortcuts ?? 0)
    return `${props.result.archiveCount} 归档 / ${props.result.totalGroups} 组 / ${moved} 处理`
  }
  if (props.data.path) return `${props.data.path} 等待运行`
  return "粘贴目录路径后开始过滤"
}

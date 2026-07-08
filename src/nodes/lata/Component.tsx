import { useEffect, useRef, useState } from "react"
import type { NodeComponentProps, NodeRunResult } from "@xiranite/contract"
import type { LataAction, LataData, LataInput } from "@xiranite/node-lata/core"
import { Clipboard, Copy, ListTodo, Play, RotateCcw, Rocket, Square } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import { LATA_ACTIONS } from "./constants"
import {
  ActionIconButton,
  ArgsInput,
  ConfigDefaultsPopover,
  StatusStrip,
  TaskfileInput,
  TaskPicker,
} from "./controls"
import type { LataCardState, LataPhase, LataStatusMeta } from "./types"
import { CONFIG_FIELDS } from "./types"

export function Component({ compId, host }: NodeComponentProps) {
  const surface = useNodeSurface()
  const data = host.getData<LataCardState>(compId) ?? {}
  const dataRef = useRef<LataCardState>(data)
  dataRef.current = data

  const [running, setRunning] = useState(false)
  const [defaults, setDefaults] = useState<Partial<LataCardState> | undefined>(undefined)
  const [configFilePath, setConfigFilePath] = useState<string | undefined>(undefined)
  const [configDirty, setConfigDirty] = useState(false)

  const tasks = data.result?.tasks ?? []
  const selectedTask = data.taskName || tasks[0]?.name || ""
  const logs = data.logs ?? []
  const result = data.result ?? null
  const phase = phaseFromState(data, running)
  const progress = data.progress ?? 0
  const status = statusFromState(data, running)
  const compactSurface = surface.mode === "compact" || surface.mode === "portrait"
  const forceCollapsedSurface = compactSurface && surface.height > 0 && surface.height < 160
  const portraitCompact = surface.mode === "portrait" || (surface.mode === "compact" && surface.width < 560 && surface.height >= 300)

  useEffect(() => {
    host.getNodeConfig?.<Partial<LataCardState>>()
      .then((response) => {
        setDefaults(response.config)
        setConfigFilePath(response.path)
      })
      .catch(() => undefined)
  }, [host])

  useEffect(() => {
    if (!defaults) return
    setConfigDirty(CONFIG_FIELDS.some((field) => String(data[field] ?? "") !== String(defaults[field] ?? "")))
  }, [data.taskfilePath, data.taskName, data.taskArgs, defaults])

  function patch(patchData: Partial<LataCardState>) {
    dataRef.current = { ...dataRef.current, ...patchData }
    host.patchData(compId, patchData)
  }

  function pushLog(message: string) {
    const nextLogs = [...(dataRef.current.logs ?? []), message].slice(-100)
    patch({ logs: nextLogs })
  }

  async function pastePath() {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ taskfilePath: text.trim() })
  }

  async function execute(action: LataAction) {
    if (running) return
    const input = buildInput(action, dataRef.current, selectedTask)
    const run = host.actions?.run
    if (!run) {
      patch({ phase: "error", progress: 0, progressText: "当前环境没有本地运行能力，请使用桌面模式或 CLI。" })
      pushLog("Native action is unavailable in this host.")
      return
    }

    setRunning(true)
    try {
      patch({ phase: action === "execute" ? "running" : "loading", progress: 0, progressText: `${labelForAction(action)}开始` })
      const response = await run<LataInput, LataData>("lata", input, (event) => {
        if (event.type === "progress") {
          patch({ progress: event.progress ?? 0, progressText: event.message })
        } else {
          pushLog(event.message)
        }
      }) as NodeRunResult<LataData>

      patch({
        phase: response.success ? "completed" : "error",
        progress: response.success ? 100 : 0,
        progressText: response.message,
        result: response.data ?? null,
        taskName: selectedTask || response.data?.tasks[0]?.name,
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

  function reset() {
    patch({ phase: "idle", progress: 0, progressText: "", result: null, logs: [] })
  }

  async function saveAsDefault() {
    const config: Partial<LataCardState> = {}
    for (const field of CONFIG_FIELDS) {
      const value = dataRef.current[field]
      if (value !== undefined && value !== "") (config as Record<string, unknown>)[field] = value
    }
    await host.saveNodeConfig?.(config)
    setDefaults(config)
    setConfigDirty(false)
  }

  function restoreDefault() {
    if (defaults) patch(defaults)
  }

  function resetOverride() {
    patch({ taskfilePath: undefined, taskName: undefined, taskArgs: undefined })
  }

  const commonProps = createViewProps({
    configDirty,
    configFilePath,
    data,
    defaults,
    host,
    logs,
    phase,
    progress,
    result,
    running,
    selectedTask,
    status,
    tasks,
    onCopyLogs: copyLogs,
    onExecute: (action: LataAction) => execute(action),
    onOpenConfigFile: host.openConfigFile,
    onPaste: pastePath,
    onPatch: patch,
    onReset: reset,
    onResetOverride: resetOverride,
    onRestoreDefault: restoreDefault,
    onSaveDefault: saveAsDefault,
    onTaskChange: (task: string) => patch({ taskName: task }),
  })

  return (
    <TooltipProvider>
      <div ref={surface.ref} className="@container/lata relative flex h-full min-h-0 w-full overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(circle_at_12%_0%,color-mix(in_oklch,var(--primary)_12%,transparent),transparent_36%),radial-gradient(circle_at_88%_8%,color-mix(in_oklch,var(--chart-3)_14%,transparent),transparent_34%)]" />
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
  data: LataCardState
  defaults?: Partial<LataCardState>
  host: NodeComponentProps["host"]
  logs: string[]
  phase: LataPhase
  progress: number
  result: LataData | null
  running: boolean
  selectedTask: string
  status: LataStatusMeta
  tasks: LataData["tasks"]
  onCopyLogs: () => void
  onExecute: (action: LataAction) => void
  onOpenConfigFile?: () => Promise<void> | void
  onPaste: () => void
  onPatch: (patch: Partial<LataCardState>) => void
  onReset: () => void
  onResetOverride: () => void
  onRestoreDefault: () => void
  onSaveDefault: () => void
  onTaskChange: (task: string) => void
}) {
  return props
}

function CollapsedView(props: ViewProps) {
  return (
    <div data-testid="lata-collapsed-view" className="relative flex h-full min-h-0 items-center gap-2 overflow-hidden rounded-xl border bg-background/85 px-3 py-2 shadow-sm">
      <div className={cn("absolute inset-0 opacity-70 transition-opacity", props.status.tone === "running" && "animate-pulse bg-primary/10", props.status.tone === "error" && "bg-destructive/10", props.status.tone === "success" && "bg-primary/10")} />
      <div className={cn("relative grid size-8 shrink-0 place-items-center rounded-lg", props.status.iconClass)}>
        <Rocket />
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="flex items-center gap-1 text-xs font-semibold leading-none">
          <span>Lata</span>
          <Badge variant={props.status.badgeVariant}>{props.status.label}</Badge>
        </div>
        <div className="mt-1 truncate text-xs text-muted-foreground">{summaryText(props)}</div>
      </div>
      <ActionButtons compact props={props} />
      {props.status.tone === "running" && <div className="relative text-xs tabular-nums text-muted-foreground">{props.progress}%</div>}
    </div>
  )
}

function CompactView(props: ViewProps) {
  return (
    <div data-testid="lata-compact-view" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-2 p-3 pb-2">
        <HeaderLine status={props.status} subtitle={props.data.progressText || summaryText(props)} />
        <div className="flex shrink-0 items-center gap-1">
          <ActionButtons compact props={props} />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
        <TaskfileInput compact data={props.data} disabled={props.running} onPaste={props.onPaste} onPatch={props.onPatch} />
        <ArgsInput data={props.data} disabled={props.running} onPatch={props.onPatch} />
        <TaskPicker compact disabled={props.running} selectedTask={props.selectedTask} tasks={props.tasks} onTaskChange={props.onTaskChange} />
        {(props.status.tone === "running" || props.status.tone === "error") && (
          <StatusStrip compact progress={props.progress} status={props.status} text={props.data.progressText} />
        )}
        <div className="min-h-0 flex-1">
          <LataDisplayTabs compact logs={props.logs} result={props.result} tasks={props.tasks} onCopyLogs={props.onCopyLogs} />
        </div>
      </div>
    </div>
  )
}

function PortraitCompactView(props: ViewProps) {
  return (
    <div data-testid="lata-portrait-view" className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="flex shrink-0 items-start justify-between gap-2">
        <HeaderLine status={props.status} subtitle={props.data.progressText || summaryText(props)} />
        <div className="flex shrink-0 items-center gap-1">
          <ActionButtons compact props={props} />
        </div>
      </div>
      <div className="grid shrink-0 gap-2">
        <TaskfileInput compact data={props.data} disabled={props.running} onPaste={props.onPaste} onPatch={props.onPatch} />
        <ArgsInput data={props.data} disabled={props.running} onPatch={props.onPatch} />
        <TaskPicker compact disabled={props.running} selectedTask={props.selectedTask} tasks={props.tasks} onTaskChange={props.onTaskChange} />
      </div>
      <div className="min-h-0 flex-1">
        <LataDisplayTabs compact logs={props.logs} result={props.result} tasks={props.tasks} onCopyLogs={props.onCopyLogs} />
      </div>
    </div>
  )
}

function FullView(props: ViewProps) {
  return (
    <div data-testid="lata-full-view" className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <div className="flex shrink-0 flex-col gap-3 @4xl/lata:flex-row @4xl/lata:items-center @4xl/lata:justify-between">
        <div className="flex min-w-0 flex-col gap-2 @4xl/lata:flex-row @4xl/lata:items-center">
          <HeaderLine status={props.status} subtitle={props.data.progressText || `${props.selectedTask || "未选择"} / ${props.tasks.length} 个任务`} />
          <div data-testid="lata-header-toolbar" className="flex min-w-0 flex-wrap items-center gap-2">
            <ActionButtons props={props} />
            <ActionIconButton disabled={!props.logs.length} icon={Copy} label="复制日志" onClick={props.onCopyLogs} />
            <ActionIconButton icon={RotateCcw} label="清空状态" onClick={props.onReset} />
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
        <StatsPanel result={props.result} selectedTask={props.selectedTask} tasks={props.tasks} />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 @5xl/lata:grid-cols-[minmax(320px,380px)_minmax(0,1fr)]">
        <section className="flex min-h-0 flex-col gap-3 overflow-auto pr-1">
          <div className="grid gap-3 border-b pb-3">
            <div>
              <div className="text-sm font-semibold">Taskfile 配置</div>
              <div className="text-xs text-muted-foreground">指定 Taskfile 路径与任务参数，加载后可选择任务。</div>
            </div>
            <TaskfileInput data={props.data} disabled={props.running} onPaste={props.onPaste} onPatch={props.onPatch} />
            <ArgsInput data={props.data} disabled={props.running} onPatch={props.onPatch} />
          </div>
          <div className="grid gap-3 border-b pb-3">
            <div>
              <div className="text-sm font-semibold">任务列表</div>
              <div className="text-xs text-muted-foreground">点击任务名选中，再预览或执行。</div>
            </div>
            <TaskPicker disabled={props.running} selectedTask={props.selectedTask} tasks={props.tasks} onTaskChange={props.onTaskChange} />
          </div>
          <StatusStrip progress={props.progress} status={props.status} text={props.data.progressText} />
        </section>

        <div className="min-h-0">
          <LataDisplayTabs logs={props.logs} result={props.result} tasks={props.tasks} onCopyLogs={props.onCopyLogs} />
        </div>
      </div>
    </div>
  )
}

function ActionButtons({ compact, props }: { compact?: boolean; props: ViewProps }) {
  if (props.running) {
    return (
      <Button aria-label="lata running" disabled size={compact ? "icon-sm" : "sm"} variant="secondary">
        <Square />
        {!compact && <span>运行中</span>}
      </Button>
    )
  }

  return (
    <div className="flex items-center gap-1">
      {LATA_ACTIONS.map((action) => {
        const Icon = action.icon
        const disabled = action.value === "list"
          ? props.running || !props.data.taskfilePath
          : props.running || !props.selectedTask
        if (action.value === "execute") {
          return (
            <AlertDialog key={action.value}>
              <AlertDialogTrigger asChild>
                <Button aria-label={action.label} disabled={disabled} size={compact ? "icon-sm" : "sm"} variant="destructive">
                  <Icon />
                  {!compact && <span>{action.label}</span>}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>确认执行 Lata 任务？</AlertDialogTitle>
                  <AlertDialogDescription>
                    将真实执行 Taskfile 中「{props.selectedTask}」任务的命令。请确认命令内容无误后再继续。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={() => props.onExecute("execute")}>确认执行</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )
        }
        return (
          <Button key={action.value} aria-label={action.label} disabled={disabled} size={compact ? "icon-sm" : "sm"} variant="outline" onClick={() => props.onExecute(action.value)}>
            <Icon />
            {!compact && <span>{action.label}</span>}
          </Button>
        )
      })}
    </div>
  )
}

function HeaderLine({ status, subtitle }: {
  status: LataStatusMeta
  subtitle: string
}) {
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-2">
        <div className={cn("grid size-8 shrink-0 place-items-center rounded-lg", status.iconClass)}>
          <Rocket />
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-sm font-semibold leading-none">Lata</h3>
            <Badge variant={status.badgeVariant}>{status.label}</Badge>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>
    </div>
  )
}

function StatsPanel(props: {
  result: LataData | null
  selectedTask: string
  tasks: LataData["tasks"]
}) {
  const commandCount = props.result?.commandPlan.length ?? props.tasks.find((task) => task.name === props.selectedTask)?.cmdCount ?? 0
  const stats = [
    ["任务", `${props.tasks.length}`],
    ["命令", `${commandCount}`],
    ["退出码", `${props.result?.exitCode ?? "-"}`],
  ] as const

  return (
    <div className="grid shrink-0 grid-cols-3 gap-1 @3xl/lata:grid-cols-3">
      {stats.map(([label, value]) => (
        <div key={label} className="min-w-0 rounded-md bg-muted/35 px-2 py-1.5 text-center">
          <div className="truncate text-[11px] text-muted-foreground">{label}</div>
          <div className="truncate text-sm font-semibold tabular-nums">{value}</div>
        </div>
      ))}
    </div>
  )
}

function LataDisplayTabs(props: {
  compact?: boolean
  logs: string[]
  result: LataData | null
  tasks: LataData["tasks"]
  onCopyLogs: () => void
}) {
  return (
    <Tabs defaultValue="tasks" className="flex h-full min-h-0 flex-col">
      <TabsList className="shrink-0">
        <TabsTrigger value="tasks">任务</TabsTrigger>
        <TabsTrigger value="commands">命令</TabsTrigger>
        <TabsTrigger value="logs">日志</TabsTrigger>
      </TabsList>
      <TabsContent value="tasks" className="min-h-0 flex-1">
        <TaskBoard compact={props.compact} tasks={props.tasks} />
      </TabsContent>
      <TabsContent value="commands" className="min-h-0 flex-1">
        <CommandBoard compact={props.compact} result={props.result} />
      </TabsContent>
      <TabsContent value="logs" className="min-h-0 flex-1">
        <LogBoard compact={props.compact} logs={props.logs} onCopy={props.onCopyLogs} />
      </TabsContent>
    </Tabs>
  )
}

function TaskBoard(props: {
  compact?: boolean
  tasks: LataData["tasks"]
}) {
  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border bg-background/70">
      <ScrollArea className="min-h-0 flex-1">
        {props.tasks.length ? (
          <div className={props.compact ? "p-2" : "p-3"}>
            {props.tasks.map((task) => (
              <div key={task.name} className="mb-1.5 truncate text-xs">
                <span className="font-mono font-semibold">{task.name}</span>
                <span className="text-muted-foreground"> / {task.cmdCount} cmd(s)</span>
                {task.desc ? <span className="text-muted-foreground"> / {task.desc}</span> : null}
              </div>
            ))}
          </div>
        ) : (
          <div className={props.compact ? "flex min-h-16 items-center justify-center p-3 text-center text-xs text-muted-foreground" : "flex min-h-36 items-center justify-center p-6 text-center text-sm text-muted-foreground"}>
            加载 Taskfile 后任务会显示在这里。
          </div>
        )}
      </ScrollArea>
    </section>
  )
}

function CommandBoard(props: {
  compact?: boolean
  result: LataData | null
}) {
  const results = props.result?.commandResults ?? []
  const plan = props.result?.commandPlan ?? []
  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border bg-background/70">
      <ScrollArea className="min-h-0 flex-1">
        {results.length ? (
          <div className={props.compact ? "p-2" : "p-3"}>
            {results.map((item) => (
              <div key={`${item.index}:${item.command}`} className="mb-1.5 truncate font-mono text-xs">
                <span className={item.exitCode === 0 ? "text-primary" : "text-destructive"}>[{item.exitCode}]</span> {item.taskName}: {item.command}
              </div>
            ))}
          </div>
        ) : plan.length ? (
          <div className={props.compact ? "p-2" : "p-3"}>
            {plan.map((item) => (
              <div key={`${item.index}:${item.command}`} className="mb-1.5 truncate font-mono text-xs text-muted-foreground">
                {item.taskName}: {item.command}
              </div>
            ))}
          </div>
        ) : (
          <div className={props.compact ? "flex min-h-16 items-center justify-center p-3 text-center text-xs text-muted-foreground" : "flex min-h-36 items-center justify-center p-6 text-center text-sm text-muted-foreground"}>
            预览或执行任务后命令会显示在这里。
          </div>
        )}
      </ScrollArea>
    </section>
  )
}

function LogBoard(props: {
  compact?: boolean
  logs: string[]
  onCopy: () => void
}) {
  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border bg-background/70">
      <div className={props.compact ? "flex shrink-0 items-center justify-between gap-2 px-2 py-1.5" : "flex shrink-0 items-center justify-between gap-2 px-3 py-2"}>
        <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
          <span>{props.logs.length ? `${props.logs.length} 条` : "等待运行"}</span>
        </div>
        <Button disabled={!props.logs.length} size="xs" variant="ghost" onClick={props.onCopy}>
          <Copy data-icon="inline-start" />
          复制
        </Button>
      </div>
      <Separator />
      <ScrollArea className="min-h-0 flex-1">
        {props.logs.length ? (
          <pre className={props.compact ? "p-2 text-xs leading-5 text-muted-foreground" : "p-3 text-xs leading-5 text-muted-foreground"}>
            {props.logs.join("\n")}
          </pre>
        ) : (
          <div className={props.compact ? "flex min-h-16 items-center justify-center p-3 text-center text-xs text-muted-foreground" : "flex min-h-36 items-center justify-center p-6 text-center text-sm text-muted-foreground"}>
            运行日志会显示在这里。
          </div>
        )}
      </ScrollArea>
    </section>
  )
}

function buildInput(action: LataAction, data: LataCardState, selectedTask: string): LataInput {
  return {
    action,
    taskfilePath: data.taskfilePath,
    taskName: selectedTask,
    taskArgs: data.taskArgs,
  }
}

function statusFromState(data: LataCardState, running: boolean): LataStatusMeta {
  if (running || data.phase === "running" || data.phase === "loading") {
    return {
      label: "运行中",
      description: data.progressText || "Lata 正在加载或执行任务。",
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
    description: "指定 Taskfile 路径后加载任务。",
    tone: "idle",
    badgeVariant: "outline",
    iconClass: "bg-secondary text-secondary-foreground",
  }
}

function phaseFromState(data: LataCardState, running: boolean): LataPhase {
  if (running) return data.phase ?? "running"
  return data.phase ?? "idle"
}

function labelForAction(action: LataAction): string {
  if (action === "list") return "加载任务"
  if (action === "plan") return "预览命令"
  if (action === "execute") return "执行任务"
  return "Lata"
}

function summaryText(props: ViewProps): string {
  if (props.data.progressText) return props.data.progressText
  if (props.phase === "completed") return "任务已完成"
  return `${props.selectedTask || "未选择"} / ${props.tasks.length} 个任务`
}

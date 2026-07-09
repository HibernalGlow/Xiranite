import { useEffect, useRef, useState } from "react"
import type { NodeComponentProps, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type { PackuToolAction, PackuToolData, PackuToolInput, PackuToolSpec } from "@xiranite/packu-node-runtime/core"
import { ArrowRight, Clipboard, Folder, FolderInput, Play, RotateCcw, Square } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import { RunningTint } from "@/nodes/shared/controls"
import { ACTIONS, NODE_META, type ClassqAction } from "./constants"
import {
  ActionIconButton,
  ActionPicker,
  ConfigDefaultsPopover,
  OptionsPopover,
  PathsInput,
  StatusStrip,
} from "./controls"
import { PackuResultTabs } from "./results"
import type { ClassqCardState, ClassqStatusMeta } from "./types"
import { CONFIG_FIELDS } from "./types"

export function Component({ compId, host }: NodeComponentProps<ClassqCardState>) {
  const surface = useNodeSurface()
  const data = getHostData(host, compId)
  const dataRef = useRef<ClassqCardState>(data)
  dataRef.current = data

  const [running, setRunning] = useState(false)
  const [defaults, setDefaults] = useState<Partial<ClassqCardState> | undefined>(undefined)
  const [configFilePath, setConfigFilePath] = useState<string | undefined>(undefined)
  const [configDirty, setConfigDirty] = useState(false)

  const action = data.action ?? "status"
  const actionMeta = ACTIONS.find((item) => item.value === action) ?? ACTIONS[0]!
  const result = data.result ?? null
  const logs = data.logs ?? []
  const progress = data.progress ?? 0
  const status = statusFromState(data, running)
  const compactSurface = surface.mode === "compact" || surface.mode === "portrait"
  const forceCollapsedSurface = compactSurface && surface.height > 0 && surface.height < 160
  const portraitCompact = surface.mode === "portrait" || (surface.mode === "compact" && surface.width < 560 && surface.height >= 300)

  useEffect(() => {
    const loadConfig = host.config?.get?.<Partial<ClassqCardState>>() ?? host.getNodeConfig?.<Partial<ClassqCardState>>()
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
    data.configPath,
    data.databasePath,
    data.argsText,
    data.python,
    data.sourceRoot,
    data.moduleName,
    data.dryRun,
    data.recordRun,
    defaults,
  ])

  function patch(patchData: Partial<ClassqCardState>) {
    dataRef.current = { ...dataRef.current, ...patchData }
    if (host.state?.patchData) host.state.patchData(patchData)
    else host.patchData(compId, patchData)
  }

  function pushLog(message: string) {
    const nextLogs = [...(dataRef.current.logs ?? []), message].slice(-120)
    patch({ logs: nextLogs })
  }

  async function pastePaths() {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ pathsText: text.trim() })
  }

  async function copyLogs() {
    await host.clipboard?.writeText?.(logs.join("\n"))
  }

  async function copyResults() {
    const current = dataRef.current.result
    if (!current) return
    const lines: string[] = []
    if (current.command.command) {
      lines.push(`${current.command.label}\t${current.command.command} ${current.command.args.join(" ")}`)
    }
    lines.push(`sourceRoot\t${current.integration.sourceRoot}`)
    lines.push(`moduleName\t${current.integration.moduleName}`)
    for (const candidate of current.integration.configCandidates) {
      lines.push(`configCandidate\t${candidate}`)
    }
    if (current.integration.databasePath) lines.push(`databasePath\t${current.integration.databasePath}`)
    await host.clipboard?.writeText?.(lines.join("\n"))
  }

  function reset() {
    patch({ logs: [], phase: "idle", progress: 0, progressText: "", result: null })
  }

  async function saveAsDefault() {
    const config: Partial<ClassqCardState> = {}
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
    const empty: Partial<ClassqCardState> = {}
    for (const field of CONFIG_FIELDS) empty[field] = undefined
    patch(empty)
  }

  async function execute(nextAction: PackuToolAction = action) {
    if (running) return
    const current = dataRef.current

    if (nextAction !== "status" && !clean(current.pathsText)) {
      const message = "请先输入至少一个归档或目录路径。"
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
      const response = await run<PackuToolInput, PackuToolData>(NODE_META.id, buildInput(nextAction, current, NODE_META.spec), (event: NodeRunEvent) => {
        if (event.type === "progress") {
          patch({ progress: event.progress ?? 0, progressText: event.message })
          pushLog(`[${event.progress ?? 0}%] ${event.message}`)
          return
        }
        pushLog(event.message)
      }) as NodeRunResult<PackuToolData>

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
    configDirty,
    configFilePath,
    data,
    defaults,
    logs,
    progress,
    result,
    running,
    status,
    onActionChange: (value: ClassqAction) => patch({ action: value }),
    onCopyLogs: copyLogs,
    onCopyResults: copyResults,
    onExecute: execute,
    onOpenConfigFile: host.config?.openFile ?? host.openConfigFile,
    onPastePaths: pastePaths,
    onPatch: patch,
    onReset: reset,
    onResetOverride: resetOverride,
    onRestoreDefault: restoreDefault,
    onSaveDefault: saveAsDefault,
  }

  return (
    <TooltipProvider>
      <div ref={surface.ref} className="@container/classq relative flex h-full min-h-0 w-full overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(circle_at_16%_0%,color-mix(in_oklch,var(--primary)_14%,transparent),transparent_36%),radial-gradient(circle_at_86%_8%,color-mix(in_oklch,var(--chart-4)_14%,transparent),transparent_34%)]" />
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
  action: PackuToolAction
  actionMeta: typeof ACTIONS[number]
  configDirty: boolean
  configFilePath?: string
  data: ClassqCardState
  defaults?: Partial<ClassqCardState>
  logs: string[]
  progress: number
  result: PackuToolData | null
  running: boolean
  status: ClassqStatusMeta
  onActionChange: (value: ClassqAction) => void
  onCopyLogs: () => void
  onCopyResults: () => void
  onExecute: (action?: PackuToolAction) => void
  onOpenConfigFile?: () => Promise<void> | void
  onPastePaths: () => void
  onPatch: (patch: Partial<ClassqCardState>) => void
  onReset: () => void
  onResetOverride: () => void
  onRestoreDefault: () => void
  onSaveDefault: () => void
}) {
  return props
}

function CollapsedView(props: ViewProps) {
  const ActionIcon = props.actionMeta.icon
  const NodeIcon = NODE_META.icon
  return (
    <div data-testid="classq-collapsed-view" className="relative flex h-full min-h-0 items-center gap-2 overflow-hidden rounded-xl border bg-background/85 px-3 py-2 shadow-sm">
      <RunningTint tone={props.status.tone} />
      <div className={cn("relative grid size-8 shrink-0 place-items-center rounded-lg", props.status.iconClass)}>
        <NodeIcon />
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="flex items-center gap-1 text-xs font-semibold leading-none">
          <span>{NODE_META.title}</span>
          <Badge variant={props.status.badgeVariant}>{props.status.label}</Badge>
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-1 truncate text-xs text-muted-foreground">
          <ActionIcon className="size-3.5 shrink-0" />
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
    <div data-testid="classq-compact-view" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-2 p-3 pb-2">
        <HeaderLine actionMeta={props.actionMeta} status={props.status} subtitle={props.data.progressText || summaryText(props)} />
        <div className="flex shrink-0 items-center gap-1">
          <OptionsPopover data={props.data} disabled={props.running} onPatch={props.onPatch} />
          <RunActionButton compact props={props} />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
        <ActionPicker action={props.action} disabled={props.running} onActionChange={props.onActionChange} />
        <PathsInput compact data={props.data} disabled={props.running} onPaste={props.onPastePaths} onPatch={props.onPatch} />
        {(props.status.tone === "running" || props.status.tone === "error") && (
          <StatusStrip compact progress={props.progress} status={props.status} text={props.data.progressText} />
        )}
        <div className="min-h-0 flex-1">
          <PackuResultTabs compact logs={props.logs} result={props.result} running={props.running} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} />
        </div>
      </div>
    </div>
  )
}

function PortraitCompactView(props: ViewProps) {
  return (
    <div data-testid="classq-portrait-view" className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="flex shrink-0 items-start justify-between gap-2">
        <HeaderLine actionMeta={props.actionMeta} status={props.status} subtitle={props.data.progressText || summaryText(props)} />
        <div className="flex shrink-0 items-center gap-1">
          <OptionsPopover data={props.data} disabled={props.running} onPatch={props.onPatch} />
          <RunActionButton compact props={props} />
        </div>
      </div>
      <div className="grid shrink-0 gap-2">
        <ActionPicker action={props.action} disabled={props.running} onActionChange={props.onActionChange} />
        <PathsInput compact data={props.data} disabled={props.running} onPaste={props.onPastePaths} onPatch={props.onPatch} />
      </div>
      <div className="min-h-0 flex-1">
        <PackuResultTabs compact logs={props.logs} result={props.result} running={props.running} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} />
      </div>
    </div>
  )
}

function FullView(props: ViewProps) {
  const pendingPaths = parsePaths(props.data.pathsText)
  const selectedPaths = props.result?.selectedPaths ?? []
  const command = props.result?.command
  const lastLog = props.logs.length ? props.logs[props.logs.length - 1] : null

  return (
    <div data-testid="classq-full-view" className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      {/* Top: Header + Stats + ActionPicker + Run button (horizontal toolbar) */}
      <div className="flex shrink-0 flex-col gap-3 @4xl/classq:flex-row @4xl/classq:items-center @4xl/classq:justify-between">
        <div className="flex min-w-0 flex-col gap-2 @4xl/classq:flex-row @4xl/classq:items-center">
          <HeaderLine actionMeta={props.actionMeta} status={props.status} subtitle={props.data.progressText || summaryText(props)} />
          <div data-testid="classq-header-toolbar" className="flex min-w-0 flex-wrap items-center gap-2">
            <ActionPicker action={props.action} disabled={props.running} triggerClassName="@4xl/classq:w-80" onActionChange={props.onActionChange} />
            <RunActionButton props={props} />
            <ActionIconButton disabled={props.running} icon={RotateCcw} label="清空状态" onClick={props.onReset} />
            <OptionsPopover data={props.data} disabled={props.running} onPatch={props.onPatch} />
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
        <ClassqStatsBar pending={pendingPaths.length} selected={selectedPaths.length} errors={props.result?.errors.length ?? 0} />
      </div>

      {/* Center: Dual-bin comparison */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 @5xl/classq:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.2fr)]">
        {/* Left bin: 待分拣 */}
        <section className="flex min-h-0 flex-col gap-2 overflow-hidden rounded-lg border bg-background/60 p-3">
          <div className="flex shrink-0 items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-sm font-semibold">
              <FolderInput className="size-4 text-muted-foreground" />
              待分拣
            </div>
            <Badge variant="outline" className="tabular-nums">{pendingPaths.length}</Badge>
          </div>
          <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] gap-2">
            <Textarea
              aria-label="classq 归档或目录"
              disabled={props.running}
              className="min-h-0 flex-1 resize-none font-mono text-xs"
              placeholder={"粘贴归档或目录路径，每行一条，例如：\nD:/Archives/pack1\nD:/Archives/pack2"}
              value={props.data.pathsText ?? ""}
              onChange={(event) => props.onPatch({ pathsText: event.currentTarget.value })}
            />
            <div className="flex shrink-0 items-center justify-between gap-2">
              <span className="truncate text-xs text-muted-foreground">每行一条路径，status 不需要路径。</span>
              <ActionIconButton disabled={props.running} icon={Clipboard} label="粘贴路径" onClick={props.onPastePaths} />
            </div>
          </div>
        </section>

        {/* Middle: Sort indicator */}
        <div className="flex items-center justify-center @5xl/classq:flex-col">
          <div className="grid size-10 shrink-0 place-items-center rounded-full border bg-background/80 text-muted-foreground shadow-sm">
            <ArrowRight className="size-5 @5xl/classq:rotate-0" />
          </div>
        </div>

        {/* Right bin: 已分拣 */}
        <section className="flex min-h-0 flex-col gap-2 overflow-hidden rounded-lg border bg-background/60 p-3">
          <div className="flex shrink-0 items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-sm font-semibold">
              <Folder className="size-4 text-muted-foreground" />
              已分拣
            </div>
            <Badge variant="outline" className="tabular-nums">{selectedPaths.length}</Badge>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            {selectedPaths.length ? (
              <div className="grid gap-1.5 p-1">
                {selectedPaths.map((path, index) => (
                  <div key={`${path}-${index}`} className="flex min-w-0 items-center gap-2 rounded-md border bg-background/70 px-2.5 py-2">
                    <Folder className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate font-mono text-xs" title={path}>{path}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex h-full min-h-24 items-center justify-center p-4 text-center text-xs text-muted-foreground">
                <span className="flex flex-col items-center gap-1.5">
                  <Folder className="size-4" />
                  <span className="font-medium text-foreground/80">等待分拣</span>
                  <span>运行生成计划或执行分类后，已分类的路径会显示在这里。</span>
                </span>
              </div>
            )}
          </ScrollArea>
        </section>
      </div>

      {/* Bottom: Command preview + Log tail (horizontal scroll) */}
      <div className="flex shrink-0 flex-col gap-2">
        <StatusStrip progress={props.progress} status={props.status} text={props.data.progressText} />
        <div className="flex items-stretch gap-2 overflow-x-auto rounded-md border bg-background/60 p-2">
          {command?.command ? (
            <div className="flex shrink-0 flex-col gap-1 rounded-md border bg-background/70 px-3 py-2">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                <span>命令预览</span>
              </div>
              <div className="font-mono text-xs" title={command.command}>{command.label}</div>
              <div className="truncate font-mono text-[11px] text-muted-foreground" title={command.args.join(" ")}>
                {command.command} {command.args.join(" ")}
              </div>
            </div>
          ) : null}
          {lastLog ? (
            <div className="flex shrink-0 flex-col gap-1 rounded-md border bg-background/70 px-3 py-2">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                <span>日志尾条</span>
              </div>
              <div className="font-mono text-xs text-muted-foreground">{lastLog}</div>
            </div>
          ) : null}
          {!command?.command && !lastLog ? (
            <div className="flex shrink-0 items-center gap-1.5 px-2 py-1.5 text-xs text-muted-foreground">
              命令预览和日志会在运行后显示在这里。
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function ClassqStatsBar(props: { pending: number; selected: number; errors: number }) {
  const stats = [
    ["待分拣", props.pending],
    ["已分拣", props.selected],
    ["错误", props.errors],
  ] as const
  return (
    <div data-testid="classq-stats-bar" className="grid shrink-0 grid-cols-3 gap-1">
      {stats.map(([label, value]) => (
        <div key={label} className="min-w-0 rounded-md bg-muted/35 px-2.5 py-1.5 text-center">
          <div className="truncate text-[11px] text-muted-foreground">{label}</div>
          <div className={cn("text-sm font-semibold tabular-nums", label === "错误" && Number(value) > 0 && "text-destructive")}>{value}</div>
        </div>
      ))}
    </div>
  )
}

function RunActionButton({ compact, props }: { compact?: boolean; props: ViewProps }) {
  if (props.running) {
    return (
      <Button aria-label="classq running" disabled size={compact ? "icon-sm" : "sm"} variant="secondary">
        <Square />
        {!compact && <span>运行中</span>}
      </Button>
    )
  }

  const label = actionLabel(props.action)
  const destructive = props.action === "run" && !(props.data.dryRun ?? true)
  if (destructive) {
    return (
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button aria-label={label} size={compact ? "icon-sm" : "sm"} variant="destructive">
            <Play />
            {!compact && <span>{label}</span>}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认执行分类？</AlertDialogTitle>
            <AlertDialogDescription>
              当前已关闭预演，会调用 ClassQ 模块按关键词分类文件夹，可能会移动或重命名归档目录。请确认配置文件和归档路径无误。
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
    <Button aria-label={label} disabled={props.running} size={compact ? "icon-sm" : "sm"} onClick={() => props.onExecute(props.action)}>
      <Play />
      {!compact && <span>{label}</span>}
    </Button>
  )
}

function HeaderLine({ actionMeta, status, subtitle }: {
  actionMeta: typeof ACTIONS[number]
  status: ClassqStatusMeta
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
            <h3 className="truncate text-sm font-semibold leading-none">{NODE_META.title}</h3>
            <Badge variant={status.badgeVariant}>{status.label}</Badge>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>
    </div>
  )
}

function buildInput(action: PackuToolAction, data: ClassqCardState, spec: PackuToolSpec): PackuToolInput {
  const pathsText = clean(data.pathsText)
  const argsText = clean(data.argsText)
  return {
    action,
    paths: pathsText ? pathsText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) : [],
    args: argsText ? argsText.split(/\s+/).filter(Boolean) : [],
    configPath: clean(data.configPath),
    databasePath: clean(data.databasePath),
    python: clean(data.python),
    sourceRoot: clean(data.sourceRoot) || spec.sourceRoot,
    moduleName: clean(data.moduleName) || spec.moduleName,
    dryRun: data.dryRun ?? true,
    recordRun: data.recordRun ?? false,
  }
}

function statusFromState(data: ClassqCardState, running: boolean): ClassqStatusMeta {
  if (running || data.phase === "running") {
    return {
      label: "运行中",
      description: data.progressText || "ClassQ 正在生成分类计划或调用模块。",
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
    description: "选择动作后查看配置、预览分类或执行分类。",
    tone: "idle",
    badgeVariant: "outline",
    iconClass: "bg-secondary text-secondary-foreground",
  }
}

function summaryText(props: ViewProps): string {
  if (props.data.progressText) return props.data.progressText
  if (props.result?.selectedPaths.length) {
    return `${props.result.selectedPaths.length} 路径 / ${props.result.errors.length} 错误`
  }
  return props.actionMeta.description
}

function actionLabel(action: PackuToolAction): string {
  return ACTIONS.find((item) => item.value === action)?.label ?? action
}

function clean(value: unknown): string | undefined {
  const text = String(value ?? "").trim()
  return text || undefined
}

function parsePaths(pathsText?: string): string[] {
  const text = clean(pathsText)
  if (!text) return []
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

function getHostData(host: NodeComponentProps<ClassqCardState>["host"], compId: string): ClassqCardState {
  return host.state?.getData?.() ?? host.getData<ClassqCardState>(compId) ?? {}
}

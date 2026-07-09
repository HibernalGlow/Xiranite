import { useEffect, useRef, useState } from "react"
import type { NodeComponentProps, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type { CommandResult, PackuCommandPlan, PackuIntegrationProfile, PackuToolAction, PackuToolData, PackuToolInput, PackuToolSpec } from "@xiranite/packu-node-runtime/core"
import { Clipboard, Eye, DatabaseZap, Play, RotateCcw, ScrollText, Square, Terminal } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import { RunningTint } from "@/nodes/shared/controls"
import { ACTIONS, NODE_META, type ClassfAction } from "./constants"
import {
  ActionIconButton,
  ActionPicker,
  ConfigDefaultsPopover,
  OptionsPopover,
  PathsInput,
  StatusStrip,
} from "./controls"
import type { ClassfCardState, ClassfStatusMeta } from "./types"
import { CONFIG_FIELDS } from "./types"

export function Component({ compId, host }: NodeComponentProps<ClassfCardState>) {
  const surface = useNodeSurface()
  const data = getHostData(host, compId)
  const dataRef = useRef<ClassfCardState>(data)
  dataRef.current = data

  const [running, setRunning] = useState(false)
  const [defaults, setDefaults] = useState<Partial<ClassfCardState> | undefined>(undefined)
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
    const loadConfig = host.config?.get?.<Partial<ClassfCardState>>() ?? host.getNodeConfig?.<Partial<ClassfCardState>>()
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

  function patch(patchData: Partial<ClassfCardState>) {
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
    const config: Partial<ClassfCardState> = {}
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
    const empty: Partial<ClassfCardState> = {}
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
    onActionChange: (value: ClassfAction) => patch({ action: value }),
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
      <div ref={surface.ref} className="@container/classf relative flex h-full min-h-0 w-full overflow-hidden">
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
  data: ClassfCardState
  defaults?: Partial<ClassfCardState>
  logs: string[]
  progress: number
  result: PackuToolData | null
  running: boolean
  status: ClassfStatusMeta
  onActionChange: (value: ClassfAction) => void
  onCopyLogs: () => void
  onCopyResults: () => void
  onExecute: (action?: PackuToolAction) => void
  onOpenConfigFile?: () => Promise<void> | void
  onPastePaths: () => void
  onPatch: (patch: Partial<ClassfCardState>) => void
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
    <div data-testid="classf-collapsed-view" className="relative flex h-full min-h-0 items-center gap-2 overflow-hidden rounded-xl border bg-background/85 px-3 py-2 shadow-sm">
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
    <div data-testid="classf-compact-view" className="flex min-h-0 flex-1 flex-col">
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
          <CompactTerminal logs={props.logs} result={props.result} running={props.running} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} />
        </div>
      </div>
    </div>
  )
}

function PortraitCompactView(props: ViewProps) {
  return (
    <div data-testid="classf-portrait-view" className="flex h-full min-h-0 flex-col gap-2 p-2">
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
        <CompactTerminal logs={props.logs} result={props.result} running={props.running} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} />
      </div>
    </div>
  )
}

function FullView(props: ViewProps) {
  return (
    <div data-testid="classf-full-view" className="flex min-h-0 flex-1 flex-col gap-2 p-3">
      {/* Top: Header + Stats + Actions toolbar */}
      <div data-testid="classf-header-toolbar" className="flex shrink-0 flex-col gap-2 @4xl/classf:flex-row @4xl/classf:items-center @4xl/classf:justify-between">
        <div className="flex min-w-0 flex-col gap-2 @4xl/classf:flex-row @4xl/classf:items-center">
          <HeaderLine actionMeta={props.actionMeta} status={props.status} subtitle={props.data.progressText || summaryText(props)} />
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <ActionPicker action={props.action} disabled={props.running} triggerClassName="@4xl/classf:w-72" onActionChange={props.onActionChange} />
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
        <StatsBar result={props.result} />
      </div>

      {/* Center: Command terminal panel (主角) */}
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-800 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-zinc-400">
            <Terminal className="size-3.5 shrink-0" />
            <span>命令终端</span>
            {props.running && (
              <span className="inline-flex items-center gap-1 text-emerald-400">
                <span className="inline-block size-1.5 animate-pulse rounded-full bg-emerald-400" />
                {props.progress}%
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant={props.status.badgeVariant} className="shrink-0">{props.status.label}</Badge>
            <Button disabled={!props.result?.command?.command} size="xs" variant="ghost" className="text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800" onClick={props.onCopyResults}>
              <Clipboard className="size-3" />
              复制
            </Button>
          </div>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <TerminalBody result={props.result} running={props.running} />
        </ScrollArea>
      </section>

      {/* Bottom: 3-column action bar */}
      <div className="grid shrink-0 grid-cols-1 gap-2 @3xl/classf:grid-cols-3">
        {/* Column 1: Path input */}
        <div className="flex min-w-0 flex-col gap-1.5 rounded-md border bg-background/60 p-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">路径输入</span>
            <ActionIconButton disabled={props.running} icon={Clipboard} label="粘贴路径" onClick={props.onPastePaths} />
          </div>
          <Textarea
            aria-label="classf 归档或目录"
            disabled={props.running}
            className="min-h-16 font-mono text-xs"
            placeholder={"每行一个归档或目录路径"}
            value={props.data.pathsText ?? ""}
            onChange={(event) => props.onPatch({ pathsText: event.currentTarget.value })}
          />
        </div>

        {/* Column 2: Runtime options */}
        <div className="flex min-w-0 flex-col gap-1.5 rounded-md border bg-background/60 p-2">
          <span className="text-xs font-medium text-muted-foreground">运行选项</span>
          <CompactSwitchRow
            checked={props.data.dryRun ?? true}
            disabled={props.running}
            icon={Eye}
            label="预演"
            onCheckedChange={(dryRun) => props.onPatch({ dryRun })}
          />
          <CompactSwitchRow
            checked={props.data.recordRun ?? false}
            disabled={props.running}
            icon={DatabaseZap}
            label="记录运行"
            onCheckedChange={(recordRun) => props.onPatch({ recordRun })}
          />
        </div>

        {/* Column 3: Log tail (recent 5) */}
        <div className="flex min-w-0 flex-col gap-1.5 rounded-md border bg-background/60 p-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">日志尾条</span>
            <Button disabled={!props.logs.length} size="xs" variant="ghost" onClick={props.onCopyLogs}>
              <Clipboard className="size-3" />
              复制
            </Button>
          </div>
          <LogTail logs={props.logs} />
        </div>
      </div>
    </div>
  )
}

function RunActionButton({ compact, props }: { compact?: boolean; props: ViewProps }) {
  if (props.running) {
    return (
      <Button aria-label="classf running" disabled size={compact ? "icon-sm" : "sm"} variant="secondary">
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
            <AlertDialogTitle>确认执行运行？</AlertDialogTitle>
            <AlertDialogDescription>
              当前已关闭预演，会调用 ClassF 模块执行真实分类运行，这一步可能产生不可撤销的改动。请确认配置文件、源码目录和归档路径无误。
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
  status: ClassfStatusMeta
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

function StatsBar({ result }: { result: PackuToolData | null }) {
  const stats = [
    { label: "选中", value: result?.selectedPaths.length ?? 0, tone: "default" as const },
    { label: "配置键", value: result?.config?.keys.length ?? 0, tone: "default" as const },
    { label: "错误", value: result?.errors.length ?? 0, tone: "error" as const },
  ]
  return (
    <div data-testid="classf-stats-bar" className="grid shrink-0 grid-cols-3 gap-1">
      {stats.map((stat) => (
        <div key={stat.label} className="min-w-0 rounded-md bg-muted/35 px-2 py-1 text-center">
          <div className="truncate text-[11px] text-muted-foreground">{stat.label}</div>
          <div className={cn("text-sm font-semibold tabular-nums", stat.tone === "error" && Number(stat.value) > 0 && "text-destructive")}>{stat.value}</div>
        </div>
      ))}
    </div>
  )
}

function TerminalBody({ result, running }: { result: PackuToolData | null; running: boolean }) {
  const command: PackuCommandPlan | undefined = result?.command
  const commandResult: CommandResult | undefined = result?.commandResult
  const integration: PackuIntegrationProfile | undefined = result?.integration
  const hasCommand = Boolean(command?.command)

  if (!hasCommand && !running) {
    return (
      <div className="flex h-full min-h-32 items-center justify-center p-6 text-center">
        <span className="flex flex-col items-center gap-2 text-zinc-500">
          <Terminal className="size-5" />
          <span className="font-medium text-zinc-400">等待命令</span>
          <span className="text-xs">运行计划或状态检查后会显示命令。</span>
        </span>
      </div>
    )
  }

  return (
    <div className="p-3 font-mono text-xs leading-relaxed">
      {/* Command line */}
      {command && (
        <div className="mb-3">
          <div className="flex items-start gap-2">
            <span className="shrink-0 select-none text-emerald-400">$</span>
            <div className="min-w-0 flex-1">
              <div className="break-all text-zinc-100">
                {command.command} {command.args.join(" ")}
              </div>
              {command.cwd && (
                <div className="mt-1 text-[11px] text-zinc-500">
                  cwd: {command.cwd}
                </div>
              )}
              {command.env && Object.keys(command.env).length > 0 && (
                <div className="mt-0.5 text-[11px] text-zinc-500">
                  env: {Object.entries(command.env).map(([key, value]) => `${key}=${value}`).join(" ")}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Command result */}
      {commandResult && (
        <div className="mb-3 border-t border-zinc-800 pt-3">
          <div className="mb-1 text-[11px] font-medium text-zinc-500">
            退出码 <span className={commandResult.code === 0 ? "text-emerald-400" : "text-red-400"}>{commandResult.code}</span>
          </div>
          {commandResult.stdout && (
            <pre className="mt-1 whitespace-pre-wrap break-all text-zinc-300">{commandResult.stdout}</pre>
          )}
          {commandResult.stderr && (
            <pre className="mt-1 whitespace-pre-wrap break-all text-red-400">{commandResult.stderr}</pre>
          )}
        </div>
      )}

      {/* Integration metadata */}
      {integration && (
        <div className="border-t border-zinc-800 pt-3">
          <div className="mb-1 text-[11px] font-medium text-zinc-500">集成信息</div>
          <div className="grid gap-0.5 text-[11px] text-zinc-400">
            <div>sourceRoot: {integration.sourceRoot}</div>
            <div>moduleName: {integration.moduleName}</div>
            {integration.configCandidates.length > 0 && (
              <div>configCandidates: {integration.configCandidates.join(", ")}</div>
            )}
            {integration.databasePath && (
              <div>databasePath: {integration.databasePath}</div>
            )}
            <div>recordRun: {integration.recordRun ? "是" : "否"}</div>
          </div>
        </div>
      )}

      {/* Errors */}
      {result?.errors && result.errors.length > 0 && (
        <div className="mt-3 border-t border-zinc-800 pt-3">
          <div className="mb-1 text-[11px] font-medium text-red-400">错误 ({result.errors.length})</div>
          {result.errors.map((error, index) => (
            <pre key={index} className="mt-1 whitespace-pre-wrap break-all text-red-400">{error}</pre>
          ))}
        </div>
      )}

      {running && (
        <div className="mt-3 flex items-center gap-2 text-emerald-400">
          <span className="inline-block size-1.5 animate-pulse rounded-full bg-emerald-400" />
          <span>运行中...</span>
        </div>
      )}
    </div>
  )
}

function CompactTerminal(props: {
  logs: string[]
  result: PackuToolData | null
  running?: boolean
  onCopyLogs: () => void
  onCopyResults: () => void
}) {
  const command = props.result?.command
  const hasCommand = Boolean(command?.command)
  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-800 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-zinc-400">
          <Terminal className="size-3.5 shrink-0" />
          <span>命令终端</span>
        </div>
        <Button disabled={!hasCommand} size="xs" variant="ghost" className="text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800" onClick={props.onCopyResults}>
          <Clipboard className="size-3" />
          复制
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {hasCommand && command ? (
          <div className="p-2 font-mono text-xs leading-relaxed">
            <div className="flex items-start gap-2">
              <span className="shrink-0 select-none text-emerald-400">$</span>
              <div className="min-w-0 flex-1 break-all text-zinc-100">
                {command.command} {command.args.join(" ")}
              </div>
            </div>
            {props.result?.commandResult?.stderr && (
              <pre className="mt-1 whitespace-pre-wrap break-all text-red-400">{props.result.commandResult.stderr}</pre>
            )}
            {props.result?.errors && props.result.errors.length > 0 && (
              <pre className="mt-1 whitespace-pre-wrap break-all text-red-400">{props.result.errors.join("\n")}</pre>
            )}
          </div>
        ) : (
          <div className="flex h-full min-h-20 items-center justify-center p-3 text-center">
            <span className="flex flex-col items-center gap-1 text-zinc-500">
              <Terminal className="size-4" />
              <span className="text-xs">等待命令</span>
            </span>
          </div>
        )}
        {props.logs.length > 0 && (
          <div className="border-t border-zinc-800 p-2">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="flex items-center gap-1 text-[11px] text-zinc-500">
                <ScrollText className="size-3" />
                日志 ({props.logs.length})
              </span>
              <Button disabled={!props.logs.length} size="xs" variant="ghost" className="text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800" onClick={props.onCopyLogs}>
                <Clipboard className="size-3" />
              </Button>
            </div>
            <pre className="whitespace-pre-wrap break-all text-[11px] text-zinc-400">
              {props.logs.slice(-8).join("\n")}
            </pre>
          </div>
        )}
      </ScrollArea>
    </section>
  )
}

function CompactSwitchRow(props: {
  checked: boolean
  disabled?: boolean
  icon: typeof Eye
  label: string
  onCheckedChange: (checked: boolean) => void
}) {
  const Icon = props.icon
  return (
    <label className="flex min-w-0 items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-1.5">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-xs font-medium">{props.label}</span>
      </span>
      <Switch checked={props.checked} disabled={props.disabled} size="sm" onCheckedChange={props.onCheckedChange} />
    </label>
  )
}

function LogTail({ logs }: { logs: string[] }) {
  const tail = logs.slice(-5)
  if (tail.length === 0) {
    return (
      <div className="flex min-h-16 items-center justify-center text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <ScrollText className="size-3.5" />
          暂无日志
        </span>
      </div>
    )
  }
  return (
    <ScrollArea className="min-h-16 max-h-24">
      <pre className="whitespace-pre-wrap break-all p-1 font-mono text-[11px] leading-4 text-muted-foreground">
        {tail.join("\n")}
      </pre>
    </ScrollArea>
  )
}

function buildInput(action: PackuToolAction, data: ClassfCardState, spec: PackuToolSpec): PackuToolInput {
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

function statusFromState(data: ClassfCardState, running: boolean): ClassfStatusMeta {
  if (running || data.phase === "running") {
    return {
      label: "运行中",
      description: data.progressText || "ClassF 正在编排分类流程。",
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
      description: data.progressText || "上次任务失败，请查看终端。",
      tone: "error",
      badgeVariant: "destructive",
      iconClass: "bg-destructive text-destructive-foreground",
    }
  }
  return {
    label: "就绪",
    description: "选择动作后查看状态、生成计划或执行运行。",
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

function getHostData(host: NodeComponentProps<ClassfCardState>["host"], compId: string): ClassfCardState {
  return host.state?.getData?.() ?? host.getData<ClassfCardState>(compId) ?? {}
}

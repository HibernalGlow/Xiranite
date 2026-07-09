import { useEffect, useRef, useState } from "react"
import type { NodeComponentProps, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type { CommandResult, PackuCommandPlan, PackuIntegrationProfile, PackuToolAction, PackuToolData, PackuToolInput, PackuToolSpec } from "@xiranite/packu-node-runtime/core"
import { Clipboard, DatabaseZap, Eye, FileText, Languages, Play, RotateCcw, ScrollText, Square, Terminal } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import { RunningTint } from "@/nodes/shared/controls"
import { ACTIONS, NODE_META, type TransqAction } from "./constants"
import {
  ActionIconButton,
  ActionPicker,
  ConfigDefaultsPopover,
  OptionsPopover,
  PathsInput,
  StatusStrip,
} from "./controls"
import type { TransqCardState, TransqStatusMeta } from "./types"
import { CONFIG_FIELDS } from "./types"

export function Component({ compId, host }: NodeComponentProps<TransqCardState>) {
  const surface = useNodeSurface()
  const data = getHostData(host, compId)
  const dataRef = useRef<TransqCardState>(data)
  dataRef.current = data

  const [running, setRunning] = useState(false)
  const [defaults, setDefaults] = useState<Partial<TransqCardState> | undefined>(undefined)
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
    const loadConfig = host.config?.get?.<Partial<TransqCardState>>() ?? host.getNodeConfig?.<Partial<TransqCardState>>()
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

  function patch(patchData: Partial<TransqCardState>) {
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
    const config: Partial<TransqCardState> = {}
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
    const empty: Partial<TransqCardState> = {}
    for (const field of CONFIG_FIELDS) empty[field] = undefined
    patch(empty)
  }

  async function execute(nextAction: PackuToolAction = action) {
    if (running) return
    const current = dataRef.current

    if (nextAction !== "status" && !clean(current.pathsText)) {
      const message = "请先输入至少一个翻译文件路径。"
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
    onActionChange: (value: TransqAction) => patch({ action: value }),
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
      <div ref={surface.ref} className="@container/transq relative flex h-full min-h-0 w-full overflow-hidden">
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
  data: TransqCardState
  defaults?: Partial<TransqCardState>
  logs: string[]
  progress: number
  result: PackuToolData | null
  running: boolean
  status: TransqStatusMeta
  onActionChange: (value: TransqAction) => void
  onCopyLogs: () => void
  onCopyResults: () => void
  onExecute: (action?: PackuToolAction) => void
  onOpenConfigFile?: () => Promise<void> | void
  onPastePaths: () => void
  onPatch: (patch: Partial<TransqCardState>) => void
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
    <div data-testid="transq-collapsed-view" className="relative flex h-full min-h-0 items-center gap-2 overflow-hidden rounded-xl border bg-background/85 px-3 py-2 shadow-sm">
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
    <div data-testid="transq-compact-view" className="flex min-h-0 flex-1 flex-col">
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
          <CompactQueueConsole logs={props.logs} result={props.result} running={props.running} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} />
        </div>
      </div>
    </div>
  )
}

function PortraitCompactView(props: ViewProps) {
  return (
    <div data-testid="transq-portrait-view" className="flex h-full min-h-0 flex-col gap-2 p-2">
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
        <CompactQueueConsole logs={props.logs} result={props.result} running={props.running} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} />
      </div>
    </div>
  )
}

function FullView(props: ViewProps) {
  return (
    <div data-testid="transq-full-view" className="flex min-h-0 flex-1 flex-col gap-2 p-3">
      {/* Top: Header + Stats + Actions toolbar */}
      <div data-testid="transq-header-toolbar" className="flex shrink-0 flex-col gap-2 @4xl/transq:flex-row @4xl/transq:items-center @4xl/transq:justify-between">
        <div className="flex min-w-0 flex-col gap-2 @4xl/transq:flex-row @4xl/transq:items-center">
          <HeaderLine actionMeta={props.actionMeta} status={props.status} subtitle={props.data.progressText || summaryText(props)} />
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <ActionPicker action={props.action} disabled={props.running} triggerClassName="@4xl/transq:w-72" onActionChange={props.onActionChange} />
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

      {/* Queue Board: horizontal card row showing selectedPaths as queue items */}
      <QueueBoard result={props.result} running={props.running} progress={props.progress} />

      {/* Middle dual-column: left = path input + runtime options, right = command preview terminal */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 @3xl/transq:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        {/* Left column: Path input + runtime options */}
        <div className="flex min-h-0 flex-col gap-2 overflow-auto pr-1">
          <PathsInput data={props.data} disabled={props.running} onPaste={props.onPastePaths} onPatch={props.onPatch} />
          <div className="grid gap-2 @2xl/transq:grid-cols-2">
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
          <OptionsPopover data={props.data} disabled={props.running} onPatch={props.onPatch} />
        </div>

        {/* Right column: Command preview terminal + integration metadata */}
        <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-800 px-3 py-2">
            <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-zinc-400">
              <Terminal className="size-3.5 shrink-0" />
              <span>命令预览</span>
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
            <CommandPreviewBody result={props.result} running={props.running} />
          </ScrollArea>
        </section>
      </div>

      {/* Bottom: Log tail strip (horizontal) */}
      <LogStrip logs={props.logs} onCopyLogs={props.onCopyLogs} />
    </div>
  )
}

function RunActionButton({ compact, props }: { compact?: boolean; props: ViewProps }) {
  if (props.running) {
    return (
      <Button aria-label="transq running" disabled size={compact ? "icon-sm" : "sm"} variant="secondary">
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
            <AlertDialogTitle>确认整理队列？</AlertDialogTitle>
            <AlertDialogDescription>
              当前已关闭预演，会调用 TransQ 模块执行真实队列整理，这一步可能产生不可撤销的改动。请确认配置文件、源码目录和翻译文件路径无误。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => props.onExecute(props.action)}>确认整理</AlertDialogAction>
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
  status: TransqStatusMeta
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
    { label: "队列", value: result?.selectedPaths.length ?? 0, tone: "default" as const },
    { label: "配置键", value: result?.config?.keys.length ?? 0, tone: "default" as const },
    { label: "错误", value: result?.errors.length ?? 0, tone: "error" as const },
  ]
  return (
    <div data-testid="transq-stats-bar" className="grid shrink-0 grid-cols-3 gap-1">
      {stats.map((stat) => (
        <div key={stat.label} className="min-w-0 rounded-md bg-muted/35 px-2 py-1 text-center">
          <div className="truncate text-[11px] text-muted-foreground">{stat.label}</div>
          <div className={cn("text-sm font-semibold tabular-nums", stat.tone === "error" && Number(stat.value) > 0 && "text-destructive")}>{stat.value}</div>
        </div>
      ))}
    </div>
  )
}

function QueueBoard({ result, running, progress }: { result: PackuToolData | null; running: boolean; progress: number }) {
  const items = result?.selectedPaths ?? []
  const errors = result?.errors ?? []

  return (
    <section data-testid="transq-queue-board" className="flex shrink-0 flex-col gap-1.5 rounded-lg border bg-background/60 p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Languages className="size-3.5" />
          <span>队列</span>
          {items.length > 0 && <Badge variant="secondary" className="text-[10px]">{items.length}</Badge>}
        </div>
        {running && (
          <span className="text-[11px] tabular-nums text-muted-foreground">{progress}%</span>
        )}
      </div>
      {items.length === 0 ? (
        <div className="flex min-h-12 items-center gap-2 px-2 text-xs text-muted-foreground">
          <FileText className="size-3.5 shrink-0" />
          <span>{running ? "正在整理队列..." : "生成计划或执行后，翻译文件会在此以卡片形式排列。"}</span>
        </div>
      ) : (
        <ScrollArea className="w-full">
          <div className="flex gap-2 pb-1">
            {items.map((path, index) => {
              const fileName = path.split(/[/\\]/).pop() ?? path
              const hasError = errors.some((err) => err.includes(path) || err.includes(fileName))
              return (
                <div
                  key={`${path}-${index}`}
                  className={cn(
                    "flex w-40 shrink-0 flex-col gap-1 rounded-md border p-2",
                    hasError ? "border-destructive/40 bg-destructive/5" : "border-border bg-background/70",
                  )}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="grid size-5 shrink-0 place-items-center rounded bg-primary/10 text-[10px] font-semibold tabular-nums text-primary">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    {hasError ? (
                      <Badge variant="destructive" className="h-4 px-1 text-[9px]">错误</Badge>
                    ) : (
                      <Badge variant="outline" className="h-4 px-1 text-[9px]">待整理</Badge>
                    )}
                  </div>
                  <div className="truncate font-mono text-[11px] leading-tight" title={path}>
                    {fileName}
                  </div>
                  <div className="truncate text-[9px] text-muted-foreground" title={path}>
                    {path}
                  </div>
                </div>
              )
            })}
          </div>
        </ScrollArea>
      )}
    </section>
  )
}

function CommandPreviewBody({ result, running }: { result: PackuToolData | null; running: boolean }) {
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

function CompactQueueConsole(props: {
  logs: string[]
  result: PackuToolData | null
  running?: boolean
  onCopyLogs: () => void
  onCopyResults: () => void
}) {
  const command = props.result?.command
  const hasCommand = Boolean(command?.command)
  const items = props.result?.selectedPaths ?? []
  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-800 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-zinc-400">
          <Terminal className="size-3.5 shrink-0" />
          <span>队列</span>
          {items.length > 0 && <span className="text-[10px] text-zinc-500">({items.length})</span>}
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
    <label className="flex min-w-0 items-center justify-between gap-2 rounded-md border bg-background/60 p-2">
      <span className="flex min-w-0 items-center gap-1.5">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-xs font-medium">{props.label}</span>
      </span>
      <Switch checked={props.checked} disabled={props.disabled} size="sm" onCheckedChange={props.onCheckedChange} />
    </label>
  )
}

function LogStrip({ logs, onCopyLogs }: { logs: string[]; onCopyLogs: () => void }) {
  const tail = logs.slice(-6)
  return (
    <div className="flex shrink-0 items-center gap-2 rounded-md border bg-background/60 px-2 py-1.5">
      <div className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-muted-foreground">
        <ScrollText className="size-3" />
        <span>日志</span>
      </div>
      <ScrollArea className="min-w-0 flex-1">
        <pre className="whitespace-pre-wrap break-all px-1 font-mono text-[11px] leading-4 text-muted-foreground">
          {tail.length > 0 ? tail.join("\n") : "暂无日志"}
        </pre>
      </ScrollArea>
      <Button disabled={!logs.length} size="xs" variant="ghost" className="shrink-0" onClick={onCopyLogs}>
        <Clipboard className="size-3" />
      </Button>
    </div>
  )
}

function buildInput(action: PackuToolAction, data: TransqCardState, spec: PackuToolSpec): PackuToolInput {
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

function statusFromState(data: TransqCardState, running: boolean): TransqStatusMeta {
  if (running || data.phase === "running") {
    return {
      label: "运行中",
      description: data.progressText || "TransQ 正在整理翻译队列。",
      tone: "running",
      badgeVariant: "secondary",
      iconClass: "bg-primary text-primary-foreground",
    }
  }
  if (data.phase === "completed") {
    return {
      label: "完成",
      description: data.progressText || "上次队列整理已完成。",
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
    description: "选择动作后查看配置、预览整理或执行队列整理。",
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

function getHostData(host: NodeComponentProps<TransqCardState>["host"], compId: string): TransqCardState {
  return host.state?.getData?.() ?? host.getData<TransqCardState>(compId) ?? {}
}

import { useEffect, useRef, useState } from "react"
import type { NodeComponentProps, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type { PackuToolAction, PackuToolData, PackuToolInput, PackuToolSpec } from "@xiranite/packu-node-runtime/core"
import type { CommandResult, PackuCommandPlan } from "@xiranite/packu-node-runtime/core"
import type { LucideIcon } from "lucide-react"
import { Clipboard, Copy, DatabaseZap, Eye, FileVideo, Info, Play, RotateCcw, ScrollText, Settings2, Square, Terminal, Volume2 } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import { RunningTint } from "@/nodes/shared/controls"
import { ACTIONS, NODE_META, type AudiovAction } from "./constants"
import type { AudiovCardState, AudiovStatusMeta } from "./types"
import { CONFIG_FIELDS } from "./types"

export function Component({ compId, host }: NodeComponentProps<AudiovCardState>) {
  const surface = useNodeSurface()
  const data = getHostData(host, compId)
  const dataRef = useRef<AudiovCardState>(data)
  dataRef.current = data

  const [running, setRunning] = useState(false)
  const [defaults, setDefaults] = useState<Partial<AudiovCardState> | undefined>(undefined)
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
    const loadConfig = host.config?.get?.<Partial<AudiovCardState>>() ?? host.getNodeConfig?.<Partial<AudiovCardState>>()
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

  function patch(patchData: Partial<AudiovCardState>) {
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
    const config: Partial<AudiovCardState> = {}
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
    const empty: Partial<AudiovCardState> = {}
    for (const field of CONFIG_FIELDS) empty[field] = undefined
    patch(empty)
  }

  async function execute(nextAction: PackuToolAction = action) {
    if (running) return
    const current = dataRef.current

    if (nextAction !== "status" && !clean(current.pathsText)) {
      const message = "请先输入至少一个视频文件路径。"
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
    onActionChange: (value: AudiovAction) => patch({ action: value }),
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
      <div ref={surface.ref} className="@container/audiov relative flex h-full min-h-0 w-full overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(circle_at_14%_0%,color-mix(in_oklch,var(--chart-3)_16%,transparent),transparent_38%),radial-gradient(circle_at_88%_6%,color-mix(in_oklch,var(--primary)_12%,transparent),transparent_32%)]" />
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
  data: AudiovCardState
  defaults?: Partial<AudiovCardState>
  logs: string[]
  progress: number
  result: PackuToolData | null
  running: boolean
  status: AudiovStatusMeta
  onActionChange: (value: AudiovAction) => void
  onCopyLogs: () => void
  onCopyResults: () => void
  onExecute: (action?: PackuToolAction) => void
  onOpenConfigFile?: () => Promise<void> | void
  onPastePaths: () => void
  onPatch: (patch: Partial<AudiovCardState>) => void
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
    <div data-testid="audiov-collapsed-view" className="relative flex h-full min-h-0 items-center gap-2 overflow-hidden rounded-xl border bg-background/85 px-3 py-2 shadow-sm">
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
    <div data-testid="audiov-compact-view" className="flex min-h-0 flex-1 flex-col">
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
        <div className="grid min-h-0 flex-1 gap-2 @3xl/audiov:grid-cols-2">
          <CommandPreview compact result={props.result} running={props.running} onCopy={props.onCopyResults} />
          <OutputConsole compact logs={props.logs} running={props.running} onCopy={props.onCopyLogs} />
        </div>
      </div>
    </div>
  )
}

function PortraitCompactView(props: ViewProps) {
  return (
    <div data-testid="audiov-portrait-view" className="flex h-full min-h-0 flex-col gap-2 p-2">
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
      <div className="grid min-h-0 flex-1 gap-2">
        <CommandPreview compact result={props.result} running={props.running} onCopy={props.onCopyResults} />
        <OutputConsole compact logs={props.logs} running={props.running} onCopy={props.onCopyLogs} />
      </div>
    </div>
  )
}

function FullView(props: ViewProps) {
  return (
    <div data-testid="audiov-full-view" className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      {/* 顶部: Header + Stats + ActionPicker */}
      <div className="flex shrink-0 flex-col gap-3 @4xl/audiov:flex-row @4xl/audiov:items-center @4xl/audiov:justify-between">
        <div className="flex min-w-0 flex-col gap-2 @4xl/audiov:flex-row @4xl/audiov:items-center">
          <HeaderLine actionMeta={props.actionMeta} status={props.status} subtitle={props.data.progressText || summaryText(props)} />
          <div data-testid="audiov-header-toolbar" className="flex min-w-0 flex-wrap items-center gap-2">
            <ActionPicker action={props.action} disabled={props.running} triggerClassName="@4xl/audiov:w-72" onActionChange={props.onActionChange} />
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
        <AudiovStatsPanel result={props.result} />
      </div>

      {/* 中央三栏: 视频路径 | 命令预览 (主角) | 输出 */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 @4xl/audiov:grid-cols-[minmax(220px,260px)_minmax(0,1fr)_minmax(220px,260px)]">
        <PathsColumn data={props.data} disabled={props.running} onPaste={props.onPastePaths} onPatch={props.onPatch} />
        <CommandPreview result={props.result} running={props.running} onCopy={props.onCopyResults} />
        <OutputConsole logs={props.logs} running={props.running} onCopy={props.onCopyLogs} />
      </div>

      {/* 底部: 运行闸门 (预演/真实切换 + 执行按钮) + 配置选项 */}
      <RunGate props={props} />
    </div>
  )
}

function PathsColumn(props: {
  data: AudiovCardState
  disabled?: boolean
  onPaste: () => void
  onPatch: (patch: Partial<AudiovCardState>) => void
}) {
  return (
    <section className="flex min-h-0 flex-col gap-2 overflow-hidden rounded-lg border bg-background/60">
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2">
        <div className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <FileVideo className="size-3.5" />
          <span>视频路径</span>
        </div>
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">每行一条</span>
      </div>
      <Separator className="shrink-0" />
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 p-2">
        <Textarea
          id="audiov-paths"
          aria-label="audiov 视频路径"
          disabled={props.disabled}
          className="min-h-0 flex-1 resize-none font-mono text-xs leading-5"
          placeholder={"粘贴视频文件路径，例如：\nD:/Video/clip1.mp4\nD:/Video/clip2.mkv"}
          value={props.data.pathsText ?? ""}
          onChange={(event) => props.onPatch({ pathsText: event.currentTarget.value })}
        />
        <Button disabled={props.disabled} size="xs" variant="outline" onClick={props.onPaste}>
          <Clipboard data-icon="inline-start" />
          粘贴路径
        </Button>
      </div>
    </section>
  )
}

function CommandPreview(props: {
  compact?: boolean
  result: PackuToolData | null
  running?: boolean
  onCopy: () => void
}) {
  const command: PackuCommandPlan | undefined = props.result?.command
  const commandResult: CommandResult | undefined = props.result?.commandResult
  const hasCommand = Boolean(command?.command)
  const status = commandResult ? (commandResult.code === 0 ? "success" : "error") : hasCommand ? "planned" : "idle"

  return (
    <section
      data-testid="audiov-command-preview"
      className="relative flex min-h-0 flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 text-zinc-100 shadow-inner"
    >
      {/* 终端风格顶栏 */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-800 bg-zinc-900/80 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="size-2 rounded-full bg-rose-500/80" />
          <span className="size-2 rounded-full bg-amber-500/80" />
          <span className="size-2 rounded-full bg-emerald-500/80" />
          <Terminal className="ml-1 size-3.5 text-zinc-400" />
          <span className="truncate text-xs font-semibold text-zinc-200">命令预览</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {hasCommand && (
            <Badge
              variant={status === "error" ? "destructive" : status === "success" ? "default" : "outline"}
              className="shrink-0"
            >
              {status === "planned" && "待执行"}
              {status === "success" && "成功"}
              {status === "error" && "失败"}
            </Badge>
          )}
          <Button disabled={!hasCommand} size="xs" variant="ghost" className="text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100" onClick={props.onCopy}>
            <Copy data-icon="inline-start" />
            复制
          </Button>
        </div>
      </div>

      {/* 命令主体 - 大字体显示，像时间线/命令行 */}
      <ScrollArea className="min-h-0 flex-1">
        {hasCommand && command ? (
          <div className={props.compact ? "flex flex-col gap-2 p-2.5" : "flex flex-col gap-3 p-4"}>
            {/* 命令行 - 主角 */}
            <div className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0 font-mono text-sm text-emerald-400">▶</span>
              <div className="min-w-0 flex-1">
                <div
                  className={cn(
                    "break-all font-mono leading-relaxed text-zinc-100",
                    props.compact ? "text-sm" : "text-base @3xl/audiov:text-lg",
                  )}
                >
                  <span className="text-emerald-400">{command.command}</span>
                  <span className="text-zinc-400"> </span>
                  <span className="text-sky-300">{command.args.join(" ")}</span>
                </div>
              </div>
            </div>

            {/* 时间线分隔 */}
            <div className="flex items-center gap-2 text-[10px] text-zinc-500">
              <span className="h-px flex-1 bg-gradient-to-r from-emerald-500/40 via-zinc-700 to-transparent" />
              <Volume2 className="size-3" />
              <span className="h-px flex-1 bg-gradient-to-l from-sky-500/30 via-zinc-700 to-transparent" />
            </div>

            {/* 命令详情 */}
            <div className="grid gap-1 font-mono text-[11px] text-zinc-400">
              <div className="flex min-w-0 gap-2">
                <span className="shrink-0 text-zinc-600">label</span>
                <span className="truncate text-zinc-300" title={command.label}>{command.label}</span>
              </div>
              {command.cwd && (
                <div className="flex min-w-0 gap-2">
                  <span className="shrink-0 text-zinc-600">cwd</span>
                  <span className="truncate text-zinc-300" title={command.cwd}>{command.cwd}</span>
                </div>
              )}
              {command.env && Object.keys(command.env).length > 0 && (
                <div className="flex min-w-0 gap-2">
                  <span className="shrink-0 text-zinc-600">env</span>
                  <span className="truncate text-zinc-300" title={JSON.stringify(command.env)}>
                    {Object.entries(command.env).map(([k, v]) => `${k}=${v}`).join(" ")}
                  </span>
                </div>
              )}
            </div>

            {/* 执行结果 */}
            {commandResult?.stdout && (
              <pre className="overflow-auto rounded border border-zinc-800 bg-zinc-900/60 p-2 font-mono text-[11px] leading-5 text-zinc-300">
                {commandResult.stdout}
              </pre>
            )}
            {commandResult?.stderr && (
              <pre className="overflow-auto rounded border border-rose-900/50 bg-rose-950/30 p-2 font-mono text-[11px] leading-5 text-rose-300">
                {commandResult.stderr}
              </pre>
            )}
          </div>
        ) : (
          <div className={props.compact ? "flex h-full min-h-20 flex-col items-center justify-center gap-1.5 p-4 text-center" : "flex h-full min-h-28 flex-col items-center justify-center gap-2 p-6 text-center"}>
            <Volume2 className="text-zinc-600" />
            <div className="text-xs font-medium text-zinc-400">等待 ffmpeg 命令</div>
            <div className="text-[11px] text-zinc-600">运行生成计划后会显示音轨提取命令。</div>
          </div>
        )}
      </ScrollArea>

      {/* 波形装饰条 */}
      {props.running && (
        <div className="flex h-1.5 shrink-0 items-end gap-0.5 bg-zinc-900/80 px-2 py-0.5" aria-hidden="true">
          {Array.from({ length: 48 }).map((_, i) => (
            <span
              key={i}
              className="flex-1 animate-pulse bg-emerald-400/70"
              style={{
                height: `${20 + Math.abs(Math.sin(i * 0.7 + Date.now() / 400)) * 80}%`,
                animationDelay: `${i * 40}ms`,
              }}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function OutputConsole(props: {
  compact?: boolean
  logs: string[]
  running?: boolean
  onCopy: () => void
}) {
  return (
    <section
      data-testid="audiov-output-console"
      className="flex min-h-0 flex-col overflow-hidden rounded-lg border bg-background/60"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2">
        <div className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <ScrollText className="size-3.5" />
          <span>输出</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {props.logs.length > 0 && (
            <span className="text-[10px] tabular-nums text-muted-foreground/70">{props.logs.length} 行</span>
          )}
          <Button disabled={!props.logs.length} size="xs" variant="ghost" onClick={props.onCopy}>
            <Copy data-icon="inline-start" />
            复制
          </Button>
        </div>
      </div>
      <Separator className="shrink-0" />
      <ScrollArea className="min-h-0 flex-1">
        {props.logs.length ? (
          <pre className={props.compact ? "whitespace-pre-wrap p-2 font-mono text-[11px] leading-5 text-muted-foreground" : "whitespace-pre-wrap p-3 font-mono text-[11px] leading-5 text-muted-foreground"}>
            {props.logs.join("\n")}
          </pre>
        ) : (
          <div className={props.compact ? "flex h-full min-h-20 items-center justify-center p-3 text-center text-[11px] text-muted-foreground" : "flex h-full min-h-28 items-center justify-center p-6 text-center text-xs text-muted-foreground"}>
            <span className="flex flex-col items-center gap-1.5">
              <ScrollText className="size-4" />
              <span>运行日志会显示在这里。</span>
            </span>
          </div>
        )}
      </ScrollArea>
    </section>
  )
}

function RunGate({ props }: { props: ViewProps }) {
  const dryRun = props.data.dryRun ?? true
  return (
    <div
      data-testid="audiov-run-gate"
      className="flex shrink-0 flex-col gap-2 rounded-lg border bg-background/60 p-2 @md/audiov:flex-row @md/audiov:items-center @md/audiov:gap-3"
    >
      <div className="min-w-0 flex-1">
        <StatusStrip progress={props.progress} status={props.status} text={props.data.progressText} />
      </div>
      <Separator className="@md/audiov:hidden" />
      <div className="flex shrink-0 items-center gap-2">
        <div className="flex items-center gap-1.5 rounded-md border bg-background/70 px-2 py-1">
          {dryRun ? <Eye className="size-3.5 text-muted-foreground" /> : <Play className="size-3.5 text-destructive" />}
          <span className="text-[11px] font-medium text-muted-foreground">{dryRun ? "预演" : "真实"}</span>
          <Switch
            aria-label="audiov 预演切换"
            checked={dryRun}
            disabled={props.running}
            size="sm"
            onCheckedChange={(checked) => props.onPatch({ dryRun: checked })}
          />
        </div>
        <OptionsPopover data={props.data} disabled={props.running} onPatch={props.onPatch} />
        <RunActionButton props={props} />
      </div>
    </div>
  )
}

function RunActionButton({ compact, props }: { compact?: boolean; props: ViewProps }) {
  if (props.running) {
    return (
      <Button aria-label="audiov running" disabled size={compact ? "icon-sm" : "sm"} variant="secondary">
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
            <AlertDialogTitle>确认提取音轨？</AlertDialogTitle>
            <AlertDialogDescription>
              当前已关闭预演，会调用 PackU AudioV 的 ffmpeg 边界执行真实音轨提取，这一步会从视频中分离并写入音轨文件。请确认视频路径、ffmpeg 可执行文件和输出目录无误。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => props.onExecute(props.action)}>确认提取</AlertDialogAction>
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
  status: AudiovStatusMeta
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

function AudiovStatsPanel({ result }: { result: PackuToolData | null }) {
  const stats = [
    ["视频", result?.selectedPaths.length ?? 0],
    ["配置项", result?.config?.keys.length ?? 0],
    ["错误", result?.errors.length ?? 0],
  ] as const

  return (
    <div data-testid="audiov-stats-panel" className="grid shrink-0 grid-cols-3 gap-1">
      {stats.map(([label, value]) => (
        <div key={label} className="min-w-0 rounded-md bg-muted/35 px-2 py-1.5 text-center">
          <div className="truncate text-[11px] text-muted-foreground">{label}</div>
          <div className={cn("text-sm font-semibold tabular-nums", label === "错误" && Number(value) > 0 && "text-destructive")}>{value}</div>
        </div>
      ))}
    </div>
  )
}

function ActionPicker(props: {
  action: AudiovAction
  disabled?: boolean
  triggerClassName?: string
  onActionChange: (action: AudiovAction) => void
}) {
  return (
    <ToggleGroup
      aria-label="audiov action"
      className={cn("grid w-full grid-cols-3", props.triggerClassName)}
      disabled={props.disabled}
      size="sm"
      type="single"
      value={props.action}
      variant="outline"
      onValueChange={(value) => {
        if (value) props.onActionChange(value as AudiovAction)
      }}
    >
      {ACTIONS.map((item) => (
        <ToggleGroupItem key={item.value} aria-label={item.label} className="min-w-0" value={item.value}>
          <item.icon data-icon="inline-start" />
          <span className="truncate">{item.shortLabel}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

function PathsInput(props: {
  compact?: boolean
  data: AudiovCardState
  disabled?: boolean
  onPaste: () => void
  onPatch: (patch: Partial<AudiovCardState>) => void
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {props.compact ? (
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-1.5">
          <Input
            id="audiov-paths-compact"
            aria-label="audiov 视频路径"
            disabled={props.disabled}
            className="font-mono text-xs"
            placeholder="每行一个视频文件路径"
            value={props.data.pathsText ?? ""}
            onChange={(event) => props.onPatch({ pathsText: event.currentTarget.value })}
          />
          <ActionIconButton disabled={props.disabled} icon={Clipboard} label="粘贴路径" onClick={props.onPaste} />
        </div>
      ) : (
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-1.5">
          <Textarea
            id="audiov-paths-compact"
            aria-label="audiov 视频路径"
            disabled={props.disabled}
            className="min-h-20 font-mono text-xs"
            placeholder={"每行一个视频文件路径，例如：\nD:/Video/clip1.mp4\nD:/Video/clip2.mkv"}
            value={props.data.pathsText ?? ""}
            onChange={(event) => props.onPatch({ pathsText: event.currentTarget.value })}
          />
          <ActionIconButton disabled={props.disabled} icon={Clipboard} label="粘贴路径" onClick={props.onPaste} />
        </div>
      )}
    </div>
  )
}

function ActionIconButton(props: {
  active?: boolean
  destructive?: boolean
  disabled?: boolean
  icon: LucideIcon
  label: string
  onClick: () => void
}) {
  const Icon = props.icon
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={props.label}
          disabled={props.disabled}
          size="icon-sm"
          variant={props.destructive ? "destructive" : props.active ? "secondary" : "outline"}
          onClick={props.onClick}
        >
          <Icon />
          <span className="sr-only">{props.label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{props.label}</TooltipContent>
    </Tooltip>
  )
}

function StatusStrip(props: {
  compact?: boolean
  progress: number
  status: AudiovStatusMeta
  text?: string
}) {
  return (
    <div className={cn("rounded-md border bg-background/70 p-2", props.compact && "p-1.5")}>
      <div className="mb-1 flex min-w-0 items-center justify-between gap-2">
        <div className="truncate text-xs font-medium">{props.text || props.status.description}</div>
        <Badge variant={props.status.badgeVariant} className="shrink-0">{props.status.label}</Badge>
      </div>
      <Progress value={props.progress} className={cn("h-1.5", props.status.tone === "error" && "bg-destructive/20")} />
    </div>
  )
}

function OptionsPopover(props: {
  data: AudiovCardState
  disabled?: boolean
  onPatch: (patch: Partial<AudiovCardState>) => void
}) {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button aria-label="audiov 运行选项" disabled={props.disabled} size="icon-sm" variant="outline">
              <Settings2 />
              <span className="sr-only">运行选项</span>
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>运行选项</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-[min(92vw,460px)]">
        <div className="mb-3">
          <div className="text-sm font-semibold">运行选项</div>
          <p className="text-xs text-muted-foreground">配置文件、记录路径、Python、源码目录集中在这里。</p>
        </div>
        <div className="grid gap-3">
          <PathFields {...props} />
          <RuntimeOptions {...props} />
        </div>
      </PopoverContent>
    </Popover>
  )
}

function PathFields(props: {
  data: AudiovCardState
  disabled?: boolean
  onPatch: (patch: Partial<AudiovCardState>) => void
}) {
  return (
    <div className="grid gap-2 @3xl/audiov:grid-cols-2">
      <Input
        aria-label="audiov 配置文件"
        disabled={props.disabled}
        placeholder="配置文件，可选"
        value={props.data.configPath ?? ""}
        onChange={(event) => props.onPatch({ configPath: event.currentTarget.value })}
      />
      <Input
        aria-label="audiov 运行记录 JSONL"
        disabled={props.disabled}
        placeholder=".xiranite/audiov-runs.jsonl"
        value={props.data.databasePath ?? ""}
        onChange={(event) => props.onPatch({ databasePath: event.currentTarget.value })}
      />
      <Input
        aria-label="audiov 额外参数"
        disabled={props.disabled}
        placeholder="额外参数，空格分隔"
        value={props.data.argsText ?? ""}
        onChange={(event) => props.onPatch({ argsText: event.currentTarget.value })}
      />
      <Input
        aria-label="audiov Python 可执行文件"
        disabled={props.disabled}
        placeholder="python，可留空"
        value={props.data.python ?? ""}
        onChange={(event) => props.onPatch({ python: event.currentTarget.value })}
      />
      <Input
        aria-label="audiov 源码目录"
        disabled={props.disabled}
        placeholder="源码目录，可留空"
        value={props.data.sourceRoot ?? ""}
        onChange={(event) => props.onPatch({ sourceRoot: event.currentTarget.value })}
      />
      <Input
        aria-label="audiov 模块名"
        disabled={props.disabled}
        placeholder="模块名，可留空"
        value={props.data.moduleName ?? ""}
        onChange={(event) => props.onPatch({ moduleName: event.currentTarget.value })}
      />
    </div>
  )
}

function RuntimeOptions(props: {
  data: AudiovCardState
  disabled?: boolean
  onPatch: (patch: Partial<AudiovCardState>) => void
}) {
  return (
    <div className="grid gap-2 @3xl/audiov:grid-cols-2">
      <SwitchRow
        checked={props.data.dryRun ?? true}
        disabled={props.disabled}
        icon={Eye}
        label="预演"
        description="只生成 ffmpeg 命令计划，不真正调用模块。"
        onCheckedChange={(dryRun) => props.onPatch({ dryRun })}
      />
      <SwitchRow
        checked={props.data.recordRun ?? false}
        disabled={props.disabled}
        icon={DatabaseZap}
        label="记录运行"
        description="把运行结果写入 JSONL。"
        onCheckedChange={(recordRun) => props.onPatch({ recordRun })}
      />
    </div>
  )
}

function SwitchRow(props: {
  checked: boolean
  description?: string
  disabled?: boolean
  icon?: LucideIcon
  label: string
  onCheckedChange: (checked: boolean) => void
}) {
  const Icon = props.icon
  return (
    <div className="flex min-w-0 items-center justify-between gap-2 rounded-md border bg-background/60 p-2">
      <label className="flex min-w-0 flex-1 items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" />}
          <span className="truncate text-xs font-medium">{props.label}</span>
        </span>
        <Switch checked={props.checked} disabled={props.disabled} size="sm" onCheckedChange={props.onCheckedChange} />
      </label>
      {props.description && <InfoHint label={props.label} description={props.description} />}
    </div>
  )
}

function ConfigDefaultsPopover(props: {
  configDirty: boolean
  configFilePath?: string
  defaults?: Partial<AudiovCardState>
  disabled?: boolean
  onOpenConfigFile?: () => Promise<void> | void
  onResetOverride: () => void
  onRestoreDefault: () => void
  onSaveDefault: () => void
}) {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button aria-label="audiov 默认配置" disabled={props.disabled} size="icon-sm" variant={props.configDirty ? "secondary" : "outline"}>
              <DatabaseZap />
              <span className="sr-only">默认配置</span>
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>默认配置</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-72">
        <div className="mb-3">
          <div className="text-sm font-semibold">默认配置</div>
          <p className="text-xs text-muted-foreground">保存 AudioV 的路径和运行选项。</p>
        </div>
        <div className="grid gap-2">
          <Button disabled={props.disabled} size="sm" onClick={props.onSaveDefault}>保存为默认</Button>
          <Button disabled={props.disabled} size="sm" variant="outline" onClick={props.onRestoreDefault}>恢复默认</Button>
          <Button disabled={props.disabled} size="sm" variant="outline" onClick={props.onResetOverride}>清除覆盖</Button>
          <Separator />
          <Dialog>
            <DialogTrigger asChild>
              <Button disabled={!props.configFilePath} size="sm" variant="ghost">查看配置</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-xl">
              <DialogHeader>
                <DialogTitle>AudioV 配置</DialogTitle>
                <DialogDescription>当前 nodes.audiov 默认值和配置文件位置。</DialogDescription>
              </DialogHeader>
              <ConfigPreview config={props.defaults} path={props.configFilePath} />
            </DialogContent>
          </Dialog>
          <Button disabled={!props.onOpenConfigFile} size="sm" variant="ghost" onClick={() => void props.onOpenConfigFile?.()}>打开文件</Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function ConfigPreview(props: {
  config?: Partial<AudiovCardState>
  path?: string
}) {
  const content = props.config === undefined
    ? "# nodes.audiov 暂无默认配置\n"
    : JSON.stringify(props.config, null, 2)
  return (
    <div className="grid gap-3">
      <div className="rounded-md border bg-muted/30 px-3 py-2">
        <div className="text-xs font-medium text-muted-foreground">配置文件</div>
        <div className="mt-1 break-all font-mono text-xs">{props.path ?? "未连接本地配置服务"}</div>
      </div>
      <pre className="max-h-[45vh] overflow-auto rounded-md border bg-muted/30 p-3 text-xs leading-5">
        {content}
      </pre>
    </div>
  )
}

function InfoHint({ description, label }: { description: string; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label={`${label}说明`}
          className="inline-grid size-5 shrink-0 cursor-help place-items-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          role="img"
          tabIndex={0}
        >
          <Info className="size-3.5" />
        </span>
      </TooltipTrigger>
      <TooltipContent>{description}</TooltipContent>
    </Tooltip>
  )
}

function buildInput(action: PackuToolAction, data: AudiovCardState, spec: PackuToolSpec): PackuToolInput {
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

function statusFromState(data: AudiovCardState, running: boolean): AudiovStatusMeta {
  if (running || data.phase === "running") {
    return {
      label: "运行中",
      description: data.progressText || "AudioV 正在生成 ffmpeg 命令或提取音轨。",
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
    description: "选择动作后查看配置、预览提取或执行音轨提取。",
    tone: "idle",
    badgeVariant: "outline",
    iconClass: "bg-secondary text-secondary-foreground",
  }
}

function summaryText(props: ViewProps): string {
  if (props.data.progressText) return props.data.progressText
  if (props.result?.selectedPaths.length) {
    return `${props.result.selectedPaths.length} 视频 / ${props.result.errors.length} 错误`
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

function getHostData(host: NodeComponentProps<AudiovCardState>["host"], compId: string): AudiovCardState {
  return host.state?.getData?.() ?? host.getData<AudiovCardState>(compId) ?? {}
}

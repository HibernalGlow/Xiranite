import { useEffect, useRef, useState } from "react"
import { FloatingWindowNodeHeader } from "@/components/workspace/FloatingWindowFrame"
import type { NodeComponentProps, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type { AudiovData, AudiovInput } from "@xiranite/node-audiov/core"
import type { LucideIcon } from "lucide-react"
import { Clipboard, Eye, Play, RotateCcw, Square } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldContent, FieldDescription, FieldTitle } from "@/components/ui/field"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { PathInput, PathTextarea } from "@/components/ui/path-input"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { NodeConfigPopover } from "@/nodes/shared/NodeConfigPopover"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import { useNodeI18n } from "@/nodes/shared/useNodeI18n"
import { RunningTint } from "@/nodes/shared/controls"
import { ACTIONS, NODE_META, type AudiovAction, type AudiovActionMeta } from "./constants"
import type { AudiovCardState, AudiovStatusMeta } from "./types"
import { CONFIG_FIELDS } from "./types"
import { CommandPreview, OutputConsole, PathsColumn } from "./WorkbenchPanels"

export function Component({ compId, host }: NodeComponentProps<AudiovCardState>) {
  "use no memo"
  const surface = useNodeSurface()
  const { t } = useNodeI18n("audiov")
  const data = getHostData(host, compId)
  const dataRef = useRef<AudiovCardState>(data)
  dataRef.current = data

  const [running, setRunning] = useState(false)
  const [defaults, setDefaults] = useState<Partial<AudiovCardState> | undefined>(undefined)
  const [configFilePath, setConfigFilePath] = useState<string | undefined>(undefined)
  const [configDirty, setConfigDirty] = useState(false)

  // AudioV deliberately exposes one fixed operation. Preview versus writing is
  // a mode of that operation, not a second action the user must discover.
  const action: AudiovAction = "run"
  const actionMeta = getActionMeta(action, t)
  const result = data.result ?? null
  const logs = data.logs ?? []
  const progress = data.progress ?? 0
  const status = statusFromState(data, running, t)
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

  async function reloadDefaults() {
    const response = await (host.config?.get?.<Partial<AudiovCardState>>() ?? host.getNodeConfig?.<Partial<AudiovCardState>>())
    if (!response) return
    setDefaults(response.config)
    setConfigFilePath(response.path)
    setConfigDirty(false)
  }

  useEffect(() => {
    if (!defaults) return
    setConfigDirty(CONFIG_FIELDS.some((field) => String(data[field] ?? "") !== String(defaults[field] ?? "")))
  }, [data.dryRun, defaults])

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
    const lines = current.commands.map((command) => `${command.label}\t${command.command} ${command.args.join(" ")}`)
    for (const outputPath of current.outputPaths) lines.push(`output\t${outputPath}`)
    for (const error of current.errors) lines.push(`error\t${error}`)
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

  async function execute(nextAction: AudiovAction = "run") {
    if (running) return
    const current = dataRef.current

    if (nextAction !== "status" && !current.pathsText?.trim()) {
      const message = t("error.pathRequired", "请先输入至少一个视频文件路径。")
      patch({ phase: "error", progress: 0, progressText: message })
      pushLog(message)
      return
    }

    const run = host.runner?.run ?? host.actions?.run
    if (!run) {
      const message = t("error.noRunEnv", "当前环境没有本地运行能力，请使用桌面模式或 CLI。")
      patch({ phase: "error", progress: 0, progressText: message })
      pushLog("Native action is unavailable in this host.")
      return
    }

    setRunning(true)
    patch({ action: nextAction, phase: "running", progress: 0, progressText: t("progress.start", "{{action}}开始", { action: actionLabel(nextAction, t) }), result: null })
    try {
      const response = await run<AudiovInput, AudiovData>(NODE_META.id, buildInput(nextAction, current), (event: NodeRunEvent) => {
        if (event.type === "progress") {
          patch({ progress: event.progress ?? 0, progressText: event.message })
          pushLog(`[${event.progress ?? 0}%] ${event.message}`)
          return
        }
        pushLog(event.message)
      }) as NodeRunResult<AudiovData>

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
    t,
    onCopyLogs: copyLogs,
    onCopyResults: copyResults,
    onExecute: execute,
    onOpenConfigFile: host.config?.openFile ?? host.openConfigFile,
    onPastePaths: pastePaths,
    onPatch: patch,
    onReset: reset,
    onReloadDefaults: reloadDefaults,
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
  action: AudiovAction
  actionMeta: AudiovActionMeta
  configDirty: boolean
  configFilePath?: string
  data: AudiovCardState
  defaults?: Partial<AudiovCardState>
  logs: string[]
  progress: number
  result: AudiovData | null
  running: boolean
  status: AudiovStatusMeta
  t: ReturnType<typeof useNodeI18n>["t"]
  onCopyLogs: () => void
  onCopyResults: () => void
  onExecute: (action?: AudiovAction) => void
  onOpenConfigFile?: () => Promise<void> | void
  onPastePaths: () => void
  onPatch: (patch: Partial<AudiovCardState>) => void
  onReset: () => void
  onReloadDefaults: () => Promise<void>
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
          <span>{props.t("name", "AudioV")}</span>
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
        <HeaderLine actionMeta={props.actionMeta} status={props.status} subtitle={props.data.progressText || summaryText(props)} t={props.t} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
        <ExecutionControls compact props={props} />
        <PathsInput compact data={props.data} disabled={props.running} t={props.t} onPaste={props.onPastePaths} onPatch={props.onPatch} />
        {(props.status.tone === "running" || props.status.tone === "error") && (
          <StatusStrip compact progress={props.progress} status={props.status} t={props.t} text={props.data.progressText} />
        )}
        <div className="grid min-h-0 flex-1 gap-2 @3xl/audiov:grid-cols-2">
          <CommandPreview compact result={props.result} running={props.running} t={props.t} onCopy={props.onCopyResults} />
          <OutputConsole compact logs={props.logs} running={props.running} t={props.t} onCopy={props.onCopyLogs} />
        </div>
      </div>
    </div>
  )
}

function PortraitCompactView(props: ViewProps) {
  return (
    <div data-testid="audiov-portrait-view" className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="flex shrink-0 items-start justify-between gap-2">
        <HeaderLine actionMeta={props.actionMeta} status={props.status} subtitle={props.data.progressText || summaryText(props)} t={props.t} />
      </div>
      <div className="grid shrink-0 gap-2">
        <ExecutionControls compact props={props} />
        <PathsInput compact data={props.data} disabled={props.running} t={props.t} onPaste={props.onPastePaths} onPatch={props.onPatch} />
      </div>
      <div className="grid min-h-0 flex-1 gap-2">
        <CommandPreview compact result={props.result} running={props.running} t={props.t} onCopy={props.onCopyResults} />
        <OutputConsole compact logs={props.logs} running={props.running} t={props.t} onCopy={props.onCopyLogs} />
      </div>
    </div>
  )
}

function FullView(props: ViewProps) {
  return (
    <div data-testid="audiov-full-view" className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      {/* 顶部: Header + direct execution gate + stats */}
      <div className="flex shrink-0 flex-col gap-3 @4xl/audiov:flex-row @4xl/audiov:items-center @4xl/audiov:justify-between">
        <div className="flex min-w-0 flex-col gap-2 @4xl/audiov:flex-row @4xl/audiov:items-center">
          <HeaderLine actionMeta={props.actionMeta} status={props.status} subtitle={props.data.progressText || summaryText(props)} t={props.t} />
          <div data-testid="audiov-header-toolbar" className="flex min-w-0 flex-wrap items-center gap-2">
            <ExecutionControls props={props} />
            <ActionIconButton disabled={props.running} icon={RotateCcw} label={props.t("buttons.clearState", "清空状态")} onClick={props.onReset} />
            <NodeConfigPopover configPath={props.configFilePath} defaults={props.defaults} dirty={props.configDirty} disabled={props.running} t={props.t} onOpenFile={props.onOpenConfigFile} onReload={props.onReloadDefaults} onRestore={props.onRestoreDefault} onSave={props.onSaveDefault} />
          </div>
        </div>
        <AudiovStatsPanel result={props.result} t={props.t} />
      </div>

      {/* 中央三栏: 视频路径 | 命令预览 (主角) | 输出 */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 @4xl/audiov:grid-cols-[minmax(220px,260px)_minmax(0,1fr)_minmax(220px,260px)]">
        <PathsColumn data={props.data} disabled={props.running} t={props.t} onPaste={props.onPastePaths} onPatch={props.onPatch} />
        <CommandPreview result={props.result} running={props.running} t={props.t} onCopy={props.onCopyResults} />
        <OutputConsole logs={props.logs} running={props.running} t={props.t} onCopy={props.onCopyLogs} />
      </div>

      {/* 底部: 运行闸门 (预演/真实切换 + 执行按钮) + 配置选项 */}
      {(props.status.tone === "running" || props.status.tone === "error") && (
        <StatusStrip progress={props.progress} status={props.status} t={props.t} text={props.data.progressText} />
      )}
    </div>
  )
}

function ExecutionControls({ compact, props }: { compact?: boolean; props: ViewProps }) {
  const dryRun = props.data.dryRun ?? true
  const previewTitle = dryRun
    ? props.t("execution.previewState", "预演：不写入文件")
    : props.t("execution.liveState", "真实：将写入文件")
  const previewDescription = dryRun
    ? props.t("execution.previewDescription", "生成命令和输出路径，不会修改文件。")
    : props.t("execution.liveDescription", "将以固定 AAC / M4A 预设写入音轨文件。")
  return (
    <section
      data-testid="audiov-execution-controls"
      className={cn(
        "flex min-w-0 shrink-0 items-center gap-2 rounded-lg border bg-card px-2 py-1.5",
        !compact && "min-h-11",
        compact && "grid grid-cols-[minmax(0,1fr)_auto]",
        !dryRun && "border-destructive/50",
      )}
    >
      <Field orientation="horizontal" className="min-w-0 flex-1 items-center gap-2">
        {dryRun ? <Eye className="shrink-0 text-muted-foreground" /> : <Play className="shrink-0 text-destructive" />}
        <FieldContent className="min-w-0 gap-0.5">
          <FieldTitle className="truncate text-xs">{compact ? (dryRun ? props.t("execution.preview", "预演模式") : props.t("execution.live", "真实执行")) : previewTitle}</FieldTitle>
          {!compact && <FieldDescription className="truncate text-[11px]">{previewDescription}</FieldDescription>}
        </FieldContent>
        <Switch
          aria-label={props.t("aria.previewSwitch", "audiov 预演切换")}
          checked={dryRun}
          disabled={props.running}
          size="default"
          onCheckedChange={(checked) => props.onPatch({ dryRun: checked })}
        />
      </Field>
      {!compact && <Badge variant={dryRun ? "outline" : "destructive"} className="shrink-0 text-[10px]">{props.t("execution.profile", "固定预设：AAC · 192 kbps · M4A")}</Badge>}
      {!compact && <Separator className="h-6 shrink-0" orientation="vertical" />}
      <div className="shrink-0">
        <RunActionButton compact={compact} props={props} />
      </div>
    </section>
  )
}

function RunActionButton({ compact, props }: { compact?: boolean; props: ViewProps }) {
  if (props.running) {
    return (
      <Button aria-label="audiov running" disabled size={compact ? "xs" : "sm"} variant="secondary">
        <Square />
        <span>{props.t("status.running", "运行中")}</span>
      </Button>
    )
  }

  const dryRun = props.data.dryRun ?? true
  const label = executionLabel(dryRun, props.t)
  const compactLabel = dryRun
    ? props.t("buttons.preview", "预演")
    : props.t("buttons.extract", "提取")
  const destructive = !dryRun
  if (destructive) {
    return (
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button aria-label={label} size={compact ? "xs" : "sm"} variant="destructive">
            <Play />
            <span>{compact ? compactLabel : label}</span>
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{props.t("confirm.title", "确认提取音轨？")}</AlertDialogTitle>
            <AlertDialogDescription>
              {props.t("confirm.description", "当前已关闭预演。AudioV 会使用内置 AAC / M4A 配置写入音轨文件；请确认视频路径和目标目录无误。")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{props.t("buttons.cancel", "取消")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => props.onExecute("run")}>{props.t("buttons.confirmExtract", "确认提取")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
  }

  return (
    <Button aria-label={label} disabled={props.running} size={compact ? "xs" : "sm"} onClick={() => props.onExecute("run")}>
      <Play />
      <span>{compact ? compactLabel : label}</span>
    </Button>
  )
}

function HeaderLine({ actionMeta, status, subtitle, t }: {
  actionMeta: typeof ACTIONS[number]
  status: AudiovStatusMeta
  subtitle: string
  t: ViewProps["t"]
}) {
  return (
    <FloatingWindowNodeHeader>
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-2">
        <div className={cn("grid size-8 shrink-0 place-items-center rounded-lg", status.iconClass)}>
          <actionMeta.icon />
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-sm font-semibold leading-none">{t("name", "AudioV")}</h3>
            <Badge variant={status.badgeVariant}>{status.label}</Badge>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>
    </div>
    </FloatingWindowNodeHeader>
  )
}

function AudiovStatsPanel({ result, t }: { result: AudiovData | null; t: ViewProps["t"] }) {
  const stats = [
    [t("stats.videos", "视频"), result?.selectedPaths.length ?? 0, false],
    [t("stats.outputs", "输出"), result?.outputPaths.length ?? 0, false],
    [t("stats.errors", "错误"), result?.errors.length ?? 0, true],
  ] as const

  return (
    <div data-testid="audiov-stats-panel" className="grid shrink-0 grid-cols-3 gap-1">
      {stats.map(([label, value, destructive]) => (
        <div key={label} className="min-w-0 rounded-md bg-muted/35 px-2 py-1.5 text-center">
          <div className="truncate text-[11px] text-muted-foreground">{label}</div>
          <div className={cn("text-sm font-semibold tabular-nums", destructive && Number(value) > 0 && "text-destructive")}>{value}</div>
        </div>
      ))}
    </div>
  )
}

function PathsInput(props: {
  compact?: boolean
  data: AudiovCardState
  disabled?: boolean
  t: ViewProps["t"]
  onPaste: () => void
  onPatch: (patch: Partial<AudiovCardState>) => void
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {props.compact ? (
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-1.5">
          <PathInput
            id="audiov-paths-compact"
            aria-label={props.t("aria.videoPaths", "audiov 视频路径")}
            disabled={props.disabled}
            className="font-mono text-xs"
            placeholder={props.t("paths.compactPlaceholder", "每行一个视频文件路径")}
            value={props.data.pathsText ?? ""}
            dropMode="append"
            onValueChange={(pathsText) => props.onPatch({ pathsText })}
          />
          <ActionIconButton disabled={props.disabled} icon={Clipboard} label={props.t("buttons.pastePaths", "粘贴路径")} onClick={props.onPaste} />
        </div>
      ) : (
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-1.5">
          <PathTextarea
            id="audiov-paths-compact"
            aria-label={props.t("aria.videoPaths", "audiov 视频路径")}
            disabled={props.disabled}
            className="min-h-20 font-mono text-xs"
            placeholder={props.t("paths.placeholder", "每行一个视频文件路径，例如：\nD:/Video/clip1.mp4\nD:/Video/clip2.mkv")}
            value={props.data.pathsText ?? ""}
            onValueChange={(pathsText) => props.onPatch({ pathsText })}
          />
          <ActionIconButton disabled={props.disabled} icon={Clipboard} label={props.t("buttons.pastePaths", "粘贴路径")} onClick={props.onPaste} />
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
  t: ViewProps["t"]
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

function buildInput(action: AudiovAction, data: AudiovCardState): AudiovInput {
  const pathsText = data.pathsText?.trim()
  return {
    action,
    paths: pathsText ? pathsText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) : [],
    dryRun: data.dryRun ?? true,
  }
}

function statusFromState(data: AudiovCardState, running: boolean, t: ViewProps["t"]): AudiovStatusMeta {
  if (running || data.phase === "running") {
    return {
      label: t("status.running", "运行中"),
      description: data.progressText || t("statusDesc.running", "AudioV 正在生成 ffmpeg 命令或提取音轨。"),
      tone: "running",
      badgeVariant: "secondary",
      iconClass: "bg-primary text-primary-foreground",
    }
  }
  if (data.phase === "completed") {
    return {
      label: t("status.completed", "完成"),
      description: data.progressText || t("statusDesc.completed", "上次任务已完成。"),
      tone: "success",
      badgeVariant: "default",
      iconClass: "bg-primary text-primary-foreground",
    }
  }
  if (data.phase === "error") {
    return {
      label: t("status.error", "失败"),
      description: data.progressText || t("statusDesc.error", "上次任务失败，请查看日志。"),
      tone: "error",
      badgeVariant: "destructive",
      iconClass: "bg-destructive text-destructive-foreground",
    }
  }
  return {
    label: t("status.idle", "就绪"),
    description: t("statusDesc.idle", "选择动作后查看配置、预览提取或执行音轨提取。"),
    tone: "idle",
    badgeVariant: "outline",
    iconClass: "bg-secondary text-secondary-foreground",
  }
}

function summaryText(props: ViewProps): string {
  if (props.data.progressText) return props.data.progressText
  if (props.result?.selectedPaths.length) {
    return props.t("summary.files", "{{videos}} 视频 / {{errors}} 错误", { videos: props.result.selectedPaths.length, errors: props.result.errors.length })
  }
  return props.actionMeta.description
}

function actionLabel(action: AudiovAction, t: ViewProps["t"]): string {
  return getActionMeta(action, t).label
}

function executionLabel(dryRun: boolean, t: ViewProps["t"]): string {
  return dryRun
    ? t("buttons.previewExtract", "预览提取")
    : t("buttons.liveExtract", "立即提取")
}

function getActionMeta(action: AudiovAction, t: ViewProps["t"]): AudiovActionMeta {
  const meta = ACTIONS.find((item) => item.value === action) ?? ACTIONS[0]!
  return {
    ...meta,
    label: t(`actions.${meta.value}.label`, meta.label),
    shortLabel: t(`actions.${meta.value}.shortLabel`, meta.shortLabel),
    description: t(`actions.${meta.value}.description`, meta.description),
  }
}

function getHostData(host: NodeComponentProps<AudiovCardState>["host"], compId: string): AudiovCardState {
  return host.state?.getData?.() ?? host.getData<AudiovCardState>(compId) ?? {}
}

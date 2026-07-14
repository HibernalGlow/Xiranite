import { useEffect, useRef, useState } from "react"
import type { NodeComponentProps, NodeRunResult } from "@xiranite/contract"
import type { MarkuAction, MarkuData, MarkuInput } from "@xiranite/node-marku/core"
import { Copy, FileCode, History, Play, RotateCcw, ShieldAlert, Square, Undo2 } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import { RunningTint } from "@/nodes/shared/controls"
import { NodeConfigButton } from "@/nodes/shared/NodeConfigPopover"
import { findModuleMeta } from "./constants"
import {
  ActionIconButton,
  AdvancedOptionsPopover,
  ConfigField,
  ModulePicker,
  PathInput,
  PrimarySwitches,
  ResultTabs,
  StatusStrip,
  TextInput,
} from "./controls"
import type { MarkuCardState, MarkuPhase, MarkuStatusMeta } from "./types"
import { CONFIG_FIELDS } from "./types"

export function Component({ compId, host }: NodeComponentProps) {
  "use no memo"
  const surface = useNodeSurface()
  const data = host.getData<MarkuCardState>(compId) ?? {}
  const dataRef = useRef<MarkuCardState>(data)
  dataRef.current = data

  const [running, setRunning] = useState(false)
  const [defaults, setDefaults] = useState<Partial<MarkuCardState> | undefined>(undefined)
  const [configFilePath, setConfigFilePath] = useState<string | undefined>(undefined)
  const [configDirty, setConfigDirty] = useState(false)

  const logs = data.logs ?? []
  const result = data.result ?? null
  const moduleMeta = findModuleMeta(data.module)
  const hasText = Boolean(data.inputText?.trim())
  const paths = splitPaths(data.pathText)
  const dryRun = data.dryRun ?? true
  const phase = phaseFromState(data, running)
  const progress = data.progress ?? 0
  const status = statusFromState(data, running)
  const compactSurface = surface.mode === "compact" || surface.mode === "portrait"
  const forceCollapsedSurface = compactSurface && surface.height > 0 && surface.height < 160
  const portraitCompact = surface.mode === "portrait" || (surface.mode === "compact" && surface.width < 560 && surface.height >= 300)

  useEffect(() => {
    host.getNodeConfig?.<Partial<MarkuCardState>>()
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
    data.inputText,
    data.pathText,
    data.module,
    data.configText,
    data.recursive,
    data.dryRun,
    data.enableUndo,
    data.historyPath,
    defaults,
  ])

  function patch(patchData: Partial<MarkuCardState>) {
    dataRef.current = { ...dataRef.current, ...patchData }
    host.patchData(compId, patchData)
  }

  function pushLog(message: string) {
    const nextLogs = [...(dataRef.current.logs ?? []), message].slice(-120)
    patch({ logs: nextLogs })
  }

  async function pasteText() {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ inputText: text })
  }

  async function pastePath() {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ pathText: text.trim() })
  }

  async function copyOutput() {
    const text = result?.outputText || result?.diffText || result?.diffs.map((item) => item.diff).join("\n") || ""
    if (text) await host.clipboard?.writeText?.(text)
  }

  async function copyLogs() {
    if (logs.length) await host.clipboard?.writeText?.(logs.join("\n"))
  }

  async function execute(action: MarkuAction) {
    if (running) return
    const current = dataRef.current
    const input = buildInput(action, current)

    if ((action === "run" || action === "text") && !input.inputText && !input.paths?.length) {
      patch({ phase: "error", progress: 0, progressText: "请先输入 Markdown 文本或扫描路径。" })
      return
    }
    if (action === "undo" && !current.result?.undoId && !current.result?.history.length) {
      patch({ phase: "error", progress: 0, progressText: "没有可撤销的历史记录。" })
      return
    }

    const run = host.actions?.run
    if (!run) {
      patch({ phase: "error", progress: 0, progressText: "当前环境没有本地运行能力，请使用桌面模式或 CLI。" })
      pushLog("Native action is unavailable in this host.")
      return
    }

    setRunning(true)
    try {
      patch({ phase: "running", progress: 0, progressText: `${actionLabel(action)}开始` })
      const response = await run<MarkuInput, MarkuData>("marku", input, (event) => {
        if (event.type === "progress") {
          patch({ progress: event.progress ?? 0, progressText: event.message })
          pushLog(`[${event.progress ?? 0}%] ${event.message}`)
        } else {
          pushLog(event.message)
        }
      }) as NodeRunResult<MarkuData>

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
    const config: Partial<MarkuCardState> = {}
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
    patch({
      inputText: undefined,
      pathText: undefined,
      module: undefined,
      configText: undefined,
      recursive: undefined,
      dryRun: undefined,
      enableUndo: undefined,
      historyPath: undefined,
    })
  }

  const commonProps = createViewProps({
    configDirty,
    configFilePath,
    data,
    defaults,
    dryRun,
    hasText,
    host,
    logs,
    moduleMeta,
    pathCount: paths.length,
    phase,
    progress,
    result,
    running,
    status,
    onCopyLogs: copyLogs,
    onCopyOutput: copyOutput,
    onExecute: execute,
    onModuleChange: (value: string) => patch({ module: value }),
    onOpenConfigFile: host.openConfigFile,
    onPastePath: pastePath,
    onPasteText: pasteText,
    onPatch: patch,
    onReset: reset,
    onResetOverride: resetOverride,
    onRestoreDefault: restoreDefault,
    onSaveDefault: saveAsDefault,
  })

  return (
    <TooltipProvider>
      <div ref={surface.ref} className="@container/marku relative flex h-full min-h-0 w-full overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(circle_at_12%_0%,color-mix(in_oklch,var(--primary)_12%,transparent),transparent_36%),radial-gradient(circle_at_88%_8%,color-mix(in_oklch,var(--chart-4)_14%,transparent),transparent_34%)]" />
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
  data: MarkuCardState
  defaults?: Partial<MarkuCardState>
  dryRun: boolean
  hasText: boolean
  host: NodeComponentProps["host"]
  logs: string[]
  moduleMeta: ReturnType<typeof findModuleMeta>
  pathCount: number
  phase: MarkuPhase
  progress: number
  result: MarkuData | null
  running: boolean
  status: MarkuStatusMeta
  onCopyLogs: () => void
  onCopyOutput: () => void
  onExecute: (action: MarkuAction) => void
  onModuleChange: (value: string) => void
  onOpenConfigFile?: () => Promise<void> | void
  onPastePath: () => void
  onPasteText: () => void
  onPatch: (patch: Partial<MarkuCardState>) => void
  onReset: () => void
  onResetOverride: () => void
  onRestoreDefault: () => void
  onSaveDefault: () => void
}) {
  return props
}

function CollapsedView(props: ViewProps) {
  return (
    <div data-testid="marku-collapsed-view" className="relative flex h-full min-h-0 items-center gap-2 overflow-hidden rounded-xl border bg-background/85 px-3 py-2 shadow-sm">
      <RunningTint tone={props.status.tone} />
      <div className={cn("relative grid size-8 shrink-0 place-items-center rounded-lg", props.status.iconClass)}>
        <FileCode />
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="flex items-center gap-1 text-xs font-semibold leading-none">
          <span>Marku</span>
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
    <div data-testid="marku-compact-view" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-2 p-3 pb-2">
        <HeaderLine status={props.status} subtitle={props.data.progressText || summaryText(props)} />
        <div className="flex shrink-0 items-center gap-1">
          <AdvancedOptionsPopover data={props.data} disabled={props.running} onPatch={props.onPatch} />
          <PrimaryActionButton compact props={props} />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
        <ModulePicker compact disabled={props.running} module={props.moduleMeta.id} onModuleChange={props.onModuleChange} />
        {props.hasText ? (
          <TextInput compact disabled={props.running} value={props.data.inputText ?? ""} onChange={(inputText) => props.onPatch({ inputText })} onClear={() => props.onPatch({ inputText: "" })} onPaste={props.onPasteText} />
        ) : (
          <PathInput compact disabled={props.running} pathCount={props.pathCount} value={props.data.pathText ?? ""} onChange={(pathText) => props.onPatch({ pathText })} onClear={() => props.onPatch({ pathText: "" })} onPaste={props.onPastePath} />
        )}
        <PrimarySwitches compact data={props.data} disabled={props.running} hasText={props.hasText} onPatch={props.onPatch} />
        <ToolbarActions {...props} compact />
        {(props.status.tone === "running" || props.status.tone === "error") && (
          <StatusStrip compact progress={props.progress} status={props.status} text={props.data.progressText} />
        )}
        <div className="min-h-0 flex-1">
          <ResultTabs compact logs={props.logs} result={props.result} onCopyLogs={props.onCopyLogs} onCopyOutput={props.onCopyOutput} />
        </div>
      </div>
    </div>
  )
}

function PortraitCompactView(props: ViewProps) {
  return (
    <div data-testid="marku-portrait-view" className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="flex shrink-0 items-start justify-between gap-2">
        <HeaderLine status={props.status} subtitle={props.data.progressText || summaryText(props)} />
        <div className="flex shrink-0 items-center gap-1">
          <AdvancedOptionsPopover data={props.data} disabled={props.running} onPatch={props.onPatch} />
          <PrimaryActionButton compact props={props} />
        </div>
      </div>
      <div className="grid shrink-0 gap-2">
        <ModulePicker compact disabled={props.running} module={props.moduleMeta.id} onModuleChange={props.onModuleChange} />
        {props.hasText ? (
          <TextInput compact disabled={props.running} value={props.data.inputText ?? ""} onChange={(inputText) => props.onPatch({ inputText })} onClear={() => props.onPatch({ inputText: "" })} onPaste={props.onPasteText} />
        ) : (
          <PathInput compact disabled={props.running} pathCount={props.pathCount} value={props.data.pathText ?? ""} onChange={(pathText) => props.onPatch({ pathText })} onClear={() => props.onPatch({ pathText: "" })} onPaste={props.onPastePath} />
        )}
        <PrimarySwitches compact data={props.data} disabled={props.running} hasText={props.hasText} onPatch={props.onPatch} />
        <ToolbarActions {...props} compact />
      </div>
      <div className="min-h-0 flex-1">
        <ResultTabs compact logs={props.logs} result={props.result} onCopyLogs={props.onCopyLogs} onCopyOutput={props.onCopyOutput} />
      </div>
    </div>
  )
}

function FullView(props: ViewProps) {
  return (
    <div data-testid="marku-full-view" className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <div className="flex shrink-0 flex-col gap-3 @4xl/marku:flex-row @4xl/marku:items-center @4xl/marku:justify-between">
        <div className="flex min-w-0 flex-col gap-2 @4xl/marku:flex-row @4xl/marku:items-center">
          <HeaderLine status={props.status} subtitle={props.data.progressText || `${props.moduleMeta.label} / ${props.hasText ? "文本模式" : "路径模式"} / ${props.dryRun ? "预演" : "真实执行"}`} />
          <div data-testid="marku-header-toolbar" className="flex min-w-0 flex-wrap items-center gap-2">
            <ToolbarActions {...props} />
          </div>
        </div>
        <StatsPanel progress={props.progress} result={props.result} />
      </div>

      <section className="shrink-0 border-y py-2">
        <div className="mb-2 text-xs font-medium text-muted-foreground">活动转换模块</div>
        <ModulePicker disabled={props.running} module={props.moduleMeta.id} onModuleChange={props.onModuleChange} />
      </section>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 @3xl/marku:grid-cols-2">
        <section className="flex min-h-0 flex-col gap-3 overflow-auto pr-1">
          <div className="grid gap-3 border-b pb-3">
            <div>
              <div className="text-sm font-semibold">模块</div>
              <div className="text-xs text-muted-foreground">选择 Markdown 处理模块，部分模块支持配置 JSON。</div>
            </div>
            <ConfigField disabled={props.running} value={props.data.configText ?? ""} onChange={(configText) => props.onPatch({ configText })} />
          </div>
          <div className="grid gap-3 border-b pb-3">
            <div>
              <div className="text-sm font-semibold">输入</div>
              <div className="text-xs text-muted-foreground">粘贴文本后将进入文本模式；留空文本则按路径扫描 Markdown 文件。</div>
            </div>
            <TextInput disabled={props.running} value={props.data.inputText ?? ""} onChange={(inputText) => props.onPatch({ inputText })} onClear={() => props.onPatch({ inputText: "" })} onPaste={props.onPasteText} />
            <PathInput disabled={props.running || props.hasText} pathCount={props.pathCount} value={props.data.pathText ?? ""} onChange={(pathText) => props.onPatch({ pathText })} onClear={() => props.onPatch({ pathText: "" })} onPaste={props.onPastePath} />
          </div>
          <div className="grid gap-3 border-b pb-3">
            <div className="text-sm font-semibold">关键开关</div>
            <PrimarySwitches data={props.data} disabled={props.running} hasText={props.hasText} onPatch={props.onPatch} />
          </div>
          <StatusStrip progress={props.progress} status={props.status} text={props.data.progressText} />
        </section>

        <div className="h-[clamp(12rem,32vh,20rem)] min-h-0 overflow-hidden @3xl/marku:h-full">
          <ResultTabs logs={props.logs} result={props.result} onCopyLogs={props.onCopyLogs} onCopyOutput={props.onCopyOutput} />
        </div>
      </div>
    </div>
  )
}

function ToolbarActions(props: ViewProps & { compact?: boolean }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-1", props.compact && "justify-between")}>
      {!props.compact && <PrimaryActionButton props={props} />}
      <ActionIconButton disabled={props.running} icon={History} label="读取历史" onClick={() => props.onExecute("history")} />
      <ActionIconButton disabled={props.running} icon={Undo2} label="撤销最近" onClick={() => props.onExecute("undo")} />
      <ActionIconButton disabled={!props.result?.outputText && !props.result?.diffText && !props.result?.diffs.length} icon={Copy} label="复制输出" onClick={props.onCopyOutput} />
      <ActionIconButton disabled={!props.logs.length} icon={RotateCcw} label="清空状态" onClick={props.onReset} />
      {!props.compact && (
        <NodeConfigButton nodeKey="marku"
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
      <Button aria-label="marku running" disabled size={compact ? "icon-sm" : "sm"} variant="secondary">
        <Square />
        {!compact && <span>运行中</span>}
      </Button>
    )
  }

  const disabled = props.hasText ? !props.data.inputText?.trim() : !props.pathCount
  const label = props.dryRun ? "预演处理" : "真实写回"
  const action: MarkuAction = props.hasText ? "text" : "run"

  if (!props.dryRun && !props.hasText) {
    return (
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button aria-label={label} disabled={disabled} size={compact ? "icon-sm" : "sm"} variant="destructive">
            <ShieldAlert />
            {!compact && <span>{label}</span>}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认真实写回 Marku？</AlertDialogTitle>
            <AlertDialogDescription>
              当前关闭了预演，将真实修改磁盘上的 Markdown 文件。模块 {props.moduleMeta.label}，{props.result?.filesChanged ?? 0} 个文件预计变更，请确认备份和撤销记录已开启。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => props.onExecute(action)}>确认执行</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
  }

  return (
    <Button aria-label={label} disabled={disabled} size={compact ? "icon-sm" : "sm"} onClick={() => props.onExecute(action)}>
      <Play />
      {!compact && <span>{label}</span>}
    </Button>
  )
}

function HeaderLine({ status, subtitle }: {
  status: MarkuStatusMeta
  subtitle: string
}) {
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-2">
        <div className={cn("grid size-8 shrink-0 place-items-center rounded-lg", status.iconClass)}>
          <FileCode />
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-sm font-semibold leading-none">Marku</h3>
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
  result: MarkuData | null
}) {
  const stats = [
    ["已处理", props.result?.filesProcessed ?? 0],
    ["已变更", props.result?.filesChanged ?? 0],
    ["差异", props.result?.diffs.filter((item) => item.changed).length ?? 0],
    ["历史", props.result?.history.length ?? 0],
    ["错误", props.result?.errors.length ?? 0],
    ["进度", `${props.progress}%`],
  ] as const

  return (
    <div className="grid shrink-0 grid-cols-3 gap-1 @3xl/marku:grid-cols-6">
      {stats.map(([label, value]) => (
        <div key={label} className="min-w-0 rounded-md bg-muted/35 px-2 py-1.5 text-center">
          <div className="truncate text-[11px] text-muted-foreground">{label}</div>
          <div className={cn("text-sm font-semibold tabular-nums", label === "错误" && Number(value) > 0 && "text-destructive")}>{value}</div>
        </div>
      ))}
    </div>
  )
}

function buildInput(action: MarkuAction, data: MarkuCardState): MarkuInput {
  const hasText = Boolean(data.inputText?.trim())
  return {
    action,
    module: data.module ?? "markt",
    paths: hasText ? [] : splitPaths(data.pathText),
    inputText: hasText ? data.inputText : "",
    stepConfig: parseConfig(data.configText),
    recursive: data.recursive ?? false,
    dryRun: data.dryRun ?? true,
    enableUndo: data.enableUndo ?? true,
    historyPath: data.historyPath,
    undoId: data.result?.undoId,
  }
}

function statusFromState(data: MarkuCardState, running: boolean): MarkuStatusMeta {
  if (running || data.phase === "running") {
    return {
      label: "运行中",
      description: data.progressText || "Marku 正在处理当前任务。",
      tone: "running",
      badgeVariant: "secondary",
      iconClass: "bg-primary text-primary-foreground",
    }
  }
  if (data.phase === "error" || (data.result?.errors.length ?? 0) > 0) {
    return {
      label: "失败",
      description: data.progressText || data.result?.errors[0] || "上次任务失败，请查看错误和日志。",
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
    description: "粘贴 Markdown 文本或路径后运行模块。",
    tone: "idle",
    badgeVariant: "outline",
    iconClass: "bg-secondary text-secondary-foreground",
  }
}

function phaseFromState(data: MarkuCardState, running: boolean): MarkuPhase {
  if (running) return "running"
  return data.phase ?? "idle"
}

function actionLabel(action: MarkuAction): string {
  if (action === "run") return "处理"
  if (action === "text") return "文本处理"
  if (action === "undo") return "撤销"
  return "读取历史"
}

function summaryText(props: ViewProps): string {
  if (props.data.progressText) return props.data.progressText
  if (props.result?.filesChanged) return `${props.result.filesChanged} 个文件已变更`
  if (props.result?.filesProcessed) return `${props.result.filesProcessed} 个文件已处理`
  if (props.hasText) return `${props.data.inputText?.length ?? 0} 字文本 / ${props.moduleMeta.shortLabel}`
  if (props.pathCount) return `${props.pathCount} 条路径 / ${props.moduleMeta.shortLabel}`
  return "粘贴 Markdown 或路径后运行模块"
}

function splitPaths(text?: string): string[] {
  if (!text) return []
  const matches = [...text.matchAll(/"([^"]+)"|'([^']+)'|(\S+)/g)]
  return [...new Set(matches.map((match) => (match[1] ?? match[2] ?? match[3] ?? "").trim()).filter(Boolean))]
}

function parseConfig(text?: string): Record<string, unknown> {
  if (!text?.trim()) return {}
  try {
    const parsed = JSON.parse(text) as unknown
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

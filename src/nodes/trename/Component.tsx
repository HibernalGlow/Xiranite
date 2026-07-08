import { useEffect, useMemo, useRef, useState } from "react"
import type { NodeComponentProps, NodeRunResult } from "@xiranite/contract"
import type { TrenameAction, TrenameData, TrenameInput, TrenameScanMode } from "@xiranite/node-trename/core"
import { Copy, FilePenLine, History, Play, RotateCcw, ScanSearch, Search, ShieldAlert, Square, Upload } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import { buildTreeModel } from "./FileTreePanel"
import { JsonEditorDialog } from "./JsonEditorDialog"
import { TrenameDisplayTabs } from "./ResultPanels"
import { ActionIconButton, AdvancedOptionsPopover, ConfigDefaultsPopover, KeySwitches, ModePicker, PathInput, StatusStrip } from "./controls"
import type { TrenameCardState, TrenamePhase, TrenameStatusMeta } from "./types"
import { CONFIG_FIELDS } from "./types"

export function Component({ compId, host }: NodeComponentProps) {
  const surface = useNodeSurface()
  const data = host.getData<TrenameCardState>(compId) ?? {}
  const dataRef = useRef<TrenameCardState>(data)
  dataRef.current = data

  const [running, setRunning] = useState(false)
  const [defaults, setDefaults] = useState<Partial<TrenameCardState> | undefined>(undefined)
  const [configFilePath, setConfigFilePath] = useState<string | undefined>(undefined)
  const [configDirty, setConfigDirty] = useState(false)

  const logs = data.logs ?? []
  const result = data.result ?? null
  const jsonText = data.jsonText ?? result?.jsonContent ?? ""
  const tree = useMemo(() => buildTreeModel(jsonText), [jsonText])
  const pathCount = useMemo(() => parsePathInput(data.pathText ?? "").length, [data.pathText])
  const mode = data.mode ?? "normal"
  const dryRun = data.dryRun ?? true
  const phase = phaseFromState(data, running)
  const progress = data.progress ?? 0
  const status = statusFromState(data, running, tree)
  const compactSurface = surface.mode === "compact" || surface.mode === "portrait"
  const forceCollapsedSurface = compactSurface && surface.height > 0 && surface.height < 160
  const portraitCompact = surface.mode === "portrait" || (surface.mode === "compact" && surface.width < 560 && surface.height >= 300)

  useEffect(() => {
    host.getNodeConfig?.<Partial<TrenameCardState>>()
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
    data.basePath,
    data.batchId,
    data.compact,
    data.dryRun,
    data.excludeExts,
    data.excludePatterns,
    data.includeHidden,
    data.includeRoot,
    data.keepRecent,
    data.maxLines,
    data.mode,
    data.pathText,
    data.undoPath,
    defaults,
  ])

  function patch(patchData: Partial<TrenameCardState>) {
    dataRef.current = { ...dataRef.current, ...patchData }
    host.patchData(compId, patchData)
  }

  function pushLog(message: string) {
    const nextLogs = [...(dataRef.current.logs ?? []), message].slice(-120)
    patch({ logs: nextLogs })
  }

  async function pastePath() {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ pathText: text.trim() })
  }

  async function pasteJson() {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ jsonText: text })
  }

  async function copyJson() {
    if (jsonText) await host.clipboard?.writeText?.(jsonText)
  }

  async function copyResults() {
    await host.clipboard?.writeText?.(resultLines(result).join("\n"))
  }

  async function copyLogs() {
    await host.clipboard?.writeText?.(logs.join("\n"))
  }

  async function execute(action: TrenameAction, override: Partial<TrenameCardState> = {}) {
    if (running) return
    const current = { ...dataRef.current, ...override }
    const nextJsonText = override.jsonText ?? jsonText
    const input = buildInput(action, current, nextJsonText)

    if (action === "scan" && !input.paths) {
      patch({ phase: "error", progress: 0, progressText: "请先输入至少一个扫描路径。" })
      return
    }
    if ((action === "import" || action === "validate" || action === "rename") && !input.jsonContent) {
      patch({ phase: "error", progress: 0, progressText: "请先扫描或导入 rename JSON。" })
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
      patch({ phase: phaseForAction(action), progress: 0, progressText: `${actionLabel(action)}开始`, ...override })
      const response = await run<TrenameInput, TrenameData>("trename", input, (event) => {
        if (event.type === "progress") {
          patch({ progress: event.progress ?? 0, progressText: event.message })
          pushLog(`[${event.progress ?? 0}%] ${event.message}`)
        } else {
          pushLog(event.message)
        }
      }) as NodeRunResult<TrenameData>

      const next = response.data ?? null
      patch({
        phase: response.success ? "completed" : "error",
        progress: response.success ? 100 : 0,
        progressText: response.message,
        result: next,
        jsonText: next?.jsonContent || nextJsonText,
        basePath: next?.basePath || current.basePath,
        batchId: next?.operationId || current.batchId,
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
    patch({ phase: "idle", progress: 0, progressText: "", result: null, jsonText: "", logs: [] })
  }

  async function saveAsDefault() {
    const config: Partial<TrenameCardState> = {}
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
      pathText: undefined,
      basePath: undefined,
      mode: undefined,
      includeHidden: undefined,
      includeRoot: undefined,
      compact: undefined,
      dryRun: undefined,
      excludeExts: undefined,
      excludePatterns: undefined,
      maxLines: undefined,
      batchId: undefined,
      undoPath: undefined,
      keepRecent: undefined,
    })
  }

  const commonProps = createViewProps({
    configDirty,
    configFilePath,
    data,
    defaults,
    dryRun,
    host,
    jsonText,
    logs,
    mode,
    pathCount,
    phase,
    progress,
    result,
    running,
    status,
    tree,
    onCopyJson: copyJson,
    onCopyLogs: copyLogs,
    onCopyResults: copyResults,
    onExecute: execute,
    onModeChange: (nextMode: TrenameScanMode) => patch({ mode: nextMode }),
    onOpenConfigFile: host.openConfigFile,
    onPasteJson: pasteJson,
    onPastePath: pastePath,
    onPatch: patch,
    onReset: reset,
    onResetOverride: resetOverride,
    onRestoreDefault: restoreDefault,
    onSaveDefault: saveAsDefault,
  })

  return (
    <TooltipProvider>
      <div ref={surface.ref} className="@container/trename relative flex h-full min-h-0 w-full overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(circle_at_12%_0%,hsl(var(--primary)/0.12),transparent_36%),radial-gradient(circle_at_88%_8%,hsl(var(--chart-2)/0.14),transparent_34%)]" />
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
  data: TrenameCardState
  defaults?: Partial<TrenameCardState>
  dryRun: boolean
  host: NodeComponentProps["host"]
  jsonText: string
  logs: string[]
  mode: TrenameScanMode
  pathCount: number
  phase: TrenamePhase
  progress: number
  result: TrenameData | null
  running: boolean
  status: TrenameStatusMeta
  tree: ReturnType<typeof buildTreeModel>
  onCopyJson: () => void
  onCopyLogs: () => void
  onCopyResults: () => void
  onExecute: (action: TrenameAction, override?: Partial<TrenameCardState>) => void
  onModeChange: (mode: TrenameScanMode) => void
  onOpenConfigFile?: () => Promise<void> | void
  onPasteJson: () => void
  onPastePath: () => void
  onPatch: (patch: Partial<TrenameCardState>) => void
  onReset: () => void
  onResetOverride: () => void
  onRestoreDefault: () => void
  onSaveDefault: () => void
}) {
  return props
}

function CollapsedView(props: ViewProps) {
  return (
    <div className="relative flex h-full min-h-0 items-center gap-2 overflow-hidden rounded-xl border bg-background/85 px-3 py-2 shadow-sm">
      <div className={cn("absolute inset-0 opacity-70 transition-opacity", props.status.tone === "running" && "animate-pulse bg-primary/10", props.status.tone === "error" && "bg-destructive/10", props.status.tone === "success" && "bg-primary/10")} />
      <div className={cn("relative grid size-8 shrink-0 place-items-center rounded-lg", props.status.iconClass)}>
        <FilePenLine />
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="flex items-center gap-1 text-xs font-semibold leading-none">
          <span>Trename</span>
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
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-2 p-3 pb-2">
        <HeaderLine status={props.status} subtitle={props.data.progressText || summaryText(props)} />
        <div className="flex shrink-0 items-center gap-1">
          <AdvancedOptionsPopover data={props.data} disabled={props.running} onPatch={props.onPatch} />
          <PrimaryActionButton compact props={props} />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
        <ModePicker disabled={props.running} mode={props.mode} onModeChange={props.onModeChange} />
        <PathInput compact disabled={props.running} pathCount={props.pathCount} value={props.data.pathText ?? ""} onChange={(pathText) => props.onPatch({ pathText })} onClear={() => props.onPatch({ pathText: "" })} onPaste={props.onPastePath} />
        <KeySwitches compact data={props.data} disabled={props.running} onPatch={props.onPatch} />
        <ToolbarActions {...props} compact />
        {(props.status.tone === "running" || props.status.tone === "error") && (
          <StatusStrip compact progress={props.progress} status={props.status} text={props.data.progressText} />
        )}
        <div className="min-h-0 flex-1">
          <TrenameDisplayTabs
            compact
            jsonText={props.jsonText}
            logs={props.logs}
            phase={props.phase}
            result={props.result}
            running={props.running}
            onCopyLogs={props.onCopyLogs}
            onCopyResults={props.onCopyResults}
            onUndoBatch={(batchId) => props.onExecute("undo", { batchId })}
          />
        </div>
      </div>
    </div>
  )
}

function PortraitCompactView(props: ViewProps) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="flex shrink-0 items-start justify-between gap-2">
        <HeaderLine status={props.status} subtitle={props.data.progressText || summaryText(props)} />
        <div className="flex shrink-0 items-center gap-1">
          <AdvancedOptionsPopover data={props.data} disabled={props.running} onPatch={props.onPatch} />
          <PrimaryActionButton compact props={props} />
        </div>
      </div>
      <div className="grid shrink-0 gap-2">
        <ModePicker disabled={props.running} mode={props.mode} onModeChange={props.onModeChange} />
        <PathInput compact disabled={props.running} pathCount={props.pathCount} value={props.data.pathText ?? ""} onChange={(pathText) => props.onPatch({ pathText })} onClear={() => props.onPatch({ pathText: "" })} onPaste={props.onPastePath} />
        <KeySwitches compact data={props.data} disabled={props.running} onPatch={props.onPatch} />
        <ToolbarActions {...props} compact />
      </div>
      <div className="min-h-0 flex-1">
        <TrenameDisplayTabs
          compact
          jsonText={props.jsonText}
          logs={props.logs}
          phase={props.phase}
          result={props.result}
          running={props.running}
          onCopyLogs={props.onCopyLogs}
          onCopyResults={props.onCopyResults}
          onUndoBatch={(batchId) => props.onExecute("undo", { batchId })}
        />
      </div>
    </div>
  )
}

function FullView(props: ViewProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <div className="flex shrink-0 flex-col gap-3 @4xl/trename:flex-row @4xl/trename:items-center @4xl/trename:justify-between">
        <div className="flex min-w-0 flex-col gap-2 @4xl/trename:flex-row @4xl/trename:items-center">
          <HeaderLine status={props.status} subtitle={props.data.progressText || `${props.pathCount} 路径 / ${props.tree.ready} 就绪 / ${props.dryRun ? "预演" : "真实执行"}`} />
          <div data-testid="trename-header-toolbar" className="flex min-w-0 flex-wrap items-center gap-2">
            <ToolbarActions {...props} />
          </div>
        </div>
        <StatsPanel progress={props.progress} result={props.result} tree={props.tree} />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 @5xl/trename:grid-cols-[minmax(320px,380px)_minmax(0,1fr)]">
        <section className="flex min-h-0 flex-col gap-3 overflow-auto pr-1">
          <div className="grid gap-3 border-b pb-3">
            <div>
              <div className="text-sm font-semibold">输入</div>
              <div className="text-xs text-muted-foreground">粘贴目录，扫描成 rename JSON；大 JSON 在弹窗里编辑。</div>
            </div>
            <PathInput disabled={props.running} pathCount={props.pathCount} value={props.data.pathText ?? ""} onChange={(pathText) => props.onPatch({ pathText })} onClear={() => props.onPatch({ pathText: "" })} onPaste={props.onPastePath} />
            <ModePicker disabled={props.running} mode={props.mode} onModeChange={props.onModeChange} />
          </div>
          <div className="grid gap-3 border-b pb-3">
            <div className="text-sm font-semibold">关键开关</div>
            <KeySwitches data={props.data} disabled={props.running} onPatch={props.onPatch} />
          </div>
          <StatusStrip progress={props.progress} status={props.status} text={props.data.progressText} />
        </section>

        <div className="min-h-0">
          <TrenameDisplayTabs
            jsonText={props.jsonText}
            logs={props.logs}
            phase={props.phase}
            result={props.result}
            running={props.running}
            onCopyLogs={props.onCopyLogs}
            onCopyResults={props.onCopyResults}
            onUndoBatch={(batchId) => props.onExecute("undo", { batchId })}
          />
        </div>
      </div>
    </div>
  )
}

function ToolbarActions(props: ViewProps & { compact?: boolean }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-1", props.compact && "justify-between")}>
      <ActionIconButton disabled={props.running || !props.pathCount} icon={ScanSearch} label="扫描路径" onClick={() => props.onExecute("scan")} />
      <JsonEditorDialog
        disabled={props.running}
        jsonText={props.jsonText}
        pendingCount={props.tree.pending}
        readyCount={props.tree.ready}
        totalCount={props.tree.total}
        onChange={(jsonText) => props.onPatch({ jsonText })}
        onCopy={props.onCopyJson}
        onImport={() => props.onExecute("import")}
        onPaste={props.onPasteJson}
      />
      <ActionIconButton disabled={props.running || !props.jsonText} icon={Search} label="校验冲突" onClick={() => props.onExecute("validate")} />
      {!props.compact && <PrimaryActionButton props={props} />}
      <ActionIconButton disabled={props.running} icon={History} label="读取历史" onClick={() => props.onExecute("history")} />
      <ActionIconButton disabled={!props.jsonText} icon={Copy} label="复制 JSON" onClick={props.onCopyJson} />
      <ActionIconButton disabled={!props.result && !props.logs.length} icon={RotateCcw} label="清空状态" onClick={props.onReset} />
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

function PrimaryActionButton({ compact, props }: { compact?: boolean; props: ViewProps }) {
  if (props.running) {
    return (
      <Button aria-label="trename running" disabled size={compact ? "icon-sm" : "sm"} variant="secondary">
        <Square />
        {!compact && <span>运行中</span>}
      </Button>
    )
  }

  const disabled = !props.jsonText
  const label = props.dryRun ? "预演重命名" : "真实重命名"
  if (!props.dryRun) {
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
            <AlertDialogTitle>确认真实执行 Trename？</AlertDialogTitle>
            <AlertDialogDescription>
              当前将执行真实文件重命名。计划 {props.result?.operations.length ?? props.tree.ready} 项，冲突 {props.result?.conflicts.length ?? 0} 项，base path 为 {props.data.basePath || props.result?.basePath || "未指定"}。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => props.onExecute("rename")}>确认执行</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
  }

  return (
    <Button aria-label={label} disabled={disabled} size={compact ? "icon-sm" : "sm"} onClick={() => props.onExecute("rename")}>
      <Play />
      {!compact && <span>{label}</span>}
    </Button>
  )
}

function HeaderLine({ status, subtitle }: {
  status: TrenameStatusMeta
  subtitle: string
}) {
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-2">
        <div className={cn("grid size-8 shrink-0 place-items-center rounded-lg", status.iconClass)}>
          <FilePenLine />
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-sm font-semibold leading-none">Trename</h3>
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
  result: TrenameData | null
  tree: ReturnType<typeof buildTreeModel>
}) {
  const stats = [
    ["总计", props.result?.totalItems ?? props.tree.total],
    ["待填", props.result?.pendingCount ?? props.tree.pending],
    ["就绪", props.result?.readyCount ?? props.tree.ready],
    ["成功", props.result?.successCount ?? 0],
    ["冲突", props.result?.conflicts.length ?? 0],
    ["进度", `${props.progress}%`],
  ] as const

  return (
    <div className="grid shrink-0 grid-cols-3 gap-1 @3xl/trename:grid-cols-6">
      {stats.map(([label, value]) => (
        <div key={label} className="min-w-0 rounded-md bg-muted/35 px-2 py-1.5 text-center">
          <div className="truncate text-[11px] text-muted-foreground">{label}</div>
          <div className={cn("text-sm font-semibold tabular-nums", label === "冲突" && Number(value) > 0 && "text-destructive")}>{value}</div>
        </div>
      ))}
    </div>
  )
}

function buildInput(action: TrenameAction, data: TrenameCardState, jsonText: string): TrenameInput {
  return {
    action,
    paths: data.pathText,
    includeHidden: data.includeHidden ?? false,
    includeRoot: data.includeRoot ?? true,
    excludeExts: data.excludeExts,
    excludePatterns: data.excludePatterns,
    maxLines: data.maxLines ?? 1000,
    compact: data.compact ?? true,
    mode: data.mode ?? "normal",
    jsonContent: jsonText,
    basePath: data.basePath,
    dryRun: data.dryRun ?? true,
    batchId: data.batchId,
    undoPath: data.undoPath,
    keepRecent: data.keepRecent ?? 10,
  }
}

function statusFromState(data: TrenameCardState, running: boolean, tree: ReturnType<typeof buildTreeModel>): TrenameStatusMeta {
  if (running || data.phase === "scanning" || data.phase === "validating" || data.phase === "renaming") {
    return {
      label: "运行中",
      description: data.progressText || "Trename 正在处理当前任务。",
      tone: "running",
      badgeVariant: "secondary",
      iconClass: "bg-primary text-primary-foreground",
    }
  }
  if (data.phase === "error" || data.result?.errors.length) {
    return {
      label: "失败",
      description: data.progressText || data.result?.errors[0] || "上次任务失败，请查看冲突和日志。",
      tone: "error",
      badgeVariant: "destructive",
      iconClass: "bg-destructive text-destructive-foreground",
    }
  }
  if (data.result?.conflicts.length) {
    return {
      label: "有冲突",
      description: `${data.result.conflicts.length} 个冲突需要处理。`,
      tone: "warning",
      badgeVariant: "outline",
      iconClass: "bg-secondary text-secondary-foreground",
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
  if (tree.total) {
    return {
      label: "待校验",
      description: `${tree.total} 项，${tree.ready} 项已准备重命名。`,
      tone: "idle",
      badgeVariant: "outline",
      iconClass: "bg-secondary text-secondary-foreground",
    }
  }
  return {
    label: "就绪",
    description: "粘贴目录并扫描成 rename JSON。",
    tone: "idle",
    badgeVariant: "outline",
    iconClass: "bg-secondary text-secondary-foreground",
  }
}

function phaseFromState(data: TrenameCardState, running: boolean): TrenamePhase {
  if (running) return data.phase ?? "scanning"
  return data.phase ?? "idle"
}

function phaseForAction(action: TrenameAction): TrenamePhase {
  if (action === "scan") return "scanning"
  if (action === "validate") return "validating"
  if (action === "rename" || action === "undo") return "renaming"
  return "ready"
}

function actionLabel(action: TrenameAction): string {
  if (action === "scan") return "扫描"
  if (action === "import") return "导入"
  if (action === "validate") return "校验"
  if (action === "rename") return "重命名"
  if (action === "undo") return "撤销"
  return "读取历史"
}

function summaryText(props: ViewProps): string {
  if (props.data.progressText) return props.data.progressText
  if (props.result?.conflicts.length) return `${props.result.conflicts.length} 个冲突`
  if (props.tree.total) return `${props.tree.total} 项 / ${props.tree.ready} 就绪 / ${props.dryRun ? "预演" : "真实"}`
  if (props.pathCount) return `${props.pathCount} 条路径等待扫描`
  return "选择目录后扫描 rename JSON"
}

function parsePathInput(text: string): string[] {
  const matches = [...text.matchAll(/"([^"]+)"|(\S+)/g)]
  const values = matches.map((match) => match[1] ?? match[2] ?? "").map((value) => value.trim()).filter(Boolean)
  return [...new Set(values)]
}

function resultLines(result: TrenameData | null): string[] {
  if (!result) return []
  return [
    ...result.operations.map((item) => `plan ${item.originalPath} -> ${item.newPath}`),
    ...result.conflicts.map((item) => `conflict ${item.type} ${item.srcPath} -> ${item.tgtPath} / ${item.message}`),
    ...result.history.map((item) => `history ${item.id} ${item.timestamp} ${item.description} ${item.undone ? "undone" : "active"}`),
  ]
}

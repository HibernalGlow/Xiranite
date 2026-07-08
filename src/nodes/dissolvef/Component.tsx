import { useEffect, useMemo, useRef, useState } from "react"
import type { NodeComponentProps, NodeRunResult } from "@xiranite/contract"
import type { DissolvefConflictMode, DissolvefData, DissolvefInput } from "@xiranite/node-dissolvef/core"
import { Copy, History, RotateCcw, Square, Undo2 } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { tNode, useNodeI18n } from "@/nodes/shared/useNodeI18n"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import { DEFAULT_THRESHOLD, DISSOLVE_ICON, NODE_ICON } from "./constants"
import { ActionIconButton, AdvancedOptionsPopover, ConfigDefaultsPopover, HistoryPanel, LogPanel, ModePicker, PathInput, PlanList, PrimarySwitches, StatusStrip } from "./controls"
import type { DissolvefAction, DissolvefCardState, DissolvefPhase, DissolvefStatusMeta } from "./types"
import { CONFIG_FIELDS } from "./types"

export function Component({ compId, host }: NodeComponentProps) {
  const surface = useNodeSurface()
  const { t } = useNodeI18n("dissolvef")
  const data = host.getData<DissolvefCardState>(compId) ?? {}
  const dataRef = useRef<DissolvefCardState>(data)
  dataRef.current = data

  const [running, setRunning] = useState(false)
  const [defaults, setDefaults] = useState<Partial<DissolvefCardState> | undefined>(undefined)
  const [configFilePath, setConfigFilePath] = useState<string | undefined>(undefined)
  const [configDirty, setConfigDirty] = useState(false)

  const logs = data.logs ?? []
  const result = data.result ?? null
  const progress = data.progress ?? 0
  const nested = data.nested ?? true
  const media = data.media ?? true
  const archive = data.archive ?? true
  const direct = data.direct ?? false
  const preview = data.preview ?? true
  const threshold = data.similarityThreshold ?? DEFAULT_THRESHOLD
  const selectedModes = useMemo(() => {
    const modes: string[] = []
    if (nested && !direct) modes.push("nested")
    if (media && !direct) modes.push("media")
    if (archive && !direct) modes.push("archive")
    return modes
  }, [nested, media, archive, direct])
  const phase = phaseFromState(data, running)
  const status = statusFromState(data, running, result)
  const compactSurface = surface.mode === "compact" || surface.mode === "portrait"
  const forceCollapsedSurface = compactSurface && surface.height > 0 && surface.height < 160
  const portraitCompact = surface.mode === "portrait" || (surface.mode === "compact" && surface.width < 560 && surface.height >= 300)

  useEffect(() => {
    host.getNodeConfig?.<Partial<DissolvefCardState>>()
      .then((response) => {
        setDefaults(response.config)
        setConfigFilePath(response.path)
      })
      .catch(() => undefined)
  }, [host])

  useEffect(() => {
    if (!defaults) return
    setConfigDirty(CONFIG_FIELDS.some((field) => String(data[field] ?? "") !== String(defaults[field] ?? "")))
  }, [data.pathText, data.historyPath, data.excludeText, data.nested, data.media, data.archive, data.direct, data.preview, data.protectFirstLevel, data.enableSimilarity, data.similarityThreshold, data.fileConflict, data.dirConflict, defaults])

  function patch(patchData: Partial<DissolvefCardState>) {
    dataRef.current = { ...dataRef.current, ...patchData }
    host.patchData(compId, patchData)
  }

  function pushLog(message: string) {
    const nextLogs = [...(dataRef.current.logs ?? []), message].slice(-100)
    patch({ logs: nextLogs })
  }

  async function pastePath() {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ pathText: text.trim() })
  }

  function setDirectMode(nextDirect: boolean) {
    if (nextDirect) patch({ direct: true, nested: false, media: false, archive: false })
    else patch({ direct: false, nested: true, media: true, archive: true })
  }

  function toggleMode(mode: "nested" | "media" | "archive") {
    patch({ direct: false, [mode]: !(dataRef.current[mode] ?? true) })
  }

  async function execute(action: DissolvefAction) {
    if (running) return
    if (!dataRef.current.pathText?.trim()) {
      patch({ phase: "error", progress: 0, progressText: t("error.noPath", "请先输入目标文件夹。") })
      return
    }

    const input: DissolvefInput = {
      action: action === "dissolve" ? (direct ? "direct" : "dissolve") : action,
      path: dataRef.current.pathText,
      historyPath: dataRef.current.historyPath,
      undoId: dataRef.current.undoId,
      exclude: dataRef.current.excludeText,
      nested,
      media,
      archive,
      direct,
      preview: action === "plan" ? true : preview,
      protectFirstLevel: dataRef.current.protectFirstLevel ?? true,
      enableSimilarity: dataRef.current.enableSimilarity ?? true,
      similarityThreshold: threshold,
      fileConflict: dataRef.current.fileConflict as DissolvefConflictMode | undefined,
      dirConflict: dataRef.current.dirConflict as DissolvefConflictMode | undefined,
    }

    const run = host.actions?.run
    if (!run) {
      patch({ phase: "error", progress: 0, progressText: t("error.noRunEnv", "当前环境没有本地运行能力，请使用桌面模式或 CLI。") })
      pushLog("Native action is unavailable in this host.")
      return
    }

    setRunning(true)
    try {
      patch({ phase: phaseForAction(action), progress: 0, progressText: t("progress.start", "{{action}}开始", { action: actionLabel(action) }), result: null })
      const response = await run<DissolvefInput, DissolvefData>("dissolvef", input, (event) => {
        if (event.type === "progress") {
          patch({ progress: event.progress ?? 0, progressText: event.message })
          pushLog(`[${event.progress ?? 0}%] ${event.message}`)
        } else {
          pushLog(event.message)
        }
      }) as NodeRunResult<DissolvefData>

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

  async function copyLogs() {
    await host.clipboard?.writeText?.(logs.join("\n"))
  }

  function reset() {
    patch({ phase: "idle", progress: 0, progressText: "", result: null, logs: [] })
  }

  async function saveAsDefault() {
    const config: Partial<DissolvefCardState> = {}
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
      historyPath: undefined,
      excludeText: undefined,
      nested: undefined,
      media: undefined,
      archive: undefined,
      direct: undefined,
      preview: undefined,
      protectFirstLevel: undefined,
      enableSimilarity: undefined,
      similarityThreshold: undefined,
      fileConflict: undefined,
      dirConflict: undefined,
    })
  }

  const commonProps = createViewProps({
    configDirty,
    configFilePath,
    data,
    defaults,
    direct,
    host,
    logs,
    preview,
    progress,
    result,
    running,
    selectedModes,
    status,
    onCopyLogs: copyLogs,
    onExecute: execute,
    onOpenConfigFile: host.openConfigFile,
    onPastePath: pastePath,
    onPatch: patch,
    onReset: reset,
    onResetOverride: resetOverride,
    onRestoreDefault: restoreDefault,
    onSaveDefault: saveAsDefault,
    onSetDirect: setDirectMode,
    onToggleMode: toggleMode,
  })

  return (
    <TooltipProvider>
      <div ref={surface.ref} className="@container/dissolvef relative flex h-full min-h-0 w-full overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(circle_at_12%_0%,color-mix(in_oklch,var(--primary)_14%,transparent),transparent_36%),radial-gradient(circle_at_88%_8%,color-mix(in_oklch,var(--chart-5)_14%,transparent),transparent_34%)]" />
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
  data: DissolvefCardState
  defaults?: Partial<DissolvefCardState>
  direct: boolean
  host: NodeComponentProps["host"]
  logs: string[]
  preview: boolean
  progress: number
  result: DissolvefData | null
  running: boolean
  selectedModes: string[]
  status: DissolvefStatusMeta
  onCopyLogs: () => void
  onExecute: (action: DissolvefAction) => void
  onOpenConfigFile?: () => Promise<void> | void
  onPastePath: () => void
  onPatch: (patch: Partial<DissolvefCardState>) => void
  onReset: () => void
  onResetOverride: () => void
  onRestoreDefault: () => void
  onSaveDefault: () => void
  onSetDirect: (direct: boolean) => void
  onToggleMode: (mode: "nested" | "media" | "archive") => void
}) {
  return props
}

function CollapsedView(props: ViewProps) {
  const Icon = NODE_ICON
  return (
    <div data-testid="dissolvef-collapsed-view" className="relative flex h-full min-h-0 items-center gap-2 overflow-hidden rounded-xl border bg-background/85 px-3 py-2 shadow-sm">
      <div className={cn("absolute inset-0 opacity-70 transition-opacity", props.status.tone === "running" && "animate-pulse bg-primary/10", props.status.tone === "error" && "bg-destructive/10", props.status.tone === "success" && "bg-primary/10")} />
      <div className={cn("relative grid size-8 shrink-0 place-items-center rounded-lg", props.status.iconClass)}>
        <Icon />
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="flex items-center gap-1 text-xs font-semibold leading-none">
          <span>Dissolvef</span>
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
    <div data-testid="dissolvef-compact-view" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-2 p-3 pb-2">
        <HeaderLine status={props.status} subtitle={props.data.progressText || summaryText(props)} />
        <div className="flex shrink-0 items-center gap-1">
          <AdvancedOptionsPopover data={props.data} direct={props.direct} disabled={props.running} onPatch={props.onPatch} />
          <PrimaryActionButton compact props={props} />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
        <PathInput compact disabled={props.running} value={props.data.pathText ?? ""} onChange={(pathText) => props.onPatch({ pathText })} onClear={() => props.onPatch({ pathText: "" })} onPaste={props.onPastePath} />
        <ModePicker compact direct={props.direct} disabled={props.running} selectedModes={props.selectedModes} onSetDirect={props.onSetDirect} onToggleMode={props.onToggleMode} />
        <PrimarySwitches compact data={props.data} direct={props.direct} disabled={props.running} onPatch={props.onPatch} />
        <ToolbarActions {...props} compact />
        {(props.status.tone === "running" || props.status.tone === "error") && (
          <StatusStrip compact progress={props.progress} status={props.status} text={props.data.progressText} />
        )}
        <div className="min-h-0 flex-1">
          <DissolvefDisplayTabs compact logs={props.logs} result={props.result} onCopyLogs={props.onCopyLogs} onUndo={(id) => props.onExecute("undo")} />
        </div>
      </div>
    </div>
  )
}

function PortraitCompactView(props: ViewProps) {
  return (
    <div data-testid="dissolvef-portrait-view" className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="flex shrink-0 items-start justify-between gap-2">
        <HeaderLine status={props.status} subtitle={props.data.progressText || summaryText(props)} />
        <div className="flex shrink-0 items-center gap-1">
          <AdvancedOptionsPopover data={props.data} direct={props.direct} disabled={props.running} onPatch={props.onPatch} />
          <PrimaryActionButton compact props={props} />
        </div>
      </div>
      <div className="grid shrink-0 gap-2">
        <PathInput compact disabled={props.running} value={props.data.pathText ?? ""} onChange={(pathText) => props.onPatch({ pathText })} onClear={() => props.onPatch({ pathText: "" })} onPaste={props.onPastePath} />
        <ModePicker compact direct={props.direct} disabled={props.running} selectedModes={props.selectedModes} onSetDirect={props.onSetDirect} onToggleMode={props.onToggleMode} />
        <PrimarySwitches compact data={props.data} direct={props.direct} disabled={props.running} onPatch={props.onPatch} />
        <ToolbarActions {...props} compact />
      </div>
      <div className="min-h-0 flex-1">
        <DissolvefDisplayTabs compact logs={props.logs} result={props.result} onCopyLogs={props.onCopyLogs} onUndo={(id) => props.onExecute("undo")} />
      </div>
    </div>
  )
}

function FullView(props: ViewProps) {
  return (
    <div data-testid="dissolvef-full-view" className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <div className="flex shrink-0 flex-col gap-3 @4xl/dissolvef:flex-row @4xl/dissolvef:items-center @4xl/dissolvef:justify-between">
        <div className="flex min-w-0 flex-col gap-2 @4xl/dissolvef:flex-row @4xl/dissolvef:items-center">
          <HeaderLine status={props.status} subtitle={props.data.progressText || tNode("dissolvef", "subtitle.full", "{{mode}} / {{preview}}", { mode: props.direct ? tNode("dissolvef", "mode.direct", "直提") : tNode("dissolvef", "mode.bundle", "捆绑"), preview: props.preview ? tNode("dissolvef", "mode.dry", "预演") : tNode("dissolvef", "mode.liveExecute", "真实执行") })} />
          <div data-testid="dissolvef-header-toolbar" className="flex min-w-0 flex-wrap items-center gap-2">
            <ToolbarActions {...props} />
          </div>
        </div>
        <StatsPanel progress={props.progress} result={props.result} />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 @5xl/dissolvef:grid-cols-[minmax(320px,380px)_minmax(0,1fr)]">
        <section className="flex min-h-0 flex-col gap-3 overflow-auto pr-1">
          <div className="grid gap-3 border-b pb-3">
            <div>
              <div className="text-sm font-semibold">{tNode("dissolvef", "labels.input", "输入")}</div>
              <div className="text-xs text-muted-foreground">{tNode("dissolvef", "labels.inputHint", "选择捆绑或直提模式，预演确认后再执行真实溶解。")}</div>
            </div>
            <PathInput disabled={props.running} value={props.data.pathText ?? ""} onChange={(pathText) => props.onPatch({ pathText })} onClear={() => props.onPatch({ pathText: "" })} onPaste={props.onPastePath} />
            <ModePicker direct={props.direct} disabled={props.running} selectedModes={props.selectedModes} onSetDirect={props.onSetDirect} onToggleMode={props.onToggleMode} />
          </div>
          <div className="grid gap-3 border-b pb-3">
            <div className="text-sm font-semibold">{tNode("dissolvef", "labels.switches", "关键开关")}</div>
            <PrimarySwitches data={props.data} direct={props.direct} disabled={props.running} onPatch={props.onPatch} />
          </div>
          <StatusStrip progress={props.progress} status={props.status} text={props.data.progressText} />
        </section>

        <div className="h-[clamp(12rem,32vh,20rem)] min-h-0 overflow-hidden @5xl/dissolvef:h-full">
          <DissolvefDisplayTabs logs={props.logs} result={props.result} onCopyLogs={props.onCopyLogs} onUndo={(id) => props.onExecute("undo")} />
        </div>
      </div>
    </div>
  )
}

function ToolbarActions(props: ViewProps & { compact?: boolean }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-1", props.compact && "justify-between")}>
      <ActionIconButton disabled={props.running} icon={History} label={tNode("dissolvef", "actions.history", "读取历史")} onClick={() => props.onExecute("history")} />
      <ActionIconButton disabled={props.running || !props.result?.history.length} icon={Undo2} label={tNode("dissolvef", "actions.undoRecent", "撤销最近")} onClick={() => props.onExecute("undo")} />
      {!props.compact && <PrimaryActionButton props={props} />}
      <ActionIconButton icon={RotateCcw} label={tNode("dissolvef", "actions.clearState", "清空状态")} onClick={props.onReset} />
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
      <Button aria-label={tNode("dissolvef", "aria.running", "dissolvef running")} disabled size={compact ? "icon-sm" : "sm"} variant="secondary">
        <Square />
        {!compact && <span>{tNode("dissolvef", "status.running", "运行中")}</span>}
      </Button>
    )
  }

  const disabled = !props.data.pathText?.trim()
  const label = props.preview ? tNode("dissolvef", "actions.dryDissolve", "预演溶解") : tNode("dissolvef", "actions.liveDissolve", "真实溶解")
  const Icon = DISSOLVE_ICON
  if (!props.preview) {
    return (
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button aria-label={label} disabled={disabled} size={compact ? "icon-sm" : "sm"} variant="destructive">
            <Icon />
            {!compact && <span>{label}</span>}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tNode("dissolvef", "confirm.title", "确认真实执行 Dissolvef？")}</AlertDialogTitle>
            <AlertDialogDescription>
              {tNode("dissolvef", "confirm.description", "当前将真实移动和删除文件夹，模式为 {{mode}}，目标 {{path}}。操作会记录到历史，可撤销但无法还原删除。", { mode: props.direct ? tNode("dissolvef", "mode.direct", "直提") : tNode("dissolvef", "mode.bundle", "捆绑"), path: props.data.pathText || "未指定" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tNode("dissolvef", "common:cancel", "取消")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => props.onExecute("dissolve")}>{tNode("dissolvef", "actions.confirmExecute", "确认执行")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
  }

  return (
    <Button aria-label={label} disabled={disabled} size={compact ? "icon-sm" : "sm"} onClick={() => props.onExecute("dissolve")}>
      <Icon />
      {!compact && <span>{label}</span>}
    </Button>
  )
}

function HeaderLine({ status, subtitle }: {
  status: DissolvefStatusMeta
  subtitle: string
}) {
  const Icon = NODE_ICON
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-2">
        <div className={cn("grid size-8 shrink-0 place-items-center rounded-lg", status.iconClass)}>
          <Icon />
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-sm font-semibold leading-none">Dissolvef</h3>
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
  result: DissolvefData | null
}) {
  const failedLabel = tNode("dissolvef", "stats.failed", "失败")
  const errorLabel = tNode("dissolvef", "stats.error", "错误")
  const stats = [
    [tNode("dissolvef", "stats.total", "总计"), props.result?.totalCount ?? 0],
    [tNode("dissolvef", "stats.nested", "嵌套"), props.result?.nestedCount ?? 0],
    [tNode("dissolvef", "stats.media", "媒体"), props.result?.mediaCount ?? 0],
    [tNode("dissolvef", "stats.archive", "归档"), props.result?.archiveCount ?? 0],
    [tNode("dissolvef", "stats.skipped", "跳过"), props.result?.skippedCount ?? 0],
    [tNode("dissolvef", "stats.progress", "进度"), `${props.progress}%`],
  ] as const

  return (
    <div className="grid shrink-0 grid-cols-3 gap-1 @3xl/dissolvef:grid-cols-6">
      {stats.map(([label, value]) => (
        <div key={label} className="min-w-0 rounded-md bg-muted/35 px-2 py-1.5 text-center">
          <div className="truncate text-[11px] text-muted-foreground">{label}</div>
          <div className={cn("text-sm font-semibold tabular-nums", (label === failedLabel || label === errorLabel) && Number(value) > 0 && "text-destructive")}>{value}</div>
        </div>
      ))}
    </div>
  )
}

function DissolvefDisplayTabs(props: {
  compact?: boolean
  logs: string[]
  result: DissolvefData | null
  onCopyLogs: () => void
  onUndo: (id: string) => void
}) {
  const hasResult = Boolean(props.result)
  const preferredTab = hasResult ? "plan" : props.logs.length ? "logs" : "plan"
  const [tab, setTab] = useState(preferredTab)

  useEffect(() => {
    setTab(preferredTab)
  }, [preferredTab])

  return (
    <Tabs value={tab} onValueChange={setTab} className="flex h-full min-h-0 flex-col">
      <TabsList className="shrink-0">
        <TabsTrigger value="plan">{tNode("dissolvef", "tabs.plan", "计划")}</TabsTrigger>
        <TabsTrigger value="history">{tNode("dissolvef", "tabs.history", "历史")}</TabsTrigger>
        <TabsTrigger value="logs">{tNode("dissolvef", "tabs.logs", "日志")}</TabsTrigger>
      </TabsList>
      <TabsContent value="plan" className="min-h-0 flex-1">
        <PlanList compact={props.compact} result={props.result} />
      </TabsContent>
      <TabsContent value="history" className="min-h-0 flex-1">
        <HistoryPanel compact={props.compact} result={props.result} onUndo={props.onUndo} />
      </TabsContent>
      <TabsContent value="logs" className="min-h-0 flex-1">
        <LogPanel compact={props.compact} logs={props.logs} onCopy={props.onCopyLogs} />
      </TabsContent>
    </Tabs>
  )
}

function statusFromState(data: DissolvefCardState, running: boolean, result: DissolvefData | null): DissolvefStatusMeta {
  if (running || data.phase === "planning" || data.phase === "dissolving") {
    return {
      label: tNode("dissolvef", "status.running", "运行中"),
      description: data.progressText || tNode("dissolvef", "desc.running", "Dissolvef 正在生成计划或执行溶解。"),
      tone: "running",
      badgeVariant: "secondary",
      iconClass: "bg-primary text-primary-foreground",
    }
  }
  if (data.phase === "error" || result?.errors.length) {
    return {
      label: tNode("dissolvef", "status.error", "失败"),
      description: data.progressText || result?.errors[0] || tNode("dissolvef", "desc.error", "上次任务失败，请查看计划和日志。"),
      tone: "error",
      badgeVariant: "destructive",
      iconClass: "bg-destructive text-destructive-foreground",
    }
  }
  if (data.phase === "completed") {
    return {
      label: tNode("dissolvef", "status.success", "完成"),
      description: data.progressText || tNode("dissolvef", "desc.success", "上次任务已完成。"),
      tone: "success",
      badgeVariant: "default",
      iconClass: "bg-primary text-primary-foreground",
    }
  }
  return {
    label: tNode("dissolvef", "status.idle", "就绪"),
    description: tNode("dissolvef", "desc.idle", "粘贴文件夹后预演或溶解。"),
    tone: "idle",
    badgeVariant: "outline",
    iconClass: "bg-secondary text-secondary-foreground",
  }
}

function phaseFromState(data: DissolvefCardState, running: boolean): DissolvefPhase {
  if (running) return data.phase ?? "planning"
  return data.phase ?? "idle"
}

function phaseForAction(action: DissolvefAction): DissolvefPhase {
  if (action === "plan") return "planning"
  if (action === "dissolve") return "dissolving"
  if (action === "undo") return "dissolving"
  return "planning"
}

function actionLabel(action: DissolvefAction): string {
  if (action === "plan") return tNode("dissolvef", "actionLabel.plan", "预演")
  if (action === "dissolve") return tNode("dissolvef", "actionLabel.dissolve", "溶解")
  if (action === "history") return tNode("dissolvef", "actionLabel.history", "历史")
  if (action === "undo") return tNode("dissolvef", "actionLabel.undo", "撤销")
  return action
}

function summaryText(props: ViewProps): string {
  if (props.data.progressText) return props.data.progressText
  if (props.result?.totalCount) return tNode("dissolvef", "summary.total", "{{total}} 项 / {{success}} 成功", { total: props.result.totalCount, success: props.result.successCount })
  if (props.data.pathText) return tNode("dissolvef", "summary.mode", "{{mode}} / {{preview}}", { mode: props.direct ? tNode("dissolvef", "mode.direct", "直提") : tNode("dissolvef", "mode.bundle", "捆绑"), preview: props.preview ? tNode("dissolvef", "mode.dry", "预演") : tNode("dissolvef", "mode.live", "真实") })
  return tNode("dissolvef", "summary.empty", "粘贴文件夹后开始溶解")
}

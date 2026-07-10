import { Fragment, useEffect, useMemo, useRef, useState } from "react"
import type { NodeComponentProps, NodeRunResult } from "@xiranite/contract"
import type { DissolvefConflictMode, DissolvefData, DissolvefInput } from "@xiranite/node-dissolvef/core"
import type { LucideIcon } from "lucide-react"
import { ArrowRight, Eye, History, RotateCcw, ShieldAlert, Square, Undo2 } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { NumberTicker } from "@/components/ui/number-ticker"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldContent, FieldDescription, FieldTitle } from "@/components/ui/field"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { tNode, useNodeI18n } from "@/nodes/shared/useNodeI18n"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import { BUNDLE_MODES, DEFAULT_THRESHOLD, DIRECT_ICON, DISSOLVE_ICON, NODE_ICON } from "./constants"
import { ActionIconButton, AdvancedOptionsPopover, ConfigDefaultsPopover, DissolveHistoryBoard, DissolvePlanBoard, ModePicker, PathInput, PrimarySwitches, RichLogPanel, StatusStrip } from "./controls"
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
      <div ref={surface.ref} className="@container/dissolvef flex h-full min-h-0 w-full overflow-hidden bg-card">
        <div className="flex min-h-0 w-full flex-col">
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
    <div data-testid="dissolvef-collapsed-view" className="flex h-full min-h-0 items-center gap-2 overflow-hidden rounded-xl border bg-card px-3 py-2 shadow-sm">
      <div className={cn("grid size-8 shrink-0 place-items-center rounded-lg", props.status.iconClass)}>
        <Icon />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-xs font-semibold leading-none">
          <span>{tNode("dissolvef", "name", "DissolveF")}</span>
          <Badge variant={props.status.badgeVariant}>{props.status.label}</Badge>
        </div>
        <div className="mt-1 truncate text-xs text-muted-foreground">{summaryText(props)}</div>
      </div>
      <PrimaryActionButton compact props={props} />
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
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
        <div className="grid shrink-0 gap-2 @[280px]/dissolvef:grid-cols-2">
          <PathInput compact disabled={props.running} value={props.data.pathText ?? ""} onChange={(pathText) => props.onPatch({ pathText })} onClear={() => props.onPatch({ pathText: "" })} onPaste={props.onPastePath} />
          <ModePicker compact direct={props.direct} disabled={props.running} selectedModes={props.selectedModes} onSetDirect={props.onSetDirect} onToggleMode={props.onToggleMode} />
        </div>
        <ExecutionGate compact props={props} />
        <PrimarySwitches compact showPreview={false} data={props.data} direct={props.direct} disabled={props.running} onPatch={props.onPatch} />
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
        </div>
      </div>
      <div className="grid shrink-0 gap-2">
        <PathInput compact disabled={props.running} value={props.data.pathText ?? ""} onChange={(pathText) => props.onPatch({ pathText })} onClear={() => props.onPatch({ pathText: "" })} onPaste={props.onPastePath} />
        <ModePicker compact direct={props.direct} disabled={props.running} selectedModes={props.selectedModes} onSetDirect={props.onSetDirect} onToggleMode={props.onToggleMode} />
        <ExecutionGate compact props={props} />
        <PrimarySwitches compact showPreview={false} data={props.data} direct={props.direct} disabled={props.running} onPatch={props.onPatch} />
        <ToolbarActions {...props} compact />
      </div>
      {(props.status.tone === "running" || props.status.tone === "error") && (
        <StatusStrip compact progress={props.progress} status={props.status} text={props.data.progressText} />
      )}
      <div className="min-h-0 flex-1">
        <DissolvefDisplayTabs compact logs={props.logs} result={props.result} onCopyLogs={props.onCopyLogs} onUndo={(id) => props.onExecute("undo")} />
      </div>
    </div>
  )
}

function FullView(props: ViewProps) {
  const isRunning = props.status.tone === "running"
  const isError = props.status.tone === "error"
  const live = !props.preview
  return (
    <div data-testid="dissolvef-full-view" className="flex min-h-0 flex-1 flex-col gap-2 p-3">
      <div className="flex shrink-0 flex-col gap-2 @3xl/dissolvef:flex-row @3xl/dissolvef:items-center @3xl/dissolvef:justify-between">
        <div className="flex min-w-0 flex-col gap-2 @3xl/dissolvef:flex-row @3xl/dissolvef:items-center">
          <HeaderLine status={props.status} subtitle={props.data.progressText || tNode("dissolvef", "subtitle.full", "{{mode}} / {{preview}}", { mode: props.direct ? tNode("dissolvef", "mode.direct", "直提") : tNode("dissolvef", "mode.bundle", "捆绑"), preview: props.preview ? tNode("dissolvef", "mode.dry", "预演") : tNode("dissolvef", "mode.liveExecute", "真实执行") })} />
          <div data-testid="dissolvef-header-toolbar" className="flex min-w-0 flex-wrap items-center gap-1">
            <ToolbarActions {...props} hidePrimaryAction />
          </div>
        </div>
        <StatsPanel progress={props.progress} result={props.result} />
      </div>

      <InputDropZone
        disabled={props.running}
        value={props.data.pathText ?? ""}
        onChange={(pathText) => props.onPatch({ pathText })}
        onClear={() => props.onPatch({ pathText: "" })}
        onPaste={props.onPastePath}
      />

      <div className="grid shrink-0 gap-2 @2xl/dissolvef:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <ModePipeline
          direct={props.direct}
          disabled={props.running}
          result={props.result}
          selectedModes={props.selectedModes}
          onSetDirect={props.onSetDirect}
          onToggleMode={props.onToggleMode}
        />
        <div className={cn("flex min-h-0 flex-col gap-2 rounded-lg border bg-card p-2", live && "border-destructive/50")}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">{tNode("dissolvef", "execution.title", "执行闸门")}</span>
            <AdvancedOptionsPopover data={props.data} direct={props.direct} disabled={props.running} onPatch={props.onPatch} />
          </div>
          <PrimarySwitches showPreview={false} data={props.data} direct={props.direct} disabled={props.running} onPatch={props.onPatch} />
          <ExecutionGate embedded props={props} />
        </div>
      </div>

      {(isRunning || isError) && (
        <StatusStrip progress={props.progress} status={props.status} text={props.data.progressText} />
      )}

      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border bg-card">
        <DissolvefDisplayTabs logs={props.logs} result={props.result} onCopyLogs={props.onCopyLogs} onUndo={(id) => props.onExecute("undo")} />
      </div>

      <LogsStrip logs={props.logs} onCopy={props.onCopyLogs} />
    </div>
  )
}

function InputDropZone(props: {
  disabled?: boolean
  value: string
  onChange: (value: string) => void
  onClear: () => void
  onPaste: () => void
}) {
  return (
    <div className="shrink-0 overflow-hidden rounded-lg border bg-card p-2">
      <PathInput compact disabled={props.disabled} value={props.value} onChange={props.onChange} onClear={props.onClear} onPaste={props.onPaste} />
    </div>
  )
}

function ModePipeline(props: {
  direct: boolean
  disabled?: boolean
  result: DissolvefData | null
  selectedModes: string[]
  onSetDirect: (direct: boolean) => void
  onToggleMode: (mode: "nested" | "media" | "archive") => void
}) {
  const DirectIcon = DIRECT_ICON
  if (props.direct) {
    const directCount = (props.result?.directFiles ?? 0) + (props.result?.directDirs ?? 0)
    return (
      <div className="flex min-h-0 flex-col gap-2 rounded-lg border bg-card p-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <span>{tNode("dissolvef", "labels.modePipeline", "溶解流水线")}</span>
          <Badge variant="secondary">{tNode("dissolvef", "mode.direct", "直提")}</Badge>
        </div>
        <PipelineStage
          icon={DirectIcon}
          label={tNode("dissolvef", "mode.direct", "直提")}
          hint={tNode("dissolvef", "pipeline.directHint", "全部上提到父级")}
          count={directCount}
          active
          disabled={props.disabled}
          onClick={() => props.onSetDirect(false)}
        />
        <Button aria-label={tNode("dissolvef", "aria.bundleMode", "捆绑模式")} disabled={props.disabled} size="sm" variant="outline" onClick={() => props.onSetDirect(false)}>
          <span className="truncate">{tNode("dissolvef", "pipeline.switchBundle", "切换到捆绑模式")}</span>
        </Button>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-col gap-2 rounded-lg border bg-card p-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <span>{tNode("dissolvef", "labels.modePipeline", "溶解流水线")}</span>
        <Badge variant="outline">{tNode("dissolvef", "mode.bundle", "捆绑")}</Badge>
      </div>
      <div className="flex items-stretch gap-1">
        {BUNDLE_MODES.map((mode, index) => (
          <Fragment key={mode.value}>
            <PipelineStage
              icon={mode.icon}
              label={tNode("dissolvef", `bundleModes.${mode.value}.shortLabel`, mode.shortLabel)}
              hint={tNode("dissolvef", `bundleModes.${mode.value}.description`, mode.description)}
              count={modeCount(props.result, mode.value)}
              active={props.selectedModes.includes(mode.value)}
              disabled={props.disabled}
              onClick={() => props.onToggleMode(mode.value)}
            />
            {index < BUNDLE_MODES.length - 1 && (
              <div className="grid shrink-0 place-items-center text-muted-foreground/60">
                <ArrowRight className="size-3" />
              </div>
            )}
          </Fragment>
        ))}
      </div>
      <Button aria-label={tNode("dissolvef", "aria.directMode", "直提模式")} disabled={props.disabled} size="sm" variant="outline" onClick={() => props.onSetDirect(true)}>
        <DirectIcon data-icon="inline-start" />
        <span className="truncate">{tNode("dissolvef", "pipeline.switchDirect", "切换到直提模式")}</span>
      </Button>
    </div>
  )
}

function PipelineStage(props: {
  icon: LucideIcon
  label: string
  hint?: string
  count: number
  active: boolean
  disabled?: boolean
  onClick: () => void
}) {
  const Icon = props.icon
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={props.label}
          disabled={props.disabled}
          size="sm"
          variant={props.active ? "secondary" : "outline"}
          onClick={props.onClick}
          className={cn(
            "h-auto min-w-0 flex-1 flex-col items-center gap-0.5 px-1.5 py-1.5",
            !props.active && "opacity-60",
          )}
        >
          <Icon className="size-3.5 text-muted-foreground" />
          <span className="truncate text-[11px] font-medium">{props.label}</span>
          <span className="text-sm font-semibold tabular-nums">
            {props.count > 0 ? <NumberTicker value={props.count} className="text-foreground" /> : props.count}
          </span>
        </Button>
      </TooltipTrigger>
      {props.hint && <TooltipContent side="bottom" className="max-w-[200px]">{props.hint}</TooltipContent>}
    </Tooltip>
  )
}

function LogsStrip(props: {
  logs: string[]
  onCopy: () => void
}) {
  if (!props.logs.length) return null
  return (
    <div className="flex shrink-0 items-center gap-2 rounded-md border bg-card px-2 py-1">
      <History className="size-3.5 shrink-0 text-muted-foreground" />
      <ScrollArea className="min-w-0 flex-1">
        <div className="flex items-center gap-3 font-mono text-[11px] leading-5 text-muted-foreground">
          {props.logs.slice(-5).map((line, index) => (
            <span key={`${line}:${index}`} className="whitespace-nowrap">{line}</span>
          ))}
        </div>
      </ScrollArea>
      <Button disabled={!props.logs.length} size="xs" variant="ghost" onClick={props.onCopy}>
        {tNode("dissolvef", "copyLogs", "复制")}
      </Button>
    </div>
  )
}

function ToolbarActions(props: ViewProps & { compact?: boolean; hidePrimaryAction?: boolean }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-1", props.compact && "justify-between")}>
      <ActionIconButton disabled={props.running} icon={History} label={tNode("dissolvef", "actions.history", "读取历史")} onClick={() => props.onExecute("history")} />
      <ActionIconButton disabled={props.running || !props.result?.history.length} icon={Undo2} label={tNode("dissolvef", "actions.undoRecent", "撤销最近")} onClick={() => props.onExecute("undo")} />
      {!props.compact && !props.hidePrimaryAction && <PrimaryActionButton props={props} />}
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
      <Button aria-label={tNode("dissolvef", "aria.running", "dissolvef running")} disabled size={compact ? "xs" : "sm"} variant="secondary">
        <Square />
        <span>{tNode("dissolvef", "status.running", "运行中")}</span>
      </Button>
    )
  }

  const disabled = !props.data.pathText?.trim()
  const label = props.preview ? tNode("dissolvef", "actions.dryDissolve", "预演溶解") : tNode("dissolvef", "actions.liveDissolve", "真实溶解")
  const compactLabel = props.preview ? tNode("dissolvef", "actions.preview", "预演") : tNode("dissolvef", "actions.execute", "执行")
  const Icon = DISSOLVE_ICON
  if (!props.preview) {
    return (
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button aria-label={label} disabled={disabled} size={compact ? "xs" : "sm"} variant="destructive">
            <Icon />
            <span>{compact ? compactLabel : label}</span>
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
    <Button aria-label={label} disabled={disabled} size={compact ? "xs" : "sm"} onClick={() => props.onExecute("dissolve")}>
      <Icon />
      <span>{compact ? compactLabel : label}</span>
    </Button>
  )
}

function ExecutionGate({ compact, embedded, props }: { compact?: boolean; embedded?: boolean; props: ViewProps }) {
  const preview = props.preview
  const modeTitle = preview
    ? tNode("dissolvef", "execution.previewState", "预演：不移动或删除")
    : tNode("dissolvef", "execution.liveState", "真实：将移动并删除空壳")
  const modeDescription = preview
    ? tNode("dissolvef", "execution.previewDescription", "只生成溶解计划；文件夹保持不变。")
    : tNode("dissolvef", "execution.liveDescription", "会移动内容并删除空文件夹；执行前仍需确认。")

  return (
    <section
      data-testid="dissolvef-execution-gate"
      className={cn(
        "flex min-w-0 items-center gap-2",
        compact && "grid grid-cols-[minmax(0,1fr)_auto]",
        !embedded && "rounded-lg border bg-card px-2 py-1.5",
        embedded && "border-t pt-2",
        !preview && "border-destructive/50",
      )}
    >
      <Field orientation="horizontal" className="min-w-0 flex-1 items-center gap-2">
        {preview ? <Eye className="shrink-0 text-muted-foreground" /> : <ShieldAlert className="shrink-0 text-destructive" />}
        <FieldContent className="min-w-0 gap-0.5">
          <FieldTitle className="truncate text-xs">{compact ? (preview ? tNode("dissolvef", "switches.preview", "预演") : tNode("dissolvef", "mode.liveExecute", "真实执行")) : modeTitle}</FieldTitle>
          {!compact && <FieldDescription className="truncate text-[11px]">{modeDescription}</FieldDescription>}
        </FieldContent>
        <Switch
          aria-label={tNode("dissolvef", "aria.previewSwitch", "dissolvef preview switch")}
          checked={preview}
          disabled={props.running}
          size="default"
          onCheckedChange={(nextPreview) => props.onPatch({ preview: nextPreview })}
        />
      </Field>
      {!compact && !embedded && <Separator className="h-6 shrink-0" orientation="vertical" />}
      <PrimaryActionButton compact={compact} props={props} />
    </section>
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
            <h3 className="truncate text-sm font-semibold leading-none">{tNode("dissolvef", "name", "DissolveF")}</h3>
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
    { label: tNode("dissolvef", "stats.total", "总计"), value: props.result?.totalCount ?? 0, numeric: true },
    { label: tNode("dissolvef", "stats.nested", "嵌套"), value: props.result?.nestedCount ?? 0, numeric: true },
    { label: tNode("dissolvef", "stats.media", "媒体"), value: props.result?.mediaCount ?? 0, numeric: true },
    { label: tNode("dissolvef", "stats.archive", "归档"), value: props.result?.archiveCount ?? 0, numeric: true },
    { label: tNode("dissolvef", "stats.skipped", "跳过"), value: props.result?.skippedCount ?? 0, numeric: true },
    { label: tNode("dissolvef", "stats.progress", "进度"), value: `${props.progress}%`, numeric: false },
  ]

  return (
    <div className="grid shrink-0 grid-cols-3 gap-1 @3xl/dissolvef:grid-cols-6">
      {stats.map((item) => {
        const isError = (item.label === failedLabel || item.label === errorLabel) && Number(item.value) > 0
        return (
          <div key={item.label} className="min-w-0 rounded-md bg-muted/35 px-2 py-1.5 text-center">
            <div className="truncate text-[11px] text-muted-foreground">{item.label}</div>
            <div className={cn("text-sm font-semibold tabular-nums", isError && "text-destructive")}>
              {item.numeric ? <NumberTicker value={item.value as number} className="text-foreground" /> : item.value}
            </div>
          </div>
        )
      })}
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
        <DissolvePlanBoard compact={props.compact} result={props.result} />
      </TabsContent>
      <TabsContent value="history" className="min-h-0 flex-1">
        <DissolveHistoryBoard compact={props.compact} result={props.result} onUndo={props.onUndo} />
      </TabsContent>
      <TabsContent value="logs" className="min-h-0 flex-1">
        <RichLogPanel compact={props.compact} logs={props.logs} onCopy={props.onCopyLogs} />
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

function modeCount(result: DissolvefData | null, mode: string): number {
  if (mode === "nested") return result?.nestedCount ?? 0
  if (mode === "media") return result?.mediaCount ?? 0
  if (mode === "archive") return result?.archiveCount ?? 0
  return 0
}

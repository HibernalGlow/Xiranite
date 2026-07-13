import { useEffect, useRef, useState } from "react"
import type { NodeComponentProps, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type { SmartZipAction, SmartZipData, SmartZipInput } from "@xiranite/node-smartzip/core"
import { FileArchive, FolderInput, Play, RotateCcw, Square, Terminal } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { tNode, useNodeI18n } from "@/nodes/shared/useNodeI18n"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import { RunningTint } from "@/nodes/shared/controls"
import { ACTIONS, actionI18nKey, isDestructiveAction } from "./constants"
import {
  ActionIconButton,
  ActionPicker,
  ConfigDefaultsPopover,
  OptionsPopover,
  PathFields,
  PathsInput,
  RuntimeOptions,
  StatusStrip,
} from "./controls"
import { SmartZipResultTabs, SmartZipStatsPanel } from "./results"
import type { SmartZipCardState, SmartZipStatusMeta } from "./types"
import { CONFIG_FIELDS } from "./types"

export function Component({ compId, host }: NodeComponentProps<SmartZipCardState>) {
  const surface = useNodeSurface()
  const { t } = useNodeI18n("smartzip")
  const data = getHostData(host, compId)
  const dataRef = useRef<SmartZipCardState>(data)
  dataRef.current = data

  const [running, setRunning] = useState(false)
  const [defaults, setDefaults] = useState<Partial<SmartZipCardState> | undefined>(undefined)
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
    const loadConfig = host.config?.get?.<Partial<SmartZipCardState>>() ?? host.getNodeConfig?.<Partial<SmartZipCardState>>()
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
    data.iniPath,
    data.codePage,
    data.databasePath,
    data.dryRun,
    data.recordRun,
    defaults,
  ])

  function patch(patchData: Partial<SmartZipCardState>) {
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
    if (current.command) lines.push(`${current.command.label}\t${current.command.command}\t${current.command.args.join(" ")}`)
    if (current.commandResult) lines.push(`code=${current.commandResult.code}\tstderr=${current.commandResult.stderr}`)
    for (const operation of current.operations ?? []) lines.push(`${operation.status}\t${operation.sourcePath}\t${operation.outputPath ?? operation.message}`)
    if (current.config) lines.push(`ext=${current.config.archiveExtensions.join(",")}`)
    await host.clipboard?.writeText?.(lines.join("\n"))
  }

  function reset() {
    patch({ logs: [], phase: "idle", progress: 0, progressText: "", result: null })
  }

  async function saveAsDefault() {
    const config: Partial<SmartZipCardState> = {}
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
    const empty: Partial<SmartZipCardState> = {}
    for (const field of CONFIG_FIELDS) empty[field] = undefined
    patch(empty)
  }

  async function execute(nextAction: SmartZipAction = action) {
    if (running) return
    const current = dataRef.current
    if (nextAction !== "status" && !clean(current.pathsText)) {
      const message = t("error.noPaths", "请先输入至少一个归档或目录路径。")
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
    patch({ action: nextAction, phase: "running", progress: 0, progressText: t("progress.start", "{{action}}开始", { action: actionLabel(nextAction) }), result: null })
    try {
      const response = await run<SmartZipInput, SmartZipData>("smartzip", buildInput(nextAction, current), (event: NodeRunEvent) => {
        if (event.type === "progress") {
          patch({ progress: event.progress ?? 0, progressText: event.message })
          pushLog(`[${event.progress ?? 0}%] ${event.message}`)
          return
        }
        pushLog(event.message)
      }) as NodeRunResult<SmartZipData>

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
    onActionChange: (value: SmartZipAction) => patch({ action: value }),
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
      <div ref={surface.ref} className="@container/smartzip relative flex h-full min-h-0 w-full overflow-hidden">
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
  action: SmartZipAction
  actionMeta: typeof ACTIONS[number]
  configDirty: boolean
  configFilePath?: string
  data: SmartZipCardState
  defaults?: Partial<SmartZipCardState>
  logs: string[]
  progress: number
  result: SmartZipData | null
  running: boolean
  status: SmartZipStatusMeta
  onActionChange: (value: SmartZipAction) => void
  onCopyLogs: () => void
  onCopyResults: () => void
  onExecute: (action?: SmartZipAction) => void
  onOpenConfigFile?: () => Promise<void> | void
  onPastePaths: () => void
  onPatch: (patch: Partial<SmartZipCardState>) => void
  onReset: () => void
  onResetOverride: () => void
  onRestoreDefault: () => void
  onSaveDefault: () => void
}) {
  return props
}

function CollapsedView(props: ViewProps) {
  const Icon = props.actionMeta.icon
  return (
    <div data-testid="smartzip-collapsed-view" className="relative flex h-full min-h-0 items-center gap-2 overflow-hidden rounded-xl border bg-background/85 px-3 py-2 shadow-sm">
      <RunningTint tone={props.status.tone} />
      <div className={cn("relative grid size-8 shrink-0 place-items-center rounded-lg", props.status.iconClass)}>
        <FileArchive />
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="flex items-center gap-1 text-xs font-semibold leading-none">
          <span>SmartZip</span>
          <Badge variant={props.status.badgeVariant}>{props.status.label}</Badge>
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-1 truncate text-xs text-muted-foreground">
          <Icon className="size-3.5 shrink-0" />
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
    <div data-testid="smartzip-compact-view" className="flex min-h-0 flex-1 flex-col">
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
          <SmartZipResultTabs compact logs={props.logs} result={props.result} running={props.running} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} />
        </div>
      </div>
    </div>
  )
}

function PortraitCompactView(props: ViewProps) {
  return (
    <div data-testid="smartzip-portrait-view" className="flex h-full min-h-0 flex-col gap-2 p-2">
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
        <SmartZipResultTabs compact logs={props.logs} result={props.result} running={props.running} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} />
      </div>
    </div>
  )
}

function FullView(props: ViewProps) {
  const { t } = useNodeI18n("smartzip")
  const showLegacySurface = false
  return (
    <div data-testid="smartzip-full-view" className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <div className="flex shrink-0 flex-col gap-3 @4xl/smartzip:flex-row @4xl/smartzip:items-center @4xl/smartzip:justify-between">
        <div className="flex min-w-0 flex-col gap-2 @4xl/smartzip:flex-row @4xl/smartzip:items-center">
          <HeaderLine actionMeta={props.actionMeta} status={props.status} subtitle={props.data.progressText || summaryText(props)} />
          <div data-testid="smartzip-header-toolbar" className="flex min-w-0 flex-wrap items-center gap-2">
            <ActionPicker action={props.action} disabled={props.running} triggerClassName="@4xl/smartzip:w-72" onActionChange={props.onActionChange} />
            <ActionIconButton disabled={props.running} icon={RotateCcw} label={t("actions.clear", "清空状态")} onClick={props.onReset} />
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
        <SmartZipStatsPanel result={props.result} />
      </div>

      <div className="grid min-h-0 flex-1 gap-3 @4xl/smartzip:grid-cols-[minmax(220px,280px)_minmax(0,1fr)_minmax(240px,300px)]">
        <section className="flex min-h-0 flex-col gap-3 rounded-lg border bg-card p-3">
          <div className="flex items-center gap-2"><FolderInput className="size-4 text-muted-foreground" /><span className="text-sm font-semibold">{t("fields.paths", "路径")}</span></div>
          <PathsInput data={props.data} disabled={props.running} onPaste={props.onPastePaths} onPatch={props.onPatch} />
          <div className="mt-auto grid gap-1.5 text-xs text-muted-foreground">
            {(props.result?.selectedPaths ?? props.data.pathsText?.split(/\r?\n/).filter(Boolean) ?? []).map((path) => <div key={path} className="truncate rounded-md border px-2 py-1.5">{path}</div>)}
          </div>
        </section>
        <CommandChamber result={props.result} />
        <section className="flex min-h-0 flex-col gap-3 rounded-lg border bg-card p-3">
          <div className="flex items-center gap-2"><FileArchive className="size-4 text-muted-foreground" /><span className="text-sm font-semibold">{t("fields.runtimeConfig", "运行配置 · 自动检测 7-Zip")}</span></div>
          <PathFields data={props.data} disabled={props.running} onPatch={props.onPatch} />
          <RuntimeOptions data={props.data} disabled={props.running} onPatch={props.onPatch} />
          <div className="min-h-0 flex-1"><SmartZipResultTabs logs={props.logs} result={props.result} running={props.running} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} /></div>
          <div className="mt-auto"><div className="mb-2 text-sm font-semibold">{t("fields.run", "运行")}</div><RunActionButton props={props} /></div>
        </section>
      </div>
      {showLegacySurface && <div>
        <section className="flex min-h-0 flex-col gap-3 overflow-auto pr-1">
          <div className="grid gap-3 border-b pb-3">
            <div>
              <div className="text-sm font-semibold">{t("fields.paths", "路径")}</div>
              <div className="text-xs text-muted-foreground">{t("hints.pathsHelp", "归档或目录，每行一条。status 不需要路径。")}</div>
            </div>
            <PathsInput data={props.data} disabled={props.running} onPaste={props.onPastePaths} onPatch={props.onPatch} />
          </div>
          <div className="grid gap-3 border-b pb-3">
            <div className="text-sm font-semibold">{t("fields.runtimeConfig", "运行配置 · 自动检测 7-Zip")}</div>
            <PathFields data={props.data} disabled={props.running} onPatch={props.onPatch} />
          </div>
          <div className="grid gap-3 border-b pb-3">
            <div className="text-sm font-semibold">{t("fields.run", "运行")}</div>
            <RuntimeOptions data={props.data} disabled={props.running} onPatch={props.onPatch} />
          </div>
          <StatusStrip progress={props.progress} status={props.status} text={props.data.progressText} />
        </section>
        <div className="min-h-0">
          <SmartZipResultTabs logs={props.logs} result={props.result} running={props.running} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} />
        </div>
      </div>}
    </div>
  )
}

function CommandChamber({ result }: { result: SmartZipData | null }) {
  const { t } = useNodeI18n("smartzip")
  const command = result?.command
  return (
    <section className="flex min-h-0 flex-col rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-2 border-b pb-3"><div className="flex items-center gap-2"><Terminal className="size-4 text-primary" /><span className="text-sm font-semibold">{t("labels.operationChamber", "Operation chamber")}</span></div><Badge variant="outline">{command ? t("badges.planned", "planned") : t("badges.idle", "idle")}</Badge></div>
      <div className="min-h-0 flex-1 overflow-auto py-4 font-mono text-xs leading-6">
        {command ? <><div className="text-muted-foreground">{t("labels.commandPlan", "; TYPESCRIPT WORKFLOW PLAN")}</div><div className="mt-2 break-words text-primary">$ {command.command} {command.args.join(" ")}</div><div className="mt-6 border-t pt-4 text-muted-foreground">{t("labels.queuedArchives", "; QUEUED ARCHIVES")}</div>{result?.selectedPaths.map((path) => <div key={path} className="truncate">{path}</div>)}</> : <div className="text-muted-foreground">{t("labels.runCommandHint", "Run an action to produce the TypeScript SmartZip workflow plan.")}</div>}
      </div>
    </section>
  )
}

function RunActionButton({ compact, props }: { compact?: boolean; props: ViewProps }) {
  const { t } = useNodeI18n("smartzip")
  if (props.running) {
    return (
      <Button aria-label="smartzip running" disabled size={compact ? "icon-sm" : "sm"} variant="secondary">
        <Square />
        {!compact && <span>{t("status.running", "运行中")}</span>}
      </Button>
    )
  }

  const label = actionLabel(props.action)
  const destructive = isDestructiveAction(props.action) && !(props.data.dryRun ?? true)
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
            <AlertDialogTitle>{t("confirm.title", "确认{{action}}？", { action: label })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("confirm.description", "当前已关闭预演，TypeScript SmartZip 工作流会通过自动检测的 7-Zip 执行{{action}}，可能修改磁盘文件。", { action: label })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("actions.cancel", "取消")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => props.onExecute(props.action)}>{t("actions.confirm", "确认执行")}</AlertDialogAction>
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
  status: SmartZipStatusMeta
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
            <h3 className="truncate text-sm font-semibold leading-none">SmartZip</h3>
            <Badge variant={status.badgeVariant}>{status.label}</Badge>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>
    </div>
  )
}

function buildInput(action: SmartZipAction, data: SmartZipCardState): SmartZipInput {
  const pathsText = clean(data.pathsText)
  const paths = pathsText ? pathsText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) : []
  return {
    action,
    paths,
    iniPath: clean(data.iniPath),
    codePage: data.codePage ?? 936,
    databasePath: clean(data.databasePath),
    dryRun: data.dryRun ?? true,
    recordRun: data.recordRun ?? false,
  }
}

function statusFromState(data: SmartZipCardState, running: boolean): SmartZipStatusMeta {
  if (running || data.phase === "running") {
    return {
      label: tNode("smartzip", "status.running", "运行中"),
      description: data.progressText || tNode("smartzip", "status.runningDesc", "SmartZip 正在加载配置或执行命令。"),
      tone: "running",
      badgeVariant: "secondary",
      iconClass: "bg-primary text-primary-foreground",
    }
  }
  if (data.phase === "completed") {
    return {
      label: tNode("smartzip", "status.completed", "完成"),
      description: data.progressText || tNode("smartzip", "status.completedDesc", "上次任务已完成。"),
      tone: "success",
      badgeVariant: "default",
      iconClass: "bg-primary text-primary-foreground",
    }
  }
  if (data.phase === "error") {
    return {
      label: tNode("smartzip", "status.error", "失败"),
      description: data.progressText || tNode("smartzip", "status.errorDesc", "上次任务失败，请查看日志。"),
      tone: "error",
      badgeVariant: "destructive",
      iconClass: "bg-destructive text-destructive-foreground",
    }
  }
  return {
    label: tNode("smartzip", "status.idle", "就绪"),
    description: tNode("smartzip", "status.idleDesc", "选择动作后查看状态、智能解压、打包或打开。"),
    tone: "idle",
    badgeVariant: "outline",
    iconClass: "bg-secondary text-secondary-foreground",
  }
}

function summaryText(props: ViewProps): string {
  if (props.data.progressText) return props.data.progressText
  if (props.result?.selectedPaths.length) {
    return tNode("smartzip", "summary.stats", "{{paths}} 路径 / {{archives}} 归档 / {{errors}} 错误", {
      paths: props.result.selectedPaths.length,
      archives: props.result.archiveCount,
      errors: props.result.errors.length,
    })
  }
  return tNode("smartzip", `actions.${actionI18nKey(props.actionMeta.value)}.description`, props.actionMeta.description)
}

function actionLabel(action: SmartZipAction): string {
  const meta = ACTIONS.find((item) => item.value === action)
  if (!meta) return action
  return tNode("smartzip", `actions.${actionI18nKey(action)}.label`, meta.label)
}

function clean(value: unknown): string | undefined {
  const text = String(value ?? "").trim()
  return text || undefined
}

function getHostData(host: NodeComponentProps<SmartZipCardState>["host"], compId: string): SmartZipCardState {
  return host.state?.getData?.() ?? host.getData<SmartZipCardState>(compId) ?? {}
}

import { useEffect, useRef, useState } from "react"
import type { NodeComponentProps, NodeRunResult } from "@xiranite/contract"
import type { SeriexAction, SeriexData, SeriexInput } from "@xiranite/node-seriex/core"
import { Copy, FileText, FolderTree, RotateCcw, Square } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { NodeConfigPopover } from "@/nodes/shared/NodeConfigPopover"
import { useNodeI18n } from "@/nodes/shared/useNodeI18n"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import { RunningTint } from "@/nodes/shared/controls"
import { ACTIONS } from "./constants"
import {
  ActionIconButton,
  ActionPicker,
  AdvancedOptionsPopover,
  ConfigTextPanel,
  PathFields,
  PrimarySwitches,
  StatusStrip,
} from "./controls"
import { defaultConfigIfEmpty, getActionMeta } from "./utils"
import type { SeriexCardState, SeriexStatusMeta } from "./types"
import { CONFIG_FIELDS } from "./types"

export function Component({ compId, host }: NodeComponentProps) {
  "use no memo"
  const surface = useNodeSurface()
  const { t } = useNodeI18n("seriex")
  const data = host.getData<SeriexCardState>(compId) ?? {}
  const dataRef = useRef<SeriexCardState>(data)
  dataRef.current = data

  const [, setRevision] = useState(0)
  const [running, setRunning] = useState(false)
  const [defaults, setDefaults] = useState<Partial<SeriexCardState> | undefined>(undefined)
  const [configFilePath, setConfigFilePath] = useState<string | undefined>(undefined)
  const [configDirty, setConfigDirty] = useState(false)

  const logs = data.logs ?? []
  const result = data.result ?? null
  const progress = data.progress ?? 0
  const action = data.action ?? "plan"
  const actionMeta = getActionMeta(action)
  const dryRun = data.dryRun ?? false
  const knownSeriesArray = splitLines(data.knownSeriesText)
  const status = statusFromState(data, running)
  const compactSurface = surface.mode === "compact" || surface.mode === "portrait"
  const forceCollapsedSurface = compactSurface && surface.height > 0 && surface.height < 160
  const portraitCompact = surface.mode === "portrait" || (surface.mode === "compact" && surface.width < 560 && surface.height >= 300)

  async function loadDefaults() {
    try {
      const response = await host.getNodeConfig?.<Partial<SeriexCardState>>()
      setDefaults(response?.config)
      setConfigFilePath(response?.path)
    } catch {
      // The node is still usable when the host has no persistent config.
    }
  }

  useEffect(() => { void loadDefaults() }, [host])

  useEffect(() => {
    if (!defaults) return
    setConfigDirty(CONFIG_FIELDS.some((field) => String(data[field] ?? "") !== String(defaults[field] ?? "")))
  }, [
    data.directoryPath,
    data.configPath,
    data.configText,
    data.knownSeriesText,
    data.prefix,
    data.addPrefix,
    data.dryRun,
    defaults,
  ])

  function patch(patchData: Partial<SeriexCardState>) {
    dataRef.current = { ...dataRef.current, ...patchData }
    host.patchData(compId, patchData)
    setRevision((value) => value + 1)
  }

  function pushLog(message: string) {
    const nextLogs = [...(dataRef.current.logs ?? []), message].slice(-120)
    patch({ logs: nextLogs })
  }

  async function pasteConfig() {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ configText: text })
  }

  async function pasteKnownSeries() {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ knownSeriesText: text })
  }

  async function copyResults() {
    const text = resultText(result)
    if (text) await host.clipboard?.writeText?.(text)
  }

  async function copyLogs() {
    if (logs.length) await host.clipboard?.writeText?.(logs.join("\n"))
  }

  async function execute(nextAction: SeriexAction) {
    if (running) return
    const nextActionMeta = getActionMeta(nextAction)

    const run = host.actions?.run
    if (!run) {
      const message = "Local Backend 暂不可用，无法执行 seriex。"
      patch({ phase: "error", progress: 0, progressText: message })
      pushLog("Native action is unavailable in this host.")
      return
    }

    const input: SeriexInput = {
      action: nextAction,
      directoryPath: dataRef.current.directoryPath,
      configPath: dataRef.current.configPath,
      configText: dataRef.current.configText,
      knownSeriesNames: splitLines(dataRef.current.knownSeriesText),
      prefix: dataRef.current.prefix || "[#s]",
      addPrefix: dataRef.current.addPrefix ?? true,
      dryRun: nextAction === "plan" ? true : dataRef.current.dryRun ?? false,
    }

    setRunning(true)
    try {
      patch({
        action: nextAction,
        phase: "running",
        progress: 0,
        progressText: `${nextActionMeta.shortLabel}开始`,
        result: null,
      })
      const response = await run<SeriexInput, SeriexData>("seriex", input, (event) => {
        if (event.type === "progress") {
          patch({ progress: event.progress ?? 0, progressText: event.message })
          pushLog(`[${event.progress ?? 0}%] ${event.message}`)
        } else {
          pushLog(event.message)
        }
      }) as NodeRunResult<SeriexData>

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
    const config: Partial<SeriexCardState> = {}
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

  const commonProps = createViewProps({
    action,
    actionMeta,
    configDirty,
    configFilePath,
    data,
    defaults,
    dryRun,
    host,
    logs,
    knownSeriesArray,
    progress,
    result,
    running,
    status,
    t,
    onCopyLogs: copyLogs,
    onCopyResults: copyResults,
    onExecute: execute,
    onOpenConfigFile: host.openConfigFile,
    onPasteConfig: pasteConfig,
    onPasteKnownSeries: pasteKnownSeries,
    onPatch: patch,
    onReset: reset,
    onReloadDefaults: loadDefaults,
    onRestoreDefault: restoreDefault,
    onSaveDefault: saveAsDefault,
  })

  return (
    <TooltipProvider>
      <div ref={surface.ref} className="@container/seriex relative flex h-full min-h-0 w-full overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(circle_at_14%_0%,color-mix(in_oklch,var(--primary)_14%,transparent),transparent_36%),radial-gradient(circle_at_88%_8%,color-mix(in_oklch,var(--chart-4)_16%,transparent),transparent_34%)]" />
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
  action: SeriexAction
  actionMeta: typeof ACTIONS[number]
  configDirty: boolean
  configFilePath?: string
  data: SeriexCardState
  defaults?: Partial<SeriexCardState>
  dryRun: boolean
  host: NodeComponentProps["host"]
  logs: string[]
  knownSeriesArray: string[]
  progress: number
  result: SeriexData | null
  running: boolean
  status: SeriexStatusMeta
  t: ReturnType<typeof useNodeI18n>["t"]
  onCopyLogs: () => void
  onCopyResults: () => void
  onExecute: (action: SeriexAction) => void
  onOpenConfigFile?: () => Promise<void> | void
  onPasteConfig: () => void
  onPasteKnownSeries: () => void
  onPatch: (patch: Partial<SeriexCardState>) => void
  onReset: () => void
  onReloadDefaults: () => Promise<void>
  onRestoreDefault: () => void
  onSaveDefault: () => void
}) {
  return props
}

function CollapsedView(props: ViewProps) {
  const ActionIcon = props.actionMeta.icon
  return (
    <div data-testid="seriex-collapsed-view" className="relative flex h-full min-h-0 items-center gap-2 overflow-hidden rounded-xl border bg-background/85 px-3 py-2 shadow-sm">
      <RunningTint tone={props.status.tone} />
      <div className={cn("relative grid size-8 shrink-0 place-items-center rounded-lg", props.status.iconClass)}>
        <FolderTree />
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="flex items-center gap-1 text-xs font-semibold leading-none">
          <span>Seriex</span>
          <Badge variant={props.status.badgeVariant}>{props.status.label}</Badge>
        </div>
        <div className="mt-1 truncate text-xs text-muted-foreground">{summaryText(props)}</div>
      </div>
      <Button aria-label={props.actionMeta.label} disabled={props.running} size="icon-sm" onClick={() => props.onExecute(props.action)}>
        <ActionIcon />
        <span className="sr-only">{props.actionMeta.label}</span>
      </Button>
      {props.status.tone === "running" && <div className="relative text-xs tabular-nums text-muted-foreground">{props.progress}%</div>}
    </div>
  )
}

function CompactView(props: ViewProps) {
  return (
    <div data-testid="seriex-compact-view" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-2 p-3 pb-2">
        <HeaderLine status={props.status} subtitle={props.data.progressText || summaryText(props)} />
        <div className="flex shrink-0 items-center gap-1">
          <AdvancedOptionsPopover data={props.data} disabled={props.running} onPatch={props.onPatch} />
          <PrimaryActionButton compact props={props} />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
        <ActionPicker action={props.action} disabled={props.running} dryRun={props.dryRun} result={props.result} onExecute={props.onExecute} onPatch={props.onPatch} />
        <ActiveFieldPanel compact {...props} />
        <ToolbarActions compact {...props} />
        {(props.status.tone === "running" || props.status.tone === "error") && (
          <StatusStrip compact progress={props.progress} status={props.status} text={props.data.progressText} />
        )}
        <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-muted/20 p-2 font-mono text-xs">
          <ResultBody compact result={props.result} />
        </div>
      </div>
    </div>
  )
}

function PortraitCompactView(props: ViewProps) {
  return (
    <div data-testid="seriex-portrait-view" className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="flex shrink-0 items-start justify-between gap-2">
        <HeaderLine status={props.status} subtitle={props.data.progressText || summaryText(props)} />
        <div className="flex shrink-0 items-center gap-1">
          <AdvancedOptionsPopover data={props.data} disabled={props.running} onPatch={props.onPatch} />
          <PrimaryActionButton compact props={props} />
        </div>
      </div>
      <div className="grid shrink-0 gap-2">
        <ActionPicker action={props.action} disabled={props.running} dryRun={props.dryRun} result={props.result} onExecute={props.onExecute} onPatch={props.onPatch} />
        <ActiveFieldPanel compact {...props} />
        <PrimarySwitches compact data={props.data} disabled={props.running} onPatch={props.onPatch} />
        <ToolbarActions compact {...props} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-muted/20 p-2 font-mono text-xs">
        <ResultBody result={props.result} />
      </div>
    </div>
  )
}

function FullView(props: ViewProps) {
  if ((props.data.action as string | undefined) === "legacy") return <LegacyFullView {...props} />
  return <SeriexReferenceWorkspace {...props} />
}

function LegacyFullView(props: ViewProps) {
  return (
    <div data-testid="seriex-full-view" className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <div className="flex shrink-0 flex-col gap-3 @4xl/seriex:flex-row @4xl/seriex:items-center @4xl/seriex:justify-between">
        <div className="flex min-w-0 flex-col gap-2 @4xl/seriex:flex-row @4xl/seriex:items-center">
          <HeaderLine
            status={props.status}
            subtitle={props.data.progressText || `${actionGroupLabel(props.action)} · ${props.dryRun ? "预演" : "真实"}`}
          />
          <div data-testid="seriex-header-toolbar" className="flex min-w-0 flex-wrap items-center gap-2">
            <ToolbarActions {...props} />
          </div>
        </div>
        <StatsPanel progress={props.progress} result={props.result} />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 @5xl/seriex:grid-cols-[minmax(320px,380px)_minmax(0,1fr)]">
        <section className="flex min-h-0 flex-col gap-3 overflow-auto pr-1">
          <div className="grid gap-3 border-b pb-3">
            <div>
              <div className="text-sm font-semibold">操作类型</div>
              <div className="text-xs text-muted-foreground">选择要执行的系列归档动作。</div>
            </div>
            <ActionPicker action={props.action} disabled={props.running} dryRun={props.dryRun} result={props.result} onExecute={props.onExecute} onPatch={props.onPatch} />
          </div>
          <div className="grid gap-3 border-b pb-3">
            <div className="text-sm font-semibold">路径与前缀</div>
            <PathFields data={props.data} disabled={props.running} onPatch={props.onPatch} />
          </div>
          <div className="grid gap-3 border-b pb-3">
            <div className="text-sm font-semibold">配置与已知系列</div>
            <ActiveFieldPanel {...props} />
          </div>
          <div className="grid gap-3 border-b pb-3">
            <div className="text-sm font-semibold">关键开关</div>
            <PrimarySwitches data={props.data} disabled={props.running} onPatch={props.onPatch} />
          </div>
          <StatusStrip progress={props.progress} status={props.status} text={props.data.progressText} />
        </section>

        <div className="flex min-h-0 flex-col gap-2">
          <div className="flex shrink-0 items-center justify-between gap-2">
            <div className="text-sm font-semibold">执行结果</div>
            <ActionIconButton disabled={!props.result} icon={Copy} label="复制结果" onClick={props.onCopyResults} />
          </div>
          <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-muted/20 p-3 font-mono text-xs leading-5">
            <ResultBody result={props.result} />
          </div>
          <div className="h-32 shrink-0 overflow-auto rounded-md border bg-muted/15 p-2 font-mono text-xs text-muted-foreground">
            {props.logs.length ? props.logs.map((line, index) => <div key={index} className="truncate">{line}</div>) : (
              <div className="flex h-full items-center justify-center text-muted-foreground">暂无日志</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function SeriexReferenceWorkspace(props: ViewProps) {
  const planItems = props.result?.planItems ?? []
  return (
    <div data-testid="seriex-full-view" className="flex min-h-0 flex-1 flex-col gap-3 p-3 @4xl/seriex:p-4">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/70 pb-2">
        <HeaderLine status={props.status} subtitle={props.data.progressText || props.t("workbench.subtitle", "扫描目录，识别系列结构，再执行归档计划")} />
        <div data-testid="seriex-header-toolbar"><ToolbarActions {...props} showPrimary={false} /></div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 @4xl/seriex:grid-cols-[minmax(15rem,.82fr)_minmax(0,1.25fr)_minmax(16rem,.9fr)]">
        <Card className="min-h-0 gap-4 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-base">{props.t("workbench.scanTitle", "系列扫描")}</CardTitle>
            <CardDescription>{props.t("workbench.scanDesc", "设置来源目录与归档命名规则")}</CardDescription>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-4">
            <ActionPicker action={props.action} disabled={props.running} dryRun={props.dryRun} result={props.result} onExecute={props.onExecute} onPatch={props.onPatch} />
            <PathFields data={props.data} disabled={props.running} onPatch={props.onPatch} />
            <PrimarySwitches data={props.data} disabled={props.running} onPatch={props.onPatch} />
            <StatusStrip progress={props.progress} status={props.status} text={props.data.progressText} />
            <div className="min-h-24 flex-1 overflow-auto rounded-md border bg-muted/15 p-2 font-mono text-xs text-muted-foreground">
              {props.logs.length ? props.logs.map((line, index) => <div key={index} className="truncate">{line}</div>) : <div className="grid h-full place-items-center">{props.t("empty.logs", "暂无运行日志")}</div>}
            </div>
          </CardContent>
        </Card>
        <Card className="min-h-0 gap-4 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-base">{props.t("workbench.clusters", "检测到的系列")}</CardTitle>
            <CardDescription>{planItems.length ? props.t("workbench.clusterCount", "已识别 {{count}} 个可归档系列", { count: planItems.length }) : props.t("workbench.clusterEmpty", "先运行预览以生成聚类结果")}</CardDescription>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 overflow-auto px-4">
            <SeriesClusterList items={planItems} t={props.t} />
          </CardContent>
        </Card>
        <Card className="min-h-0 gap-4 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-base">{props.t("workbench.execution", "归档执行")}</CardTitle>
            <CardDescription>{props.dryRun ? props.t("workbench.dryRun", "预演模式不会移动文件") : props.t("workbench.live", "执行会修改文件系统")}</CardDescription>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-3 px-4">
            <div data-testid="seriex-stats-panel" className="grid gap-2 text-sm">
              <ExecutionMetric label={props.t("stats.series", "系列") } value={planItems.length} />
              <ExecutionMetric label={props.t("stats.files", "文件") } value={props.result?.totalFiles ?? 0} />
              <ExecutionMetric label={props.t("stats.progress", "进度") } value={`${props.progress}%`} />
            </div>
            <div className="min-h-0 flex-1 rounded-md border bg-muted/15 p-3 text-xs text-muted-foreground">
              <div className="font-medium text-foreground">{props.t("workbench.destination", "目标目录")}</div>
              <p className="mt-1 break-all font-mono">{props.data.directoryPath || props.t("workbench.destinationEmpty", "尚未设置来源目录")}</p>
              <p className="mt-3">{props.t("workbench.executeHint", "执行将按左侧预览生成的计划整理文件；危险操作会要求确认。")}</p>
            </div>
          </CardContent>
          <CardFooter className="flex-col gap-2 px-4">
            <div className="h-1 w-full overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-[width]" style={{ width: `${props.progress}%` }} /></div>
            <div className="w-full [&>button]:w-full [&>button]:justify-center [&>button]:py-5"><PrimaryActionButton props={props} /></div>
          </CardFooter>
        </Card>
      </div>
    </div>
  )
}

function SeriesClusterList({ items, t }: { items: NonNullable<SeriexData["planItems"]>; t: ViewProps["t"] }) {
  if (!items.length) return <div className="grid h-full min-h-40 place-items-center text-center text-sm text-muted-foreground">{t("workbench.clusterEmpty", "先运行预览以生成聚类结果")}</div>
  return <div className="flex flex-col gap-3">{items.map((item) => <Card key={`${item.directory}:${item.folder}`} className="gap-3 py-3 shadow-none"><CardHeader className="px-3"><CardTitle className="flex items-center gap-2 text-sm"><FolderTree className="size-4 text-primary" />{item.folder}<Badge variant="secondary">{item.files.length}</Badge></CardTitle><CardDescription className="truncate font-mono text-xs">{item.directory}</CardDescription></CardHeader><CardContent className="flex gap-2 overflow-x-auto px-3 pb-1">{item.files.slice(0, 4).map((file) => <div key={file} className="flex w-20 shrink-0 flex-col gap-1 rounded-md border bg-muted/15 p-2"><FileText className="size-5 text-muted-foreground" /><span className="truncate font-mono text-[10px]">{file.split(/[\\/]/).at(-1)}</span></div>)}{item.files.length > 4 && <div className="grid w-20 shrink-0 place-items-center rounded-md border border-dashed text-xs text-muted-foreground">+{item.files.length - 4}</div>}</CardContent></Card>)}</div>
}

function ExecutionMetric({ label, value }: { label: string; value: number | string }) {
  return <div className="flex items-center justify-between border-b border-border/70 py-1.5"><span className="text-muted-foreground">{label}</span><span className="font-mono font-semibold tabular-nums">{value}</span></div>
}

function ActiveFieldPanel(props: ViewProps & { compact?: boolean }) {
  return (
    <div className="grid gap-2">
      <ConfigTextPanel
        ariaLabel="seriex config"
        compact={props.compact}
        count={configLineCount(props.data.configText)}
        disabled={props.running}
        inputId="seriex-config-text"
        label="配置"
        placeholder={"formats = [\".mp4\", \".nov\"]\nprefix = \"[#s]\""}
        value={defaultConfigIfEmpty(props.data.configText)}
        onChange={(configText) => props.onPatch({ configText })}
        onClear={() => props.onPatch({ configText: "" })}
        onPaste={props.onPasteConfig}
      />
      <ConfigTextPanel
        ariaLabel="seriex known series"
        compact={props.compact}
        count={props.knownSeriesArray.length}
        disabled={props.running}
        inputId="seriex-known-series"
        label="已知系列"
        placeholder={"我的系列\n另一系列"}
        value={props.data.knownSeriesText ?? ""}
        onChange={(knownSeriesText) => props.onPatch({ knownSeriesText })}
        onClear={() => props.onPatch({ knownSeriesText: "" })}
        onPaste={props.onPasteKnownSeries}
      />
    </div>
  )
}

function ToolbarActions(props: ViewProps & { compact?: boolean; showPrimary?: boolean }) {
  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-1", props.compact && "justify-between")}>
      {props.showPrimary !== false && <PrimaryActionButton compact={props.compact} props={props} />}
      <ActionIconButton disabled={!props.result} icon={Copy} label="复制结果" onClick={props.onCopyResults} />
      <ActionIconButton disabled={!props.logs.length} icon={Copy} label="复制日志" onClick={props.onCopyLogs} />
      <ActionIconButton disabled={props.running} icon={RotateCcw} label="清空状态" onClick={props.onReset} />
      {!props.compact && <NodeConfigPopover configPath={props.configFilePath} defaults={props.defaults as Record<string, unknown> | undefined} dirty={props.configDirty} disabled={props.running} t={props.t} onOpenFile={props.onOpenConfigFile} onReload={props.onReloadDefaults} onRestore={props.onRestoreDefault} onSave={props.onSaveDefault} />}
    </div>
  )
}

function PrimaryActionButton({ compact, props }: { compact?: boolean; props: ViewProps }) {
  if (props.running) {
    return (
      <Button aria-label="seriex running" disabled size={compact ? "icon-sm" : "sm"} variant="secondary">
        <Square />
        {!compact && <span>运行中</span>}
      </Button>
    )
  }

  const actionMeta = props.actionMeta
  const dangerous = isDangerousAction(props.action)
  const label = dangerous ? dangerLabel(props.action) : `执行${actionMeta.shortLabel}`
  const Icon = actionMeta.icon

  if (dangerous) {
    return (
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button aria-label={label} size={compact ? "icon-sm" : "sm"} variant="destructive">
            <Icon />
            {!compact && <span>{label}</span>}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{dangerTitle(props.action)}</AlertDialogTitle>
            <AlertDialogDescription>
              {dangerDescription(props)}
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
    <Button aria-label={label} size={compact ? "icon-sm" : "sm"} onClick={() => props.onExecute(props.action)}>
      <Icon />
      {!compact && <span>{label}</span>}
    </Button>
  )
}

function HeaderLine({ status, subtitle }: {
  status: SeriexStatusMeta
  subtitle: string
}) {
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-2">
        <div className={cn("grid size-8 shrink-0 place-items-center rounded-lg", status.iconClass)}>
          <FolderTree />
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-sm font-semibold leading-none">Seriex</h3>
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
  result: SeriexData | null
}) {
  const stats = [
    ["系列", props.result?.totalSeries ?? 0],
    ["文件", props.result?.totalFiles ?? 0],
    ["已移", props.result?.movedCount ?? 0],
    ["失败", props.result?.failedCount ?? 0],
    ["错误", props.result?.errors.length ?? 0],
    ["进度", `${props.progress}%`],
  ] as const

  return (
    <div data-testid="seriex-stats-panel" className="grid shrink-0 grid-cols-3 gap-1 @4xl/seriex:grid-cols-6">
      {stats.map(([label, value]) => (
        <div key={label} className="min-w-0 rounded-md bg-muted/35 px-2 py-1.5 text-center">
          <div className="truncate text-[11px] text-muted-foreground">{label}</div>
          <div className={cn("text-sm font-semibold tabular-nums", (label === "失败" || label === "错误") && Number(value) > 0 && "text-destructive")}>{value}</div>
        </div>
      ))}
    </div>
  )
}

function ResultBody({ compact, result }: { compact?: boolean; result: SeriexData | null }) {
  if (!result) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        选择动作并执行后将在此显示结果
      </div>
    )
  }
  const limit = compact ? 30 : 80
  if (result.planItems.length) {
    return (
      <div className="grid gap-1">
        {result.planItems.slice(0, limit).map((item) => (
          <div key={`${item.directory}:${item.folder}`}>
            <div className="truncate text-primary">{item.folder}</div>
            <div className="truncate text-muted-foreground">{item.files.length} 个文件 · {item.directory}</div>
          </div>
        ))}
      </div>
    )
  }
  if (result.moveItems.length) {
    return (
      <div className="grid gap-1">
        {result.moveItems.slice(0, limit).map((item) => (
          <div key={`${item.sourcePath}:${item.targetPath}`} className="truncate">
            <span className={item.success ? "text-primary" : "text-destructive"}>{item.success ? "成功" : "失败"}</span> {item.filename} → {item.folder}
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className="flex h-full items-center justify-center text-muted-foreground">
      {result.totalSeries} 个系列 · {result.totalFiles} 个文件
    </div>
  )
}

function statusFromState(data: SeriexCardState, running: boolean): SeriexStatusMeta {
  if (running || data.phase === "running") {
    return {
      label: "运行中",
      description: data.progressText || "Seriex 正在执行当前任务。",
      tone: "running",
      badgeVariant: "secondary",
      iconClass: "bg-primary text-primary-foreground",
    }
  }
  if (data.phase === "error" || (data.result?.errors.length ?? 0) > 0) {
    return {
      label: "失败",
      description: data.progressText || data.result?.errors[0] || "上次任务失败，请查看日志。",
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
    description: "选择动作后执行系列归档任务。",
    tone: "idle",
    badgeVariant: "outline",
    iconClass: "bg-secondary text-secondary-foreground",
  }
}

function isDangerousAction(action: SeriexAction): boolean {
  return action === "execute" || action === "apply"
}

function dangerLabel(action: SeriexAction): string {
  if (action === "execute") return "真实执行"
  if (action === "apply") return "真实应用"
  return "真实执行"
}

function dangerTitle(action: SeriexAction): string {
  if (action === "execute") return "确认执行文件移动？"
  if (action === "apply") return "确认应用系列计划？"
  return "确认真实执行 Seriex？"
}

function dangerDescription(props: ViewProps): string {
  if (props.action === "execute" || props.action === "apply") {
    const series = props.result?.totalSeries ?? 0
    const files = props.result?.totalFiles ?? 0
    return `当前将按计划把 ${files} 个文件移动到 ${series} 个系列文件夹，此操作会修改文件系统且不可撤销。请确认目录和配置无误后继续。`
  }
  return "当前操作会修改文件系统，请确认无误后继续。"
}

function actionGroupLabel(action: SeriexAction): string {
  const meta = ACTIONS.find((item) => item.value === action)
  return meta?.shortLabel ?? "预览"
}

function summaryText(props: ViewProps): string {
  if (props.data.progressText) return props.data.progressText
  if (props.result?.failedCount) return `${props.result.failedCount} 个失败`
  if (props.result?.planItems.length) return `${props.result.totalSeries} 个系列 · ${props.result.totalFiles} 个文件`
  if (props.result?.moveItems.length) return `${props.result.movedCount} 已移 · ${props.result.failedCount} 失败`
  return `${props.actionMeta.shortLabel} · ${props.dryRun ? "预演" : "真实"}`
}

function resultText(result: SeriexData | null): string {
  if (!result) return ""
  if (result.planItems.length) {
    return result.planItems.map((item) => `${item.folder}\n${item.directory}\n${item.files.map((file) => `  ${file}`).join("\n")}`).join("\n")
  }
  if (result.moveItems.length) {
    return result.moveItems.map((item) => `${item.success ? "OK" : "FAIL"} ${item.filename} -> ${item.folder}`).join("\n")
  }
  return ""
}

function configLineCount(value?: string): number {
  if (!value || !value.trim()) return 0
  return value.split(/\r?\n/).length
}

function splitLines(value?: string): string[] {
  return (value ?? "").split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean)
}

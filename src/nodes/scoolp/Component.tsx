import { useEffect, useMemo, useRef, useState } from "react"
import type { NodeComponentProps, NodeRunResult } from "@xiranite/contract"
import type { ScoolpAction, ScoolpData, ScoolpInput } from "@xiranite/node-scoolp/core"
import { formatSize, parseScoolpSyncConfig, planScoolpSyncCommands } from "@xiranite/node-scoolp/core"
import { Copy, Package, RotateCcw, Square } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import { ACTIONS } from "./constants"
import {
  ActionIconButton,
  ActionMeta,
  ActionPicker,
  AdvancedOptionsPopover,
  ConfigDefaultsPopover,
  ConfigTextPanel,
  PathFields,
  PrimarySwitches,
  StatusStrip,
  defaultConfigIfEmpty,
} from "./controls"
import type { ScoolpCardState, ScoolpStatusMeta } from "./types"
import { CONFIG_FIELDS } from "./types"

export function Component({ compId, host }: NodeComponentProps) {
  const surface = useNodeSurface()
  const data = host.getData<ScoolpCardState>(compId) ?? {}
  const dataRef = useRef<ScoolpCardState>(data)
  dataRef.current = data

  const [, setRevision] = useState(0)
  const [running, setRunning] = useState(false)
  const [defaults, setDefaults] = useState<Partial<ScoolpCardState> | undefined>(undefined)
  const [configFilePath, setConfigFilePath] = useState<string | undefined>(undefined)
  const [configDirty, setConfigDirty] = useState(false)

  const logs = data.logs ?? []
  const result = data.result ?? null
  const progress = data.progress ?? 0
  const action = data.action ?? "status"
  const actionMeta = ActionMeta(action)
  const dryRun = data.dryRun ?? true
  const packagesArray = useMemo(() => splitPackages(data.packages), [data.packages])
  const status = statusFromState(data, running)
  const compactSurface = surface.mode === "compact" || surface.mode === "portrait"
  const forceCollapsedSurface = compactSurface && surface.height > 0 && surface.height < 160
  const portraitCompact = surface.mode === "portrait" || (surface.mode === "compact" && surface.width < 560 && surface.height >= 300)

  useEffect(() => {
    host.getNodeConfig?.<Partial<ScoolpCardState>>()
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
    data.configText,
    data.packageName,
    data.packages,
    data.cachePath,
    data.scoopRoot,
    data.dryRun,
    defaults,
  ])

  function patch(patchData: Partial<ScoolpCardState>) {
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

  async function pastePackages() {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ packages: text })
  }

  async function copyResults() {
    const text = resultText(result)
    if (text) await host.clipboard?.writeText?.(text)
  }

  async function copyLogs() {
    if (logs.length) await host.clipboard?.writeText?.(logs.join("\n"))
  }

  async function execute(nextAction: ScoolpAction) {
    if (running) return
    const nextActionMeta = ActionMeta(nextAction)

    if ((nextAction === "sync" || nextAction === "show_config") && dataRef.current.configText?.trim()) {
      try {
        const syncConfig = parseScoolpSyncConfig(dataRef.current.configText)
        const syncPlan = planScoolpSyncCommands(syncConfig, true)
        patch({
          action: nextAction,
          phase: "completed",
          progress: 100,
          progressText: `预演：${syncPlan.length} 条命令`,
          result: emptyResult({ syncConfig, syncPlan }),
        })
        pushLog(`sync dry-run: ${syncPlan.length} command(s)`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        patch({ phase: "error", progress: 0, progressText: message })
        pushLog(message)
      }
      return
    }

    const run = host.actions?.run
    if (!run) {
      const message = "Local Backend 暂不可用，无法执行 scoolp。"
      patch({ phase: "error", progress: 0, progressText: message })
      pushLog("Native action is unavailable in this host.")
      return
    }

    const input: ScoolpInput = {
      action: nextAction,
      path: dataRef.current.path,
      configText: dataRef.current.configText,
      packageName: dataRef.current.packageName,
      packages: splitPackages(dataRef.current.packages),
      cachePath: dataRef.current.cachePath,
      scoopRoot: dataRef.current.scoopRoot,
      dryRun,
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
      const response = await run<ScoolpInput, ScoolpData>("scoolp", input, (event) => {
        if (event.type === "progress") {
          patch({ progress: event.progress ?? 0, progressText: event.message })
          pushLog(`[${event.progress ?? 0}%] ${event.message}`)
        } else {
          pushLog(event.message)
        }
      }) as NodeRunResult<ScoolpData>

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
    const config: Partial<ScoolpCardState> = {}
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
      configText: undefined,
      packageName: undefined,
      packages: undefined,
      cachePath: undefined,
      scoopRoot: undefined,
      dryRun: undefined,
    })
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
    packagesArray,
    progress,
    result,
    running,
    status,
    onCopyLogs: copyLogs,
    onCopyResults: copyResults,
    onExecute: execute,
    onOpenConfigFile: host.openConfigFile,
    onPasteConfig: pasteConfig,
    onPastePackages: pastePackages,
    onPatch: patch,
    onReset: reset,
    onResetOverride: resetOverride,
    onRestoreDefault: restoreDefault,
    onSaveDefault: saveAsDefault,
  })

  return (
    <TooltipProvider>
      <div ref={surface.ref} className="@container/scoolp relative flex h-full min-h-0 w-full overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(circle_at_14%_0%,hsl(var(--primary)/0.14),transparent_36%),radial-gradient(circle_at_88%_8%,hsl(var(--chart-4)/0.16),transparent_34%)]" />
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
  action: ScoolpAction
  actionMeta: typeof ACTIONS[number]
  configDirty: boolean
  configFilePath?: string
  data: ScoolpCardState
  defaults?: Partial<ScoolpCardState>
  dryRun: boolean
  host: NodeComponentProps["host"]
  logs: string[]
  packagesArray: string[]
  progress: number
  result: ScoolpData | null
  running: boolean
  status: ScoolpStatusMeta
  onCopyLogs: () => void
  onCopyResults: () => void
  onExecute: (action: ScoolpAction) => void
  onOpenConfigFile?: () => Promise<void> | void
  onPasteConfig: () => void
  onPastePackages: () => void
  onPatch: (patch: Partial<ScoolpCardState>) => void
  onReset: () => void
  onResetOverride: () => void
  onRestoreDefault: () => void
  onSaveDefault: () => void
}) {
  return props
}

function CollapsedView(props: ViewProps) {
  const ActionIcon = props.actionMeta.icon
  return (
    <div data-testid="scoolp-collapsed-view" className="relative flex h-full min-h-0 items-center gap-2 overflow-hidden rounded-xl border bg-background/85 px-3 py-2 shadow-sm">
      <div className={cn("absolute inset-0 opacity-70 transition-opacity", props.status.tone === "running" && "animate-pulse bg-primary/10", props.status.tone === "error" && "bg-destructive/10", props.status.tone === "success" && "bg-primary/10")} />
      <div className={cn("relative grid size-8 shrink-0 place-items-center rounded-lg", props.status.iconClass)}>
        <Package />
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="flex items-center gap-1 text-xs font-semibold leading-none">
          <span>Scoolp</span>
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
    <div data-testid="scoolp-compact-view" className="flex min-h-0 flex-1 flex-col">
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
    <div data-testid="scoolp-portrait-view" className="flex h-full min-h-0 flex-col gap-2 p-2">
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
  return (
    <div data-testid="scoolp-full-view" className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <div className="flex shrink-0 flex-col gap-3 @4xl/scoolp:flex-row @4xl/scoolp:items-center @4xl/scoolp:justify-between">
        <div className="flex min-w-0 flex-col gap-2 @4xl/scoolp:flex-row @4xl/scoolp:items-center">
          <HeaderLine
            status={props.status}
            subtitle={props.data.progressText || `${actionGroupLabel(props.action)} · ${props.dryRun ? "预演" : "真实"}`}
          />
          <div data-testid="scoolp-header-toolbar" className="flex min-w-0 flex-wrap items-center gap-2">
            <ToolbarActions {...props} />
          </div>
        </div>
        <StatsPanel progress={props.progress} result={props.result} />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 @5xl/scoolp:grid-cols-[minmax(320px,380px)_minmax(0,1fr)]">
        <section className="flex min-h-0 flex-col gap-3 overflow-auto pr-1">
          <div className="grid gap-3 border-b pb-3">
            <div>
              <div className="text-sm font-semibold">操作类型</div>
              <div className="text-xs text-muted-foreground">选择要执行的 Scoop 管理动作。</div>
            </div>
            <ActionPicker action={props.action} disabled={props.running} dryRun={props.dryRun} result={props.result} onExecute={props.onExecute} onPatch={props.onPatch} />
          </div>
          <div className="grid gap-3 border-b pb-3">
            <div className="text-sm font-semibold">路径与包名</div>
            <PathFields data={props.data} disabled={props.running} onPatch={props.onPatch} />
          </div>
          <div className="grid gap-3 border-b pb-3">
            <div className="text-sm font-semibold">同步配置 / 包列表</div>
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

function ActiveFieldPanel(props: ViewProps & { compact?: boolean }) {
  if (props.action === "install") {
    return (
      <ConfigTextPanel
        ariaLabel="scoolp packages"
        compact={props.compact}
        count={props.packagesArray.length}
        disabled={props.running}
        inputId="scoolp-packages"
        label="包列表"
        placeholder={"7zip\ngit\ngrep"}
        value={props.data.packages ?? ""}
        onChange={(packages) => props.onPatch({ packages })}
        onClear={() => props.onPatch({ packages: "" })}
        onPaste={props.onPastePackages}
      />
    )
  }
  return (
    <ConfigTextPanel
      ariaLabel="scoolp sync config"
      compact={props.compact}
      count={configLineCount(props.data.configText)}
      disabled={props.running}
      inputId="scoolp-config-text"
      label="同步配置"
      placeholder={"[scoop]\nroot = \"D:/scoop\"\n\n[[bucket]]\nname = \"main\""}
      value={defaultConfigIfEmpty(props.data.configText)}
      onChange={(configText) => props.onPatch({ configText })}
      onClear={() => props.onPatch({ configText: "" })}
      onPaste={props.onPasteConfig}
    />
  )
}

function ToolbarActions(props: ViewProps & { compact?: boolean }) {
  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-1", props.compact && "justify-between")}>
      <PrimaryActionButton compact={props.compact} props={props} />
      <ActionIconButton disabled={!props.result} icon={Copy} label="复制结果" onClick={props.onCopyResults} />
      <ActionIconButton disabled={!props.logs.length} icon={Copy} label="复制日志" onClick={props.onCopyLogs} />
      <ActionIconButton disabled={props.running} icon={RotateCcw} label="清空状态" onClick={props.onReset} />
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
      <Button aria-label="scoolp running" disabled size={compact ? "icon-sm" : "sm"} variant="secondary">
        <Square />
        {!compact && <span>运行中</span>}
      </Button>
    )
  }

  const actionMeta = props.actionMeta
  const dangerous = isDangerousAction(props.action, props.dryRun)
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
  status: ScoolpStatusMeta
  subtitle: string
}) {
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-2">
        <div className={cn("grid size-8 shrink-0 place-items-center rounded-lg", status.iconClass)}>
          <Package />
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-sm font-semibold leading-none">Scoolp</h3>
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
  result: ScoolpData | null
}) {
  const stats = [
    ["包", props.result?.installedPackages.length ?? props.result?.availablePackages.length ?? 0],
    ["Bucket", props.result?.buckets.length ?? props.result?.syncConfig?.buckets.length ?? 0],
    ["缓存", props.result?.cache?.obsoleteCount ?? 0],
    ["失败", props.result?.failedCount ?? 0],
    ["清理", props.result?.cleanedCount ?? 0],
    ["进度", `${props.progress}%`],
  ] as const

  return (
    <div data-testid="scoolp-stats-panel" className="grid shrink-0 grid-cols-3 gap-1 @4xl/scoolp:grid-cols-6">
      {stats.map(([label, value]) => (
        <div key={label} className="min-w-0 rounded-md bg-muted/35 px-2 py-1.5 text-center">
          <div className="truncate text-[11px] text-muted-foreground">{label}</div>
          <div className={cn("text-sm font-semibold tabular-nums", label === "失败" && Number(value) > 0 && "text-destructive")}>{value}</div>
        </div>
      ))}
    </div>
  )
}

function ResultBody({ compact, result }: { compact?: boolean; result: ScoolpData | null }) {
  if (!result) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        选择动作并执行后将在此显示结果
      </div>
    )
  }
  const limit = compact ? 30 : 80
  if (result.syncPlan.length) {
    return (
      <div className="grid gap-1">
        {result.syncPlan.slice(0, limit).map((item) => (
          <div key={`${item.label}:${item.args.join(" ")}`}>
            <div className="truncate text-primary">{item.label}</div>
            <div className="truncate text-muted-foreground">{item.command} {item.args.join(" ")}</div>
          </div>
        ))}
      </div>
    )
  }
  if (result.availablePackages.length) {
    return (
      <div className="grid gap-1">
        {result.availablePackages.slice(0, limit).map((item) => (
          <div key={item.name}>
            <div className="truncate text-primary">{item.name} {item.version ?? ""}</div>
            <div className="truncate text-muted-foreground">{item.description ?? item.homepage ?? ""}</div>
          </div>
        ))}
      </div>
    )
  }
  if (result.cache) {
    return (
      <div>
        <div className="mb-2 text-primary">{result.cache.obsoleteCount} 个过时 / {formatSize(result.cache.obsoleteSize)}</div>
        {result.cache.obsoletePackages.slice(0, limit).map((item) => (
          <div key={item.path} className="truncate">{item.name} {item.version} / {formatSize(item.size)}</div>
        ))}
      </div>
    )
  }
  return (
    <div className="flex h-full items-center justify-center text-muted-foreground">
      scoop 已安装：{String(result.scoopInstalled)}
    </div>
  )
}

function statusFromState(data: ScoolpCardState, running: boolean): ScoolpStatusMeta {
  if (running || data.phase === "running") {
    return {
      label: "运行中",
      description: data.progressText || "Scoolp 正在执行当前任务。",
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
    description: "选择动作后执行 Scoop 管理任务。",
    tone: "idle",
    badgeVariant: "outline",
    iconClass: "bg-secondary text-secondary-foreground",
  }
}

function isDangerousAction(action: ScoolpAction, dryRun: boolean): boolean {
  if (action === "cache_delete" || action === "cache_backup") return true
  if (action === "sync" && !dryRun) return true
  return false
}

function dangerLabel(action: ScoolpAction): string {
  if (action === "cache_delete") return "真实清理"
  if (action === "cache_backup") return "真实备份"
  if (action === "sync") return "真实同步"
  return "真实执行"
}

function dangerTitle(action: ScoolpAction): string {
  if (action === "cache_delete") return "确认删除过时缓存？"
  if (action === "cache_backup") return "确认备份过时缓存？"
  if (action === "sync") return "确认真实同步 Bucket？"
  return "确认真实执行 Scoolp？"
}

function dangerDescription(props: ViewProps): string {
  if (props.action === "cache_delete") {
    return `当前关闭了预演，清理时会永久删除过时缓存文件。${props.result?.cache?.obsoleteCount ?? 0} 个文件将被删除，请确认无误后继续。`
  }
  if (props.action === "cache_backup") {
    return `当前关闭了预演，备份时会移动过时缓存到备份目录。${props.result?.cache?.obsoleteCount ?? 0} 个文件将被移动，请确认无误后继续。`
  }
  if (props.action === "sync") {
    return "当前关闭了预演，同步时会真实执行 git 和 scoop 命令，可能重置 bucket 和更新包。请确认配置无误后继续。"
  }
  return "当前操作会修改文件系统，请确认无误后继续。"
}

function actionGroupLabel(action: ScoolpAction): string {
  const meta = ACTIONS.find((item) => item.value === action)
  return meta?.shortLabel ?? "状态"
}

function summaryText(props: ViewProps): string {
  if (props.data.progressText) return props.data.progressText
  if (props.result?.failedCount) return `${props.result.failedCount} 个失败`
  if (props.result?.syncPlan.length) return `${props.result.syncPlan.length} 条命令`
  if (props.result?.availablePackages.length) return `${props.result.availablePackages.length} 个包`
  if (props.result?.installedPackages.length) return `${props.result.installedPackages.length} 个已装`
  if (props.result?.cache?.obsoleteCount) return `${props.result.cache.obsoleteCount} 个过时缓存`
  return `${props.actionMeta.shortLabel} · ${props.dryRun ? "预演" : "真实"}`
}

function resultText(result: ScoolpData | null): string {
  if (!result) return ""
  if (result.syncPlan.length) {
    return result.syncPlan.map((item) => `${item.label}\n${item.command} ${item.args.join(" ")}`).join("\n")
  }
  if (result.availablePackages.length) {
    return result.availablePackages.map((item) => `${item.name} ${item.version ?? ""}`).join("\n")
  }
  if (result.cache) {
    return result.cache.obsoletePackages.map((item) => `${item.name} ${item.version} ${formatSize(item.size)}`).join("\n")
  }
  return ""
}

function configLineCount(value?: string): number {
  if (!value || !value.trim()) return 0
  return value.split(/\r?\n/).length
}

function emptyResult(override: Partial<ScoolpData>): ScoolpData {
  return {
    scoopInstalled: false,
    installedPackages: [],
    buckets: [],
    availablePackages: [],
    syncPlan: [],
    commandResults: [],
    installedCount: 0,
    failedCount: 0,
    cleanedCount: 0,
    cleanedSizeBytes: 0,
    errors: [],
    ...override,
  }
}

function splitPackages(value?: string): string[] {
  return (value ?? "").split(/[;,\n]/).map((item) => item.trim()).filter(Boolean)
}

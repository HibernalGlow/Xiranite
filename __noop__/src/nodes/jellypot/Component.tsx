import { useEffect, useRef, useState } from "react"
import { FloatingWindowNodeHeader } from "@/components/workspace/FloatingWindowFrame"
import type { NodeComponentProps, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type { JellyPotAction, JellyPotData, JellyPotInput } from "@xiranite/node-jellypot/core"
import { Clapperboard, FileCog, Play, RotateCcw, Square } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { NodeConfigPopover } from "@/nodes/shared/NodeConfigPopover"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import { useNodeI18n } from "@/nodes/shared/useNodeI18n"
import { RunningTint } from "@/nodes/shared/controls"
import { ACTIONS } from "./constants"
import {
  ActionIconButton,
  ActionPicker,
  MediaPathInput,
  OptionsPopover,
  PathFields,
  RuntimeOptions,
  StatusStrip,
} from "./controls"
import { JellyPotResultTabs, JellyPotStatsPanel } from "./results"
import type { JellyPotCardState, JellyPotStatusMeta } from "./types"
import { CONFIG_FIELDS } from "./types"

export function Component({ compId, host }: NodeComponentProps<JellyPotCardState>) {
  "use no memo"
  const surface = useNodeSurface()
  const { t } = useNodeI18n("jellypot")
  const data = getHostData(host, compId)
  const dataRef = useRef<JellyPotCardState>(data)
  dataRef.current = data

  const [running, setRunning] = useState(false)
  const [defaults, setDefaults] = useState<Partial<JellyPotCardState> | undefined>(undefined)
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

  async function loadDefaults() {
    try {
      const response = await (host.config?.get?.<Partial<JellyPotCardState>>() ?? host.getNodeConfig?.<Partial<JellyPotCardState>>())
      setDefaults(response?.config)
      setConfigFilePath(response?.path)
    } catch {
      // Browser previews and standalone CLI hosts may not expose node config.
    }
  }

  useEffect(() => { void loadDefaults() }, [host])

  useEffect(() => {
    if (!defaults) return
    setConfigDirty(CONFIG_FIELDS.some((field) => String(data[field] ?? "") !== String(defaults[field] ?? "")))
  }, [
    data.configPath,
    data.databasePath,
    data.mediaPath,
    data.potplayerPath,
    data.browserPath,
    data.dryRun,
    data.recordRun,
    defaults,
  ])

  function patch(patchData: Partial<JellyPotCardState>) {
    dataRef.current = { ...dataRef.current, ...patchData }
    if (host.state?.patchData) host.state.patchData(patchData)
    else host.patchData(compId, patchData)
  }

  function pushLog(message: string) {
    const nextLogs = [...(dataRef.current.logs ?? []), message].slice(-120)
    patch({ logs: nextLogs })
  }

  async function pasteMedia() {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ mediaPath: text.trim() })
  }

  async function copyLogs() {
    await host.clipboard?.writeText?.(logs.join("\n"))
  }

  async function copyResults() {
    const current = dataRef.current.result
    if (!current) return
    const checkLines = current.checks.map((item) => `${item.exists ? "ok" : "missing"}\t${item.name}\t${item.path}`)
    const commandLines = (current.commandResults.length ? current.commandResults : current.commands).map((item) => `${item.label}\t${item.command}\t${item.args.join(" ")}`)
    await host.clipboard?.writeText?.([...checkLines, ...commandLines].join("\n"))
  }

  function reset() {
    patch({ logs: [], phase: "idle", progress: 0, progressText: "", result: null })
  }

  async function saveAsDefault() {
    const config: Partial<JellyPotCardState> = {}
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

  async function execute(nextAction: JellyPotAction = action) {
    if (running) return
    const current = dataRef.current
    if (nextAction === "launch_media" && !clean(current.mediaPath)) {
      const message = "请先输入媒体路径。"
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
      const response = await run<JellyPotInput, JellyPotData>("jellypot", buildInput(nextAction, current), (event: NodeRunEvent) => {
        if (event.type === "progress") {
          patch({ progress: event.progress ?? 0, progressText: event.message })
          pushLog(`[${event.progress ?? 0}%] ${event.message}`)
          return
        }
        pushLog(event.message)
      }) as NodeRunResult<JellyPotData>

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
    onActionChange: (value: JellyPotAction) => patch({ action: value }),
    onCopyLogs: copyLogs,
    onCopyResults: copyResults,
    onExecute: execute,
    onOpenConfigFile: host.config?.openFile ?? host.openConfigFile,
    onPasteMedia: pasteMedia,
    onPatch: patch,
    onReset: reset,
    onReloadDefaults: loadDefaults,
    onRestoreDefault: restoreDefault,
    onSaveDefault: saveAsDefault,
  }

  return (
    <TooltipProvider>
      <div ref={surface.ref} className="@container/jellypot relative flex h-full min-h-0 w-full overflow-hidden">
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
  action: JellyPotAction
  actionMeta: typeof ACTIONS[number]
  configDirty: boolean
  configFilePath?: string
  data: JellyPotCardState
  defaults?: Partial<JellyPotCardState>
  logs: string[]
  progress: number
  result: JellyPotData | null
  running: boolean
  status: JellyPotStatusMeta
  t: ReturnType<typeof useNodeI18n>["t"]
  onActionChange: (value: JellyPotAction) => void
  onCopyLogs: () => void
  onCopyResults: () => void
  onExecute: (action?: JellyPotAction) => void
  onOpenConfigFile?: () => Promise<void> | void
  onPasteMedia: () => void
  onPatch: (patch: Partial<JellyPotCardState>) => void
  onReset: () => void
  onReloadDefaults: () => Promise<void>
  onRestoreDefault: () => void
  onSaveDefault: () => void
}) {
  return props
}

function CollapsedView(props: ViewProps) {
  const Icon = props.actionMeta.icon
  return (
    <div data-testid="jellypot-collapsed-view" className="relative flex h-full min-h-0 items-center gap-2 overflow-hidden rounded-xl border bg-background/85 px-3 py-2 shadow-sm">
      <RunningTint tone={props.status.tone} />
      <div className={cn("relative grid size-8 shrink-0 place-items-center rounded-lg", props.status.iconClass)}>
        <Clapperboard />
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="flex items-center gap-1 text-xs font-semibold leading-none">
          <span>JellyPot</span>
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
    <div data-testid="jellypot-compact-view" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-2 p-3 pb-2">
        <HeaderLine actionMeta={props.actionMeta} status={props.status} subtitle={props.data.progressText || summaryText(props)} />
        <div className="flex shrink-0 items-center gap-1">
          <OptionsPopover data={props.data} disabled={props.running} onPatch={props.onPatch} />
          <RunActionButton compact props={props} />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
        <ActionPicker action={props.action} disabled={props.running} onActionChange={props.onActionChange} />
        {props.action === "launch_media" && (
          <MediaPathInput compact data={props.data} disabled={props.running} onPaste={props.onPasteMedia} onPatch={props.onPatch} />
        )}
        {(props.status.tone === "running" || props.status.tone === "error") && (
          <StatusStrip compact progress={props.progress} status={props.status} text={props.data.progressText} />
        )}
        <div className="min-h-0 flex-1">
          <JellyPotResultTabs compact logs={props.logs} result={props.result} running={props.running} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} />
        </div>
      </div>
    </div>
  )
}

function PortraitCompactView(props: ViewProps) {
  return (
    <div data-testid="jellypot-portrait-view" className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="flex shrink-0 items-start justify-between gap-2">
        <HeaderLine actionMeta={props.actionMeta} status={props.status} subtitle={props.data.progressText || summaryText(props)} />
        <div className="flex shrink-0 items-center gap-1">
          <OptionsPopover data={props.data} disabled={props.running} onPatch={props.onPatch} />
          <RunActionButton compact props={props} />
        </div>
      </div>
      <div className="grid shrink-0 gap-2">
        <ActionPicker action={props.action} disabled={props.running} onActionChange={props.onActionChange} />
        {props.action === "launch_media" && (
          <MediaPathInput compact data={props.data} disabled={props.running} onPaste={props.onPasteMedia} onPatch={props.onPatch} />
        )}
      </div>
      <div className="min-h-0 flex-1">
        <JellyPotResultTabs compact logs={props.logs} result={props.result} running={props.running} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} />
      </div>
    </div>
  )
}

function LegacyFullView(props: ViewProps) {
  return (
    <div data-testid="jellypot-full-view" className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <div className="flex shrink-0 flex-col gap-3 @4xl/jellypot:flex-row @4xl/jellypot:items-center @4xl/jellypot:justify-between">
        <div className="flex min-w-0 flex-col gap-2 @4xl/jellypot:flex-row @4xl/jellypot:items-center">
          <HeaderLine actionMeta={props.actionMeta} status={props.status} subtitle={props.data.progressText || summaryText(props)} />
          <div data-testid="jellypot-header-toolbar" className="flex min-w-0 flex-wrap items-center gap-2">
            <ActionPicker action={props.action} disabled={props.running} triggerClassName="@4xl/jellypot:w-80" onActionChange={props.onActionChange} />
            <RunActionButton props={props} />
            <ActionIconButton disabled={props.running} icon={RotateCcw} label="清空状态" onClick={props.onReset} />
            <NodeConfigPopover configPath={props.configFilePath} defaults={props.defaults as Record<string, unknown> | undefined} dirty={props.configDirty} disabled={props.running} t={props.t} onOpenFile={props.onOpenConfigFile} onReload={props.onReloadDefaults} onRestore={props.onRestoreDefault} onSave={props.onSaveDefault} />
          </div>
        </div>
        <JellyPotStatsPanel result={props.result} />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 @5xl/jellypot:grid-cols-[minmax(320px,380px)_minmax(0,1fr)]">
        <section className="flex min-h-0 flex-col gap-3 overflow-auto pr-1">
          <div className="grid gap-3 border-b pb-3">
            <div>
              <div className="text-sm font-semibold">媒体</div>
              <div className="text-xs text-muted-foreground">播放媒体时需要媒体路径，其他动作只读配置和依赖路径。</div>
            </div>
            <MediaPathInput data={props.data} disabled={props.running} onPaste={props.onPasteMedia} onPatch={props.onPatch} />
          </div>
          <div className="grid gap-3 border-b pb-3">
            <div className="text-sm font-semibold">路径</div>
            <PathFields data={props.data} disabled={props.running} onPatch={props.onPatch} />
          </div>
          <div className="grid gap-3 border-b pb-3">
            <div className="text-sm font-semibold">运行</div>
            <RuntimeOptions data={props.data} disabled={props.running} onPatch={props.onPatch} />
          </div>
          <StatusStrip progress={props.progress} status={props.status} text={props.data.progressText} />
        </section>
        <div className="min-h-0">
          <JellyPotResultTabs logs={props.logs} result={props.result} running={props.running} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} />
        </div>
      </div>
    </div>
  )
}

function FullView(props: ViewProps) {
  if ((props.data.action as string | undefined) === "init") return <LegacyFullView {...props} />
  return <JellyPotConsole {...props} />
}

function JellyPotConsole(props: ViewProps) {
  const potplayer = props.result?.checks.find((item) => item.name === "potplayer")
  const browser = props.result?.checks.find((item) => item.name === "browser")
  const registry = props.result?.checks.find((item) => item.name === "registry")

  return (
    <div data-testid="jellypot-full-view" className="flex min-h-0 flex-1 flex-col p-3 @4xl/jellypot:p-4">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b pb-3">
        <HeaderLine actionMeta={props.actionMeta} status={props.status} subtitle={props.data.progressText || props.t("console.subtitle", "媒体入口、环境检查与注册表配置")} />
        <div data-testid="jellypot-header-toolbar" className="flex shrink-0 items-center gap-1">
          <ActionIconButton disabled={!props.result} icon={RotateCcw} label={props.t("action.reset", "清空状态")} onClick={props.onReset} />
          <NodeConfigPopover configPath={props.configFilePath} defaults={props.defaults as Record<string, unknown> | undefined} dirty={props.configDirty} disabled={props.running} t={props.t} onOpenFile={props.onOpenConfigFile} onReload={props.onReloadDefaults} onRestore={props.onRestoreDefault} onSave={props.onSaveDefault} />
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 py-4 @6xl/jellypot:grid-cols-[15rem_minmax(0,1fr)_18rem]">
        <aside className="flex min-h-0 flex-col gap-4">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm">{props.t("media.title", "媒体入口")}</CardTitle><CardDescription>{props.t("media.description", "输入本地媒体后使用 PotPlayer 打开")}</CardDescription></CardHeader>
            <CardContent className="grid gap-3"><MediaPathInput data={props.data} disabled={props.running} onPaste={props.onPasteMedia} onPatch={props.onPatch} /><Button disabled={props.running} size="sm" variant="outline" onClick={() => props.onExecute("status")}>{props.actionMeta.value === "status" ? <Square data-icon="inline-start" /> : <Play data-icon="inline-start" />}{props.t("media.scan", "检查环境")}</Button></CardContent>
          </Card>
          <Card className="min-h-0 flex-1"><CardHeader className="pb-3"><CardTitle className="text-sm">{props.t("activity.title", "最近活动")}</CardTitle><CardDescription>{props.t("activity.description", "本节点最近的运行记录")}</CardDescription></CardHeader><CardContent className="min-h-0"><ActivityFeed logs={props.logs} /></CardContent></Card>
        </aside>
        <section className="flex min-h-0 flex-col gap-4">
          <div className="grid shrink-0 gap-4 @3xl/jellypot:grid-cols-2">
            <ServiceCard description={props.t("service.potplayerDesc", "本地播放器与媒体文件入口")} title="PotPlayer" check={potplayer} action="launch_media" actionLabel={props.t("service.launch", "播放媒体")} disabled={props.running} onExecute={props.onExecute} />
            <ServiceCard description={props.t("service.jellyfinDesc", "浏览器打开 Jellyfin Web") } title="Jellyfin" check={browser} action="open_jellyfin" actionLabel={props.t("service.open", "打开 Jellyfin")} disabled={props.running} onExecute={props.onExecute} />
          </div>
          <div className="min-h-0 flex-1"><JellyPotResultTabs logs={props.logs} result={props.result} running={props.running} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} /></div>
        </section>
        <aside className="flex min-h-0 flex-col gap-4 border-t pt-4 @6xl/jellypot:border-t-0 @6xl/jellypot:border-l @6xl/jellypot:pl-4 @6xl/jellypot:pt-0">
          <Card className="min-h-0 flex-1"><CardHeader className="pb-3"><CardTitle className="text-sm">{props.t("registry.title", "注册表配置")}</CardTitle><CardDescription>{props.data.configPath || props.t("registry.noConfig", "当前尚未读取配置文件")}</CardDescription></CardHeader><CardContent className="min-h-0"><ConfigSnapshot config={props.result?.config} /></CardContent></Card>
          <Alert variant="destructive"><FileCog data-icon="inline-start" /><AlertTitle>{props.t("registry.riskTitle", "高风险操作")}</AlertTitle><AlertDescription>{registry?.exists ? props.t("registry.riskReady", "注册表文件已找到。关闭预演后会修改系统注册表。") : props.t("registry.riskMissing", "请先检查注册表文件和配置路径，再执行导入。")}</AlertDescription></Alert>
          <RunRegistryButton props={props} disabled={props.running || !registry?.exists} />
        </aside>
      </div>
    </div>
  )
}

function ServiceCard(props: { action: JellyPotAction; actionLabel: string; check?: JellyPotData["checks"][number]; description: string; disabled?: boolean; onExecute: (action?: JellyPotAction) => void; title: string }) {
  const available = props.check?.exists
  return <Card><CardHeader className="items-center text-center"><div className={cn("grid size-14 place-items-center rounded-full border", available ? "border-primary/30 bg-primary/10 text-primary" : "border-muted bg-muted text-muted-foreground")}><Clapperboard className="size-7" /></div><CardTitle>{props.title}</CardTitle><CardDescription>{available ? props.check?.path : props.description}</CardDescription></CardHeader><CardContent><Button className="w-full" disabled={props.disabled} variant={available ? "default" : "outline"} onClick={() => props.onExecute(props.action)}><Play data-icon="inline-start" />{props.actionLabel}</Button></CardContent></Card>
}

function ActivityFeed({ logs }: { logs: string[] }) {
  return <div className="max-h-64 space-y-2 overflow-auto">{logs.length ? logs.slice(-8).reverse().map((line, index) => <div key={`${line}-${index}`} className="border-l-2 border-primary/40 pl-2 text-xs text-muted-foreground">{line}</div>) : <div className="py-6 text-center text-xs text-muted-foreground">尚无运行记录</div>}</div>
}

function ConfigSnapshot({ config }: { config: JellyPotData["config"] | undefined }) {
  return <pre className="max-h-72 overflow-auto rounded-md border bg-muted/20 p-3 text-xs leading-5 text-muted-foreground">{config ? JSON.stringify(config, null, 2) : "运行状态检查后将在这里显示已解析配置。"}</pre>
}

function RunRegistryButton({ disabled, props }: { disabled?: boolean; props: ViewProps }) {
  if (props.data.dryRun ?? true) return <Button className="w-full" disabled={disabled} variant="outline" onClick={() => props.onExecute("apply_registry")}><FileCog data-icon="inline-start" />{props.t("registry.plan", "预演导入注册表")}</Button>
  return <RunActionButton props={{ ...props, action: "apply_registry" }} />
}

function RunActionButton({ compact, props }: { compact?: boolean; props: ViewProps }) {
  if (props.running) {
    return (
      <Button aria-label="jellypot running" disabled size={compact ? "icon-sm" : "sm"} variant="secondary">
        <Square />
        {!compact && <span>运行中</span>}
      </Button>
    )
  }

  const label = actionLabel(props.action)
  const destructive = props.action === "apply_registry" && !(props.data.dryRun ?? true)
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
            <AlertDialogTitle>确认导入注册表？</AlertDialogTitle>
            <AlertDialogDescription>
              当前已关闭预演，会调用 regedit 静默导入 PotPlayer 注册表配置，这一步不可撤销。请确认配置文件和脚本目录无误。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => props.onExecute(props.action)}>确认导入</AlertDialogAction>
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
  status: JellyPotStatusMeta
  subtitle: string
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
            <h3 className="truncate text-sm font-semibold leading-none">JellyPot</h3>
            <Badge variant={status.badgeVariant}>{status.label}</Badge>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>
    </div>
    </FloatingWindowNodeHeader>
  )
}

function buildInput(action: JellyPotAction, data: JellyPotCardState): JellyPotInput {
  return {
    action,
    configPath: clean(data.configPath),
    databasePath: clean(data.databasePath),
    mediaPath: clean(data.mediaPath),
    potplayerPath: clean(data.potplayerPath),
    browserPath: clean(data.browserPath),
    dryRun: data.dryRun ?? true,
    recordRun: data.recordRun ?? false,
  }
}

function statusFromState(data: JellyPotCardState, running: boolean): JellyPotStatusMeta {
  if (running || data.phase === "running") {
    return {
      label: "运行中",
      description: data.progressText || "JellyPot 正在检查依赖或启动命令。",
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
    description: "选择动作后检查依赖、播放媒体或导入注册表。",
    tone: "idle",
    badgeVariant: "outline",
    iconClass: "bg-secondary text-secondary-foreground",
  }
}

function summaryText(props: ViewProps): string {
  if (props.data.progressText) return props.data.progressText
  if (props.result?.checks.length) {
    const found = props.result.checks.filter((item) => item.exists).length
    return `${found}/${props.result.checks.length} 依赖就绪 / ${props.result.commands.length || props.result.commandResults.length} 命令`
  }
  return props.actionMeta.description
}

function actionLabel(action: JellyPotAction): string {
  return ACTIONS.find((item) => item.value === action)?.label ?? action
}

function clean(value: unknown): string | undefined {
  const text = String(value ?? "").trim()
  return text || undefined
}

function getHostData(host: NodeComponentProps<JellyPotCardState>["host"], compId: string): JellyPotCardState {
  return host.state?.getData?.() ?? host.getData<JellyPotCardState>(compId) ?? {}
}

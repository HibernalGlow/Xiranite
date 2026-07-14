import { useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"
import type { NodeComponentProps, NodeRunResult } from "@xiranite/contract"
import type { OwithuAction, OwithuData, OwithuInput } from "@xiranite/node-owithu/core"
import { buildOwithuPlan, parseOwithuConfig } from "@xiranite/node-owithu/core"
import { Copy, ListChecks, MousePointerClick, Play, RotateCcw, ScrollText, Square } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import { RunningTint } from "@/nodes/shared/controls"
import { NodeConfigButton } from "@/nodes/shared/NodeConfigPopover"
import { ACTIONS } from "./constants"
import {
  ActionIconButton,
  ActionPicker,
  ConfigTextInput,
  OptionsPopover,
  PathInput,
  StatusStrip,
} from "./controls"
import type { OwithuCardState, OwithuStatusMeta } from "./types"
import { CONFIG_FIELDS } from "./types"

export function Component({ compId, host }: NodeComponentProps) {
  "use no memo"
  const surface = useNodeSurface()
  const data = host.getData<OwithuCardState>(compId) ?? {}
  const dataRef = useRef<OwithuCardState>(data)
  dataRef.current = data

  const [running, setRunning] = useState(false)
  const [defaults, setDefaults] = useState<Partial<OwithuCardState> | undefined>(undefined)
  const [configFilePath, setConfigFilePath] = useState<string | undefined>(undefined)
  const [configDirty, setConfigDirty] = useState(false)

  const action = data.action ?? "preview"
  const actionMeta = ACTIONS.find((item) => item.value === action) ?? ACTIONS[0]!
  const logs = data.logs ?? []
  const result = data.result ?? null
  const progress = data.progress ?? 0
  const hive = data.hive ?? ""
  const status = statusFromState(data, running)
  const compactSurface = surface.mode === "compact" || surface.mode === "portrait"
  const forceCollapsedSurface = compactSurface && surface.height > 0 && surface.height < 160
  const portraitCompact = surface.mode === "portrait" || (surface.mode === "compact" && surface.width < 560 && surface.height >= 300)

  useEffect(() => {
    host.getNodeConfig?.<Partial<OwithuCardState>>()
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
    data.action,
    data.configText,
    data.hive,
    data.onlyKey,
    data.path,
    defaults,
  ])

  function patch(patchData: Partial<OwithuCardState>) {
    dataRef.current = { ...dataRef.current, ...patchData }
    host.patchData(compId, patchData)
  }

  function pushLog(message: string) {
    const nextLogs = [...(dataRef.current.logs ?? []), message].slice(-120)
    patch({ logs: nextLogs })
  }

  async function pastePath() {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ path: text.trim().split(/\r?\n/)[0]?.trim() ?? "" })
  }

  async function pasteConfig() {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ configText: text })
  }

  async function copyResults() {
    const lines = (result?.plan ?? []).map((item) => `${item.entryKey} / ${item.hive} / ${item.scope} -> ${item.command}`)
    await host.clipboard?.writeText?.(lines.join("\n"))
  }

  async function copyLogs() {
    await host.clipboard?.writeText?.(logs.join("\n"))
  }

  async function execute(nextAction: OwithuAction = action) {
    if (running) return
    const current = dataRef.current
    if (!current.path?.trim() && !current.configText?.trim()) {
      patch({ phase: "error", progress: 0, progressText: "请先提供配置文件路径或粘贴 TOML 内容。" })
      return
    }

    if (nextAction === "preview" && current.configText?.trim()) {
      try {
        const config = parseOwithuConfig(current.configText)
        const plan = buildOwithuPlan(config, { action: "register", hive, onlyKey: current.onlyKey })
        patch({
          phase: "completed",
          progress: 100,
          progressText: `找到 ${config.entries.length} 个条目和 ${plan.length} 个注册表操作。`,
          action: nextAction,
          result: {
            vars: config.vars,
            defaults: config.defaults,
            entries: config.entries,
            plan,
            registeredCount: 0,
            unregisteredCount: 0,
            failedCount: 0,
            errors: [],
          },
        })
        pushLog(`Found ${config.entries.length} entries and ${plan.length} registry operations.`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        patch({ phase: "error", progress: 0, progressText: message })
        pushLog(message)
      }
      return
    }

    const run = host.actions?.run
    if (!run) {
      patch({ phase: "error", progress: 0, progressText: "当前环境没有本地运行能力，请使用桌面模式或 CLI。" })
      pushLog("Native action is unavailable in this host.")
      return
    }

    const input = buildInput(nextAction, current)
    setRunning(true)
    try {
      patch({ phase: "running", progress: 0, progressText: `${labelForAction(nextAction)}开始`, result: null, action: nextAction })
      const response = await run<OwithuInput, OwithuData>("owithu", input, (event) => {
        if (event.type === "progress") {
          patch({ progress: event.progress ?? 0, progressText: event.message })
          pushLog(`[${event.progress ?? 0}%] ${event.message}`)
        } else {
          pushLog(event.message)
        }
      }) as NodeRunResult<OwithuData>

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
    const config: Partial<OwithuCardState> = {}
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
      action: undefined,
      path: undefined,
      configText: undefined,
      hive: undefined,
      onlyKey: undefined,
    })
  }

  const commonProps = createViewProps({
    action,
    actionMeta,
    configDirty,
    configFilePath,
    data,
    defaults,
    hive,
    host,
    logs,
    progress,
    result,
    running,
    status,
    onCopyLogs: copyLogs,
    onCopyResults: copyResults,
    onExecute: execute,
    onOpenConfigFile: host.openConfigFile,
    onPasteConfig: pasteConfig,
    onPastePath: pastePath,
    onPatch: patch,
    onReset: reset,
    onResetOverride: resetOverride,
    onRestoreDefault: restoreDefault,
    onSaveDefault: saveAsDefault,
  })

  return (
    <TooltipProvider>
      <div ref={surface.ref} className="@container/owithu relative flex h-full min-h-0 w-full overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(circle_at_12%_0%,color-mix(in_oklch,var(--primary)_14%,transparent),transparent_36%),radial-gradient(circle_at_88%_8%,color-mix(in_oklch,var(--chart-2)_16%,transparent),transparent_34%)]" />
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
  action: OwithuAction
  actionMeta: typeof ACTIONS[number]
  configDirty: boolean
  configFilePath?: string
  data: OwithuCardState
  defaults?: Partial<OwithuCardState>
  hive: string
  host: NodeComponentProps["host"]
  logs: string[]
  progress: number
  result: OwithuData | null
  running: boolean
  status: OwithuStatusMeta
  onCopyLogs: () => void
  onCopyResults: () => void
  onExecute: (action?: OwithuAction) => void
  onOpenConfigFile?: () => Promise<void> | void
  onPasteConfig: () => void
  onPastePath: () => void
  onPatch: (patch: Partial<OwithuCardState>) => void
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
    <div data-testid="owithu-collapsed-view" className="relative flex h-full min-h-0 items-center gap-2 overflow-hidden rounded-xl border bg-background/85 px-3 py-2 shadow-sm">
      <RunningTint tone={props.status.tone} />
      <div className={cn("relative grid size-8 shrink-0 place-items-center rounded-lg", props.status.iconClass)}>
        <MousePointerClick />
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="flex items-center gap-1 text-xs font-semibold leading-none">
          <span>Owithu</span>
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
    <div data-testid="owithu-compact-view" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-2 p-3 pb-2">
        <HeaderLine actionMeta={props.actionMeta} status={props.status} subtitle={props.data.progressText || summaryText(props)} />
        <div className="flex shrink-0 items-center gap-1">
          <OptionsPopover data={props.data} disabled={props.running} onPatch={props.onPatch} />
          {props.running ? <ActionIconButton destructive icon={Square} label="运行中" onClick={() => undefined} /> : <RunActionButton compact props={props} />}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
        <ActionPicker disabled={props.running} value={props.action} onActionChange={(value) => props.onPatch({ action: value })} />
        <PathInput compact data={props.data} disabled={props.running} onPaste={props.onPastePath} onPatch={props.onPatch} />
        <ConfigTextInput compact data={props.data} disabled={props.running} onPaste={props.onPasteConfig} onPatch={props.onPatch} />
        <ToolbarActions {...props} compact />
        {(props.status.tone === "running" || props.status.tone === "error") && (
          <StatusStrip compact progress={props.progress} status={props.status} text={props.data.progressText} />
        )}
        <div className="min-h-0 flex-1">
          <OwithuResultTabs compact logs={props.logs} result={props.result} running={props.running} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} />
        </div>
      </div>
    </div>
  )
}

function PortraitCompactView(props: ViewProps) {
  return (
    <div data-testid="owithu-portrait-view" className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="flex shrink-0 items-start justify-between gap-2">
        <HeaderLine actionMeta={props.actionMeta} status={props.status} subtitle={props.data.progressText || summaryText(props)} />
        <div className="flex shrink-0 items-center gap-1">
          <OptionsPopover data={props.data} disabled={props.running} onPatch={props.onPatch} />
          {props.running ? <ActionIconButton destructive icon={Square} label="运行中" onClick={() => undefined} /> : <RunActionButton compact props={props} />}
        </div>
      </div>
      <div className="grid shrink-0 gap-2">
        <ActionPicker disabled={props.running} value={props.action} onActionChange={(value) => props.onPatch({ action: value })} />
        <PathInput compact data={props.data} disabled={props.running} onPaste={props.onPastePath} onPatch={props.onPatch} />
        <ConfigTextInput compact data={props.data} disabled={props.running} onPaste={props.onPasteConfig} onPatch={props.onPatch} />
        <ToolbarActions {...props} compact />
      </div>
      <div className="min-h-0 flex-1">
        <OwithuResultTabs compact logs={props.logs} result={props.result} running={props.running} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} />
      </div>
    </div>
  )
}

function FullView(props: ViewProps) {
  if (!props.result) return <FullViewLegacy {...props} />

  return (
    <div data-testid="owithu-full-view" className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <div className="flex shrink-0 flex-col gap-3 @4xl/owithu:flex-row @4xl/owithu:items-center @4xl/owithu:justify-between">
        <HeaderLine actionMeta={props.actionMeta} status={props.status} subtitle={props.data.progressText || `${props.result.entries.length} entries / ${props.result.plan.length} registry operations`} />
        <div data-testid="owithu-header-toolbar" className="flex min-w-0 flex-wrap items-center gap-2">
          <ActionPicker disabled={props.running} value={props.action} onActionChange={(value) => props.onPatch({ action: value })} />
            <NodeConfigButton nodeKey="owithu"
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
        <StatsPanel progress={props.progress} result={props.result} />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 @5xl/owithu:grid-cols-[minmax(190px,.72fr)_minmax(280px,1.35fr)_minmax(190px,.75fr)]">
        <Card className="min-h-0 gap-0 overflow-hidden py-0">
          <CardHeader className="shrink-0 border-b bg-muted/20 px-3 py-2.5 !pb-2.5">
            <CardTitle className="text-sm">Menu config.toml</CardTitle>
            <CardDescription className="text-[11px]">Configuration source and validation input.</CardDescription>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-3 p-3">
            <PathInput compact data={props.data} disabled={props.running} onPaste={props.onPastePath} onPatch={props.onPatch} />
            <ConfigTextInput compact data={props.data} disabled={props.running} onPaste={props.onPasteConfig} onPatch={props.onPatch} />
            <StatusStrip progress={props.progress} status={props.status} text={props.data.progressText} />
          </CardContent>
        </Card>

        <RegistryTopology entries={props.result.entries} plan={props.result.plan} runAction={<RunActionButton props={props} />} />

        <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-3">
          <LivePreview entries={props.result.entries} />
          <Card className="gap-0 py-0">
            <CardHeader className="px-3 py-2.5 !pb-2.5"><CardTitle className="text-xs">System log</CardTitle></CardHeader>
            <CardContent className="max-h-32 overflow-auto px-3 pb-3"><pre className="whitespace-pre-wrap text-[11px] leading-5 text-muted-foreground">{props.logs.join("\n") || "Waiting for registry activity."}</pre></CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function RegistryTopology({ entries, plan, runAction }: { entries: OwithuData["entries"]; plan: OwithuData["plan"]; runAction: ReactNode }) {
  return (
    <Card className="min-h-0 gap-0 overflow-hidden py-0">
      <CardHeader className="shrink-0 border-b bg-muted/20 px-3 py-2.5 !pb-2.5">
        <div className="flex items-center justify-between gap-2"><CardTitle className="text-sm">Registry topology</CardTitle><Badge variant="outline">HKCU</Badge></div>
        <CardDescription className="text-[11px]">Live system mapping from menu item to registry scope.</CardDescription>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3 p-3">
        <div className="grid min-h-0 flex-1 content-center gap-3">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full border border-primary/60 bg-primary/10 text-xs font-semibold text-primary">HKCU</div>
          <div className="grid grid-cols-2 gap-2">
            {entries.map((entry) => <div key={entry.key} className="min-w-0 rounded-md border bg-background/60 p-2"><div className="truncate text-xs font-medium">{entry.label}</div><div className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{entry.key}</div></div>)}
          </div>
          <div className="grid gap-1.5 text-[11px] text-muted-foreground">{plan.map((item) => <div key={`${item.registryPath}:${item.scope}`} className="truncate rounded-md bg-muted/30 px-2 py-1.5 font-mono" title={item.registryPath}>{item.scope} → {item.registryPath}</div>)}</div>
        </div>
        <div className="flex items-center justify-between gap-2 border-t pt-3"><span className="text-xs text-muted-foreground">Active mode</span>{runAction}</div>
      </CardContent>
    </Card>
  )
}

function LivePreview({ entries }: { entries: OwithuData["entries"] }) {
  return (
    <Card className="min-h-0 gap-0 overflow-hidden py-0">
      <CardHeader className="shrink-0 border-b bg-muted/20 px-3 py-2.5 !pb-2.5"><CardTitle className="text-sm">Live preview</CardTitle><CardDescription className="text-[11px]">Context-menu emulation for the selected item.</CardDescription></CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col justify-center p-3"><div className="rounded-md border bg-background/60 p-2">{entries.map((entry) => <div key={entry.key} className="flex items-center gap-2 rounded-sm px-2 py-2 text-xs hover:bg-muted"><MousePointerClick className="size-3.5 text-primary" /><span className="truncate">{entry.label}</span></div>)}</div></CardContent>
    </Card>
  )
}

function FullViewLegacy(props: ViewProps) {
  return (
    <div data-testid="owithu-full-view" className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <div className="flex shrink-0 flex-col gap-3 @4xl/owithu:flex-row @4xl/owithu:items-center @4xl/owithu:justify-between">
        <div className="flex min-w-0 flex-col gap-2 @4xl/owithu:flex-row @4xl/owithu:items-center">
          <HeaderLine
            actionMeta={props.actionMeta}
            status={props.status}
            subtitle={props.data.progressText || `${props.actionMeta.label} / ${props.data.configText ? "已粘贴 TOML" : props.data.path ? "已设路径" : "待输入"}`}
          />
          <div data-testid="owithu-header-toolbar" className="flex min-w-0 flex-wrap items-center gap-2">
            <ToolbarActions {...props} />
          </div>
        </div>
        <StatsPanel progress={props.progress} result={props.result} />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 @5xl/owithu:grid-cols-[minmax(320px,380px)_minmax(0,1fr)]">
        <section className="flex min-h-0 flex-col gap-3 overflow-auto pr-1">
          <div className="grid gap-3 border-b pb-3">
            <div>
              <div className="text-sm font-semibold">任务</div>
              <div className="text-xs text-muted-foreground">选择动作，粘贴配置路径或 TOML 内容。</div>
            </div>
            <ActionPicker disabled={props.running} value={props.action} onActionChange={(value) => props.onPatch({ action: value })} />
            <PathInput data={props.data} disabled={props.running} onPaste={props.onPastePath} onPatch={props.onPatch} />
          </div>
          <div className="grid gap-3 border-b pb-3">
            <div className="text-sm font-semibold">TOML 配置</div>
            <ConfigTextInput data={props.data} disabled={props.running} onPaste={props.onPasteConfig} onPatch={props.onPatch} />
          </div>
          <StatusStrip progress={props.progress} status={props.status} text={props.data.progressText} />
        </section>

        <div className="min-h-0">
          <OwithuResultTabs logs={props.logs} result={props.result} running={props.running} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} />
        </div>
      </div>
    </div>
  )
}

function ToolbarActions(props: ViewProps & { compact?: boolean; hidePrimary?: boolean }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-1", props.compact && "justify-between")}>
      {!props.compact && (props.running ? <ActionIconButton destructive icon={Square} label="运行中" onClick={() => undefined} /> : <RunActionButton props={props} />)}
      <ActionIconButton disabled={!props.result} icon={Copy} label="复制结果" onClick={props.onCopyResults} />
      <ActionIconButton disabled={!props.logs.length} icon={ScrollText} label="复制日志" onClick={props.onCopyLogs} />
      <ActionIconButton icon={RotateCcw} label="清空状态" onClick={props.onReset} />
      {!props.compact && (
        <NodeConfigButton nodeKey="owithu"
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

function RunActionButton({ compact, props }: { compact?: boolean; props: ViewProps }) {
  if (props.running) {
    return (
      <Button aria-label="owithu running" disabled size={compact ? "icon-sm" : "sm"} variant="secondary">
        <Square />
        {!compact && <span>运行中</span>}
      </Button>
    )
  }
  const label = `运行${props.actionMeta.shortLabel}`
  const dangerous = isDangerous(props)
  const disabled = !props.data.path?.trim() && !props.data.configText?.trim()
  if (dangerous) {
    return (
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button aria-label={label} disabled={disabled} size={compact ? "icon-sm" : "sm"} variant="destructive">
            <Play />
            {!compact && <span>{label}</span>}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认真实执行 Owithu？</AlertDialogTitle>
            <AlertDialogDescription>
              当前选择的是{props.actionMeta.label}，将向 Windows 注册表{props.action === "register" ? "写入" : "移除"}右键菜单项，操作不可撤销。请确认配置内容和注册表位置无误后再继续。
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
    <Button aria-label={label} disabled={disabled} size={compact ? "icon-sm" : "sm"} onClick={() => props.onExecute(props.action)}>
      <Play />
      {!compact && <span>{label}</span>}
    </Button>
  )
}

function HeaderLine({ actionMeta, status, subtitle }: {
  actionMeta: typeof ACTIONS[number]
  status: OwithuStatusMeta
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
            <h3 className="truncate text-sm font-semibold leading-none">Owithu</h3>
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
  result: OwithuData | null
}) {
  const stats = [
    ["条目", props.result?.entries.length ?? 0],
    ["操作", props.result?.plan.length ?? 0],
    ["已注册", props.result?.registeredCount ?? 0],
    ["已注销", props.result?.unregisteredCount ?? 0],
    ["失败", props.result?.failedCount ?? 0],
    ["错误", props.result?.errors.length ?? 0],
    ["进度", `${props.progress}%`],
  ] as const

  return (
    <div className="grid shrink-0 grid-cols-3 gap-1 @4xl/owithu:grid-cols-7">
      {stats.map(([label, value]) => (
        <div key={label} className="min-w-0 rounded-md bg-muted/35 px-2 py-1.5 text-center">
          <div className="truncate text-[11px] text-muted-foreground">{label}</div>
          <div className={cn("text-sm font-semibold tabular-nums", (label === "失败" || label === "错误") && Number(value) > 0 && "text-destructive")}>{value}</div>
        </div>
      ))}
    </div>
  )
}

function OwithuResultTabs(props: {
  compact?: boolean
  logs: string[]
  result: OwithuData | null
  running?: boolean
  onCopyLogs: () => void
  onCopyResults: () => void
}) {
  const planLines = (props.result?.plan ?? []).slice(0, 500).map((item) => `${item.enabled ? "✓" : "○"} ${item.entryKey} / ${item.hive} / ${item.scope} -> ${item.command}`)
  const entryLines = (props.result?.entries ?? []).map((entry) => `${entry.enabled ? "✓" : "○"} ${entry.key} - ${entry.label} [${entry.scope.join(", ")}]`)
  const hasPlan = planLines.length > 0
  const hasEntries = entryLines.length > 0

  const preferredTab = props.running ? "logs" : hasPlan ? "plan" : hasEntries ? "entries" : props.logs.length ? "logs" : "plan"
  const [tab, setTab] = useState(preferredTab)
  useEffect(() => { setTab(preferredTab) }, [preferredTab])

  return (
    <Tabs value={tab} onValueChange={setTab} className="flex h-full min-h-0 flex-col">
      <TabsList variant="line" className="shrink-0">
        <TabsTrigger value="plan">计划</TabsTrigger>
        <TabsTrigger value="entries">条目</TabsTrigger>
        <TabsTrigger value="logs">日志</TabsTrigger>
      </TabsList>
      <TabsContent value="plan" className="min-h-0 flex-1">
        <TextPanel compact={props.compact} emptyText="预览或注册后会显示注册表操作计划。" icon={ListChecks} lines={planLines} onCopy={props.onCopyResults} />
      </TabsContent>
      <TabsContent value="entries" className="min-h-0 flex-1">
        <TextPanel compact={props.compact} emptyText="解析 TOML 后菜单条目会显示在这里。" icon={MousePointerClick} lines={entryLines} onCopy={props.onCopyResults} />
      </TabsContent>
      <TabsContent value="logs" className="min-h-0 flex-1">
        <TextPanel compact={props.compact} emptyText="运行日志会显示在这里。" icon={ScrollText} lines={props.logs} onCopy={props.onCopyLogs} />
      </TabsContent>
    </Tabs>
  )
}

function TextPanel(props: {
  compact?: boolean
  emptyText: string
  icon: typeof ListChecks
  lines: string[]
  onCopy: () => void
}) {
  const Icon = props.icon
  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border bg-background/70">
      <div className={props.compact ? "flex shrink-0 items-center justify-between gap-2 px-2 py-1.5" : "flex shrink-0 items-center justify-between gap-2 px-3 py-2"}>
        <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
          <Icon className="size-3.5" />
          <span>{props.lines.length ? `${props.lines.length} 项` : "等待运行"}</span>
        </div>
        <Button disabled={!props.lines.length} size="xs" variant="ghost" onClick={props.onCopy}>
          <Copy data-icon="inline-start" />
          复制
        </Button>
      </div>
      <Separator />
      <ScrollArea className="min-h-0 flex-1">
        {props.lines.length ? (
          <pre className={props.compact ? "whitespace-pre-wrap p-2 text-xs leading-5 text-muted-foreground" : "whitespace-pre-wrap p-3 text-xs leading-5 text-muted-foreground"}>
            {props.lines.join("\n")}
          </pre>
        ) : (
          <div className="flex h-full min-h-16 items-center justify-center p-3 text-center text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><Icon className="size-3.5" />{props.emptyText}</span>
          </div>
        )}
      </ScrollArea>
    </section>
  )
}

function buildInput(action: OwithuAction, data: OwithuCardState): OwithuInput {
  return {
    action,
    path: data.path,
    configText: data.configText,
    hive: data.hive ?? "",
    onlyKey: data.onlyKey,
  }
}

function statusFromState(data: OwithuCardState, running: boolean): OwithuStatusMeta {
  if (running || data.phase === "running") {
    return {
      label: "运行中",
      description: data.progressText || "Owithu 正在处理注册表操作。",
      tone: "running",
      badgeVariant: "secondary",
      iconClass: "bg-primary text-primary-foreground",
    }
  }
  if (data.phase === "completed") {
    return {
      label: "完成",
      description: data.progressText || "上次操作已完成。",
      tone: "success",
      badgeVariant: "default",
      iconClass: "bg-primary text-primary-foreground",
    }
  }
  if (data.phase === "error") {
    return {
      label: "失败",
      description: data.progressText || "上次操作失败，请查看日志。",
      tone: "error",
      badgeVariant: "destructive",
      iconClass: "bg-destructive text-destructive-foreground",
    }
  }
  return {
    label: "就绪",
    description: "粘贴路径或 TOML 后开始预览。",
    tone: "idle",
    badgeVariant: "outline",
    iconClass: "bg-secondary text-secondary-foreground",
  }
}

function isDangerous(props: ViewProps): boolean {
  return props.action !== "preview"
}

function labelForAction(action: OwithuAction): string {
  if (action === "preview") return "预览"
  if (action === "register") return "注册"
  if (action === "unregister") return "注销"
  return action
}

function summaryText(props: ViewProps): string {
  if (props.data.progressText) return props.data.progressText
  if (props.result) {
    const processed = props.result.registeredCount + props.result.unregisteredCount
    return `${props.result.entries.length} 条目 / ${props.result.plan.length} 操作 / ${processed} 已处理`
  }
  if (props.data.configText) return "已粘贴 TOML，等待预览"
  if (props.data.path) return `${props.data.path} 等待运行`
  return "粘贴路径或 TOML 后开始预览"
}

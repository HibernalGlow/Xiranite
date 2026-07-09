import { useEffect, useMemo, useRef, useState } from "react"
import type { NodeComponentProps, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type { PackuToolAction, PackuToolData, PackuToolInput, PackuToolSpec } from "@xiranite/packu-node-runtime/core"
import type { LucideIcon } from "lucide-react"
import { CheckCircle2, Image as ImageIcon, Play, RotateCcw, Square } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { AnimatedCircularProgressBar } from "@/components/ui/animated-circular-progress-bar"
import { Badge } from "@/components/ui/badge"
import { BlurFade } from "@/components/ui/blur-fade"
import { BorderBeam } from "@/components/ui/border-beam"
import { Button } from "@/components/ui/button"
import { GridPattern } from "@/components/ui/grid-pattern"
import { MagicCard } from "@/components/ui/magic-card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { RunningTint } from "@/nodes/shared/controls"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import { ActionIconButton, ActionPicker, ConfigDefaultsPopover, OptionsPopover, PathFields, PathsInput, RuntimeOptions, StatusStrip } from "./controls"
import { ACTIONS, NODE_META } from "./constants"
import { PackuResultTabs } from "./results"
import type { PackuCardState, PackuStatusMeta } from "./types"
import { CONFIG_FIELDS } from "./types"

export function Component({ compId, host }: NodeComponentProps<PackuCardState>) {
  const surface = useNodeSurface()
  const data = getHostData(host, compId)
  const dataRef = useRef<PackuCardState>(data)
  dataRef.current = data

  const [running, setRunning] = useState(false)
  const [defaults, setDefaults] = useState<Partial<PackuCardState> | undefined>(undefined)
  const [configFilePath, setConfigFilePath] = useState<string | undefined>(undefined)
  const [configDirty, setConfigDirty] = useState(false)

  const action = data.action ?? "status"
  const actionMeta = ACTIONS.find((item) => item.value === action) ?? ACTIONS[0]!
  const result = data.result ?? null
  const logs = data.logs ?? []
  const progress = data.progress ?? 0
  const status = statusFromState(data, running, NODE_META.description)
  const covers = useMemo(() => coverCandidates(data, result), [data.pathsText, result?.selectedPaths])
  const compactSurface = surface.mode === "compact" || surface.mode === "portrait"
  const forceCollapsedSurface = compactSurface && surface.height > 0 && surface.height < 160
  const portraitCompact = surface.mode === "portrait" || (surface.mode === "compact" && surface.width < 560 && surface.height >= 300)

  useEffect(() => {
    const loadConfig = host.config?.get?.<Partial<PackuCardState>>() ?? host.getNodeConfig?.<Partial<PackuCardState>>()
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
    data.configPath,
    data.databasePath,
    data.argsText,
    data.python,
    data.sourceRoot,
    data.moduleName,
    data.dryRun,
    data.recordRun,
    defaults,
  ])

  function patch(patchData: Partial<PackuCardState>) {
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
    if (current.command.command) {
      lines.push(`${current.command.label}\t${current.command.command} ${current.command.args.join(" ")}`)
    }
    lines.push(`sourceRoot\t${current.integration.sourceRoot}`)
    lines.push(`moduleName\t${current.integration.moduleName}`)
    for (const candidate of current.integration.configCandidates) {
      lines.push(`configCandidate\t${candidate}`)
    }
    if (current.integration.databasePath) lines.push(`databasePath\t${current.integration.databasePath}`)
    lines.push(`covers\t${current.selectedPaths.length}`)
    await host.clipboard?.writeText?.(lines.join("\n"))
  }

  function reset() {
    patch({ logs: [], phase: "idle", progress: 0, progressText: "", result: null })
  }

  async function saveAsDefault() {
    const config: Partial<PackuCardState> = {}
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
    const empty: Partial<PackuCardState> = {}
    for (const field of CONFIG_FIELDS) empty[field] = undefined
    patch(empty)
  }

  async function execute(nextAction: PackuToolAction = action) {
    if (running) return
    const current = dataRef.current

    if (nextAction !== "status" && !clean(current.pathsText)) {
      const message = "请先输入至少一个归档或目录路径。"
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
      const response = await run<PackuToolInput, PackuToolData>(NODE_META.id, buildInput(nextAction, current, NODE_META.spec), (event: NodeRunEvent) => {
        if (event.type === "progress") {
          patch({ progress: event.progress ?? 0, progressText: event.message })
          pushLog(`[${event.progress ?? 0}%] ${event.message}`)
          return
        }
        pushLog(event.message)
      }) as NodeRunResult<PackuToolData>

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

  const commonProps = createViewProps({
    action,
    actionMeta,
    configDirty,
    configFilePath,
    covers,
    data,
    defaults,
    logs,
    nodeIcon: NODE_META.icon,
    nodeTitle: NODE_META.title,
    progress,
    result,
    running,
    status,
    onActionChange: (value: PackuToolAction) => patch({ action: value }),
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
  })

  return (
    <TooltipProvider>
      <div ref={surface.ref} className="@container/coveru relative flex h-full min-h-0 w-full overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(circle_at_18%_0%,color-mix(in_oklch,var(--primary)_14%,transparent),transparent_36%),radial-gradient(circle_at_82%_10%,color-mix(in_oklch,var(--chart-4)_14%,transparent),transparent_34%)]" />
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
  action: PackuToolAction
  actionMeta: (typeof ACTIONS)[number]
  configDirty: boolean
  configFilePath?: string
  covers: string[]
  data: PackuCardState
  defaults?: Partial<PackuCardState>
  logs: string[]
  nodeIcon: LucideIcon
  nodeTitle: string
  progress: number
  result: PackuToolData | null
  running: boolean
  status: PackuStatusMeta
  onActionChange: (value: PackuToolAction) => void
  onCopyLogs: () => void
  onCopyResults: () => void
  onExecute: (action?: PackuToolAction) => void
  onOpenConfigFile?: () => Promise<void> | void
  onPastePaths: () => void
  onPatch: (patch: Partial<PackuCardState>) => void
  onReset: () => void
  onResetOverride: () => void
  onRestoreDefault: () => void
  onSaveDefault: () => void
}) {
  return props
}

function CollapsedView(props: ViewProps) {
  const NodeIcon = props.nodeIcon
  return (
    <div data-testid="packu-collapsed-view" className="relative flex h-full min-h-0 items-center gap-2 overflow-hidden rounded-xl border bg-background/85 px-3 py-2 shadow-sm">
      <RunningTint tone={props.status.tone} />
      <div className={cn("relative grid size-8 shrink-0 place-items-center rounded-lg", props.status.iconClass)}>
        <NodeIcon />
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="flex items-center gap-1 text-xs font-semibold leading-none">
          <span>{props.nodeTitle}</span>
          <Badge variant={props.status.badgeVariant}>{props.status.label}</Badge>
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-1 truncate text-xs text-muted-foreground">
          <ImageIcon className="size-3.5 shrink-0" />
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
    <div data-testid="packu-compact-view" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-2 p-3 pb-2">
        <HeaderLine status={props.status} subtitle={props.data.progressText || summaryText(props)} />
        <div className="flex shrink-0 items-center gap-1">
          <OptionsPopover data={props.data} disabled={props.running} onPatch={props.onPatch} />
          <RunActionButton compact props={props} />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
        <ActionPicker action={props.action} disabled={props.running} onActionChange={props.onActionChange} />
        <PathsInput compact data={props.data} disabled={props.running} onPaste={props.onPastePaths} onPatch={props.onPatch} />
        <CoverStrip covers={props.covers} running={props.running} status={props.status} />
        {(props.status.tone === "running" || props.status.tone === "error") && (
          <StatusStrip compact progress={props.progress} status={props.status} text={props.data.progressText} />
        )}
        <div className="min-h-0 flex-1">
          <PackuResultTabs compact logs={props.logs} result={props.result} running={props.running} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} />
        </div>
      </div>
    </div>
  )
}

function PortraitCompactView(props: ViewProps) {
  return (
    <div data-testid="packu-portrait-view" className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="flex shrink-0 items-start justify-between gap-2">
        <HeaderLine status={props.status} subtitle={props.data.progressText || summaryText(props)} />
        <div className="flex shrink-0 items-center gap-1">
          <OptionsPopover data={props.data} disabled={props.running} onPatch={props.onPatch} />
          <RunActionButton compact props={props} />
        </div>
      </div>
      <div className="grid shrink-0 gap-2">
        <ActionPicker action={props.action} disabled={props.running} onActionChange={props.onActionChange} />
        <PathsInput compact data={props.data} disabled={props.running} onPaste={props.onPastePaths} onPatch={props.onPatch} />
      </div>
      <CoverList covers={props.covers} running={props.running} status={props.status} className="max-h-36" />
      <div className="min-h-0 flex-1">
        <PackuResultTabs compact logs={props.logs} result={props.result} running={props.running} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} />
      </div>
    </div>
  )
}

function FullView(props: ViewProps) {
  return (
    <div data-testid="packu-full-view" className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <div className="flex shrink-0 flex-col gap-3 @3xl/coveru:flex-row @3xl/coveru:items-center @3xl/coveru:justify-between">
        <div className="flex min-w-0 flex-col gap-2 @3xl/coveru:flex-row @3xl/coveru:items-center">
          <HeaderLine status={props.status} subtitle={props.data.progressText || summaryText(props)} />
          <div data-testid="packu-header-toolbar" className="flex min-w-0 flex-wrap items-center gap-2">
            <ActionPicker action={props.action} disabled={props.running} triggerClassName="@3xl/coveru:w-72" onActionChange={props.onActionChange} />
            <RunActionButton props={props} />
            <ActionIconButton disabled={props.running} icon={RotateCcw} label="清空状态" onClick={props.onReset} />
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
        <CoverStatsPanel covers={props.covers} progress={props.progress} result={props.result} />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 @2xl/coveru:grid-cols-[minmax(260px,320px)_minmax(0,1fr)]">
        <section className="flex min-h-0 flex-col gap-3 overflow-auto pr-1">
          <div className="grid gap-2 border-b pb-3">
            <div>
              <div className="text-sm font-semibold">路径</div>
              <div className="text-xs text-muted-foreground">归档或目录，每行一条。status 不需要路径。</div>
            </div>
            <PathsInput data={props.data} disabled={props.running} onPaste={props.onPastePaths} onPatch={props.onPatch} />
          </div>
          <div className="grid gap-2 border-b pb-3">
            <div className="text-sm font-semibold">可执行文件</div>
            <PathFields data={props.data} disabled={props.running} onPatch={props.onPatch} />
          </div>
          <div className="grid gap-2 border-b pb-3">
            <div className="text-sm font-semibold">运行选项</div>
            <RuntimeOptions data={props.data} disabled={props.running} onPatch={props.onPatch} />
          </div>
          <ProgressDial progress={props.progress} status={props.status} text={props.data.progressText} />
        </section>

        <div className="grid min-h-0 gap-3 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] @4xl/coveru:grid-cols-[minmax(0,1fr)_minmax(280px,340px)] @4xl/coveru:grid-rows-1">
          <section className="relative min-h-0 rounded-xl">
            <MagicCard className="h-full w-full">
              <div className="relative flex h-full min-h-0 flex-col gap-2 rounded-xl p-3">
                <div className="relative flex shrink-0 items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <ImageIcon className="size-4 text-muted-foreground" />
                    <span className="text-xs font-semibold">封面预览</span>
                    <Badge variant="outline">{props.covers.length}</Badge>
                  </div>
                  {props.running && <span className="text-[11px] text-muted-foreground">提取中…</span>}
                </div>
                <div className="relative min-h-0 flex-1 overflow-auto">
                  <CoverGrid covers={props.covers} running={props.running} status={props.status} />
                </div>
                {props.running && <BorderBeam size={120} duration={5} colorFrom="var(--primary)" colorTo="var(--chart-4)" borderWidth={1.5} />}
              </div>
            </MagicCard>
          </section>
          <div className="min-h-0">
            <PackuResultTabs logs={props.logs} result={props.result} running={props.running} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} />
          </div>
        </div>
      </div>
    </div>
  )
}

function CoverGrid(props: { covers: string[]; running: boolean; status: PackuStatusMeta }) {
  if (!props.covers.length) return <EmptyCoverState />
  return (
    <div className="grid grid-cols-2 gap-2 @sm/coveru:grid-cols-3 @md/coveru:grid-cols-4 @lg/coveru:grid-cols-5">
      {props.covers.slice(0, 60).map((path, index) => (
        <BlurFade key={`${path}:${index}`} delay={Math.min(index * 0.03, 0.3)} className="h-full">
          <CoverTile done={props.status.tone === "success"} index={index} path={path} running={props.running} />
        </BlurFade>
      ))}
    </div>
  )
}

function CoverTile({ path, index, running, done }: { path: string; index: number; running: boolean; done: boolean }) {
  return (
    <div className="group relative flex h-full flex-col gap-1 rounded-lg border bg-background/70 p-1.5">
      <div className={cn("relative aspect-[3/4] overflow-hidden rounded-md bg-gradient-to-br from-primary/12 via-chart-4/12 to-chart-2/12", running && "animate-pulse")}>
        <GridPattern className="fill-muted-foreground/10 stroke-muted-foreground/10" height={16} width={16} />
        <div className="absolute inset-0 grid place-items-center">
          <ImageIcon className="size-5 text-muted-foreground/50" />
        </div>
        <div className="absolute left-1 top-1 grid size-4 place-items-center rounded-sm bg-background/80 text-[9px] font-semibold tabular-nums text-muted-foreground">{index + 1}</div>
        {done && (
          <div className="absolute right-1 top-1 grid size-4 place-items-center rounded-full bg-primary text-primary-foreground">
            <CheckCircle2 className="size-3" />
          </div>
        )}
      </div>
      <div className="truncate text-[11px] font-medium leading-tight" title={path}>{basename(path)}</div>
      <div className="truncate text-[10px] leading-tight text-muted-foreground" title={path}>{path}</div>
    </div>
  )
}

function CoverStrip(props: { covers: string[]; running: boolean; status: PackuStatusMeta }) {
  if (!props.covers.length) return null
  return (
    <ScrollArea className="shrink-0">
      <div className="flex gap-1.5 pb-1">
        {props.covers.slice(0, 16).map((path, index) => (
          <div key={`${path}:${index}`} className="relative flex w-14 shrink-0 flex-col gap-0.5">
            <div className={cn("relative aspect-[3/4] overflow-hidden rounded-md bg-gradient-to-br from-primary/12 via-chart-4/12 to-chart-2/12", props.running && "animate-pulse")}>
              <div className="absolute inset-0 grid place-items-center">
                <ImageIcon className="size-3.5 text-muted-foreground/50" />
              </div>
              {props.status.tone === "success" && <div className="absolute right-0.5 top-0.5 size-2 rounded-full bg-primary" />}
            </div>
            <div className="truncate text-[9px] text-muted-foreground" title={path}>{basename(path)}</div>
          </div>
        ))}
      </div>
    </ScrollArea>
  )
}

function CoverList(props: { covers: string[]; running: boolean; status: PackuStatusMeta; className?: string }) {
  if (!props.covers.length) return null
  return (
    <ScrollArea className={cn("shrink-0", props.className)}>
      <div className="grid gap-1">
        {props.covers.slice(0, 8).map((path, index) => (
          <div key={`${path}:${index}`} className="flex items-center gap-2 rounded-md border bg-background/60 px-2 py-1">
            <div className={cn("relative grid size-7 shrink-0 place-items-center overflow-hidden rounded bg-gradient-to-br from-primary/12 via-chart-4/12 to-chart-2/12", props.running && "animate-pulse")}>
              <ImageIcon className="size-3.5 text-muted-foreground/60" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11px] font-medium leading-tight" title={path}>{basename(path)}</div>
            </div>
            {props.status.tone === "success"
              ? <CheckCircle2 className="size-3 shrink-0 text-primary" />
              : <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{index + 1}</span>}
          </div>
        ))}
      </div>
    </ScrollArea>
  )
}

function EmptyCoverState() {
  return (
    <div className="flex h-full min-h-32 flex-col items-center justify-center gap-2 p-4 text-center text-xs text-muted-foreground">
      <ImageIcon className="size-6 text-muted-foreground/40" />
      <span className="font-medium text-foreground/80">等待封面</span>
      <span>输入归档路径后，这里会显示封面缩略图网格。</span>
    </div>
  )
}

function CoverStatsPanel(props: { covers: string[]; result: PackuToolData | null }) {
  const stats: Array<{ label: string; value: number; tone?: "error" }> = [
    { label: "封面", value: props.covers.length },
    { label: "选中", value: props.result?.selectedPaths.length ?? 0 },
    { label: "配置键", value: props.result?.config?.keys.length ?? 0 },
    { label: "错误", value: props.result?.errors.length ?? 0, tone: "error" },
  ]
  return (
    <div data-testid="coveru-stats-panel" className="grid shrink-0 grid-cols-2 gap-1 @3xl/coveru:grid-cols-4">
      {stats.map((item) => (
        <div key={item.label} className="min-w-0 rounded-md bg-muted/35 px-2 py-1.5 text-center">
          <div className="truncate text-[11px] text-muted-foreground">{item.label}</div>
          <div className={cn("text-sm font-semibold tabular-nums", item.tone === "error" && item.value > 0 && "text-destructive")}>{item.value}</div>
        </div>
      ))}
    </div>
  )
}

function ProgressDial(props: { progress: number; status: PackuStatusMeta; text?: string }) {
  return (
    <div className="flex shrink-0 items-center gap-3 rounded-lg border bg-background/60 p-2">
      <div className="relative size-14 shrink-0">
        <AnimatedCircularProgressBar className="size-14! text-xs! font-semibold" gaugePrimaryColor="var(--primary)" gaugeSecondaryColor="var(--muted)" value={props.progress} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium">{props.text || props.status.description}</div>
        <div className="text-[11px] text-muted-foreground">{props.status.label} · {props.progress}%</div>
      </div>
    </div>
  )
}

function RunActionButton({ compact, props }: { compact?: boolean; props: ViewProps }) {
  if (props.running) {
    return (
      <Button aria-label="coveru running" disabled size={compact ? "icon-sm" : "sm"} variant="secondary">
        <Square />
        {!compact && <span>运行中</span>}
      </Button>
    )
  }

  const label = actionLabel(props.action)
  const destructive = props.action === "run" && !(props.data.dryRun ?? true)
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
            <AlertDialogTitle>确认执行运行？</AlertDialogTitle>
            <AlertDialogDescription>
              当前已关闭预演，会调用 Python 模块执行真实封面提取，这一步可能产生不可撤销的改动。请确认配置文件、源码目录和归档路径无误。
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
    <Button aria-label={label} disabled={props.running} size={compact ? "icon-sm" : "sm"} onClick={() => props.onExecute(props.action)}>
      <Play />
      {!compact && <span>{label}</span>}
    </Button>
  )
}

function HeaderLine({ status, subtitle }: { status: PackuStatusMeta; subtitle: string }) {
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-2">
        <div className={cn("grid size-8 shrink-0 place-items-center rounded-lg", status.iconClass)}>
          <ImageIcon />
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-sm font-semibold leading-none">CoverU</h3>
            <Badge variant={status.badgeVariant}>{status.label}</Badge>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>
    </div>
  )
}

function coverCandidates(data: PackuCardState, result: PackuToolData | null): string[] {
  const fromResult = result?.selectedPaths ?? []
  if (fromResult.length) return fromResult
  const text = clean(data.pathsText)
  if (!text) return []
  return [...new Set(text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))]
}

function statusFromState(data: PackuCardState, running: boolean, idleDescription: string): PackuStatusMeta {
  if (running || data.phase === "running") {
    return {
      label: "运行中",
      description: data.progressText || "CoverU 正在生成命令计划或调用模块提取封面。",
      tone: "running",
      badgeVariant: "secondary",
      iconClass: "bg-primary text-primary-foreground",
    }
  }
  if (data.phase === "completed") {
    return {
      label: "完成",
      description: data.progressText || "上次封面提取已完成。",
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
    description: idleDescription,
    tone: "idle",
    badgeVariant: "outline",
    iconClass: "bg-secondary text-secondary-foreground",
  }
}

function summaryText(props: ViewProps): string {
  if (props.data.progressText) return props.data.progressText
  if (props.covers.length) return `${props.covers.length} 个归档待提取封面`
  if (props.result?.selectedPaths.length) return `${props.result.selectedPaths.length} 路径 / ${props.result.errors.length} 错误`
  return props.actionMeta.description
}

function actionLabel(action: PackuToolAction): string {
  return ACTIONS.find((item) => item.value === action)?.label ?? action
}

function basename(value: string): string {
  const normalized = value.replace(/\\/g, "/")
  return normalized.split("/").filter(Boolean).at(-1) ?? value
}

function clean(value: unknown): string | undefined {
  const text = String(value ?? "").trim()
  return text || undefined
}

function buildInput(action: PackuToolAction, data: PackuCardState, spec: PackuToolSpec): PackuToolInput {
  const pathsText = clean(data.pathsText)
  const argsText = clean(data.argsText)
  return {
    action,
    paths: pathsText ? pathsText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) : [],
    args: argsText ? argsText.split(/\s+/).filter(Boolean) : [],
    configPath: clean(data.configPath),
    databasePath: clean(data.databasePath),
    python: clean(data.python),
    sourceRoot: clean(data.sourceRoot) || spec.sourceRoot,
    moduleName: clean(data.moduleName) || spec.moduleName,
    dryRun: data.dryRun ?? true,
    recordRun: data.recordRun ?? false,
  }
}

function getHostData(host: NodeComponentProps<PackuCardState>["host"], compId: string): PackuCardState {
  return host.state?.getData?.() ?? host.getData<PackuCardState>(compId) ?? {}
}

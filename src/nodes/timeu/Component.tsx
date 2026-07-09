import { useEffect, useMemo, useRef, useState } from "react"
import type { NodeComponentProps, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type { TimeuAction, TimeuData, TimeuInput, TimeuPlanItem } from "@xiranite/node-timeu/core"
import type { LucideIcon } from "lucide-react"
import { AlertTriangle, CheckCircle2, Clipboard, Clock3, Copy, DatabaseZap, FileClock, FolderInput, History, Play, RotateCcw, Settings2, ShieldAlert, Square, Terminal, Trash2, XCircle } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import { ACTIONS, NODE_ICON } from "./constants"
import type { TimeuCardState, TimeuStatusMeta } from "./types"
import { CONFIG_FIELDS } from "./types"

export function Component({ compId, host }: NodeComponentProps<TimeuCardState>) {
  const surface = useNodeSurface()
  const data = getHostData(host, compId)
  const dataRef = useRef<TimeuCardState>(data)
  dataRef.current = data
  const [running, setRunning] = useState(false)
  const [defaults, setDefaults] = useState<Partial<TimeuCardState> | undefined>()
  const [configDirty, setConfigDirty] = useState(false)

  const action = data.action ?? "scan"
  const actionMeta = ACTIONS.find((item) => item.value === action) ?? ACTIONS[0]!
  const logs = data.logs ?? []
  const result = data.result ?? null
  const progress = data.progress ?? 0
  const paths = useMemo(() => splitLines(data.pathsText), [data.pathsText])
  const status = statusFromState(data, running, result)
  const compactSurface = surface.mode === "compact" || surface.mode === "portrait"
  const forceCollapsedSurface = compactSurface && surface.height > 0 && surface.height < 160
  const portraitCompact = surface.mode === "portrait" || (surface.mode === "compact" && surface.width < 560 && surface.height >= 300)

  useEffect(() => {
    const loadConfig = host.config?.get?.<Partial<TimeuCardState>>() ?? host.getNodeConfig?.<Partial<TimeuCardState>>()
    loadConfig?.then((response) => setDefaults(response.config)).catch(() => undefined)
  }, [host])

  useEffect(() => {
    if (!defaults) return
    setConfigDirty(CONFIG_FIELDS.some((field) => String(data[field] ?? "") !== String(defaults[field] ?? "")))
  }, [data.pathsText, data.recordPath, data.recursive, data.includeDirectories, data.dryRun, defaults])

  function patch(patchData: Partial<TimeuCardState>) {
    dataRef.current = { ...dataRef.current, ...patchData }
    if (host.state?.patchData) host.state.patchData(patchData)
    else host.patchData(compId, patchData)
  }

  function pushLog(message: string) {
    patch({ logs: [...(dataRef.current.logs ?? []), message].slice(-120) })
  }

  async function pastePaths() {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ pathsText: text.trim() })
  }

  async function copyResults() {
    const lines = (dataRef.current.result?.plan ?? []).map((item) => `${item.status}\t${item.operation}\t${item.path}\t${item.reason ?? ""}`)
    await host.clipboard?.writeText?.(lines.join("\n"))
  }

  async function copyLogs() {
    await host.clipboard?.writeText?.(logs.join("\n"))
  }

  function reset() {
    patch({ logs: [], phase: "idle", progress: 0, progressText: "", result: null })
  }

  async function saveAsDefault() {
    const config: Partial<TimeuCardState> = {}
    for (const field of CONFIG_FIELDS) {
      const value = dataRef.current[field]
      if (value !== undefined) (config as Record<string, unknown>)[field] = value
    }
    if (host.config?.save) await host.config.save(config)
    else await host.saveNodeConfig?.(config)
    setDefaults(config)
    setConfigDirty(false)
  }

  async function execute(nextAction: TimeuAction = action) {
    if (running) return
    if (!splitLines(dataRef.current.pathsText).length) {
      const message = "请先输入至少一个文件或目录路径。"
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
      const response = await run<TimeuInput, TimeuData>("timeu", buildInput(nextAction, dataRef.current), (event: NodeRunEvent) => {
        if (event.type === "progress") {
          patch({ progress: event.progress ?? 0, progressText: event.message })
          pushLog(`[${event.progress ?? 0}%] ${event.message}`)
        } else {
          pushLog(event.message)
        }
      }) as NodeRunResult<TimeuData>
      patch({ phase: response.success ? "completed" : "error", progress: response.success ? 100 : 0, progressText: response.message, result: response.data ?? null })
      pushLog(response.message)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      patch({ phase: "error", progress: 0, progressText: message })
      pushLog(message)
    } finally {
      setRunning(false)
    }
  }

  const props: ViewProps = {
    action,
    actionMeta,
    configDirty,
    data,
    defaults,
    logs,
    paths,
    progress,
    result,
    running,
    status,
    onActionChange: (value) => patch({ action: value }),
    onCopyLogs: copyLogs,
    onCopyResults: copyResults,
    onExecute: execute,
    onPastePaths: pastePaths,
    onPatch: patch,
    onReset: reset,
    onRestoreDefault: () => defaults && patch(defaults),
    onSaveDefault: saveAsDefault,
  }

  return (
    <TooltipProvider>
      <div ref={surface.ref} className="@container/timeu flex h-full min-h-0 w-full overflow-hidden bg-card">
        {surface.mode === "collapsed" || forceCollapsedSurface ? (
          <CollapsedView {...props} />
        ) : compactSurface ? (
          portraitCompact ? <PortraitView {...props} /> : <CompactView {...props} />
        ) : (
          <FullView {...props} />
        )}
      </div>
    </TooltipProvider>
  )
}

interface ViewProps {
  action: TimeuAction
  actionMeta: (typeof ACTIONS)[number]
  configDirty: boolean
  data: TimeuCardState
  defaults?: Partial<TimeuCardState>
  logs: string[]
  paths: string[]
  progress: number
  result: TimeuData | null
  running: boolean
  status: TimeuStatusMeta
  onActionChange: (value: TimeuAction) => void
  onCopyLogs: () => void
  onCopyResults: () => void
  onExecute: (action?: TimeuAction) => void
  onPastePaths: () => void
  onPatch: (patch: Partial<TimeuCardState>) => void
  onReset: () => void
  onRestoreDefault: () => void
  onSaveDefault: () => void
}

function CollapsedView(props: ViewProps) {
  const Icon = NODE_ICON
  return (
    <div data-testid="timeu-collapsed-view" className="flex h-full min-h-0 w-full items-center gap-2 overflow-hidden rounded-xl border bg-card px-3 py-2 shadow-sm">
      <div className={cn("grid size-8 shrink-0 place-items-center rounded-lg", props.status.iconClass)}><Icon /></div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-xs font-semibold leading-none"><span>TimeU</span><Badge variant={props.status.badgeVariant}>{props.status.label}</Badge></div>
        <div className="mt-1 truncate text-xs text-muted-foreground">{summaryText(props)}</div>
      </div>
      <RunButton compact props={props} />
    </div>
  )
}

function CompactView(props: ViewProps) {
  return (
    <div data-testid="timeu-compact-view" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-2 p-3 pb-2">
        <HeaderLine status={props.status} subtitle={props.data.progressText || summaryText(props)} />
        <div className="flex shrink-0 items-center gap-1"><ActionTools {...props} compact /><RunButton compact props={props} /></div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
        <ActionMode value={props.action} disabled={props.running} onChange={props.onActionChange} />
        <PathInput compact data={props.data} disabled={props.running} onPaste={props.onPastePaths} onPatch={props.onPatch} />
        <SwitchPanel compact data={props.data} disabled={props.running} onPatch={props.onPatch} />
        {(props.status.tone === "running" || props.status.tone === "error") && <StatusStrip progress={props.progress} status={props.status} text={props.data.progressText} />}
        <div className="min-h-0 flex-1"><ResultTabs compact logs={props.logs} result={props.result} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} /></div>
      </div>
    </div>
  )
}

function PortraitView(props: ViewProps) {
  return (
    <div data-testid="timeu-portrait-view" className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="flex shrink-0 items-start justify-between gap-2"><HeaderLine status={props.status} subtitle={props.data.progressText || summaryText(props)} /><RunButton compact props={props} /></div>
      <ActionMode value={props.action} disabled={props.running} onChange={props.onActionChange} />
      <PathInput compact data={props.data} disabled={props.running} onPaste={props.onPastePaths} onPatch={props.onPatch} />
      <SwitchPanel compact data={props.data} disabled={props.running} onPatch={props.onPatch} />
      <div className="min-h-0 flex-1"><ResultTabs compact logs={props.logs} result={props.result} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} /></div>
    </div>
  )
}

function FullView(props: ViewProps) {
  return (
    <div data-testid="timeu-full-view" className="flex min-h-0 flex-1 flex-col gap-2 p-3">
      <div className="flex shrink-0 flex-col gap-2 @3xl/timeu:flex-row @3xl/timeu:items-center @3xl/timeu:justify-between">
        <div className="flex min-w-0 flex-col gap-2 @3xl/timeu:flex-row @3xl/timeu:items-center">
          <HeaderLine status={props.status} subtitle={props.data.progressText || summaryText(props)} />
          <div data-testid="timeu-header-toolbar" className="flex min-w-0 flex-wrap items-center gap-1"><ActionTools {...props} /></div>
        </div>
        <StatsPanel progress={props.progress} result={props.result} paths={props.paths} />
      </div>
      {(props.status.tone === "running" || props.status.tone === "error") && <StatusStrip progress={props.progress} status={props.status} text={props.data.progressText} />}
      <div className="grid min-h-0 flex-1 gap-2 @2xl/timeu:grid-cols-[minmax(250px,320px)_minmax(0,1fr)] @4xl/timeu:grid-cols-[minmax(250px,320px)_minmax(0,1fr)_minmax(260px,320px)]">
        <section className="flex min-h-0 flex-col gap-2 overflow-auto rounded-lg border bg-card p-2">
          <ZoneTitle icon={FolderInput} label="路径队列" />
          <PathInput data={props.data} disabled={props.running} onPaste={props.onPastePaths} onPatch={props.onPatch} />
          <Separator />
          <RecordField data={props.data} disabled={props.running} onPatch={props.onPatch} />
        </section>
        <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border bg-card">
          <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2"><ZoneTitle icon={FileClock} label="时间记录" /><Badge variant="outline">{props.result?.plan.length ?? props.paths.length}</Badge></div>
          <Separator />
          <TimestampRows plan={props.result?.plan ?? props.paths.map((path) => ({ path, operation: props.action === "restore" ? "restore" : "backup", status: "pending" as const }))} />
        </section>
        <div className="grid min-h-0 gap-2 grid-rows-[auto_minmax(0,1fr)] @2xl/timeu:col-span-2 @4xl/timeu:col-span-1">
          <ExecutionGate {...props} />
          <ResultTabs logs={props.logs} result={props.result} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} />
        </div>
      </div>
    </div>
  )
}

function ActionTools(props: ViewProps & { compact?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      {!props.compact && <ActionMode value={props.action} disabled={props.running} onChange={props.onActionChange} />}
      <IconButton disabled={props.running} active={props.configDirty} icon={DatabaseZap} label="保存默认" onClick={props.onSaveDefault} />
      <IconButton disabled={props.running || !props.defaults} icon={Settings2} label="恢复默认" onClick={props.onRestoreDefault} />
      <IconButton icon={RotateCcw} label="清空状态" onClick={props.onReset} />
    </div>
  )
}

function ActionMode(props: { disabled?: boolean; value: TimeuAction; onChange: (value: TimeuAction) => void }) {
  return (
    <ToggleGroup type="single" value={props.value} disabled={props.disabled} onValueChange={(value) => value && props.onChange(value as TimeuAction)} className="grid grid-cols-3" size="sm">
      {ACTIONS.map((item) => <ToggleGroupItem key={item.value} value={item.value} className="min-w-0 gap-1"><item.icon className="size-3.5" /><span className="truncate text-xs">{item.shortLabel}</span></ToggleGroupItem>)}
    </ToggleGroup>
  )
}

function PathInput(props: { compact?: boolean; data: TimeuCardState; disabled?: boolean; onPaste: () => void; onPatch: (patch: Partial<TimeuCardState>) => void }) {
  return (
    <div className="grid gap-1.5">
      {!props.compact && <Label htmlFor="timeu-paths" className="text-xs">文件或目录</Label>}
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-1.5">
        <Textarea id="timeu-paths" aria-label="timeu paths" className={cn("min-h-0 resize-none font-mono text-xs", props.compact ? "h-14" : "h-28")} disabled={props.disabled} placeholder={"每行一个文件或目录\nD:/archive"} value={props.data.pathsText ?? ""} onChange={(event) => props.onPatch({ pathsText: event.currentTarget.value })} />
        <div className="grid content-start gap-1.5"><IconButton disabled={props.disabled} icon={Clipboard} label="粘贴路径" onClick={props.onPaste} /><IconButton disabled={props.disabled || !props.data.pathsText} icon={Trash2} label="清空路径" onClick={() => props.onPatch({ pathsText: "" })} /></div>
      </div>
    </div>
  )
}

function RecordField(props: { data: TimeuCardState; disabled?: boolean; onPatch: (patch: Partial<TimeuCardState>) => void }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="timeu-record" className="text-xs">记录文件</Label>
      <Input id="timeu-record" disabled={props.disabled} placeholder="留空则在首个路径旁生成 timeu-timestamps.json" value={props.data.recordPath ?? ""} onChange={(event) => props.onPatch({ recordPath: event.currentTarget.value })} />
    </div>
  )
}

function SwitchPanel(props: { compact?: boolean; data: TimeuCardState; disabled?: boolean; onPatch: (patch: Partial<TimeuCardState>) => void }) {
  return (
    <div className={cn("grid gap-2", props.compact ? "grid-cols-1" : "grid-cols-[repeat(auto-fit,minmax(8rem,1fr))]")}>
      <SwitchRow checked={props.data.dryRun ?? true} disabled={props.disabled} icon={ShieldAlert} label="预览" onCheckedChange={(dryRun) => props.onPatch({ dryRun })} />
      <SwitchRow checked={props.data.recursive ?? true} disabled={props.disabled} icon={FolderInput} label="递归" onCheckedChange={(recursive) => props.onPatch({ recursive })} />
      <SwitchRow checked={props.data.includeDirectories ?? false} disabled={props.disabled} icon={FileClock} label="含目录" onCheckedChange={(includeDirectories) => props.onPatch({ includeDirectories })} />
    </div>
  )
}

function ExecutionGate(props: ViewProps) {
  const live = props.action !== "scan" && !(props.data.dryRun ?? true)
  return (
    <section className={cn("flex shrink-0 flex-col gap-2 rounded-lg border bg-card p-2", live && "border-destructive/50 bg-destructive/[0.03]")}>
      <div className="flex items-center justify-between gap-2"><ZoneTitle icon={live ? AlertTriangle : ShieldAlert} label="执行" tone={live ? "danger" : "default"} /><Badge variant={live ? "destructive" : "outline"}>{props.data.dryRun ?? true ? "预览" : "写入"}</Badge></div>
      <ActionMode value={props.action} disabled={props.running} onChange={props.onActionChange} />
      <SwitchPanel data={props.data} disabled={props.running} onPatch={props.onPatch} />
      <RunButton props={props} />
    </section>
  )
}

function RunButton({ compact, props }: { compact?: boolean; props: ViewProps }) {
  if (props.running) return <Button aria-label="timeu running" disabled size={compact ? "icon-sm" : "sm"} variant="secondary"><Square />{!compact && <span>运行中</span>}</Button>
  const label = actionLabel(props.action)
  const live = props.action !== "scan" && !(props.data.dryRun ?? true)
  if (live) {
    return (
      <AlertDialog>
        <AlertDialogTrigger asChild><Button aria-label={label} size={compact ? "icon-sm" : "sm"} variant="destructive"><Play />{!compact && <span>{label}</span>}</Button></AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>确认{props.action === "restore" ? "恢复时间戳" : "备份时间戳"}？</AlertDialogTitle><AlertDialogDescription>当前会写入记录文件或修改文件 atime/mtime。请确认路径和记录文件无误。</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => props.onExecute(props.action)}>确认执行</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
  }
  return <Button aria-label={label} size={compact ? "icon-sm" : "sm"} onClick={() => props.onExecute(props.action)}><Play />{!compact && <span>{label}</span>}</Button>
}

function TimestampRows(props: { plan: Array<TimeuPlanItem | { path: string; operation: "backup" | "restore"; status: "pending" }> }) {
  if (!props.plan.length) return <div className="flex min-h-32 flex-1 items-center justify-center p-4 text-center text-sm text-muted-foreground">运行后显示当前时间、记录时间和恢复计划。</div>
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="grid gap-1.5 p-3">
        {props.plan.slice(0, 160).map((item, index) => {
          const meta = itemStatusMeta(item.status)
          const StatusIcon = meta.icon
          const current = "current" in item ? item.current : undefined
          const stored = "stored" in item ? item.stored : undefined
          return (
            <div key={`${item.path}:${index}`} className={cn("grid gap-1 rounded-md border px-2 py-1.5", item.status === "error" && "border-destructive/40", item.status === "skipped" && "opacity-75")}>
              <div className="flex min-w-0 items-center gap-2"><Clock3 className="size-4 shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1"><div className="truncate text-xs font-medium">{baseName(item.path)}</div><div className="truncate font-mono text-[11px] text-muted-foreground">{item.path}</div></div><Badge variant={meta.variant} className="gap-1"><StatusIcon className="size-3" />{meta.label}</Badge></div>
              {(current || stored) && <div className="grid gap-1 text-[11px] text-muted-foreground @md/timeu:grid-cols-2"><span className="truncate">当前 {current ? formatMs(current.mtimeMs) : "缺失"}</span><span className="truncate">记录 {stored ? formatMs(stored.mtimeMs) : "未写入"}</span></div>}
            </div>
          )
        })}
      </div>
    </ScrollArea>
  )
}

function ResultTabs(props: { compact?: boolean; logs: string[]; result: TimeuData | null; onCopyLogs: () => void; onCopyResults: () => void }) {
  return (
    <Tabs defaultValue="records" className="flex h-full min-h-0 flex-col">
      <TabsList className="shrink-0"><TabsTrigger value="records">记录</TabsTrigger><TabsTrigger value="errors">问题</TabsTrigger><TabsTrigger value="logs">日志</TabsTrigger></TabsList>
      <TabsContent value="records" className="min-h-0 flex-1"><RecordPanel compact={props.compact} result={props.result} onCopy={props.onCopyResults} /></TabsContent>
      <TabsContent value="errors" className="min-h-0 flex-1"><TextPanel empty="暂无问题" lines={[...(props.result?.errors ?? []), ...(props.result?.plan ?? []).filter((item) => item.reason && item.status !== "pending").map((item) => `${item.path}: ${item.reason}`)]} /></TabsContent>
      <TabsContent value="logs" className="min-h-0 flex-1"><TextPanel actionLabel="复制" empty="运行日志会显示在这里。" icon={Terminal} lines={props.logs} onAction={props.onCopyLogs} /></TabsContent>
    </Tabs>
  )
}

function RecordPanel(props: { compact?: boolean; result: TimeuData | null; onCopy: () => void }) {
  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border bg-card">
      <div className={props.compact ? "flex shrink-0 items-center justify-between gap-2 px-2 py-1.5" : "flex shrink-0 items-center justify-between gap-2 px-3 py-2"}><div className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground"><History className="size-3.5" /><span>{props.result?.plan.length ? `${props.result.plan.length} 项` : "等待运行"}</span></div><Button disabled={!props.result?.plan.length} size="xs" variant="ghost" onClick={props.onCopy}><Copy data-icon="inline-start" />复制</Button></div>
      <Separator />
      <TimestampRows plan={props.result?.plan ?? []} />
    </section>
  )
}

function TextPanel(props: { actionLabel?: string; empty: string; icon?: LucideIcon; lines: string[]; onAction?: () => void }) {
  const Icon = props.icon
  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border bg-card">
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2"><span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">{Icon && <Icon className="size-3.5" />}{props.lines.length ? `${props.lines.length} 行` : props.empty}</span>{props.onAction && <Button disabled={!props.lines.length} size="xs" variant="ghost" onClick={props.onAction}>{props.actionLabel ?? "复制"}</Button>}</div>
      <Separator />
      <ScrollArea className="min-h-0 flex-1">{props.lines.length ? <pre className="p-3 text-xs leading-5 text-muted-foreground">{props.lines.join("\n")}</pre> : <div className="flex min-h-24 items-center justify-center p-4 text-sm text-muted-foreground">{props.empty}</div>}</ScrollArea>
    </section>
  )
}

function HeaderLine(props: { status: TimeuStatusMeta; subtitle: string }) {
  const Icon = NODE_ICON
  return <div className="min-w-0"><div className="flex min-w-0 items-center gap-2"><div className={cn("grid size-8 shrink-0 place-items-center rounded-lg", props.status.iconClass)}><Icon /></div><div className="min-w-0"><div className="flex min-w-0 items-center gap-2"><h3 className="truncate text-sm font-semibold leading-none">TimeU</h3><Badge variant={props.status.badgeVariant}>{props.status.label}</Badge></div><p className="mt-1 truncate text-xs text-muted-foreground">{props.subtitle}</p></div></div></div>
}

function StatsPanel(props: { paths: string[]; progress: number; result: TimeuData | null }) {
  const stats = [
    { label: "路径", value: props.paths.length },
    { label: "扫描", value: props.result?.scannedCount ?? 0 },
    { label: "备份", value: props.result?.backupCount ?? 0 },
    { label: "恢复", value: props.result?.restoredCount ?? 0 },
    { label: "跳过", value: props.result?.skippedCount ?? 0 },
    { label: "进度", value: props.progress, suffix: "%" },
  ]
  return <div className="grid shrink-0 grid-cols-3 gap-1 @3xl/timeu:grid-cols-6">{stats.map((item) => <div key={item.label} className="min-w-0 rounded-md bg-muted/35 px-2 py-1.5 text-center"><div className="truncate text-[11px] text-muted-foreground">{item.label}</div><div className="text-sm font-semibold tabular-nums">{item.value}{item.suffix ?? ""}</div></div>)}</div>
}

function StatusStrip(props: { progress: number; status: TimeuStatusMeta; text?: string }) {
  return <div className="rounded-md border bg-card p-2"><div className="mb-1 flex min-w-0 items-center justify-between gap-2"><div className="truncate text-xs font-medium">{props.text || props.status.description}</div><Badge variant={props.status.badgeVariant}>{props.status.label}</Badge></div><Progress value={props.progress} className={cn("h-1.5", props.status.tone === "error" && "bg-destructive/20")} /></div>
}

function SwitchRow(props: { checked: boolean; disabled?: boolean; icon: LucideIcon; label: string; onCheckedChange: (checked: boolean) => void }) {
  const Icon = props.icon
  return <label className="flex min-w-0 items-center justify-between gap-2 rounded-md border bg-card px-2 py-1.5"><span className="flex min-w-0 items-center gap-1.5"><Icon className="size-4 shrink-0 text-muted-foreground" /><span className="truncate text-xs font-medium">{props.label}</span></span><Switch checked={props.checked} disabled={props.disabled} size="sm" onCheckedChange={props.onCheckedChange} /></label>
}

function IconButton(props: { active?: boolean; disabled?: boolean; icon: LucideIcon; label: string; onClick: () => void }) {
  const Icon = props.icon
  return <Tooltip><TooltipTrigger asChild><Button aria-label={props.label} disabled={props.disabled} size="icon-sm" variant={props.active ? "secondary" : "outline"} onClick={props.onClick}><Icon /></Button></TooltipTrigger><TooltipContent>{props.label}</TooltipContent></Tooltip>
}

function ZoneTitle(props: { icon: LucideIcon; label: string; tone?: "default" | "danger" }) {
  const Icon = props.icon
  return <div className="flex shrink-0 items-center gap-1.5"><Icon className={cn("size-3.5", props.tone === "danger" ? "text-destructive" : "text-muted-foreground")} /><span className="text-xs font-semibold">{props.label}</span></div>
}

function statusFromState(data: TimeuCardState, running: boolean, result: TimeuData | null): TimeuStatusMeta {
  if (running || data.phase === "running") return { label: "运行中", description: data.progressText || "TimeU 正在扫描或写入时间戳。", tone: "running", badgeVariant: "secondary", iconClass: "bg-primary text-primary-foreground" }
  if (data.phase === "error" || result?.errorCount) return { label: "失败", description: data.progressText || result?.errors[0] || "上次任务失败，请查看问题列表。", tone: "error", badgeVariant: "destructive", iconClass: "bg-destructive text-destructive-foreground" }
  if (data.phase === "completed") return { label: "完成", description: data.progressText || "上次时间戳任务已完成。", tone: "success", badgeVariant: "default", iconClass: "bg-primary text-primary-foreground" }
  return { label: "就绪", description: "输入文件或目录后扫描时间戳。", tone: "idle", badgeVariant: "outline", iconClass: "bg-secondary text-secondary-foreground" }
}

function itemStatusMeta(status: TimeuPlanItem["status"] | "pending") {
  if (status === "success") return { icon: CheckCircle2, label: "完成", variant: "default" as const }
  if (status === "error") return { icon: XCircle, label: "错误", variant: "destructive" as const }
  if (status === "skipped") return { icon: AlertTriangle, label: "跳过", variant: "outline" as const }
  return { icon: Clock3, label: "待执行", variant: "secondary" as const }
}

function summaryText(props: ViewProps): string {
  if (props.data.progressText) return props.data.progressText
  if (props.result) return `${props.result.plan.length} 项 / 记录 ${props.result.records.length}`
  if (props.paths.length) return `${props.paths.length} 条路径 / ${props.actionMeta.shortLabel}`
  return props.actionMeta.description
}

function actionLabel(action: TimeuAction): string {
  return ACTIONS.find((item) => item.value === action)?.label ?? action
}

function buildInput(action: TimeuAction, data: TimeuCardState): TimeuInput {
  return { action, paths: splitLines(data.pathsText), recordPath: clean(data.recordPath), recursive: data.recursive ?? true, includeDirectories: data.includeDirectories ?? false, dryRun: data.dryRun ?? true }
}

function formatMs(value: number): string {
  return new Date(value).toLocaleString()
}

function splitLines(value: unknown): string[] {
  return String(value ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

function clean(value: unknown): string | undefined {
  const text = String(value ?? "").trim()
  return text || undefined
}

function baseName(value: string): string {
  const normalized = value.replace(/\\/g, "/")
  return normalized.split("/").filter(Boolean).at(-1) ?? value
}

function getHostData(host: NodeComponentProps<TimeuCardState>["host"], compId: string): TimeuCardState {
  return host.state?.getData?.() ?? host.getData<TimeuCardState>(compId) ?? {}
}

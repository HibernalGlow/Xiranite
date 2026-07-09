import { useEffect, useMemo, useRef, useState } from "react"
import type { NodeComponentProps, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type { ClassfAction, ClassfClassifyMode, ClassfData, ClassfInput, ClassfPlanItem, ClassfTransferMode } from "@xiranite/node-classf/core"
import type { LucideIcon } from "lucide-react"
import { AlertTriangle, Archive, CheckCircle2, Clipboard, Copy, DatabaseZap, File, Folder, FolderInput, Play, RotateCcw, Settings2, ShieldAlert, Square, Terminal, Trash2, XCircle } from "lucide-react"
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
import { ACTIONS, CLASSIFY_MODES, NODE_ICON, PLAN_ICON, TRANSFER_MODES } from "./constants"
import type { ClassfCardState, ClassfStatusMeta } from "./types"
import { CONFIG_FIELDS } from "./types"

export function Component({ compId, host }: NodeComponentProps<ClassfCardState>) {
  const surface = useNodeSurface()
  const data = getHostData(host, compId)
  const dataRef = useRef<ClassfCardState>(data)
  dataRef.current = data

  const [running, setRunning] = useState(false)
  const [defaults, setDefaults] = useState<Partial<ClassfCardState> | undefined>()
  const [configDirty, setConfigDirty] = useState(false)

  const action = data.action ?? "plan"
  const actionMeta = ACTIONS.find((item) => item.value === action) ?? ACTIONS[0]!
  const paths = useMemo(() => splitLines(data.pathsText), [data.pathsText])
  const logs = data.logs ?? []
  const result = data.result ?? null
  const progress = data.progress ?? 0
  const status = statusFromState(data, running, result)
  const compactSurface = surface.mode === "compact" || surface.mode === "portrait"
  const forceCollapsedSurface = compactSurface && surface.height > 0 && surface.height < 160
  const portraitCompact = surface.mode === "portrait" || (surface.mode === "compact" && surface.width < 560 && surface.height >= 300)

  useEffect(() => {
    const loadConfig = host.config?.get?.<Partial<ClassfCardState>>() ?? host.getNodeConfig?.<Partial<ClassfCardState>>()
    loadConfig?.then((response) => setDefaults(response.config)).catch(() => undefined)
  }, [host])

  useEffect(() => {
    if (!defaults) return
    setConfigDirty(CONFIG_FIELDS.some((field) => String(data[field] ?? "") !== String(defaults[field] ?? "")))
  }, [data.pathsText, data.targetDir, data.transferMode, data.classifyMode, data.existingPolicy, data.dryRun, defaults])

  function patch(patchData: Partial<ClassfCardState>) {
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
    const lines = (dataRef.current.result?.items ?? []).map((item) => `${item.status}\t${item.stage}\t${item.sourcePath}\t${item.targetRelative}\t${item.reason ?? ""}`)
    await host.clipboard?.writeText?.(lines.join("\n"))
  }

  async function copyLogs() {
    await host.clipboard?.writeText?.(logs.join("\n"))
  }

  function reset() {
    patch({ logs: [], phase: "idle", progress: 0, progressText: "", result: null })
  }

  async function saveAsDefault() {
    const config: Partial<ClassfCardState> = {}
    for (const field of CONFIG_FIELDS) {
      const value = dataRef.current[field]
      if (value !== undefined) (config as Record<string, unknown>)[field] = value
    }
    if (host.config?.save) await host.config.save(config)
    else await host.saveNodeConfig?.(config)
    setDefaults(config)
    setConfigDirty(false)
  }

  async function execute(nextAction: ClassfAction = action) {
    if (running) return
    if (!splitLines(dataRef.current.pathsText).length) {
      const message = "Add at least one selected source path before running ClassF."
      patch({ phase: "error", progress: 0, progressText: message })
      pushLog(message)
      return
    }
    const run = host.runner?.run ?? host.actions?.run
    if (!run) {
      const message = "Native execution is unavailable in this host. Use the desktop backend or CLI."
      patch({ phase: "error", progress: 0, progressText: message })
      pushLog(message)
      return
    }
    setRunning(true)
    patch({ action: nextAction, phase: "running", progress: 0, progressText: `${actionLabel(nextAction)} started.`, result: null })
    try {
      const response = await run<ClassfInput, ClassfData>("classf", buildInput(nextAction, dataRef.current), (event: NodeRunEvent) => {
        if (event.type === "progress") {
          patch({ progress: event.progress ?? 0, progressText: event.message })
          pushLog(`[${event.progress ?? 0}%] ${event.message}`)
        } else {
          pushLog(event.message)
        }
      }) as NodeRunResult<ClassfData>
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
      <div ref={surface.ref} className="@container/classf flex h-full min-h-0 w-full overflow-hidden bg-card">
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
  action: ClassfAction
  actionMeta: (typeof ACTIONS)[number]
  configDirty: boolean
  data: ClassfCardState
  defaults?: Partial<ClassfCardState>
  logs: string[]
  paths: string[]
  progress: number
  result: ClassfData | null
  running: boolean
  status: ClassfStatusMeta
  onActionChange: (value: ClassfAction) => void
  onCopyLogs: () => void
  onCopyResults: () => void
  onExecute: (action?: ClassfAction) => void
  onPastePaths: () => void
  onPatch: (patch: Partial<ClassfCardState>) => void
  onReset: () => void
  onRestoreDefault: () => void
  onSaveDefault: () => void
}

function CollapsedView(props: ViewProps) {
  const Icon = NODE_ICON
  return (
    <div data-testid="classf-collapsed-view" className="flex h-full min-h-0 w-full items-center gap-2 overflow-hidden rounded-xl border bg-card px-3 py-2 shadow-sm">
      <div className={cn("grid size-8 shrink-0 place-items-center rounded-lg", props.status.iconClass)}><Icon /></div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-xs font-semibold leading-none"><span>ClassF</span><Badge variant={props.status.badgeVariant}>{props.status.label}</Badge></div>
        <div className="mt-1 truncate text-xs text-muted-foreground">{summaryText(props)}</div>
      </div>
      <RunButton compact props={props} />
    </div>
  )
}

function CompactView(props: ViewProps) {
  return (
    <div data-testid="classf-compact-view" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-2 p-3 pb-2">
        <HeaderLine status={props.status} subtitle={props.data.progressText || summaryText(props)} />
        <div className="flex shrink-0 items-center gap-1"><ActionTools {...props} compact /><RunButton compact props={props} /></div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
        <ActionMode value={props.action} disabled={props.running} onChange={props.onActionChange} />
        <ModeToggle value={props.data.classifyMode ?? "auto"} disabled={props.running} onChange={(classifyMode) => props.onPatch({ classifyMode })} />
        <PathInput compact data={props.data} disabled={props.running} onPaste={props.onPastePaths} onPatch={props.onPatch} />
        <div className="min-h-0 flex-1"><ResultTabs compact logs={props.logs} result={props.result} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} /></div>
      </div>
    </div>
  )
}

function PortraitView(props: ViewProps) {
  return (
    <div data-testid="classf-portrait-view" className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="flex shrink-0 items-start justify-between gap-2"><HeaderLine status={props.status} subtitle={props.data.progressText || summaryText(props)} /><RunButton compact props={props} /></div>
      <ActionMode value={props.action} disabled={props.running} onChange={props.onActionChange} />
      <PathInput compact data={props.data} disabled={props.running} onPaste={props.onPastePaths} onPatch={props.onPatch} />
      <ModeToggle value={props.data.classifyMode ?? "auto"} disabled={props.running} onChange={(classifyMode) => props.onPatch({ classifyMode })} />
      <TargetField compact data={props.data} disabled={props.running} onPatch={props.onPatch} />
      <div className="min-h-0 flex-1"><ResultTabs compact logs={props.logs} result={props.result} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} /></div>
    </div>
  )
}

function FullView(props: ViewProps) {
  return (
    <div data-testid="classf-full-view" className="flex min-h-0 flex-1 flex-col gap-2 p-3">
      <div className="flex shrink-0 flex-col gap-2 @3xl/classf:flex-row @3xl/classf:items-center @3xl/classf:justify-between">
        <div className="flex min-w-0 flex-col gap-2 @3xl/classf:flex-row @3xl/classf:items-center">
          <HeaderLine status={props.status} subtitle={props.data.progressText || summaryText(props)} />
          <div data-testid="classf-header-toolbar" className="flex min-w-0 flex-wrap items-center gap-1"><ActionTools {...props} /></div>
        </div>
        <StatsPanel progress={props.progress} result={props.result} paths={props.paths} />
      </div>
      {(props.status.tone === "running" || props.status.tone === "error") && <StatusStrip progress={props.progress} status={props.status} text={props.data.progressText} />}
      <div className="grid min-h-0 flex-1 gap-2 @2xl/classf:grid-cols-[minmax(250px,330px)_minmax(0,1fr)] @4xl/classf:grid-cols-[minmax(250px,330px)_minmax(0,1fr)_minmax(270px,340px)]">
        <section className="flex min-h-0 flex-col gap-2 overflow-auto rounded-lg border bg-card p-2">
          <ZoneTitle icon={FolderInput} label="Selection and target" />
          <PathInput data={props.data} disabled={props.running} onPaste={props.onPastePaths} onPatch={props.onPatch} />
          <ModeToggle value={props.data.classifyMode ?? "auto"} disabled={props.running} onChange={(classifyMode) => props.onPatch({ classifyMode })} />
          <TargetField data={props.data} disabled={props.running} onPatch={props.onPatch} />
          <TransferToggle value={props.data.transferMode ?? "move"} disabled={props.running} onChange={(transferMode) => props.onPatch({ transferMode })} />
          <SwitchRow checked={props.data.dryRun ?? true} disabled={props.running} icon={ShieldAlert} label="Dry run" onCheckedChange={(dryRun) => props.onPatch({ dryRun })} />
        </section>
        <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border bg-card">
          <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2"><ZoneTitle icon={PLAN_ICON} label="Classification plan" /><Badge variant="outline">{props.result?.items.length ?? props.paths.length}</Badge></div>
          <Separator />
          <PlanRows items={props.result?.items ?? []} paths={props.paths} />
        </section>
        <div className="grid min-h-0 gap-2 grid-rows-[auto_minmax(0,1fr)] @2xl/classf:col-span-2 @4xl/classf:col-span-1">
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
      <IconButton disabled={props.running} active={props.configDirty} icon={DatabaseZap} label="Save defaults" onClick={props.onSaveDefault} />
      <IconButton disabled={props.running || !props.defaults} icon={Settings2} label="Restore defaults" onClick={props.onRestoreDefault} />
      <IconButton icon={RotateCcw} label="Clear state" onClick={props.onReset} />
    </div>
  )
}

function ActionMode(props: { disabled?: boolean; value: ClassfAction; onChange: (value: ClassfAction) => void }) {
  return (
    <ToggleGroup type="single" value={props.value} disabled={props.disabled} onValueChange={(value) => value && props.onChange(value as ClassfAction)} className="grid grid-cols-2" size="sm">
      {ACTIONS.map((item) => <ToggleGroupItem key={item.value} value={item.value} className="min-w-0 gap-1"><item.icon className="size-3.5" /><span className="truncate text-xs">{item.shortLabel}</span></ToggleGroupItem>)}
    </ToggleGroup>
  )
}

function ModeToggle(props: { disabled?: boolean; value: ClassfClassifyMode; onChange: (value: ClassfClassifyMode) => void }) {
  return (
    <ToggleGroup type="single" value={props.value} disabled={props.disabled} onValueChange={(value) => value && props.onChange(value as ClassfClassifyMode)} className="grid grid-cols-3" size="sm">
      {CLASSIFY_MODES.map((item) => <ToggleGroupItem key={item.value} value={item.value} className="min-w-0 gap-1"><item.icon className="size-3.5" /><span className="truncate text-xs">{item.label}</span></ToggleGroupItem>)}
    </ToggleGroup>
  )
}

function TransferToggle(props: { disabled?: boolean; value: ClassfTransferMode; onChange: (value: ClassfTransferMode) => void }) {
  return (
    <ToggleGroup type="single" value={props.value} disabled={props.disabled} onValueChange={(value) => value && props.onChange(value as ClassfTransferMode)} className="grid grid-cols-2" size="sm">
      {TRANSFER_MODES.map((item) => <ToggleGroupItem key={item.value} value={item.value} className="min-w-0 gap-1"><item.icon className="size-3.5" /><span className="truncate text-xs">{item.label}</span></ToggleGroupItem>)}
    </ToggleGroup>
  )
}

function PathInput(props: { compact?: boolean; data: ClassfCardState; disabled?: boolean; onPaste: () => void; onPatch: (patch: Partial<ClassfCardState>) => void }) {
  return (
    <div className="grid gap-1.5">
      {!props.compact && <Label htmlFor="classf-paths" className="text-xs">Selected source paths</Label>}
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-1.5">
        <Textarea id="classf-paths" aria-label="classf paths" className={cn("min-h-0 resize-none font-mono text-xs", props.compact ? "h-14" : "h-28")} disabled={props.disabled} placeholder={"One selected file or folder per line\nD:/set/reviewed.zip"} value={props.data.pathsText ?? ""} onChange={(event) => props.onPatch({ pathsText: event.currentTarget.value })} />
        <div className="grid content-start gap-1.5"><IconButton disabled={props.disabled} icon={Clipboard} label="Paste paths" onClick={props.onPaste} /><IconButton disabled={props.disabled || !props.data.pathsText} icon={Trash2} label="Clear paths" onClick={() => props.onPatch({ pathsText: "" })} /></div>
      </div>
    </div>
  )
}

function TargetField(props: { compact?: boolean; data: ClassfCardState; disabled?: boolean; onPatch: (patch: Partial<ClassfCardState>) => void }) {
  return (
    <div className="grid gap-1.5">
      {!props.compact && <Label htmlFor="classf-target" className="text-xs">Target folder</Label>}
      <Input id="classf-target" aria-label="classf target" disabled={props.disabled} placeholder={props.data.classifyMode === "off" ? "Required for target mode" : "Optional; defaults to already"} value={props.data.targetDir ?? ""} onChange={(event) => props.onPatch({ targetDir: event.currentTarget.value })} />
    </div>
  )
}

function ExecutionGate(props: ViewProps) {
  const live = props.action === "classify" && !(props.data.dryRun ?? true)
  return (
    <section className={cn("flex shrink-0 flex-col gap-2 rounded-lg border bg-card p-2", live && "border-destructive/50 bg-destructive/[0.03]")}>
      <div className="flex items-center justify-between gap-2"><ZoneTitle icon={live ? AlertTriangle : ShieldAlert} label="Run" tone={live ? "danger" : "default"} /><Badge variant={live ? "destructive" : "outline"}>{props.data.dryRun ?? true ? "dry run" : "live"}</Badge></div>
      <ActionMode value={props.action} disabled={props.running} onChange={props.onActionChange} />
      <TransferToggle value={props.data.transferMode ?? "move"} disabled={props.running} onChange={(transferMode) => props.onPatch({ transferMode })} />
      <SwitchRow checked={props.data.dryRun ?? true} disabled={props.running} icon={ShieldAlert} label="Dry run" onCheckedChange={(dryRun) => props.onPatch({ dryRun })} />
      <RunButton props={props} />
    </section>
  )
}

function RunButton({ compact, props }: { compact?: boolean; props: ViewProps }) {
  if (props.running) return <Button aria-label="classf running" disabled size={compact ? "icon-sm" : "sm"} variant="secondary"><Square />{!compact && <span>Running</span>}</Button>
  const label = actionLabel(props.action)
  const live = props.action === "classify" && !(props.data.dryRun ?? true)
  if (live) {
    return (
      <AlertDialog>
        <AlertDialogTrigger asChild><Button aria-label={label} size={compact ? "icon-sm" : "sm"} variant="destructive"><Play />{!compact && <span>{label}</span>}</Button></AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Confirm live classification?</AlertDialogTitle><AlertDialogDescription>ClassF will move or copy ready paths into the planned folders. Existing targets are skipped as conflicts.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => props.onExecute(props.action)}>Confirm classify</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
  }
  return <Button aria-label={label} size={compact ? "icon-sm" : "sm"} onClick={() => props.onExecute(props.action)}><Play />{!compact && <span>{label}</span>}</Button>
}

function PlanRows(props: { items: ClassfPlanItem[]; paths: string[] }) {
  if (!props.items.length) {
    const text = props.paths.length ? "Run a plan to show already and wait transfers." : "Add selected source paths to preview classification."
    return <div className="flex min-h-32 flex-1 items-center justify-center p-4 text-center text-sm text-muted-foreground">{text}</div>
  }
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="grid gap-1.5 p-3">
        {props.items.slice(0, 180).map((item, index) => {
          const meta = itemStatusMeta(item.status)
          const StatusIcon = meta.icon
          const KindIcon = item.kind === "folder" ? Folder : File
          return (
            <div key={`${item.sourcePath}:${index}`} className={cn("grid gap-1 rounded-md border px-2 py-1.5", (item.status === "conflict" || item.status === "error") && "border-destructive/40")}>
              <div className="flex min-w-0 items-center gap-2"><KindIcon className="size-4 shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1"><div className="truncate text-xs font-medium">{item.sourceName}</div><div className="truncate font-mono text-[11px] text-muted-foreground">{"->"} {item.targetRelative}</div></div><Badge variant={meta.variant} className="gap-1"><StatusIcon className="size-3" />{meta.label}</Badge></div>
              <div className="truncate text-[11px] text-muted-foreground">{item.stage}{item.reason ? ` / ${item.reason}` : ""}</div>
            </div>
          )
        })}
      </div>
    </ScrollArea>
  )
}

function ResultTabs(props: { compact?: boolean; logs: string[]; result: ClassfData | null; onCopyLogs: () => void; onCopyResults: () => void }) {
  return (
    <Tabs defaultValue="plan" className="flex h-full min-h-0 flex-col">
      <TabsList className="shrink-0"><TabsTrigger value="plan"><PLAN_ICON className="size-3.5" />Plan</TabsTrigger><TabsTrigger value="issues"><AlertTriangle className="size-3.5" />Issues</TabsTrigger><TabsTrigger value="logs"><Terminal className="size-3.5" />Log</TabsTrigger></TabsList>
      <TabsContent value="plan" className="min-h-0 flex-1"><PlanPanel compact={props.compact} result={props.result} onCopy={props.onCopyResults} /></TabsContent>
      <TabsContent value="issues" className="min-h-0 flex-1"><TextPanel empty="No issues yet." lines={[...(props.result?.errors ?? []), ...(props.result?.items ?? []).filter((item) => item.reason && item.status !== "ready").map((item) => `${item.sourcePath}: ${item.reason}`)]} /></TabsContent>
      <TabsContent value="logs" className="min-h-0 flex-1"><TextPanel actionLabel="Copy" empty="Run log will appear here." icon={Terminal} lines={props.logs} onAction={props.onCopyLogs} /></TabsContent>
    </Tabs>
  )
}

function PlanPanel(props: { compact?: boolean; result: ClassfData | null; onCopy: () => void }) {
  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border bg-card">
      <div className={props.compact ? "flex shrink-0 items-center justify-between gap-2 px-2 py-1.5" : "flex shrink-0 items-center justify-between gap-2 px-3 py-2"}><div className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground"><PLAN_ICON className="size-3.5" /><span>{props.result?.items.length ? `${props.result.items.length} items` : "Waiting for plan"}</span></div><Button disabled={!props.result?.items.length} size="xs" variant="ghost" onClick={props.onCopy}><Copy data-icon="inline-start" />Copy</Button></div>
      <Separator />
      <PlanRows items={props.result?.items ?? []} paths={[]} />
    </section>
  )
}

function TextPanel(props: { actionLabel?: string; empty: string; icon?: LucideIcon; lines: string[]; onAction?: () => void }) {
  const Icon = props.icon
  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border bg-card">
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2"><span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">{Icon && <Icon className="size-3.5" />}{props.lines.length ? `${props.lines.length} lines` : props.empty}</span>{props.onAction && <Button disabled={!props.lines.length} size="xs" variant="ghost" onClick={props.onAction}>{props.actionLabel ?? "Copy"}</Button>}</div>
      <Separator />
      <ScrollArea className="min-h-0 flex-1">{props.lines.length ? <pre className="p-3 text-xs leading-5 text-muted-foreground">{props.lines.join("\n")}</pre> : <div className="flex min-h-24 items-center justify-center p-4 text-sm text-muted-foreground">{props.empty}</div>}</ScrollArea>
    </section>
  )
}

function HeaderLine(props: { status: ClassfStatusMeta; subtitle: string }) {
  const Icon = NODE_ICON
  return <div className="min-w-0"><div className="flex min-w-0 items-center gap-2"><div className={cn("grid size-8 shrink-0 place-items-center rounded-lg", props.status.iconClass)}><Icon /></div><div className="min-w-0"><div className="flex min-w-0 items-center gap-2"><h3 className="truncate text-sm font-semibold leading-none">ClassF</h3><Badge variant={props.status.badgeVariant}>{props.status.label}</Badge></div><p className="mt-1 truncate text-xs text-muted-foreground">{props.subtitle}</p></div></div></div>
}

function StatsPanel(props: { paths: string[]; progress: number; result: ClassfData | null }) {
  const stats = [
    { label: "Selected", value: props.paths.length },
    { label: "Ready", value: props.result?.readyCount ?? 0 },
    { label: "Wait", value: props.result?.waitCount ?? 0 },
    { label: "Moved", value: props.result?.movedCount ?? 0 },
    { label: "Conflicts", value: props.result?.conflictCount ?? 0 },
    { label: "Progress", value: props.progress, suffix: "%" },
  ]
  return <div className="grid shrink-0 grid-cols-3 gap-1 @3xl/classf:grid-cols-6">{stats.map((item) => <div key={item.label} className="min-w-0 rounded-md bg-muted/35 px-2 py-1.5 text-center"><div className="truncate text-[11px] text-muted-foreground">{item.label}</div><div className="text-sm font-semibold tabular-nums">{item.value}{item.suffix ?? ""}</div></div>)}</div>
}

function StatusStrip(props: { progress: number; status: ClassfStatusMeta; text?: string }) {
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
  return <div className="flex min-w-0 shrink-0 items-center gap-1.5"><Icon className={cn("size-3.5 shrink-0", props.tone === "danger" ? "text-destructive" : "text-muted-foreground")} /><span className="truncate text-xs font-semibold">{props.label}</span></div>
}

function statusFromState(data: ClassfCardState, running: boolean, result: ClassfData | null): ClassfStatusMeta {
  if (running || data.phase === "running") return { label: "Running", description: data.progressText || "ClassF is planning or applying transfers.", tone: "running", badgeVariant: "secondary", iconClass: "bg-primary text-primary-foreground" }
  if (data.phase === "error" || result?.errorCount) return { label: "Failed", description: data.progressText || result?.errors[0] || "Last ClassF run failed. Check issues.", tone: "error", badgeVariant: "destructive", iconClass: "bg-destructive text-destructive-foreground" }
  if (data.phase === "completed") return { label: "Done", description: data.progressText || "Last ClassF run completed.", tone: "success", badgeVariant: "default", iconClass: "bg-primary text-primary-foreground" }
  return { label: "Ready", description: "Add selected paths and preview already/wait transfers.", tone: "idle", badgeVariant: "outline", iconClass: "bg-secondary text-secondary-foreground" }
}

function itemStatusMeta(status: ClassfPlanItem["status"]) {
  if (status === "moved") return { icon: CheckCircle2, label: "Moved", variant: "default" as const }
  if (status === "copied") return { icon: CheckCircle2, label: "Copied", variant: "default" as const }
  if (status === "ready") return { icon: Archive, label: "Ready", variant: "secondary" as const }
  if (status === "conflict") return { icon: AlertTriangle, label: "Conflict", variant: "destructive" as const }
  if (status === "error") return { icon: XCircle, label: "Error", variant: "destructive" as const }
  return { icon: AlertTriangle, label: "Skipped", variant: "outline" as const }
}

function summaryText(props: ViewProps): string {
  if (props.data.progressText) return props.data.progressText
  if (props.result) return `${props.result.items.length} items / ready ${props.result.readyCount} / wait ${props.result.waitCount}`
  if (props.paths.length) return `${props.paths.length} selected / ${props.actionMeta.shortLabel}`
  return props.actionMeta.description
}

function actionLabel(action: ClassfAction): string {
  return ACTIONS.find((item) => item.value === action)?.label ?? action
}

function buildInput(action: ClassfAction, data: ClassfCardState): ClassfInput {
  return {
    action,
    paths: splitLines(data.pathsText),
    targetDir: clean(data.targetDir),
    transferMode: data.transferMode ?? "move",
    classifyMode: data.classifyMode ?? "auto",
    existingPolicy: data.existingPolicy ?? "merge",
    dryRun: data.dryRun ?? true,
  }
}

function splitLines(value: unknown): string[] {
  return String(value ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

function clean(value: unknown): string | undefined {
  const text = String(value ?? "").trim()
  return text || undefined
}

function getHostData(host: NodeComponentProps<ClassfCardState>["host"], compId: string): ClassfCardState {
  return host.state?.getData?.() ?? host.getData<ClassfCardState>(compId) ?? {}
}

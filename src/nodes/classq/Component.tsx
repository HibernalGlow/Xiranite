import { useEffect, useMemo, useRef, useState } from "react"
import type { NodeComponentProps, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type { ClassqAction, ClassqData, ClassqInput, ClassqPlanItem, ClassqTransferMode } from "@xiranite/node-classq/core"
import type { LucideIcon } from "lucide-react"
import { AlertTriangle, CheckCircle2, Clipboard, Copy, DatabaseZap, File, Folder, ListTree, Play, RotateCcw, Search, Settings2, ShieldAlert, Square, Terminal, Trash2, XCircle } from "lucide-react"
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
import { ACTIONS, NODE_ICON, PLAN_ICON, ROOT_ICON, TRANSFER_MODES, WAIT_ICON } from "./constants"
import type { ClassqCardState, ClassqStatusMeta } from "./types"
import { CONFIG_FIELDS } from "./types"

export function Component({ compId, host }: NodeComponentProps<ClassqCardState>) {
  const surface = useNodeSurface()
  const data = getHostData(host, compId)
  const dataRef = useRef<ClassqCardState>(data)
  dataRef.current = data

  const [running, setRunning] = useState(false)
  const [defaults, setDefaults] = useState<Partial<ClassqCardState> | undefined>()
  const [configDirty, setConfigDirty] = useState(false)

  const action = data.action ?? "plan"
  const actionMeta = ACTIONS.find((item) => item.value === action) ?? ACTIONS[0]!
  const roots = useMemo(() => splitLines(data.pathsText), [data.pathsText])
  const logs = data.logs ?? []
  const result = data.result ?? null
  const progress = data.progress ?? 0
  const status = statusFromState(data, running, result)
  const compactSurface = surface.mode === "compact" || surface.mode === "portrait"
  const forceCollapsedSurface = compactSurface && surface.height > 0 && surface.height < 160
  const portraitCompact = surface.mode === "portrait" || (surface.mode === "compact" && surface.width < 560 && surface.height >= 300)

  useEffect(() => {
    const loadConfig = host.config?.get?.<Partial<ClassqCardState>>() ?? host.getNodeConfig?.<Partial<ClassqCardState>>()
    loadConfig?.then((response) => setDefaults(response.config)).catch(() => undefined)
  }, [host])

  useEffect(() => {
    if (!defaults) return
    setConfigDirty(CONFIG_FIELDS.some((field) => String(data[field] ?? "") !== String(defaults[field] ?? "")))
  }, [data.pathsText, data.keyword, data.waitKeyword, data.transferMode, data.existingPolicy, data.dryRun, defaults])

  function patch(patchData: Partial<ClassqCardState>) {
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
    const config: Partial<ClassqCardState> = {}
    for (const field of CONFIG_FIELDS) {
      const value = dataRef.current[field]
      if (value !== undefined) (config as Record<string, unknown>)[field] = value
    }
    if (host.config?.save) await host.config.save(config)
    else await host.saveNodeConfig?.(config)
    setDefaults(config)
    setConfigDirty(false)
  }

  async function execute(nextAction: ClassqAction = action) {
    if (running) return
    if (!splitLines(dataRef.current.pathsText).length) {
      const message = "Add at least one root directory before running ClassQ."
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
      const response = await run<ClassqInput, ClassqData>("classq", buildInput(nextAction, dataRef.current), (event: NodeRunEvent) => {
        if (event.type === "progress") {
          patch({ progress: event.progress ?? 0, progressText: event.message })
          pushLog(`[${event.progress ?? 0}%] ${event.message}`)
        } else {
          pushLog(event.message)
        }
      }) as NodeRunResult<ClassqData>
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
    progress,
    result,
    roots,
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
      <div ref={surface.ref} className="@container/classq flex h-full min-h-0 w-full overflow-hidden bg-card">
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
  action: ClassqAction
  actionMeta: (typeof ACTIONS)[number]
  configDirty: boolean
  data: ClassqCardState
  defaults?: Partial<ClassqCardState>
  logs: string[]
  progress: number
  result: ClassqData | null
  roots: string[]
  running: boolean
  status: ClassqStatusMeta
  onActionChange: (value: ClassqAction) => void
  onCopyLogs: () => void
  onCopyResults: () => void
  onExecute: (action?: ClassqAction) => void
  onPastePaths: () => void
  onPatch: (patch: Partial<ClassqCardState>) => void
  onReset: () => void
  onRestoreDefault: () => void
  onSaveDefault: () => void
}

function CollapsedView(props: ViewProps) {
  const Icon = NODE_ICON
  return (
    <div data-testid="classq-collapsed-view" className="flex h-full min-h-0 w-full items-center gap-2 overflow-hidden rounded-xl border bg-card px-3 py-2 shadow-sm">
      <div className={cn("grid size-8 shrink-0 place-items-center rounded-lg", props.status.iconClass)}><Icon /></div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-xs font-semibold leading-none"><span>ClassQ</span><Badge variant={props.status.badgeVariant}>{props.status.label}</Badge></div>
        <div className="mt-1 truncate text-xs text-muted-foreground">{summaryText(props)}</div>
      </div>
      <RunButton compact props={props} />
    </div>
  )
}

function CompactView(props: ViewProps) {
  return (
    <div data-testid="classq-compact-view" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-2 p-3 pb-2">
        <HeaderLine status={props.status} subtitle={props.data.progressText || summaryText(props)} />
        <div className="flex shrink-0 items-center gap-1"><ActionTools {...props} compact /><RunButton compact props={props} /></div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
        <ActionMode value={props.action} disabled={props.running} onChange={props.onActionChange} />
        <KeywordFields compact data={props.data} disabled={props.running} onPatch={props.onPatch} />
        <RootInput compact data={props.data} disabled={props.running} onPaste={props.onPastePaths} onPatch={props.onPatch} />
        <div className="min-h-0 flex-1"><ResultTabs compact logs={props.logs} result={props.result} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} /></div>
      </div>
    </div>
  )
}

function PortraitView(props: ViewProps) {
  return (
    <div data-testid="classq-portrait-view" className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="flex shrink-0 items-start justify-between gap-2"><HeaderLine status={props.status} subtitle={props.data.progressText || summaryText(props)} /><RunButton compact props={props} /></div>
      <ActionMode value={props.action} disabled={props.running} onChange={props.onActionChange} />
      <RootInput compact data={props.data} disabled={props.running} onPaste={props.onPastePaths} onPatch={props.onPatch} />
      <KeywordFields compact data={props.data} disabled={props.running} onPatch={props.onPatch} />
      <TransferToggle value={props.data.transferMode ?? "move"} disabled={props.running} onChange={(transferMode) => props.onPatch({ transferMode })} />
      <div className="min-h-0 flex-1"><ResultTabs compact logs={props.logs} result={props.result} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} /></div>
    </div>
  )
}

function FullView(props: ViewProps) {
  return (
    <div data-testid="classq-full-view" className="flex min-h-0 flex-1 flex-col gap-2 p-3">
      <div className="flex shrink-0 flex-col gap-2 @3xl/classq:flex-row @3xl/classq:items-center @3xl/classq:justify-between">
        <div className="flex min-w-0 flex-col gap-2 @3xl/classq:flex-row @3xl/classq:items-center">
          <HeaderLine status={props.status} subtitle={props.data.progressText || summaryText(props)} />
          <div data-testid="classq-header-toolbar" className="flex min-w-0 flex-wrap items-center gap-1"><ActionTools {...props} /></div>
        </div>
        <StatsPanel progress={props.progress} result={props.result} roots={props.roots} />
      </div>
      {(props.status.tone === "running" || props.status.tone === "error") && <StatusStrip progress={props.progress} status={props.status} text={props.data.progressText} />}
      <section className="grid shrink-0 gap-2 rounded-lg border bg-card p-2">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <ZoneTitle icon={ROOT_ICON} label="Root scan" />
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            <ActionMode value={props.action} disabled={props.running} onChange={props.onActionChange} />
            <TransferToggle value={props.data.transferMode ?? "move"} disabled={props.running} onChange={(transferMode) => props.onPatch({ transferMode })} />
            <SwitchRow checked={props.data.dryRun ?? true} disabled={props.running} icon={ShieldAlert} label="Dry run" onCheckedChange={(dryRun) => props.onPatch({ dryRun })} />
          </div>
        </div>
        <div className="grid gap-2 @2xl/classq:grid-cols-[minmax(280px,1fr)_minmax(260px,0.8fr)]">
          <RootInput compact data={props.data} disabled={props.running} onPaste={props.onPastePaths} onPatch={props.onPatch} />
          <KeywordFields compact data={props.data} disabled={props.running} onPatch={props.onPatch} />
        </div>
      </section>
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card">
        <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2">
          <ZoneTitle icon={WAIT_ICON} label="Wait transfer groups" />
          <div className="flex shrink-0 items-center gap-1">
            <Badge variant="outline">{props.result?.keywordCount ?? 0} keyword</Badge>
            <Badge variant="outline">{props.result?.waitCount ?? 0} wait</Badge>
          </div>
        </div>
        <Separator />
        <ParentPlanGroups items={props.result?.items ?? []} roots={props.roots} />
      </section>
      <section className="grid shrink-0 gap-2 rounded-lg border bg-card p-2 @3xl/classq:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <ZoneTitle icon={props.action === "classify" && !(props.data.dryRun ?? true) ? AlertTriangle : ShieldAlert} label="Run" tone={props.action === "classify" && !(props.data.dryRun ?? true) ? "danger" : "default"} />
          <ActionMode value={props.action} disabled={props.running} onChange={props.onActionChange} />
          <TransferToggle value={props.data.transferMode ?? "move"} disabled={props.running} onChange={(transferMode) => props.onPatch({ transferMode })} />
          <Badge variant={props.action === "classify" && !(props.data.dryRun ?? true) ? "destructive" : "outline"}>{props.data.dryRun ?? true ? "dry run" : "live"}</Badge>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <IconButton disabled={!props.result?.items.length} icon={Copy} label="Copy plan" onClick={props.onCopyResults} />
          <IconButton disabled={!props.logs.length} icon={Terminal} label="Copy log" onClick={props.onCopyLogs} />
          <RunButton props={props} />
        </div>
      </section>
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

function ActionMode(props: { disabled?: boolean; value: ClassqAction; onChange: (value: ClassqAction) => void }) {
  return (
    <ToggleGroup type="single" value={props.value} disabled={props.disabled} onValueChange={(value) => value && props.onChange(value as ClassqAction)} className="grid grid-cols-2" size="sm">
      {ACTIONS.map((item) => <ToggleGroupItem key={item.value} value={item.value} className="min-w-0 gap-1"><item.icon className="size-3.5" /><span className="truncate text-xs">{item.shortLabel}</span></ToggleGroupItem>)}
    </ToggleGroup>
  )
}

function TransferToggle(props: { disabled?: boolean; value: ClassqTransferMode; onChange: (value: ClassqTransferMode) => void }) {
  return (
    <ToggleGroup type="single" value={props.value} disabled={props.disabled} onValueChange={(value) => value && props.onChange(value as ClassqTransferMode)} className="grid grid-cols-2" size="sm">
      {TRANSFER_MODES.map((item) => <ToggleGroupItem key={item.value} value={item.value} className="min-w-0 gap-1"><item.icon className="size-3.5" /><span className="truncate text-xs">{item.label}</span></ToggleGroupItem>)}
    </ToggleGroup>
  )
}

function RootInput(props: { compact?: boolean; data: ClassqCardState; disabled?: boolean; onPaste: () => void; onPatch: (patch: Partial<ClassqCardState>) => void }) {
  return (
    <div className="grid gap-1.5">
      {!props.compact && <Label htmlFor="classq-roots" className="text-xs">Root directories</Label>}
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-1.5">
        <Textarea id="classq-roots" aria-label="classq roots" className={cn("min-h-0 resize-none font-mono text-xs", props.compact ? "h-14" : "h-28")} disabled={props.disabled} placeholder={"One root directory per line\nD:/set"} value={props.data.pathsText ?? ""} onChange={(event) => props.onPatch({ pathsText: event.currentTarget.value })} />
        <div className="grid content-start gap-1.5"><IconButton disabled={props.disabled} icon={Clipboard} label="Paste roots" onClick={props.onPaste} /><IconButton disabled={props.disabled || !props.data.pathsText} icon={Trash2} label="Clear roots" onClick={() => props.onPatch({ pathsText: "" })} /></div>
      </div>
    </div>
  )
}

function KeywordFields(props: { compact?: boolean; data: ClassqCardState; disabled?: boolean; onPatch: (patch: Partial<ClassqCardState>) => void }) {
  return (
    <div className={cn("grid gap-2", props.compact ? "grid-cols-2" : "grid-cols-2")}>
      <div className="grid gap-1.5">
        {!props.compact && <Label htmlFor="classq-keyword" className="text-xs">Keyword folder</Label>}
        <Input id="classq-keyword" aria-label="classq keyword" disabled={props.disabled} placeholder="already" value={props.data.keyword ?? ""} onChange={(event) => props.onPatch({ keyword: event.currentTarget.value })} />
      </div>
      <div className="grid gap-1.5">
        {!props.compact && <Label htmlFor="classq-wait" className="text-xs">Wait folder</Label>}
        <Input id="classq-wait" aria-label="classq wait" disabled={props.disabled} placeholder="wait" value={props.data.waitKeyword ?? ""} onChange={(event) => props.onPatch({ waitKeyword: event.currentTarget.value })} />
      </div>
    </div>
  )
}

function RunButton({ compact, props }: { compact?: boolean; props: ViewProps }) {
  if (props.running) return <Button aria-label="classq running" disabled size={compact ? "icon-sm" : "sm"} variant="secondary"><Square />{!compact && <span>Running</span>}</Button>
  const label = actionLabel(props.action)
  const live = props.action === "classify" && !(props.data.dryRun ?? true)
  if (live) {
    return (
      <AlertDialog>
        <AlertDialogTrigger asChild><Button aria-label={label} size={compact ? "icon-sm" : "sm"} variant="destructive"><Play />{!compact && <span>{label}</span>}</Button></AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Confirm live ClassQ transfer?</AlertDialogTitle><AlertDialogDescription>ClassQ will move or copy ready sibling items into wait folders. Existing targets are skipped as conflicts.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => props.onExecute(props.action)}>Confirm classify</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
  }
  return <Button aria-label={label} size={compact ? "icon-sm" : "sm"} onClick={() => props.onExecute(props.action)}><Play />{!compact && <span>{label}</span>}</Button>
}

function PlanRows(props: { items: ClassqPlanItem[]; roots: string[] }) {
  if (!props.items.length) {
    const text = props.roots.length ? "Run a scan to show keyword folders and wait transfers." : "Add root directories to preview wait classification."
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
            <div key={`${item.sourcePath}:${index}`} className={cn("grid gap-1 rounded-md border px-2 py-1.5", (item.status === "conflict" || item.status === "error") && "border-destructive/40", item.stage === "keyword" && "bg-muted/25")}>
              <div className="flex min-w-0 items-center gap-2"><KindIcon className="size-4 shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1"><div className="truncate text-xs font-medium">{item.sourceName}</div><div className="truncate font-mono text-[11px] text-muted-foreground">{"->"} {item.targetRelative}</div></div><Badge variant={meta.variant} className="gap-1"><StatusIcon className="size-3" />{meta.label}</Badge></div>
              <div className="truncate text-[11px] text-muted-foreground">{item.stage === "keyword" ? "keyword folder" : "wait candidate"}{item.reason ? ` / ${item.reason}` : ""}</div>
            </div>
          )
        })}
      </div>
    </ScrollArea>
  )
}

function ParentPlanGroups(props: { items: ClassqPlanItem[]; roots: string[] }) {
  if (!props.items.length) {
    const text = props.roots.length ? "Run a scan to group keyword folders and wait candidates by parent directory." : "Add root directories to preview wait classification."
    return <div className="flex min-h-40 flex-1 items-center justify-center p-4 text-center text-sm text-muted-foreground">{text}</div>
  }
  const groups = groupByParent(props.items)
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="grid gap-2 p-3">
        {groups.map((group) => {
          const ready = group.items.filter((item) => item.status === "ready").length
          const conflicts = group.items.filter((item) => item.status === "conflict" || item.status === "error").length
          const keywordItems = group.items.filter((item) => item.stage === "keyword")
          const waitItems = group.items.filter((item) => item.stage === "wait")
          return (
            <div key={group.parentPath} className={cn("grid gap-2 rounded-lg border p-2", conflicts && "border-destructive/40")}>
              <div className="flex min-w-0 items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Folder className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold">{baseName(group.parentPath)}</div>
                    <div className="truncate font-mono text-[11px] text-muted-foreground">{group.parentPath}</div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Badge variant="outline">{keywordItems.length} keyword</Badge>
                  <Badge variant={conflicts ? "destructive" : "secondary"}>{ready} ready</Badge>
                </div>
              </div>
              <div className="flex min-w-0 flex-wrap gap-1">
                {keywordItems.map((item) => <Badge key={item.sourcePath} variant="outline" className="max-w-full gap-1"><Search className="size-3" /><span className="truncate">{item.sourceName}</span></Badge>)}
              </div>
              <div className="grid gap-1">
                {waitItems.length ? waitItems.slice(0, 12).map((item) => <CompactPlanRow key={item.sourcePath} item={item} />) : <div className="rounded-md border border-dashed px-2 py-1.5 text-xs text-muted-foreground">No wait candidates in this parent directory.</div>}
                {waitItems.length > 12 && <div className="text-[11px] text-muted-foreground">+ {waitItems.length - 12} more wait candidates</div>}
              </div>
            </div>
          )
        })}
      </div>
    </ScrollArea>
  )
}

function CompactPlanRow({ item }: { item: ClassqPlanItem }) {
  const meta = itemStatusMeta(item.status)
  const StatusIcon = meta.icon
  const KindIcon = item.kind === "folder" ? Folder : File
  return (
    <div className={cn("flex min-w-0 items-center gap-2 rounded-md border px-2 py-1.5", (item.status === "conflict" || item.status === "error") && "border-destructive/40")}>
      <KindIcon className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium">{item.sourceName}</div>
        <div className="truncate font-mono text-[11px] text-muted-foreground">{"->"} {item.targetRelative}</div>
      </div>
      <Badge variant={meta.variant} className="shrink-0 gap-1"><StatusIcon className="size-3" />{meta.label}</Badge>
    </div>
  )
}

function ResultTabs(props: { compact?: boolean; logs: string[]; result: ClassqData | null; onCopyLogs: () => void; onCopyResults: () => void }) {
  return (
    <Tabs defaultValue="plan" className="flex h-full min-h-0 flex-col">
      <TabsList className="shrink-0"><TabsTrigger value="plan"><PLAN_ICON className="size-3.5" />Plan</TabsTrigger><TabsTrigger value="issues"><AlertTriangle className="size-3.5" />Issues</TabsTrigger><TabsTrigger value="logs"><Terminal className="size-3.5" />Log</TabsTrigger></TabsList>
      <TabsContent value="plan" className="min-h-0 flex-1"><PlanPanel compact={props.compact} result={props.result} onCopy={props.onCopyResults} /></TabsContent>
      <TabsContent value="issues" className="min-h-0 flex-1"><TextPanel empty="No issues yet." lines={[...(props.result?.errors ?? []), ...(props.result?.items ?? []).filter((item) => item.reason && item.status !== "ready").map((item) => `${item.sourcePath}: ${item.reason}`)]} /></TabsContent>
      <TabsContent value="logs" className="min-h-0 flex-1"><TextPanel actionLabel="Copy" empty="Run log will appear here." icon={Terminal} lines={props.logs} onAction={props.onCopyLogs} /></TabsContent>
    </Tabs>
  )
}

function PlanPanel(props: { compact?: boolean; result: ClassqData | null; onCopy: () => void }) {
  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border bg-card">
      <div className={props.compact ? "flex shrink-0 items-center justify-between gap-2 px-2 py-1.5" : "flex shrink-0 items-center justify-between gap-2 px-3 py-2"}><div className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground"><PLAN_ICON className="size-3.5" /><span>{props.result?.items.length ? `${props.result.items.length} items` : "Waiting for scan"}</span></div><Button disabled={!props.result?.items.length} size="xs" variant="ghost" onClick={props.onCopy}><Copy data-icon="inline-start" />Copy</Button></div>
      <Separator />
      <PlanRows items={props.result?.items ?? []} roots={[]} />
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

function HeaderLine(props: { status: ClassqStatusMeta; subtitle: string }) {
  const Icon = NODE_ICON
  return <div className="min-w-0"><div className="flex min-w-0 items-center gap-2"><div className={cn("grid size-8 shrink-0 place-items-center rounded-lg", props.status.iconClass)}><Icon /></div><div className="min-w-0"><div className="flex min-w-0 items-center gap-2"><h3 className="truncate text-sm font-semibold leading-none">ClassQ</h3><Badge variant={props.status.badgeVariant}>{props.status.label}</Badge></div><p className="mt-1 truncate text-xs text-muted-foreground">{props.subtitle}</p></div></div></div>
}

function StatsPanel(props: { progress: number; result: ClassqData | null; roots: string[] }) {
  const stats = [
    { label: "Roots", value: props.roots.length },
    { label: "Keyword", value: props.result?.keywordCount ?? 0 },
    { label: "Wait", value: props.result?.waitCount ?? 0 },
    { label: "Ready", value: props.result?.readyCount ?? 0 },
    { label: "Moved", value: props.result?.movedCount ?? 0 },
    { label: "Progress", value: props.progress, suffix: "%" },
  ]
  return <div className="grid shrink-0 grid-cols-3 gap-1 @3xl/classq:grid-cols-6">{stats.map((item) => <div key={item.label} className="min-w-0 rounded-md bg-muted/35 px-2 py-1.5 text-center"><div className="truncate text-[11px] text-muted-foreground">{item.label}</div><div className="text-sm font-semibold tabular-nums">{item.value}{item.suffix ?? ""}</div></div>)}</div>
}

function StatusStrip(props: { progress: number; status: ClassqStatusMeta; text?: string }) {
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

function statusFromState(data: ClassqCardState, running: boolean, result: ClassqData | null): ClassqStatusMeta {
  if (running || data.phase === "running") return { label: "Running", description: data.progressText || "ClassQ is scanning keyword folders or moving wait candidates.", tone: "running", badgeVariant: "secondary", iconClass: "bg-primary text-primary-foreground" }
  if (data.phase === "error" || result?.errorCount) return { label: "Failed", description: data.progressText || result?.errors[0] || "Last ClassQ run failed. Check issues.", tone: "error", badgeVariant: "destructive", iconClass: "bg-destructive text-destructive-foreground" }
  if (data.phase === "completed") return { label: "Done", description: data.progressText || "Last ClassQ run completed.", tone: "success", badgeVariant: "default", iconClass: "bg-primary text-primary-foreground" }
  return { label: "Ready", description: "Scan roots for keyword folders and wait candidates.", tone: "idle", badgeVariant: "outline", iconClass: "bg-secondary text-secondary-foreground" }
}

function itemStatusMeta(status: ClassqPlanItem["status"]) {
  if (status === "moved") return { icon: CheckCircle2, label: "Moved", variant: "default" as const }
  if (status === "copied") return { icon: CheckCircle2, label: "Copied", variant: "default" as const }
  if (status === "found") return { icon: Search, label: "Found", variant: "outline" as const }
  if (status === "ready") return { icon: ListTree, label: "Ready", variant: "secondary" as const }
  if (status === "conflict") return { icon: AlertTriangle, label: "Conflict", variant: "destructive" as const }
  if (status === "error") return { icon: XCircle, label: "Error", variant: "destructive" as const }
  return { icon: AlertTriangle, label: "Skipped", variant: "outline" as const }
}

function summaryText(props: ViewProps): string {
  if (props.data.progressText) return props.data.progressText
  if (props.result) return `${props.result.keywordCount} keyword / wait ${props.result.waitCount} / ready ${props.result.readyCount}`
  if (props.roots.length) return `${props.roots.length} root(s) / ${props.actionMeta.shortLabel}`
  return props.actionMeta.description
}

function actionLabel(action: ClassqAction): string {
  return ACTIONS.find((item) => item.value === action)?.label ?? action
}

function buildInput(action: ClassqAction, data: ClassqCardState): ClassqInput {
  return {
    action,
    paths: splitLines(data.pathsText),
    keyword: data.keyword,
    waitKeyword: data.waitKeyword,
    transferMode: data.transferMode ?? "move",
    existingPolicy: data.existingPolicy ?? "merge",
    dryRun: data.dryRun ?? true,
  }
}

function groupByParent(items: ClassqPlanItem[]): Array<{ parentPath: string; items: ClassqPlanItem[] }> {
  const groups = new Map<string, ClassqPlanItem[]>()
  for (const item of items) {
    const list = groups.get(item.parentPath) ?? []
    list.push(item)
    groups.set(item.parentPath, list)
  }
  return [...groups.entries()].map(([parentPath, groupItems]) => ({ parentPath, items: groupItems }))
}

function baseName(value: string): string {
  const normalized = value.replace(/\\/g, "/")
  return normalized.split("/").filter(Boolean).at(-1) ?? value
}

function splitLines(value: unknown): string[] {
  return String(value ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

function getHostData(host: NodeComponentProps<ClassqCardState>["host"], compId: string): ClassqCardState {
  return host.state?.getData?.() ?? host.getData<ClassqCardState>(compId) ?? {}
}

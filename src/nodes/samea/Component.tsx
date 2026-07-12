import { useMemo, useRef, useState } from "react"
import type { NodeComponentProps, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type { SameaAction, SameaData, SameaInput, SameaPlanItem } from "@xiranite/node-samea/core"
import { AlertTriangle, Archive, Bot, CheckCircle2, Clipboard, Copy, FileArchive, FolderInput, ListTree, Play, RotateCcw, ScanSearch, ShieldAlert, SlidersHorizontal, Terminal, Trash2, UserRound, X, XCircle } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldContent, FieldLabel, FieldTitle } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import type { SameaCardState, SameaFilterTab } from "./types"

const FILTERS: Array<{ id: SameaFilterTab; label: string; key: keyof Pick<SameaCardState, "artistBlacklist" | "pathBlacklist" | "regexBlacklist"> }> = [
  { id: "artist", label: "Artists", key: "artistBlacklist" },
  { id: "path", label: "Paths", key: "pathBlacklist" },
  { id: "regex", label: "Regex", key: "regexBlacklist" },
]

export function Component({ compId, host }: NodeComponentProps<SameaCardState>) {
  const surface = useNodeSurface()
  const data = getHostData(host, compId)
  const dataRef = useRef(data)
  dataRef.current = data
  const [running, setRunning] = useState(false)
  const [filterTab, setFilterTab] = useState<SameaFilterTab>("artist")
  const [draftFilter, setDraftFilter] = useState("")
  const paths = useMemo(() => splitLines(data.pathsText), [data.pathsText])
  const result = data.result ?? null
  const action = data.action ?? "plan"
  const compact = surface.mode === "compact" || surface.mode === "portrait"

  function patch(next: Partial<SameaCardState>) {
    dataRef.current = { ...dataRef.current, ...next }
    if (host.state?.patchData) host.state.patchData(next)
    else host.patchData(compId, next)
  }
  function log(message: string) { patch({ logs: [...(dataRef.current.logs ?? []), message].slice(-120) }) }
  async function paste() { const text = await host.clipboard?.readText?.(); if (text) patch({ pathsText: text.trim() }) }
  async function execute(nextAction: SameaAction) {
    if (running) return
    if (!splitLines(dataRef.current.pathsText).length) { patch({ phase: "error", progressText: "Add at least one archive root before scanning." }); return }
    const run = host.runner?.run ?? host.actions?.run
    if (!run) { patch({ phase: "error", progressText: "Native execution is unavailable in this host." }); return }
    setRunning(true)
    patch({ action: nextAction, phase: "running", progress: 0, progressText: "Initializing SameA extractor.", result: null })
    try {
      const response = await run<SameaInput, SameaData>("samea", buildInput(nextAction, dataRef.current), (event: NodeRunEvent) => {
        if (event.type === "progress") patch({ progress: event.progress ?? 0, progressText: event.message })
        log(`[${event.progress ?? 0}%] ${event.message}`)
      }) as NodeRunResult<SameaData>
      patch({ phase: response.success ? "completed" : "error", progress: response.success ? 100 : 0, progressText: response.message, result: response.data ?? null })
      log(response.message)
    } catch (error) { const message = error instanceof Error ? error.message : String(error); patch({ phase: "error", progressText: message }); log(message) }
    finally { setRunning(false) }
  }
  function addFilter() {
    const value = draftFilter.trim()
    const meta = FILTERS.find((filter) => filter.id === filterTab)!
    if (!value || (data[meta.key] ?? []).includes(value)) return
    patch({ [meta.key]: [...(data[meta.key] ?? []), value] })
    setDraftFilter("")
  }
  function removeFilter(value: string) {
    const meta = FILTERS.find((filter) => filter.id === filterTab)!
    patch({ [meta.key]: (data[meta.key] ?? []).filter((item) => item !== value) })
  }
  const props = { action, compact, data, filterTab, paths, result, running, onAction: execute, onAddFilter: addFilter, onDraftFilter: setDraftFilter, onFilterTab: setFilterTab, onPatch: patch, onPaste: paste, onRemoveFilter: removeFilter, draftFilter }
  return <TooltipProvider><div ref={surface.ref} data-testid="samea-surface" className="@container/samea flex h-full min-h-0 w-full overflow-hidden">
    {surface.mode === "collapsed" ? <Collapsed {...props} /> : compact ? <Compact {...props} /> : <Full {...props} />}
  </div></TooltipProvider>
}

type ViewProps = {
  action: SameaAction; compact: boolean; data: SameaCardState; filterTab: SameaFilterTab; paths: string[]; result: SameaData | null; running: boolean; draftFilter: string
  onAction: (action: SameaAction) => void; onAddFilter: () => void; onDraftFilter: (value: string) => void; onFilterTab: (tab: SameaFilterTab) => void; onPatch: (patch: Partial<SameaCardState>) => void; onPaste: () => Promise<void>; onRemoveFilter: (value: string) => void
}

function Full(props: ViewProps) {
  return <div data-testid="samea-full-view" className="flex min-h-0 flex-1 flex-col gap-3 p-3">
    <Header {...props} />
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(210px,0.75fr)_minmax(360px,1.55fr)_minmax(210px,0.75fr)] gap-3">
      <div className="flex min-h-0 flex-col gap-3"><SourceControl {...props} /><OperationGate {...props} /></div>
      <Analysis {...props} />
      <FilterProtocols {...props} />
    </div>
    <LogConsole {...props} />
  </div>
}
function Compact(props: ViewProps) {
  return <div data-testid="samea-compact-view" className="flex min-h-0 flex-1 flex-col gap-2 p-2"><Header {...props} />
    <Tabs value={props.filterTab} onValueChange={(value) => props.onFilterTab(value as SameaFilterTab)} className="flex min-h-0 flex-1 flex-col">
      <TabsList variant="line" className="grid grid-cols-3"><TabsTrigger value="artist">Input</TabsTrigger><TabsTrigger value="path">Analysis</TabsTrigger><TabsTrigger value="regex">Filters</TabsTrigger></TabsList>
      <div className="min-h-0 flex-1 overflow-auto pt-2">{props.filterTab === "artist" ? <div className="grid gap-2"><SourceControl {...props} /><OperationGate {...props} /></div> : props.filterTab === "path" ? <Analysis {...props} /> : <FilterProtocols {...props} />}</div>
    </Tabs>
  </div>
}
function Collapsed(props: ViewProps) {
  const count = props.result?.readyCount ?? props.paths.length
  return <div data-testid="samea-collapsed-view" className="flex h-full w-full items-center gap-2 rounded-lg border bg-card px-3"><ScanSearch className="size-5 text-primary" /><div className="min-w-0 flex-1"><div className="text-sm font-semibold">SameA</div><div className="truncate text-xs text-muted-foreground">{props.data.progressText || `${count} archive candidates`}</div></div><Badge variant={props.data.phase === "error" ? "destructive" : "outline"}>{props.data.phase ?? "idle"}</Badge><ActionButton {...props} compact /></div>
}
function Header(props: ViewProps) {
  const phase = props.running ? "running" : props.data.phase ?? "idle"
  return <header className="flex shrink-0 items-end justify-between gap-3 border-b-2 border-primary pb-2"><div><div className="flex items-center gap-2"><ScanSearch className="size-5 text-primary" /><h3 className="text-xl font-semibold tracking-tight">SameA: Extractor Protocol</h3></div><p className="mt-1 font-mono text-xs tracking-wide text-muted-foreground">WORKSPACE SESSION: <span className="text-primary">{phase.toUpperCase()}</span> | TARGET: ARCHIVE TRIAGE</p></div><div className="flex items-center gap-2"><Badge variant={phase === "error" ? "destructive" : "outline"} className="font-mono uppercase">{phase}</Badge><ActionButton {...props} /></div></header>
}
function SourceControl(props: ViewProps) {
  return <section className="flex min-h-0 flex-1 flex-col border bg-card p-3"><SectionTitle icon={FolderInput} title="Source Control" /><label className="mt-3 text-xs text-muted-foreground">Ingestion paths (line separated)</label><div className="mt-1 flex min-h-24 flex-1 gap-1"><Textarea aria-label="samea paths" className="min-h-24 resize-none font-mono text-xs" placeholder={'D:/Archives/Unsorted\nE:/Staging/New'} value={props.data.pathsText ?? ""} onChange={(event) => props.onPatch({ pathsText: event.currentTarget.value })} /><Tooltip><TooltipTrigger asChild><Button aria-label="paste paths" size="icon-sm" variant="outline" onClick={props.onPaste}><Clipboard /></Button></TooltipTrigger><TooltipContent>Paste paths</TooltipContent></Tooltip></div><Field className="mt-3 border px-2 py-1.5"><FieldContent><FieldTitle className="text-xs">Ignore path blacklist</FieldTitle></FieldContent><Switch checked={props.data.ignorePathBlacklist ?? false} size="sm" onCheckedChange={(ignorePathBlacklist) => props.onPatch({ ignorePathBlacklist })} /></Field></section>
}
function OperationGate(props: ViewProps) {
  const min = props.data.minOccurrences ?? 1
  return <section className="border bg-card p-3"><SectionTitle icon={SlidersHorizontal} title="Operation Gate" /><div className="mt-3 flex items-center justify-between text-xs"><span>Min occurrences</span><strong className="font-mono text-primary">{min}</strong></div><Slider className="mt-3" min={1} max={10} step={1} value={[min]} onValueChange={([minOccurrences]) => props.onPatch({ minOccurrences })} /><Separator className="my-3" /><ToggleField label="Centralize output" description="Move to [00画师分类]" checked={props.data.centralize ?? false} onChange={(centralize) => props.onPatch({ centralize })} /><Separator className="my-3" /><ToggleField label="Dry run mode" description="Simulate without moving" checked={props.data.dryRun ?? true} danger onChange={(dryRun) => props.onPatch({ dryRun })} /><div className="mt-4"><ActionButton {...props} full /></div></section>
}
function Analysis(props: ViewProps) {
  const items = props.result?.items ?? []
  return <section className="flex min-h-0 flex-col border bg-card"><div className="flex items-center justify-between border-b bg-muted/30 px-3 py-2"><SectionTitle icon={Bot} title="Analysis Chamber" noBorder /><Badge variant="outline">{props.result?.scannedCount ?? props.paths.length} scanned</Badge></div><div className="m-3 flex items-center gap-2 border border-dashed p-2 text-xs text-muted-foreground"><ScanSearch className={cn("size-4", props.running && "animate-spin")} />{props.data.progressText || "Ready to scan archive nomenclature patterns."}</div><ScrollArea className="min-h-0 flex-1"><Table className="text-xs"><TableHeader><TableRow><TableHead>Detected entity</TableHead><TableHead className="w-20 text-right">Count</TableHead><TableHead className="w-24 text-center">Action</TableHead></TableRow></TableHeader><TableBody>{items.length ? items.slice(0, 160).map((item, index) => <AnalysisRow item={item} key={`${item.sourcePath}:${index}`} />) : <TableRow><TableCell colSpan={3} className="h-36 text-center text-muted-foreground">Run a dry scan to populate the artist matrix.</TableCell></TableRow>}</TableBody></Table></ScrollArea></section>
}
function AnalysisRow({ item }: { item: SameaPlanItem }) { const ignored = item.status === "ignored" || item.status === "skipped"; const Icon = ignored ? AlertTriangle : item.artistName.includes("(") ? Archive : UserRound; return <TableRow data-state={item.status === "conflict" || item.status === "error" ? "selected" : undefined}><TableCell><div className="flex items-center gap-2"><Icon className={cn("size-4", ignored ? "text-muted-foreground" : "text-primary")} /><div className={cn("max-w-56 truncate border px-1.5 py-0.5 font-mono", ignored && "line-through text-muted-foreground")}>{item.artistName || item.sourceName}</div></div></TableCell><TableCell className="text-right font-mono font-semibold">{item.status === "ready" || item.status === "moved" ? "1" : "—"}</TableCell><TableCell className="text-center"><StatusBadge status={item.status} /></TableCell></TableRow> }
function FilterProtocols(props: ViewProps) { const meta = FILTERS.find((filter) => filter.id === props.filterTab)!; const values = props.data[meta.key] ?? []; return <section className="flex min-h-0 flex-col border bg-card"><div className="border-b bg-muted/30 px-3 py-2"><SectionTitle icon={ShieldAlert} title="Filter Protocols" noBorder danger /></div><Tabs value={props.filterTab} onValueChange={(value) => props.onFilterTab(value as SameaFilterTab)} className="flex min-h-0 flex-1 flex-col"><TabsList variant="line" className="grid grid-cols-3"><TabsTrigger value="artist">Artists</TabsTrigger><TabsTrigger value="path">Paths</TabsTrigger><TabsTrigger value="regex">Regex</TabsTrigger></TabsList><div className="p-3"><div className="flex gap-1"><Input aria-label="samea exclusion" value={props.draftFilter} placeholder="Add exclusion…" className="font-mono text-xs" onChange={(event) => props.onDraftFilter(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); props.onAddFilter() } }} /><Button aria-label="add exclusion" size="icon-sm" variant="outline" onClick={props.onAddFilter}>+</Button></div><div className="mt-3 flex flex-wrap gap-1.5">{values.map((value) => <Badge key={value} variant="secondary" className="gap-1 font-mono"><span>{value}</span><button aria-label={`remove ${value}`} onClick={() => props.onRemoveFilter(value)}><X className="size-3" /></button></Badge>)}</div></div></Tabs></section> }
function LogConsole(props: ViewProps) { const lines = props.data.logs ?? []; return <section className="flex h-48 shrink-0 flex-col border bg-muted/30"><div className="flex items-center justify-between border-b bg-card px-3 py-1.5"><span className="flex items-center gap-2 font-mono text-xs tracking-wide text-muted-foreground"><Terminal className="size-4" />SYSTEM_LOGS // STDOUT</span><div className="flex gap-1"><Button size="xs" variant="ghost" onClick={() => props.onPatch({ logs: [] })}>Clear</Button><Button size="xs" variant="ghost" onClick={() => void props.onPaste()}>Copy</Button></div></div><ScrollArea className="min-h-0 flex-1"><pre className="p-3 font-mono text-xs leading-5 text-muted-foreground">{lines.length ? lines.join("\n") : "[idle] SameA is ready. Dry run is enabled by default."}</pre></ScrollArea></section> }
function ActionButton(props: ViewProps & { full?: boolean }) { if (props.running) return <Button disabled className={cn(props.full && "w-full")}><Progress className="w-12" value={props.data.progress ?? 0} />Running</Button>; const classify = props.action === "classify"; const execute = <Button aria-label={classify ? "Execute scan" : "Plan scan"} className={cn(props.full && "w-full")} onClick={() => props.onAction(classify ? "classify" : "plan")}><Play />{classify ? "Execute scan" : "Plan scan"}</Button>; if (!classify || props.data.dryRun !== false) return execute; return <AlertDialog><AlertDialogTrigger asChild>{execute}</AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Classify archives live?</AlertDialogTitle><AlertDialogDescription>SameA will move ready archives into detected artist folders.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => props.onAction("classify")}>Confirm</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog> }
function ToggleField({ label, description, checked, danger, onChange }: { label: string; description: string; checked: boolean; danger?: boolean; onChange: (value: boolean) => void }) { return <Field><FieldContent><FieldLabel className={cn("text-xs", danger && "text-destructive")}>{label}</FieldLabel><div className="text-[11px] text-muted-foreground">{description}</div></FieldContent><Switch checked={checked} size="sm" onCheckedChange={onChange} /></Field> }
function SectionTitle({ icon: Icon, title, noBorder, danger }: { icon: typeof FolderInput; title: string; noBorder?: boolean; danger?: boolean }) { return <div className={cn("flex items-center gap-2 pb-2 text-xs font-semibold uppercase tracking-wider", !noBorder && "border-b")}><Icon className={cn("size-4", danger ? "text-destructive" : "text-primary")} />{title}</div> }
function StatusBadge({ status }: { status: SameaPlanItem["status"] }) { const variant = status === "error" || status === "conflict" ? "destructive" : status === "ready" || status === "moved" ? "default" : "outline"; return <Badge variant={variant} className="text-[10px] uppercase">{status}</Badge> }
function buildInput(action: SameaAction, data: SameaCardState): SameaInput { return { action, paths: splitLines(data.pathsText), ignorePathBlacklist: data.ignorePathBlacklist ?? false, minOccurrences: data.minOccurrences ?? 1, centralize: data.centralize ?? false, dryRun: data.dryRun ?? true, artistBlacklist: data.artistBlacklist, pathBlacklist: data.pathBlacklist, regexBlacklist: data.regexBlacklist } }
function splitLines(value: unknown): string[] { return String(value ?? "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean) }
function getHostData(host: NodeComponentProps<SameaCardState>["host"], compId: string): SameaCardState { return host.state?.getData?.() ?? host.getData<SameaCardState>(compId) ?? {} }

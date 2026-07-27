import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react"
import type { NodeComponentProps } from "@xiranite/contract"
import type { FindzArchiveRow, FindzLibrarySummary, FindzMemberRow, FindzTask, FindzTreemapNode } from "@xiranite/findz-native"
import type { FindzData, FindzInput } from "@xiranite/node-findz/core"
import { BarChart3, ChevronDown, Download, Filter, TriangleAlert } from "lucide-react"
import { FloatingWindowNodeHeader } from "@/components/workspace/FloatingWindowFrame"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { TooltipProvider } from "@/components/ui/tooltip"
import { RuleTreeEditor } from "@/nodes/shared/RuleTreeEditor"
import { cn } from "@/lib/utils"
import { FindzArchiveTable } from "./ArchiveTable"
import { FindzTreemap } from "./Treemap"
import { FINDZ_ARCHIVE_SORTS, FINDZ_AREA_METRICS, FINDZ_RULE_FIELDS, createFindzRuleTree, isTerminalTask, type FindzArchiveSort, type FindzCardState } from "./types"
import { FindzWorkspaceHeader } from "./WorkspaceHeader"

type FindzProps = NodeComponentProps<FindzCardState, Partial<FindzCardState>>

export function Component({ host }: FindzProps) {
  const [card, setCard] = useState<FindzCardState>(() => host.state.getData() ?? {})
  const [library, setLibrary] = useState<FindzLibrarySummary>()
  const [archives, setArchives] = useState<FindzArchiveRow[]>([])
  const [members, setMembers] = useState<FindzMemberRow[]>()
  const [treemap, setTreemap] = useState<FindzTreemapNode>()
  const [task, setTask] = useState<FindzTask>()
  const [archivePage, setArchivePage] = useState<{ total: number; nextCursor?: string }>({ total: 0 })
  const [pageTrail, setPageTrail] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [filtersOpen, setFiltersOpen] = useState(false)
  const deferredText = useDeferredValue(card.text ?? "")
  const rules = card.rules ?? createFindzRuleTree()

  const patch = useCallback((next: Partial<FindzCardState>) => {
    setCard((current) => {
      const merged = { ...current, ...next }
      host.state.patchData(next)
      return merged
    })
  }, [host])

  const invoke = useCallback(async (input: FindzInput): Promise<FindzData> => {
    if (!host.runner?.run) throw new Error("Findz requires the desktop backend.")
    const result = await host.runner.run<FindzInput, FindzData>("findz", input)
    if (!result.success) throw new Error(result.message)
    return result.data ?? { action: input.action ?? "query_archives" }
  }, [host])

  const refresh = useCallback(async (libraryId: string, override: Partial<FindzCardState> = {}) => {
    const queryState = { ...card, ...override }
    const query = {
      rules: (queryState.rules ?? createFindzRuleTree()) as never,
      sortBy: queryState.sortBy ?? "archiveSize",
      sortDesc: queryState.sortDesc ?? true,
      page: { cursor: queryState.pageCursor, limit: 200 },
    }
    const [archiveData, treemapData] = await Promise.all([
      invoke({ action: "query_archives", libraryId, text: override.text ?? deferredText, pathPrefix: queryState.pathPrefix, query }),
      invoke({ action: "treemap", libraryId, text: override.text ?? deferredText, pathPrefix: queryState.pathPrefix, areaBy: queryState.areaBy ?? "archiveSize", query }),
    ])
    setArchives(archiveData.archives?.items ?? [])
    setArchivePage({ total: archiveData.archives?.total ?? 0, nextCursor: archiveData.archives?.nextCursor })
    setTreemap(treemapData.treemap)
  }, [card, deferredText, invoke])

  const openLibrary = useCallback(async () => {
    const root = card.libraryRoot?.trim()
    if (!root) return
    setBusy(true)
    setError(undefined)
    try {
      const data = await invoke({ action: "open_library", library: { root } })
      if (!data.library) throw new Error("Findz did not return a library.")
      setLibrary(data.library)
      patch({ libraryRoot: root, libraryId: data.library.libraryId, pathPrefix: undefined, selectedArchiveId: undefined, pageCursor: undefined })
      setPageTrail([])
      setMembers(undefined)
      await refresh(data.library.libraryId, { libraryRoot: root, libraryId: data.library.libraryId, pathPrefix: undefined })
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }, [card.libraryRoot, invoke, patch, refresh])

  const startTask = useCallback(async (action: "scan" | "analyze") => {
    if (!card.libraryId) return
    setBusy(true)
    setError(undefined)
    try {
      const data = await invoke({ action, libraryId: card.libraryId })
      if (!data.task) throw new Error("Findz did not create a task.")
      setTask(data.task)
      patch({ taskId: data.task.id })
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }, [card.libraryId, invoke, patch])

  const controlTask = useCallback(async (action: "pause" | "resume" | "cancel") => {
    if (!card.libraryId || !task) return
    try {
      const data = await invoke({ action, libraryId: card.libraryId, taskId: task.id })
      if (data.task) setTask(data.task)
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }, [card.libraryId, invoke, task])

  const selectArchive = useCallback(async (archiveId: number) => {
    if (!card.libraryId) return
    patch({ selectedArchiveId: archiveId })
    setMembers(undefined)
    try {
      const data = await invoke({ action: "query_members", libraryId: card.libraryId, archiveId, text: deferredText })
      setMembers(data.members?.items ?? [])
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }, [card.libraryId, deferredText, invoke, patch])

  const changeSort = useCallback((sortBy: FindzArchiveSort) => {
    const next = { sortBy, sortDesc: card.sortBy === sortBy ? !card.sortDesc : true, pageCursor: undefined }
    setPageTrail([])
    patch(next)
    if (card.libraryId) void refresh(card.libraryId, next)
  }, [card.libraryId, card.sortBy, card.sortDesc, patch, refresh])

  const drill = useCallback((pathPrefix: string) => {
    if (!card.libraryId) return
    patch({ pathPrefix, selectedArchiveId: undefined, pageCursor: undefined })
    setPageTrail([])
    setMembers(undefined)
    void refresh(card.libraryId, { pathPrefix, selectedArchiveId: undefined })
  }, [card.libraryId, patch, refresh])

  const nextPage = useCallback(() => {
    if (!archivePage.nextCursor) return
    setPageTrail((trail) => [...trail, card.pageCursor ?? ""])
    patch({ pageCursor: archivePage.nextCursor, selectedArchiveId: undefined })
    setMembers(undefined)
  }, [archivePage.nextCursor, card.pageCursor, patch])

  const previousPage = useCallback(() => {
    if (!pageTrail.length) return
    const previousCursor = pageTrail[pageTrail.length - 1]
    setPageTrail((trail) => trail.slice(0, -1))
    patch({ pageCursor: previousCursor || undefined, selectedArchiveId: undefined })
    setMembers(undefined)
  }, [pageTrail, patch])

  const resetPage = useCallback((next: Partial<FindzCardState>) => {
    setPageTrail([])
    patch({ ...next, pageCursor: undefined })
  }, [patch])

  const exportArchives = useCallback(async (format: "json" | "csv") => {
    if (!card.libraryId) return
    setBusy(true)
    setError(undefined)
    try {
      const rows: FindzArchiveRow[] = []
      let cursor: string | undefined
      do {
        const data = await invoke({
          action: "export_rows",
          libraryId: card.libraryId,
          text: deferredText,
          pathPrefix: card.pathPrefix,
          query: { rules: rules as never, sortBy: card.sortBy ?? "archiveSize", sortDesc: card.sortDesc ?? true, page: { cursor, limit: 1_000 } },
        })
        rows.push(...(data.archives?.items ?? []))
        cursor = data.archives?.nextCursor
      } while (cursor)
      downloadArchiveExport(rows, format)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }, [card.libraryId, card.pathPrefix, card.sortBy, card.sortDesc, deferredText, invoke, rules])

  useEffect(() => {
    if (!card.libraryId) return
    const timeout = window.setTimeout(() => { void refresh(card.libraryId!) }, 180)
    return () => window.clearTimeout(timeout)
  }, [card.libraryId, card.pathPrefix, card.pageCursor, card.rules, card.sortBy, card.sortDesc, card.areaBy, deferredText, refresh])

  useEffect(() => {
    if (!task || isTerminalTask(task) || !card.libraryId) return
    let cancelled = false
    const poll = async () => {
      try {
        const data = await invoke({ action: "task", libraryId: card.libraryId!, taskId: task.id })
        if (cancelled || !data.task) return
        setTask(data.task)
        if (isTerminalTask(data.task)) void refresh(card.libraryId!)
      } catch (cause) {
        if (!cancelled) setError(errorMessage(cause))
      }
    }
    void poll()
    const interval = window.setInterval(() => { void poll() }, 900)
    return () => { cancelled = true; window.clearInterval(interval) }
  }, [card.libraryId, invoke, refresh, task])

  const breadcrumb = useMemo(() => card.pathPrefix?.split("/").filter(Boolean) ?? [], [card.pathPrefix])
  return <TooltipProvider>
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background" data-testid="findz-workspace">
      <FindzWorkspaceHeader
        root={card.libraryRoot ?? ""}
        library={library}
        task={task}
        busy={busy}
        onRootChange={(libraryRoot) => patch({ libraryRoot })}
        onOpen={() => void openLibrary()}
        onScan={() => void startTask("scan")}
        onAnalyze={() => void startTask("analyze")}
        onPause={() => void controlTask("pause")}
        onResume={() => void controlTask("resume")}
        onCancel={() => void controlTask("cancel")}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <FloatingWindowNodeHeader><div className="flex items-center gap-2"><BarChart3 className="size-4" /><h3 className="text-sm font-semibold">Findz</h3></div></FloatingWindowNodeHeader>
          <div className="min-w-48 flex-1"><Input aria-label="Search Findz index" value={card.text ?? ""} placeholder="Search archive and member paths" onChange={(event) => resetPage({ text: event.target.value })} /></div>
          <Select value={card.areaBy ?? "archiveSize"} onValueChange={(areaBy) => resetPage({ areaBy: areaBy as FindzCardState["areaBy"] })}>
            <SelectTrigger size="sm" className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>{FINDZ_AREA_METRICS.map((metric) => <SelectItem key={metric.value} value={metric.value}>{metric.label}</SelectItem>)}</SelectContent>
          </Select>
          <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen}>
            <CollapsibleTrigger asChild><Button aria-label="Advanced filters" size="sm" variant={filtersOpen ? "secondary" : "outline"}><Filter />Filters<ChevronDown className={cn("transition-transform", filtersOpen && "rotate-180")} /></Button></CollapsibleTrigger>
            <CollapsibleContent className="absolute right-3 top-32 z-20 w-[min(42rem,calc(100vw-2rem))] border bg-popover p-3 shadow-lg">
              <RuleTreeEditor value={rules} fields={FINDZ_RULE_FIELDS} onValueChange={(next) => resetPage({ rules: next })} />
            </CollapsibleContent>
          </Collapsible>
          <Button aria-label="Export filtered archives as JSON" size="sm" variant="outline" disabled={!card.libraryId || busy} onClick={() => void exportArchives("json")}><Download />JSON</Button>
          <Button aria-label="Export filtered archives as CSV" size="sm" variant="outline" disabled={!card.libraryId || busy} onClick={() => void exportArchives("csv")}><Download />CSV</Button>
        </div>
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto text-xs text-muted-foreground">
          <Button size="xs" variant={breadcrumb.length ? "ghost" : "secondary"} onClick={() => card.libraryId && drill("")}>Library</Button>
          {breadcrumb.map((segment, index) => <span key={`${segment}-${index}`} className="flex items-center gap-1"><span>/</span><Button size="xs" variant={index === breadcrumb.length - 1 ? "secondary" : "ghost"} onClick={() => card.libraryId && drill(breadcrumb.slice(0, index + 1).join("/"))}>{segment}</Button></span>)}
        </div>
        {error && <div role="alert" className="flex shrink-0 items-center gap-2 border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"><TriangleAlert className="size-4" />{error}</div>}
        <div className="grid min-h-0 flex-1 grid-rows-[minmax(180px,1.25fr)_minmax(160px,0.9fr)] gap-3">
          <section aria-label="Findz archive results" className="min-h-0 overflow-hidden">
            <FindzArchiveTable archives={archives} members={members} selectedArchiveId={card.selectedArchiveId} sortBy={card.sortBy ?? "archiveSize"} sortDesc={card.sortDesc ?? true} total={archivePage.total} hasPreviousPage={pageTrail.length > 0} hasNextPage={Boolean(archivePage.nextCursor)} onSelectArchive={(archiveId) => void selectArchive(archiveId)} onSort={changeSort} onPreviousPage={previousPage} onNextPage={nextPage} />
          </section>
          <section aria-label="Findz treemap" className="flex min-h-0 flex-col border bg-background">
            <div className="flex shrink-0 items-center justify-between border-b px-3 py-2"><span className="text-xs font-medium">Treemap</span><span className="text-xs text-muted-foreground">Area: {FINDZ_AREA_METRICS.find((metric) => metric.value === (card.areaBy ?? "archiveSize"))?.label}</span></div>
            <FindzTreemap projection={treemap} selectedArchiveId={card.selectedArchiveId} onSelectArchive={(archiveId) => void selectArchive(archiveId)} onDrill={drill} />
          </section>
        </div>
      </div>
    </div>
  </TooltipProvider>
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function downloadArchiveExport(rows: readonly FindzArchiveRow[], format: "json" | "csv"): void {
  const content = format === "json"
    ? JSON.stringify(rows, null, 2)
    : ["path,size,memberCount,imageMemberCount,analyzedImageCount,anomalyCount,estimatedSavingsBytes", ...rows.map((row) => [row.relativePath, row.size, row.memberCount, row.imageMemberCount, row.analyzedImageCount, row.anomalyCount, row.estimatedSavingsBytes].map(csvCell).join(","))].join("\n")
  const url = URL.createObjectURL(new Blob([content], { type: format === "json" ? "application/json" : "text/csv" }))
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = `findz-archives.${format}`
  anchor.click()
  URL.revokeObjectURL(url)
}

function csvCell(value: string | number): string {
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll("\"", "\"\"")}"` : text
}

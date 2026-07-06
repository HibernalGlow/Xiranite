import { useState } from "react"
import type { NodeComponentProps } from "@xiranite/contract"
import { Clipboard, Copy, Download, Filter, Image, Play, RefreshCw, RotateCcw, Trash2 } from "lucide-react"
import { ActionButton, Field, IconButton, LogView, NodeBody, NodeContent, NodeFooter, NodeHeader, ResultView, SegmentButton, StatPill } from "@xiranite/ui"
import type { EngineVAction, EngineVData, EngineVInput, EngineVResult, EngineVWallpaper } from "./core.js"

interface EngineVCardState {
  workshopPath?: string
  titleFilter?: string
  ratingFilter?: string
  typeFilter?: string
  idsText?: string
  template?: string
  outputPath?: string
  dryRun?: boolean
  copyMode?: boolean
  targetPath?: string
  phase?: string
  progress?: number
  progressText?: string
  wallpapers?: EngineVWallpaper[]
  filteredWallpapers?: EngineVWallpaper[]
  result?: EngineVData | null
  logs?: string[]
}

export function Component({ compId, host }: NodeComponentProps) {
  const data = host.getData<EngineVCardState>(compId) ?? {}
  const [running, setRunning] = useState(false)
  const result = data.result ?? null
  const wallpapers = data.wallpapers ?? result?.wallpapers ?? []
  const filtered = data.filteredWallpapers ?? result?.filteredWallpapers ?? []
  const logs = data.logs ?? []
  const selectedIds = parseIds(data.idsText)

  function patch(patchData: Partial<EngineVCardState>) {
    host.patchData(compId, patchData)
  }

  function log(message: string) {
    patch({ logs: [...logs.slice(-40), message] })
  }

  async function pastePath() {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ workshopPath: text.trim() })
  }

  async function execute(action: EngineVAction, forceWrite = false) {
    if (running) return
    const runNode = host.runner?.runNode
    if (!runNode) {
      log("Host runner unavailable. Use the xiranite-enginev CLI for filesystem actions.")
      return
    }
    const input = buildInput(action, data, forceWrite)
    if (!input.path && !input.wallpapers?.length) return
    if (action === "delete" && !selectedIds.length) return
    if (action === "export" && !input.exportPath) return

    setRunning(true)
    patch({ phase: action, progress: 0, progressText: "starting" })
    const response = await runNode<EngineVInput, EngineVData>("enginev", input, (event) => {
      if (event.type === "progress") patch({ progress: event.progress ?? 0, progressText: event.message })
      else log(event.message)
    }) as EngineVResult

    const next = response.data ?? null
    patch({
      phase: response.success ? "completed" : "error",
      progress: response.success ? 100 : 0,
      progressText: response.message,
      result: next,
      wallpapers: next?.wallpapers ?? wallpapers,
      filteredWallpapers: next?.filteredWallpapers ?? filtered,
    })
    log(response.message)
    setRunning(false)
  }

  async function copyResults() {
    const text = filtered.map((item) => `${item.workshopId}\t${item.title}\t${item.path}`).join("\n")
    if (text) await host.clipboard?.writeText?.(text)
  }

  async function copyLogs() {
    await host.clipboard?.writeText?.(logs.join("\n"))
  }

  function reset() {
    patch({ phase: "idle", progress: 0, progressText: "", result: null, wallpapers: [], filteredWallpapers: [], logs: [] })
  }

  return (
    <NodeContent>
      <NodeHeader
        title="enginev"
        meta={`${wallpapers.length} scanned / ${filtered.length} visible / ${selectedIds.length} selected`}
        actions={
          <>
            <IconButton title="Paste workshop path" disabled={running} onClick={pastePath}><Clipboard size={14} /></IconButton>
            <ActionButton disabled={running || !data.workshopPath} onClick={() => execute("scan")}><RefreshCw size={14} /> Scan</ActionButton>
            <ActionButton disabled={running || (!wallpapers.length && !data.workshopPath)} onClick={() => execute("filter")}><Filter size={14} /> Filter</ActionButton>
            <ActionButton variant="primary" disabled={running || (!wallpapers.length && !data.workshopPath)} onClick={() => execute("rename")}><Play size={14} /> Rename</ActionButton>
            <IconButton title="Copy results" onClick={copyResults}><Copy size={14} /></IconButton>
            <IconButton title="Copy logs" onClick={copyLogs}><Download size={14} /></IconButton>
            <IconButton title="Reset" onClick={reset}><RotateCcw size={14} /></IconButton>
          </>
        }
      />

      <NodeBody className="flex flex-col gap-2">
        <div className="flex shrink-0 flex-wrap gap-2">
          <Field label="workshop path" value={data.workshopPath ?? ""} disabled={running} onChange={(event) => patch({ workshopPath: event.currentTarget.value })} />
          <Field label="ids" value={data.idsText ?? ""} disabled={running} placeholder="123,456" onChange={(event) => patch({ idsText: event.currentTarget.value })} />
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <Field label="title filter" value={data.titleFilter ?? ""} disabled={running} onChange={(event) => patch({ titleFilter: event.currentTarget.value })} />
          <Field label="rating" value={data.ratingFilter ?? ""} disabled={running} placeholder="Everyone" onChange={(event) => patch({ ratingFilter: event.currentTarget.value })} />
          <Field label="type" value={data.typeFilter ?? ""} disabled={running} placeholder="Video" onChange={(event) => patch({ typeFilter: event.currentTarget.value })} />
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <Field label="rename template" value={data.template ?? "[#{id}]{original_name}+{title}"} disabled={running} onChange={(event) => patch({ template: event.currentTarget.value })} />
          <Field label="target/export path" value={data.targetPath || data.outputPath || ""} disabled={running} onChange={(event) => patch({ targetPath: event.currentTarget.value, outputPath: event.currentTarget.value })} />
        </div>

        <div className="flex shrink-0 flex-wrap gap-1">
          <SegmentButton active={data.dryRun ?? true} disabled={running} onClick={() => patch({ dryRun: !(data.dryRun ?? true) })}>dry run</SegmentButton>
          <SegmentButton active={data.copyMode ?? false} disabled={running} onClick={() => patch({ copyMode: !(data.copyMode ?? false) })}>copy mode</SegmentButton>
          <ActionButton disabled={running || !selectedIds.length} onClick={() => execute("delete")}><Trash2 size={14} /> Delete</ActionButton>
          <ActionButton disabled={running || (!filtered.length && !wallpapers.length)} onClick={() => execute("export")}><Download size={14} /> Export</ActionButton>
        </div>

        <div className="flex shrink-0 flex-wrap gap-1">
          <StatPill label="total" value={result?.totalCount ?? wallpapers.length} tone="accent" />
          <StatPill label="filtered" value={result?.filteredCount ?? filtered.length} tone="good" />
          <StatPill label="types" value={Object.keys(result?.typeStats ?? {}).length} />
          <StatPill label="ok" value={result?.successCount ?? 0} />
          <StatPill label="failed" value={result?.failedCount ?? 0} tone={(result?.failedCount ?? 0) ? "bad" : "neutral"} />
        </div>

        <ResultView className="flex-1 text-muted-foreground">
          {running ? (
            <div>{`[${data.progress ?? 0}%] ${data.progressText ?? ""}`}</div>
          ) : result?.renameResults.length ? (
            result.renameResults.slice(0, 60).map((item) => (
              <div key={`${item.workshopId}:${item.newPath}`} className="truncate">{item.status} {item.oldName} -&gt; {item.newName}</div>
            ))
          ) : result?.deleteResults.length ? (
            result.deleteResults.slice(0, 60).map((item) => (
              <div key={`${item.workshopId}:${item.status}`} className="truncate">{item.status} {item.workshopId} {item.message}</div>
            ))
          ) : filtered.length ? (
            filtered.slice(0, 80).map((item) => (
              <div key={item.workshopId} className="truncate">{item.workshopId} / {item.wallpaperType || "unknown"} / {item.contentRating || "unrated"} / {item.title || item.folderName}</div>
            ))
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground"><Image size={16} className="mr-1" /> Ready to scan Wallpaper Engine workshop folders.</div>
          )}
        </ResultView>
      </NodeBody>

      <NodeFooter>
        <LogView lines={running ? [`[${data.progress ?? 0}%] ${data.progressText ?? ""}`, ...logs] : logs} className="h-14" />
      </NodeFooter>
    </NodeContent>
  )
}

function buildInput(action: EngineVAction, data: EngineVCardState, forceWrite: boolean): EngineVInput {
  return {
    action,
    path: data.workshopPath,
    wallpapers: action === "scan" ? undefined : data.wallpapers,
    filters: {
      title: data.titleFilter,
      contentRating: data.ratingFilter,
      type: data.typeFilter,
    },
    ids: data.idsText,
    template: data.template,
    dryRun: forceWrite ? false : data.dryRun ?? true,
    copyMode: data.copyMode ?? false,
    targetPath: data.targetPath,
    exportPath: data.outputPath || data.targetPath,
    exportFormat: "json",
  }
}

function parseIds(value = ""): string[] {
  return value.split(/[,;\s]+/).map((item) => item.trim()).filter(Boolean)
}

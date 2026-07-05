import { useMemo, useState } from "react"
import type { ReactNode } from "react"
import type { NodeCardProps } from "@xiranite/contract"
import { Clipboard, Copy, Download, RotateCcw, Zap } from "lucide-react"
import { createDiffRows, filterLines, splitLines } from "./core.js"

interface LinedupCardState {
  sourceText?: string
  filterText?: string
}

export function Component({ compId, host }: NodeCardProps) {
  const data = host.getData<LinedupCardState>(compId) ?? {}
  const [running, setRunning] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [result, setResult] = useState<ReturnType<typeof filterLines> | null>(null)

  const sourceText = data.sourceText ?? ""
  const filterText = data.filterText ?? ""
  const sourceLines = useMemo(() => splitLines(sourceText).filter((line) => line.trim()), [sourceText])
  const filterTokens = useMemo(() => splitLines(filterText).filter((line) => line.trim()), [filterText])
  const diffRows = useMemo(
    () => (result ? createDiffRows(sourceLines, result.filteredLines) : []),
    [result, sourceLines],
  )

  function patch(patchData: Partial<LinedupCardState>) {
    host.patchData(compId, patchData)
  }

  function log(message: string) {
    setLogs((current) => [...current.slice(-30), message])
  }

  async function paste(kind: "source" | "filter") {
    const text = await host.clipboard?.readText?.()
    if (!text) return
    patch(kind === "source" ? { sourceText: text } : { filterText: text })
  }

  async function execute() {
    if (!sourceLines.length || running) return
    setRunning(true)
    log(`filter source=${sourceLines.length} filters=${filterTokens.length}`)
    const next = filterLines({ sourceLines, filterLines: filterTokens })
    setResult(next)
    log(`done kept=${next.keptCount} removed=${next.removedCount}`)
    setRunning(false)
  }

  async function copy(text: string) {
    await host.clipboard?.writeText?.(text)
  }

  function reset() {
    setResult(null)
    setLogs([])
  }

  return (
    <div className="h-full min-h-[300px] overflow-hidden p-3 text-xs font-mono">
      <div className="grid h-full min-h-0 grid-cols-[1fr_1fr_132px] grid-rows-[140px_1fr_88px] gap-2">
        <Panel title="Source" meta={`${sourceLines.length} lines`} action={<IconButton title="Paste source" onClick={() => paste("source")}><Clipboard size={14} /></IconButton>}>
          <textarea
            value={sourceText}
            onChange={(event) => patch({ sourceText: event.currentTarget.value })}
            disabled={running}
            className="h-full w-full resize-none rounded border border-border bg-muted/30 p-2 text-xs outline-none"
            placeholder="one item per line"
          />
        </Panel>
        <Panel title="Filters" meta={`${filterTokens.length} tokens`} action={<IconButton title="Paste filters" onClick={() => paste("filter")}><Clipboard size={14} /></IconButton>}>
          <textarea
            value={filterText}
            onChange={(event) => patch({ filterText: event.currentTarget.value })}
            disabled={running}
            className="h-full w-full resize-none rounded border border-border bg-muted/30 p-2 text-xs outline-none"
            placeholder="remove source lines containing these tokens"
          />
        </Panel>
        <Panel title="Actions">
          <div className="flex h-full flex-col gap-2">
            <div className="rounded border border-border bg-muted/30 p-2 leading-relaxed">
              <div>source: {sourceLines.length}</div>
              <div>filters: {filterTokens.length}</div>
              <div className="text-green-600">kept: {result?.keptCount ?? 0}</div>
              <div className="text-red-500">removed: {result?.removedCount ?? 0}</div>
            </div>
            <button className="flex flex-1 items-center justify-center gap-1 rounded bg-primary px-2 text-primary-foreground disabled:opacity-50" disabled={!sourceLines.length || running} onClick={execute}>
              <Zap size={14} /> Filter
            </button>
            <button className="flex h-8 items-center justify-center gap-1 rounded border border-border" onClick={reset}>
              <RotateCcw size={14} /> Reset
            </button>
          </div>
        </Panel>
        <Panel title="Diff" meta={result ? `+${result.keptCount} / -${result.removedCount}` : "pending"} className="col-span-2 row-span-2">
          <div className="h-full overflow-auto rounded border border-border bg-muted/20 p-2">
            {diffRows.length ? diffRows.map((row) => (
              <div key={`${row.status}:${row.line}`} className={row.status === "removed" ? "rounded bg-red-500/10 px-1 py-0.5 text-red-600 line-through" : "rounded px-1 py-0.5 text-muted-foreground"}>
                <span className="mr-2 opacity-60">{row.status === "removed" ? "-" : " "}</span>{row.line}
              </div>
            )) : <div className="flex h-full items-center justify-center text-muted-foreground">Run filter to preview removed lines.</div>}
          </div>
        </Panel>
        <Panel title="Output">
          <div className="grid h-full grid-cols-2 gap-2">
            <button className="flex items-center justify-center gap-1 rounded border border-border disabled:opacity-50" disabled={!result} onClick={() => copy(result?.filteredLines.join("\n") ?? "")}>
              <Copy size={14} /> Kept
            </button>
            <button className="flex items-center justify-center gap-1 rounded border border-border text-red-500 disabled:opacity-50" disabled={!result} onClick={() => copy(result?.removedLines.join("\n") ?? "")}>
              <Copy size={14} /> Removed
            </button>
            <button className="col-span-2 flex items-center justify-center gap-1 rounded border border-border disabled:opacity-50" disabled={!result} onClick={() => host.downloadText?.("linedup-output.txt", result?.filteredLines.join("\n") ?? "")}>
              <Download size={14} /> Download kept
            </button>
          </div>
        </Panel>
        <Panel title="Log" className="col-start-3 row-start-3">
          <div className="h-full overflow-auto rounded bg-muted/30 p-2 text-[11px] text-muted-foreground">
            {logs.length ? logs.map((line) => <div key={line}>{line}</div>) : "No logs"}
          </div>
        </Panel>
      </div>
    </div>
  )
}

function Panel(props: { title: string; meta?: string; action?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`flex min-h-0 flex-col gap-1 rounded border border-border bg-card/40 p-2 ${props.className ?? ""}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">{props.title}</span>
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">{props.meta}{props.action}</div>
      </div>
      <div className="min-h-0 flex-1">{props.children}</div>
    </section>
  )
}

function IconButton(props: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button title={props.title} className="rounded border border-border p-1 hover:bg-muted" onClick={props.onClick}>
      {props.children}
    </button>
  )
}

import { useMemo, useState } from "react"
import type { NodeCardProps } from "@xiranite/contract"
import { Clipboard, Copy, Download, RotateCcw, Zap } from "lucide-react"
import { ActionButton, IconButton, LogView, NodeBody, NodeContent, NodeFooter, NodeHeader, ResultView, StatPill, TextArea } from "@xiranite/ui"
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
  const diffRows = useMemo(() => (result ? createDiffRows(sourceLines, result.filteredLines) : []), [result, sourceLines])

  function patch(patchData: Partial<LinedupCardState>) {
    host.patchData(compId, patchData)
  }

  function log(message: string) {
    setLogs((current) => [...current.slice(-30), message])
  }

  async function paste(kind: "source" | "filter") {
    const text = await host.clipboard?.readText?.()
    if (text) patch(kind === "source" ? { sourceText: text } : { filterText: text })
  }

  async function execute() {
    if (!sourceLines.length || running) return
    setRunning(true)
    const next = filterLines({ sourceLines, filterLines: filterTokens })
    setResult(next)
    log(`kept=${next.keptCount} removed=${next.removedCount}`)
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
    <NodeContent>
      <NodeHeader
        title="linedup"
        meta={`${sourceLines.length} source / ${filterTokens.length} filters`}
        actions={
          <>
            <IconButton title="Paste source" onClick={() => paste("source")}><Clipboard size={14} /></IconButton>
            <IconButton title="Paste filters" onClick={() => paste("filter")}><Clipboard size={14} /></IconButton>
            <ActionButton variant="primary" disabled={!sourceLines.length || running} onClick={execute}><Zap size={14} /> Filter</ActionButton>
            <IconButton title="Reset" onClick={reset}><RotateCcw size={14} /></IconButton>
          </>
        }
      />

      <NodeBody className="flex flex-col gap-2">
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-2">
          <TextArea
            label="source"
            value={sourceText}
            onChange={(event) => patch({ sourceText: event.currentTarget.value })}
            disabled={running}
            placeholder="one item per line"
          />
          <TextArea
            label="filters"
            value={filterText}
            onChange={(event) => patch({ filterText: event.currentTarget.value })}
            disabled={running}
            placeholder="remove source lines containing these tokens"
          />
        </div>

        <div className="flex min-h-0 flex-1 gap-2">
          <div className="grid w-24 shrink-0 content-start gap-1">
            <StatPill label="kept" value={result?.keptCount ?? 0} tone="good" />
            <StatPill label="removed" value={result?.removedCount ?? 0} tone="bad" />
            <ActionButton disabled={!result} onClick={() => copy(result?.filteredLines.join("\n") ?? "")}><Copy size={14} /> Kept</ActionButton>
            <ActionButton disabled={!result} onClick={() => copy(result?.removedLines.join("\n") ?? "")}><Copy size={14} /> Removed</ActionButton>
            <ActionButton disabled={!result} onClick={() => host.downloadText?.("linedup-output.txt", result?.filteredLines.join("\n") ?? "")}><Download size={14} /> Save</ActionButton>
          </div>
          <ResultView>
            {diffRows.length ? diffRows.map((row) => (
              <div key={`${row.status}:${row.line}`} className={row.status === "removed" ? "truncate text-red-500 line-through" : "truncate text-muted-foreground"}>
                <span className="mr-2 opacity-60">{row.status === "removed" ? "-" : " "}</span>{row.line}
              </div>
            )) : <div className="flex h-full items-center justify-center text-muted-foreground">Run filter to preview removed lines.</div>}
          </ResultView>
        </div>
      </NodeBody>

      <NodeFooter>
        <LogView lines={logs} className="h-14" />
      </NodeFooter>
    </NodeContent>
  )
}

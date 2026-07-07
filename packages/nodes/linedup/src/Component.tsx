import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import type { NodeComponentProps } from "@xiranite/contract"
import { Clipboard, Copy, Download, RotateCcw, Zap } from "lucide-react"
import { ActionButton, IconButton, LogView, NodeBody, NodeContent, NodeFooter, NodeHeader, ResultView, StatPill, TextArea } from "@xiranite/ui"
import { createDiffRows, filterLines, splitLines } from "./core.js"

interface LinedupCardState {
  sourceText?: string
  filterText?: string
}

export function Component({ compId, host }: NodeComponentProps) {
  const { t } = useTranslation()
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
    try {
      const next = filterLines({ sourceLines, filterLines: filterTokens })
      setResult(next)
      log(`kept=${next.keptCount} removed=${next.removedCount}`)
    } finally {
      setRunning(false)
    }
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
        title={t("module:linedup.title")}
        meta={t("module:linedup.meta", { source: sourceLines.length, filters: filterTokens.length })}
        actions={
          <>
            <IconButton title={t("module:linedup.pasteSource")} onClick={() => paste("source")}><Clipboard size={14} /></IconButton>
            <IconButton title={t("module:linedup.pasteFilters")} onClick={() => paste("filter")}><Clipboard size={14} /></IconButton>
            <ActionButton variant="primary" disabled={!sourceLines.length || running} onClick={execute}><Zap size={14} /> {t("module:linedup.filter")}</ActionButton>
            <IconButton title={t("module:linedup.reset")} onClick={reset}><RotateCcw size={14} /></IconButton>
          </>
        }
      />

      <NodeBody className="flex flex-col gap-2">
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <TextArea
            label={t("module:linedup.sourceLabel")}
            value={sourceText}
            onChange={(event) => patch({ sourceText: event.currentTarget.value })}
            disabled={running}
            placeholder={t("module:linedup.sourcePlaceholder")}
          />
          <TextArea
            label={t("module:linedup.filtersLabel")}
            value={filterText}
            onChange={(event) => patch({ filterText: event.currentTarget.value })}
            disabled={running}
            placeholder={t("module:linedup.filtersPlaceholder")}
          />
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex shrink-0 flex-wrap gap-1">
            <StatPill label={t("module:linedup.statKept")} value={result?.keptCount ?? 0} tone="good" />
            <StatPill label={t("module:linedup.statRemoved")} value={result?.removedCount ?? 0} tone="bad" />
            <ActionButton disabled={!result} onClick={() => copy(result?.filteredLines.join("\n") ?? "")}><Copy size={14} /> {t("module:linedup.kept")}</ActionButton>
            <ActionButton disabled={!result} onClick={() => copy(result?.removedLines.join("\n") ?? "")}><Copy size={14} /> {t("module:linedup.removed")}</ActionButton>
            <ActionButton disabled={!result} onClick={() => host.downloadText?.("linedup-output.txt", result?.filteredLines.join("\n") ?? "")}><Download size={14} /> {t("module:linedup.save")}</ActionButton>
          </div>
          <ResultView>
            {diffRows.length ? diffRows.map((row) => (
              <div key={`${row.status}:${row.line}`} className={row.status === "removed" ? "truncate text-red-500 line-through" : "truncate text-muted-foreground"}>
                <span className="mr-2 opacity-60">{row.status === "removed" ? "-" : " "}</span>{row.line}
              </div>
            )) : <div className="flex h-full items-center justify-center text-muted-foreground">{t("module:linedup.runToPreview")}</div>}
          </ResultView>
        </div>
      </NodeBody>

      <NodeFooter>
        <LogView lines={logs} className="h-14" />
      </NodeFooter>
    </NodeContent>
  )
}

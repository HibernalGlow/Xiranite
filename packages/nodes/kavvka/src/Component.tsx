import { useState } from "react"
import type { NodeCardProps } from "@xiranite/contract"
import { Clipboard, Copy, FileSearch, Play, RotateCcw, Search } from "lucide-react"
import { ActionButton, Field, IconButton, LogView, NodeBody, NodeContent, NodeFooter, NodeHeader, ResultView, SegmentButton, StatPill, TextArea } from "@xiranite/ui"
import type { KavvkaAction, KavvkaData, KavvkaInput, KavvkaResult } from "./core.js"
import { DEFAULT_KAVVKA_KEYWORDS, parseKavvkaKeywords, parseKavvkaPaths } from "./core.js"

interface KavvkaCardState {
  sourceText?: string
  scanRootText?: string
  keywordText?: string
  scanDepth?: number
  force?: boolean
  dryRun?: boolean
  strictArtist?: boolean
  result?: KavvkaData | null
  logs?: string[]
  phase?: string
  progress?: number
  progressText?: string
}

export function Component({ compId, host }: NodeCardProps) {
  const data = host.getData<KavvkaCardState>(compId) ?? {}
  const [running, setRunning] = useState(false)
  const sourcePaths = parseKavvkaPaths(data.sourceText)
  const scanRoots = parseKavvkaPaths(data.scanRootText)
  const keywords = parseKavvkaKeywords(data.keywordText).length ? parseKavvkaKeywords(data.keywordText) : DEFAULT_KAVVKA_KEYWORDS
  const result = data.result ?? null
  const logs = data.logs ?? []

  function patch(patchData: Partial<KavvkaCardState>) {
    host.patchData(compId, patchData)
  }

  function log(message: string) {
    patch({ logs: [...logs.slice(-40), message] })
  }

  async function paste(kind: "source" | "scan") {
    const text = await host.clipboard?.readText?.()
    if (!text) return
    patch(kind === "source" ? { sourceText: appendText(data.sourceText, text) } : { scanRootText: appendText(data.scanRootText, text) })
  }

  async function execute(action: KavvkaAction) {
    if (running) return
    const runNode = host.runner?.runNode
    if (!runNode) {
      log("Host runner unavailable. Use the xiranite-kavvka CLI for filesystem actions.")
      return
    }

    const input = buildInput(action, data)
    if (action === "scan" && !scanRoots.length) return
    if (action !== "scan" && !sourcePaths.length) return

    setRunning(true)
    patch({ phase: action, progress: 0, progressText: "starting", result: null })
    const response = await runNode<KavvkaInput, KavvkaData>("kavvka", input, (event) => {
      if (event.type === "progress") patch({ progress: event.progress ?? 0, progressText: event.message })
      else log(event.message)
    }) as KavvkaResult

    const nextResult = response.data ?? null
    patch({
      phase: response.success ? "completed" : "error",
      progress: response.success ? 100 : 0,
      progressText: response.message,
      result: nextResult,
      ...(action === "scan" && nextResult?.matchedPaths.length ? { sourceText: nextResult.matchedPaths.join("\n") } : {}),
    })
    log(response.message)
    setRunning(false)
  }

  async function copyResults() {
    const text = result?.allCombinedPaths.length ? result.allCombinedPaths.join("\n") : result?.matchedPaths.join("\n") ?? ""
    if (text) await host.clipboard?.writeText?.(text)
  }

  async function copyLogs() {
    await host.clipboard?.writeText?.(logs.join("\n"))
  }

  function reset() {
    patch({ phase: "idle", progress: 0, progressText: "", result: null, logs: [] })
  }

  return (
    <NodeContent>
      <NodeHeader
        title="kavvka"
        meta={`${sourcePaths.length} source / ${scanRoots.length} scan root / depth ${data.scanDepth ?? 3}`}
        actions={
          <>
            <IconButton title="Paste sources" disabled={running} onClick={() => paste("source")}><Clipboard size={14} /></IconButton>
            <ActionButton disabled={running || !scanRoots.length} onClick={() => execute("scan")}><Search size={14} /> Scan</ActionButton>
            <ActionButton disabled={running || !sourcePaths.length} onClick={() => execute("plan")}><FileSearch size={14} /> Plan</ActionButton>
            <ActionButton variant="primary" disabled={running || !sourcePaths.length} onClick={() => execute("process")}><Play size={14} /> Process</ActionButton>
            <IconButton title="Copy results" onClick={copyResults}><Copy size={14} /></IconButton>
            <IconButton title="Copy logs" onClick={copyLogs}><FileSearch size={14} /></IconButton>
            <IconButton title="Reset" onClick={reset}><RotateCcw size={14} /></IconButton>
          </>
        }
      />

      <NodeBody className="flex flex-col gap-2">
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <TextArea
            label="source folders"
            value={data.sourceText ?? ""}
            onChange={(event) => patch({ sourceText: event.currentTarget.value })}
            disabled={running}
            placeholder="one folder per line, usually a gallery folder under an [artist] folder"
          />
          <TextArea
            label="scan roots"
            value={data.scanRootText ?? ""}
            onChange={(event) => patch({ scanRootText: event.currentTarget.value })}
            disabled={running}
            placeholder="one root folder per line"
          />
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <Field label="keywords" value={data.keywordText ?? DEFAULT_KAVVKA_KEYWORDS.join(", ")} disabled={running} onChange={(event) => patch({ keywordText: event.currentTarget.value })} />
          <Field label="depth" type="number" min={0} max={10} value={data.scanDepth ?? 3} disabled={running} onChange={(event) => patch({ scanDepth: Number(event.currentTarget.value) })} />
        </div>

        <div className="flex shrink-0 flex-wrap gap-1">
          <SegmentButton active={data.force ?? true} disabled={running} onClick={() => patch({ force: !(data.force ?? true) })}>force move</SegmentButton>
          <SegmentButton active={data.dryRun ?? true} disabled={running} onClick={() => patch({ dryRun: !(data.dryRun ?? true) })}>dry run</SegmentButton>
          <SegmentButton active={data.strictArtist ?? false} disabled={running} onClick={() => patch({ strictArtist: !(data.strictArtist ?? false) })}>strict []</SegmentButton>
          <StatPill label="matched" value={result?.matchedPaths.length ?? 0} tone="accent" />
          <StatPill label="paths" value={result?.allCombinedPaths.length ?? 0} tone="good" />
          <StatPill label="moved" value={result?.movedCount ?? 0} />
          <StatPill label="errors" value={result?.errorCount ?? 0} tone={(result?.errorCount ?? 0) ? "bad" : "neutral"} />
        </div>

        <ResultView className="h-24 shrink-0 text-muted-foreground">
          {result?.allCombinedPaths.length ? result.allCombinedPaths.slice(0, 40).map((path) => (
            <div key={path} className="truncate">{path}</div>
          )) : result?.matchedPaths.length ? result.matchedPaths.slice(0, 60).map((path) => (
            <div key={path} className="truncate">{path}</div>
          )) : (
            <div className="flex h-full items-center justify-center text-muted-foreground">{data.progressText || `keywords: ${keywords.slice(0, 4).join(", ")}`}</div>
          )}
        </ResultView>
      </NodeBody>

      <NodeFooter>
        <LogView lines={running ? [`[${data.progress ?? 0}%] ${data.progressText ?? ""}`, ...logs] : logs} className="h-14" />
      </NodeFooter>
    </NodeContent>
  )
}

function buildInput(action: KavvkaAction, data: KavvkaCardState): KavvkaInput {
  return {
    action,
    pathText: data.sourceText,
    scanRootText: data.scanRootText,
    keywordText: data.keywordText,
    scanDepth: data.scanDepth ?? 3,
    force: data.force ?? true,
    dryRun: action === "plan" ? true : data.dryRun ?? false,
    strictArtist: data.strictArtist ?? false,
  }
}

function appendText(current = "", next: string): string {
  return current.trim() ? `${current.trimEnd()}\n${next}` : next
}

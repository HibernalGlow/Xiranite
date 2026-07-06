import { useState } from "react"
import type { NodeComponentProps } from "@xiranite/contract"
import { Clipboard, Copy, FolderOpen, Minus, Plus, RefreshCw, RotateCcw, Search, Video } from "lucide-react"
import { ActionButton, Field, IconButton, LogView, NodeBody, NodeContent, NodeFooter, NodeHeader, ResultView, SegmentButton, StatPill, createUnavailableNativeAction } from "@xiranite/ui"
import type { FormatvData, FormatvInput, FormatvResult } from "./core.js"

interface FormatvCardState {
  pathText?: string
  prefixName?: string
  recursive?: boolean
  dryRun?: boolean
  result?: FormatvData | null
  logs?: string[]
  phase?: string
}

export function Component({ compId, host }: NodeComponentProps) {
  const data = host.getData<FormatvCardState>(compId) ?? {}
  const [running, setRunning] = useState(false)
  const logs = data.logs ?? []
  const paths = splitLines(data.pathText)
  const prefixName = data.prefixName || "hb"
  const recursive = data.recursive ?? false
  const dryRun = data.dryRun ?? false
  const result = data.result

  function patch(patchData: Partial<FormatvCardState>) {
    host.patchData(compId, patchData)
  }

  function log(message: string) {
    patch({ logs: [...logs.slice(-40), message] })
  }

  async function pastePath() {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ pathText: text.trim() })
  }

  async function execute(action: FormatvInput["action"]) {
    if (running) return
    const runNativeAction = createUnavailableNativeAction("Native action is unavailable in the shell-less Component. Use the xiranite-formatv CLI for filesystem actions.")
    setRunning(true)
    patch({ phase: action })
    const response = await runNativeAction<FormatvInput, FormatvData>("formatv", {
      action,
      paths,
      recursive,
      prefixName,
      dryRun,
    }, (event) => {
      if (event.type === "progress") log(`[${event.progress ?? 0}%] ${event.message}`)
      else log(event.message)
    }) as FormatvResult
    patch({ phase: response.success ? "completed" : "error", result: response.data ?? null })
    log(response.message)
    setRunning(false)
  }

  async function copyResults() {
    const text = [
      ...(result?.duplicates ?? []),
      ...(result?.operations ?? []).map((item) => `${item.status} ${item.sourcePath} -> ${item.targetPath}`),
      ...(result?.normalFiles ?? []),
      ...(result?.novFiles ?? []),
    ].join("\n")
    await host.clipboard?.writeText?.(text)
  }

  async function copyLogs() {
    await host.clipboard?.writeText?.(logs.join("\n"))
  }

  function reset() {
    patch({ result: null, logs: [], phase: "idle" })
  }

  return (
    <NodeContent>
      <NodeHeader
        title="formatv"
        meta={`${data.phase ?? "idle"} / ${paths.length || 0} path(s) / ${dryRun ? "dry-run" : "write"}`}
        actions={
          <>
            <ActionButton disabled={running || !paths.length} onClick={() => execute("scan")}><RefreshCw size={14} /> Scan</ActionButton>
            <ActionButton disabled={running || !paths.length} onClick={() => execute("add_nov")}><Plus size={14} /> .nov</ActionButton>
            <ActionButton disabled={running || !paths.length} onClick={() => execute("remove_nov")}><Minus size={14} /> .nov</ActionButton>
            <ActionButton disabled={running || !paths.length} onClick={() => execute("check_duplicates")}><Search size={14} /> Dup</ActionButton>
            <IconButton title="Copy results" onClick={copyResults}><Copy size={14} /></IconButton>
            <IconButton title="Copy logs" onClick={copyLogs}><Clipboard size={14} /></IconButton>
            <IconButton title="Reset" onClick={reset}><RotateCcw size={14} /></IconButton>
          </>
        }
      />

      <NodeBody className="flex flex-col gap-2">
        <div className="flex shrink-0 flex-wrap items-end gap-2">
          <Field label="paths" value={data.pathText ?? ""} disabled={running} onChange={(event) => patch({ pathText: event.currentTarget.value })} className="min-w-0 flex-1" />
          <IconButton title="Paste paths" disabled={running} onClick={pastePath}><FolderOpen size={13} /></IconButton>
          <Field label="prefix" value={prefixName} disabled={running} onChange={(event) => patch({ prefixName: event.currentTarget.value })} className="min-w-0 flex-1" />
          <SegmentButton active={recursive} disabled={running} onClick={() => patch({ recursive: !recursive })}>recursive</SegmentButton>
          <SegmentButton active={dryRun} disabled={running} onClick={() => patch({ dryRun: !dryRun })}>dry-run</SegmentButton>
        </div>

        <div className="flex shrink-0 flex-wrap gap-1">
          <StatPill label="normal" value={result?.normalCount ?? 0} tone="good" />
          <StatPill label=".nov" value={result?.novCount ?? 0} tone="accent" />
          <StatPill label={prefixName} value={result?.prefixedCounts[prefixName] ?? 0} tone="accent" />
          <StatPill label="success" value={result?.successCount ?? 0} tone="good" />
          <StatPill label="dups" value={result?.duplicateCount ?? 0} tone={(result?.duplicateCount ?? 0) ? "bad" : "neutral"} />
          <StatPill label="errors" value={result?.errorCount ?? 0} tone={(result?.errorCount ?? 0) ? "bad" : "neutral"} />
        </div>

        <ResultView className="flex-1 text-muted-foreground">
          {result?.operations.length ? result.operations.slice(0, 80).map((item) => (
            <div key={`${item.sourcePath}:${item.targetPath}`} className={item.status === "error" ? "mb-1 truncate text-red-500" : "mb-1 truncate"}>
              {item.status} {item.sourcePath} -&gt; {item.targetPath}{item.reason ? ` / ${item.reason}` : ""}
            </div>
          )) : result?.duplicates.length ? result.duplicates.slice(0, 80).map((item) => (
            <div key={item} className="mb-1 truncate text-red-500">{item}</div>
          )) : result ? (
            <FileList result={result} prefixName={prefixName} />
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground"><Video size={14} className="mr-2" />No scan yet</div>
          )}
        </ResultView>
      </NodeBody>

      <NodeFooter>
        <LogView lines={logs} className="h-14" />
      </NodeFooter>
    </NodeContent>
  )
}

function FileList({ result, prefixName }: { result: FormatvData; prefixName: string }) {
  const files = [
    ...result.normalFiles.map((file) => `normal ${file}`),
    ...result.novFiles.map((file) => `.nov ${file}`),
    ...(result.prefixedFiles[prefixName] ?? []).map((file) => `${prefixName} ${file}`),
  ]
  return files.length ? files.slice(0, 100).map((line) => <div key={line} className="mb-1 truncate">{line}</div>) : "No video files"
}

function splitLines(text?: string): string[] {
  return (text ?? "").split(/\r?\n|[;]/).map((item) => item.trim()).filter(Boolean)
}

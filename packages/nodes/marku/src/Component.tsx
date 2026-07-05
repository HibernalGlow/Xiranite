import { useState } from "react"
import type { NodeCardProps } from "@xiranite/contract"
import { Clipboard, Copy, FileCode, History, Play, RotateCcw, Undo2 } from "lucide-react"
import { ActionButton, Field, IconButton, LogView, NodeBody, NodeContent, NodeFooter, NodeHeader, ResultView, SegmentButton, StatPill, TextArea } from "@xiranite/ui"
import type { MarkuData, MarkuInput, MarkuModuleId, MarkuResult } from "./core.js"
import { MARKU_MODULES } from "./core.js"

interface MarkuCardState {
  inputText?: string
  pathText?: string
  module?: string
  configText?: string
  recursive?: boolean
  dryRun?: boolean
  enableUndo?: boolean
  result?: MarkuData | null
  logs?: string[]
  phase?: string
}

export function Component({ compId, host }: NodeCardProps) {
  const data = host.getData<MarkuCardState>(compId) ?? {}
  const [running, setRunning] = useState(false)
  const logs = data.logs ?? []
  const selectedModule = data.module ?? "markt"
  const dryRun = data.dryRun ?? true
  const recursive = data.recursive ?? false
  const enableUndo = data.enableUndo ?? true
  const paths = splitLines(data.pathText)
  const hasText = Boolean(data.inputText?.trim())
  const result = data.result

  function patch(patchData: Partial<MarkuCardState>) {
    host.patchData(compId, patchData)
  }

  function log(message: string) {
    patch({ logs: [...logs.slice(-50), message] })
  }

  async function pasteText() {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ inputText: text })
  }

  async function pastePath() {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ pathText: text.trim() })
  }

  async function execute(action: MarkuInput["action"] = "run") {
    if (running) return
    const runNode = host.runner?.runNode
    if (!runNode) {
      log("Host runner unavailable. Use the xiranite-marku CLI for Markdown actions.")
      return
    }
    setRunning(true)
    patch({ phase: action })
    const response = await runNode<MarkuInput, MarkuData>("marku", {
      action,
      module: selectedModule,
      inputText: hasText ? data.inputText : "",
      paths: hasText ? [] : paths,
      stepConfig: parseConfig(data.configText),
      recursive,
      dryRun,
      enableUndo,
    }, (event) => {
      if (event.type === "progress") log(`[${event.progress ?? 0}%] ${event.message}`)
      else log(event.message)
    }) as MarkuResult
    patch({ phase: response.success ? "completed" : "error", result: response.data ?? null })
    log(response.message)
    setRunning(false)
  }

  async function copyOutput() {
    const text = result?.outputText || result?.diffText || result?.diffs.map((item) => item.diff).join("\n") || ""
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
        title="marku"
        meta={`${data.phase ?? "idle"} / ${selectedModule} / ${dryRun ? "dry-run" : "write"}`}
        actions={
          <>
            <ActionButton disabled={running || (!hasText && !paths.length)} onClick={() => execute(hasText ? "text" : "run")}><Play size={14} /> Run</ActionButton>
            <ActionButton disabled={running} onClick={() => execute("history")}><History size={14} /> History</ActionButton>
            <ActionButton disabled={running} onClick={() => execute("undo")}><Undo2 size={14} /> Undo</ActionButton>
            <IconButton title="Copy output" onClick={copyOutput}><Copy size={14} /></IconButton>
            <IconButton title="Copy logs" onClick={copyLogs}><Clipboard size={14} /></IconButton>
            <IconButton title="Reset" onClick={reset}><RotateCcw size={14} /></IconButton>
          </>
        }
      />

      <NodeBody className="flex flex-col gap-2">
        <div className="flex shrink-0 flex-wrap gap-1">
          {MARKU_MODULES.map((module) => (
            <SegmentButton key={module.id} active={selectedModule === module.id} disabled={running} onClick={() => patch({ module: module.id })}>
              {module.id}
            </SegmentButton>
          ))}
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <TextArea label="text input" value={data.inputText ?? ""} disabled={running} onChange={(event) => patch({ inputText: event.currentTarget.value })} placeholder="paste markdown text, or leave empty to use paths" />
          <TextArea label="paths / config" value={data.pathText ?? ""} disabled={running || hasText} onChange={(event) => patch({ pathText: event.currentTarget.value })} placeholder="one file or folder per line" />
        </div>

        <div className="flex shrink-0 flex-wrap items-end gap-2">
          <Field label="config json" value={data.configText ?? ""} disabled={running} onChange={(event) => patch({ configText: event.currentTarget.value })} className="min-w-0 flex-1" />
          <IconButton title="Paste text" disabled={running} onClick={pasteText}><FileCode size={13} /></IconButton>
          <IconButton title="Paste path" disabled={running} onClick={pastePath}><Clipboard size={13} /></IconButton>
          <SegmentButton active={recursive} disabled={running || hasText} onClick={() => patch({ recursive: !recursive })}>recursive</SegmentButton>
          <SegmentButton active={dryRun} disabled={running || hasText} onClick={() => patch({ dryRun: !dryRun })}>dry-run</SegmentButton>
          <SegmentButton active={enableUndo} disabled={running || dryRun || hasText} onClick={() => patch({ enableUndo: !enableUndo })}>undo</SegmentButton>
        </div>

        <div className="flex shrink-0 flex-wrap gap-1">
          <StatPill label="processed" value={result?.filesProcessed ?? 0} tone="accent" />
          <StatPill label="changed" value={result?.filesChanged ?? 0} tone="good" />
          <StatPill label="diffs" value={result?.diffs.filter((item) => item.changed).length ?? 0} />
          <StatPill label="history" value={result?.history.length ?? 0} />
          <StatPill label="errors" value={result?.errors.length ?? 0} tone={(result?.errors.length ?? 0) ? "bad" : "neutral"} />
        </div>

        <ResultView className="flex-1 text-muted-foreground">
          {result?.outputText ? (
            <pre className="whitespace-pre-wrap break-words">{result.outputText}</pre>
          ) : result?.diffText ? (
            <pre className="whitespace-pre-wrap break-words">{result.diffText}</pre>
          ) : result?.diffs.length ? result.diffs.slice(0, 20).map((item) => (
            <div key={item.file} className="mb-2">
              <div className={item.changed ? "truncate text-primary" : "truncate"}>{item.changed ? "changed" : "same"} {item.file}</div>
              {item.diff ? <pre className="max-h-24 overflow-hidden whitespace-pre-wrap break-words opacity-80">{item.diff}</pre> : null}
            </div>
          )) : result?.history.length ? result.history.map((item) => (
            <div key={item.id} className="mb-1 truncate">{item.id} {item.module} {item.files.length} file(s) {item.undone ? "/ undone" : ""}</div>
          )) : "No result"}
        </ResultView>
      </NodeBody>

      <NodeFooter>
        <LogView lines={logs} className="h-14" />
      </NodeFooter>
    </NodeContent>
  )
}

function splitLines(text?: string): string[] {
  return (text ?? "").split(/\r?\n|[;]/).map((item) => item.trim()).filter(Boolean)
}

function parseConfig(text?: string): Record<string, unknown> {
  if (!text?.trim()) return {}
  try {
    const parsed = JSON.parse(text) as unknown
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

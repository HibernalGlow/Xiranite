import { useState } from "react"
import type { NodeComponentProps } from "@xiranite/contract"
import { Clipboard, Copy, FolderOpen, MoveRight, RotateCcw, Search, Zap } from "lucide-react"
import { ActionButton, Field, IconButton, LogView, NodeBody, NodeContent, NodeFooter, NodeHeader, ResultView, SegmentButton, StatPill, TextArea } from "@xiranite/ui"
import type { CrashuData, CrashuInput, CrashuResult } from "./core.js"

interface CrashuCardState {
  sourcePathsText?: string
  targetPath?: string
  targetNamesText?: string
  destinationPath?: string
  similarityThreshold?: number
  autoMove?: boolean
  moveDirection?: "to_target" | "to_source"
  conflictPolicy?: "skip" | "overwrite" | "rename"
  result?: CrashuData | null
  logs?: string[]
  phase?: string
}

export function Component({ compId, host }: NodeComponentProps) {
  const data = host.getData<CrashuCardState>(compId) ?? {}
  const [running, setRunning] = useState(false)
  const logs = data.logs ?? []
  const sourcePaths = splitLines(data.sourcePathsText)
  const targetNames = splitLines(data.targetNamesText)
  const threshold = data.similarityThreshold ?? 0.6
  const autoMove = data.autoMove ?? false
  const direction = data.moveDirection ?? "to_target"
  const conflict = data.conflictPolicy ?? "skip"
  const plan = data.result?.plan ?? []
  const matches = data.result?.similarFolders ?? []

  function patch(patchData: Partial<CrashuCardState>) {
    host.patchData(compId, patchData)
  }

  function log(message: string) {
    patch({ logs: [...logs.slice(-40), message] })
  }

  async function paste(field: "sourcePathsText" | "targetPath" | "targetNamesText" | "destinationPath") {
    const text = await host.clipboard?.readText?.()
    if (!text) return
    patch({ [field]: field.endsWith("Text") ? text.trim() : text.trim() })
  }

  async function execute(action: CrashuInput["action"]) {
    if (running) return
    const runNode = host.runner?.runNode
    if (!runNode) {
      log("Host runner unavailable. Use the xiranite-crashu CLI for filesystem actions.")
      return
    }
    setRunning(true)
    patch({ phase: action === "move" || action === "execute" ? "moving" : action })
    const response = await runNode<CrashuInput, CrashuData>("crashu", {
      action,
      sourcePaths,
      targetPath: data.targetPath,
      targetNames,
      destinationPath: data.destinationPath,
      similarityThreshold: threshold,
      autoMove: action === "move" || action === "execute" ? true : autoMove,
      moveDirection: direction,
      conflictPolicy: conflict,
    }, (event) => {
      if (event.type === "progress") log(`[${event.progress ?? 0}%] ${event.message}`)
      else log(event.message)
    }) as CrashuResult
    patch({ phase: response.success ? "completed" : "error", result: response.data ?? null })
    log(response.message)
    setRunning(false)
  }

  async function copyResults() {
    const text = matches.map((item) => `${item.path} -> ${item.target} (${Math.round(item.similarity * 100)}%)`).join("\n")
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
        title="crashu"
        meta={`${data.phase ?? "idle"} / ${matches.length} match(es)`}
        actions={
          <>
            <ActionButton disabled={running || !sourcePaths.length} onClick={() => execute("scan")}><Search size={14} /> Scan</ActionButton>
            <ActionButton disabled={running || !sourcePaths.length} onClick={() => execute("plan")}><Zap size={14} /> Plan</ActionButton>
            <ActionButton variant="primary" disabled={running || !sourcePaths.length || !data.destinationPath} onClick={() => execute("move")}><MoveRight size={14} /> Move</ActionButton>
            <IconButton title="Copy results" onClick={copyResults}><Copy size={14} /></IconButton>
            <IconButton title="Copy logs" onClick={copyLogs}><Clipboard size={14} /></IconButton>
            <IconButton title="Reset" onClick={reset}><RotateCcw size={14} /></IconButton>
          </>
        }
      />

      <NodeBody className="flex flex-col gap-2">
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <TextArea label="sources" value={data.sourcePathsText ?? ""} disabled={running} onChange={(event) => patch({ sourcePathsText: event.currentTarget.value })} placeholder="one source folder per line" />
          <TextArea label="targets" value={data.targetNamesText ?? ""} disabled={running || Boolean(data.targetPath?.trim())} onChange={(event) => patch({ targetNamesText: event.currentTarget.value })} placeholder="manual target names, one per line" />
        </div>

        <div className="flex shrink-0 flex-wrap items-end gap-2">
          <Field label="target folder" value={data.targetPath ?? ""} disabled={running} onChange={(event) => patch({ targetPath: event.currentTarget.value })} className="min-w-0 flex-1" />
          <IconButton title="Paste target folder" disabled={running} onClick={() => paste("targetPath")}><FolderOpen size={13} /></IconButton>
          <Field label="destination" value={data.destinationPath ?? ""} disabled={running} onChange={(event) => patch({ destinationPath: event.currentTarget.value })} className="min-w-0 flex-1" />
          <IconButton title="Paste destination" disabled={running} onClick={() => paste("destinationPath")}><FolderOpen size={13} /></IconButton>
        </div>

        <div className="flex shrink-0 flex-wrap items-end gap-2">
          <Field label="threshold" type="number" min={0} max={1} step={0.05} value={threshold} disabled={running} onChange={(event) => patch({ similarityThreshold: Number(event.currentTarget.value) })} className="min-w-0 flex-1" />
          <SegmentButton active={autoMove} disabled={running} onClick={() => patch({ autoMove: !autoMove })}>auto move</SegmentButton>
          <SegmentButton active={direction === "to_target"} disabled={running} onClick={() => patch({ moveDirection: "to_target" })}>to target</SegmentButton>
          <SegmentButton active={direction === "to_source"} disabled={running} onClick={() => patch({ moveDirection: "to_source" })}>to source</SegmentButton>
          <SegmentButton active={conflict === "skip"} disabled={running} onClick={() => patch({ conflictPolicy: "skip" })}>skip</SegmentButton>
          <SegmentButton active={conflict === "rename"} disabled={running} onClick={() => patch({ conflictPolicy: "rename" })}>rename</SegmentButton>
          <SegmentButton active={conflict === "overwrite"} disabled={running} onClick={() => patch({ conflictPolicy: "overwrite" })}>overwrite</SegmentButton>
        </div>

        <div className="flex shrink-0 flex-wrap gap-1">
          <StatPill label="sources" value={data.result?.sourceCount ?? sourcePaths.length} tone="accent" />
          <StatPill label="targets" value={data.result?.targetCount ?? targetNames.length} tone="accent" />
          <StatPill label="matches" value={data.result?.similarFound ?? 0} tone="good" />
          <StatPill label="moved" value={data.result?.movedCount ?? 0} tone="good" />
          <StatPill label="skipped" value={data.result?.skippedCount ?? 0} />
          <StatPill label="errors" value={data.result?.errorCount ?? 0} tone={(data.result?.errorCount ?? 0) ? "bad" : "neutral"} />
        </div>

        <ResultView className="flex-1 text-muted-foreground">
          {plan.length ? plan.slice(0, 80).map((item) => (
            <div key={`${item.sourcePath}:${item.destinationPath}`} className={item.status === "error" ? "mb-1 truncate text-red-500" : "mb-1 truncate"}>
              {item.status} {Math.round(item.similarity * 100)}% {item.sourcePath}{item.destinationPath ? ` -> ${item.destinationPath}` : ` / ${item.reason}`}
            </div>
          )) : matches.length ? matches.slice(0, 80).map((item) => (
            <div key={`${item.path}:${item.target}`} className="mb-1 truncate">
              {Math.round(item.similarity * 100)}% {item.name}{" -> "}{item.target}
            </div>
          )) : "No matches yet"}
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

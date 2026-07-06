import { useState } from "react"
import type { NodeComponentProps } from "@xiranite/contract"
import { Clipboard, FolderInput, FolderOpen, History, Play, RotateCcw, Undo2 } from "lucide-react"
import { ActionButton, Field, IconButton, LogView, NodeBody, NodeContent, NodeFooter, NodeHeader, ResultView, SegmentButton, StatPill, createUnavailableNodeRunner } from "@xiranite/ui"
import type { DissolvefData, DissolvefInput, DissolvefResult } from "./core.js"

interface DissolvefCardState {
  pathText?: string
  historyPath?: string
  excludeText?: string
  nested?: boolean
  media?: boolean
  archive?: boolean
  direct?: boolean
  preview?: boolean
  protectFirstLevel?: boolean
  enableSimilarity?: boolean
  similarityThreshold?: number
  fileConflict?: string
  dirConflict?: string
  undoId?: string
  result?: DissolvefData | null
  logs?: string[]
  phase?: string
}

export function Component({ compId, host }: NodeComponentProps) {
  const data = host.getData<DissolvefCardState>(compId) ?? {}
  const [running, setRunning] = useState(false)
  const logs = data.logs ?? []
  const nested = data.nested ?? true
  const media = data.media ?? true
  const archive = data.archive ?? true
  const direct = data.direct ?? false
  const preview = data.preview ?? false
  const protectFirstLevel = data.protectFirstLevel ?? true
  const enableSimilarity = data.enableSimilarity ?? true
  const threshold = data.similarityThreshold ?? 0.6
  const plan = data.result?.plan ?? []
  const history = data.result?.history ?? []

  function patch(patchData: Partial<DissolvefCardState>) {
    host.patchData(compId, patchData)
  }

  function log(message: string) {
    patch({ logs: [...logs.slice(-40), message] })
  }

  async function paste(field: "pathText" | "historyPath" | "excludeText") {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ [field]: text.trim() })
  }

  async function execute(action: DissolvefInput["action"]) {
    if (running) return
    const runNode = createUnavailableNodeRunner("Native action is unavailable in the shell-less Component. Use the xiranite-dissolvef CLI for filesystem actions.")
    setRunning(true)
    patch({ phase: "running" })
    const response = await runNode<DissolvefInput, DissolvefData>("dissolvef", {
      action,
      path: data.pathText,
      historyPath: data.historyPath,
      undoId: data.undoId,
      exclude: data.excludeText,
      nested,
      media,
      archive,
      direct,
      preview: action === "plan" ? true : preview,
      protectFirstLevel,
      enableSimilarity,
      similarityThreshold: threshold,
      fileConflict: data.fileConflict as DissolvefInput["fileConflict"],
      dirConflict: data.dirConflict as DissolvefInput["dirConflict"],
    }, (event) => {
      if (event.type === "progress") log(`[${event.progress ?? 0}%] ${event.message}`)
      else log(event.message)
    }) as DissolvefResult
    patch({ phase: response.success ? "completed" : "error", result: response.data ?? null })
    log(response.message)
    setRunning(false)
  }

  function setMode(mode: "bundle" | "direct") {
    if (mode === "direct") patch({ direct: true, nested: false, media: false, archive: false })
    else patch({ direct: false, nested: true, media: true, archive: true })
  }

  function toggleMode(key: "nested" | "media" | "archive") {
    patch({ direct: false, [key]: !(data[key] ?? true) })
  }

  function reset() {
    patch({ result: null, logs: [], phase: "idle" })
  }

  async function copyLogs() {
    await host.clipboard?.writeText?.(logs.join("\n"))
  }

  return (
    <NodeContent>
      <NodeHeader
        title="dissolvef"
        meta={`${data.phase ?? "idle"} / ${direct ? "direct" : selectedModes(nested, media, archive)}`}
        actions={
          <>
            <ActionButton disabled={running} onClick={() => execute("plan")}><Play size={14} /> Plan</ActionButton>
            <ActionButton disabled={running} onClick={() => execute(direct ? "direct" : "dissolve")}><FolderInput size={14} /> Run</ActionButton>
            <ActionButton disabled={running} onClick={() => execute("history")}><History size={14} /> History</ActionButton>
            <ActionButton disabled={running} onClick={() => execute("undo")}><Undo2 size={14} /> Undo</ActionButton>
            <IconButton title="Copy logs" onClick={copyLogs}><Clipboard size={14} /></IconButton>
            <IconButton title="Reset" onClick={reset}><RotateCcw size={14} /></IconButton>
          </>
        }
      />

      <NodeBody className="flex flex-col gap-2">
        <div className="flex shrink-0 flex-wrap items-end gap-2">
          <Field label="folder" value={data.pathText ?? ""} disabled={running} onChange={(event) => patch({ pathText: event.currentTarget.value })} className="min-w-0 flex-1" />
          <IconButton title="Paste folder" onClick={() => paste("pathText")} disabled={running}><FolderOpen size={13} /></IconButton>
          <Field label="history" value={data.historyPath ?? ""} disabled={running} onChange={(event) => patch({ historyPath: event.currentTarget.value })} className="min-w-0 flex-1" />
        </div>

        <div className="flex shrink-0 flex-wrap gap-1">
          <SegmentButton active={!direct} disabled={running} onClick={() => setMode("bundle")}>bundle</SegmentButton>
          <SegmentButton active={direct} disabled={running} onClick={() => setMode("direct")}>direct</SegmentButton>
          <SegmentButton active={nested && !direct} disabled={running || direct} onClick={() => toggleMode("nested")}>nested</SegmentButton>
          <SegmentButton active={media && !direct} disabled={running || direct} onClick={() => toggleMode("media")}>media</SegmentButton>
          <SegmentButton active={archive && !direct} disabled={running || direct} onClick={() => toggleMode("archive")}>archive</SegmentButton>
          <SegmentButton active={preview} disabled={running} onClick={() => patch({ preview: !preview })}>preview</SegmentButton>
          <SegmentButton active={protectFirstLevel} disabled={running || direct} onClick={() => patch({ protectFirstLevel: !protectFirstLevel })}>protect</SegmentButton>
          <SegmentButton active={enableSimilarity} disabled={running || direct} onClick={() => patch({ enableSimilarity: !enableSimilarity })}>similarity</SegmentButton>
        </div>

        <div className="flex shrink-0 flex-wrap items-end gap-2">
          <Field label="exclude" value={data.excludeText ?? ""} disabled={running} onChange={(event) => patch({ excludeText: event.currentTarget.value })} className="min-w-0 flex-1" />
          <Field label="threshold" type="number" min={0} max={1} step={0.05} value={threshold} disabled={running || direct || !enableSimilarity} onChange={(event) => patch({ similarityThreshold: Number(event.currentTarget.value) })} className="min-w-0 flex-1" />
          <Field label="file conflict" value={data.fileConflict ?? "auto"} disabled={running || !direct} onChange={(event) => patch({ fileConflict: event.currentTarget.value })} className="min-w-0 flex-1" />
          <Field label="dir conflict" value={data.dirConflict ?? "auto"} disabled={running || !direct} onChange={(event) => patch({ dirConflict: event.currentTarget.value })} className="min-w-0 flex-1" />
        </div>

        <div className="flex shrink-0 flex-wrap gap-1">
          <StatPill label="nested" value={data.result?.nestedCount ?? 0} tone="good" />
          <StatPill label="media" value={data.result?.mediaCount ?? 0} tone="good" />
          <StatPill label="archive" value={data.result?.archiveCount ?? 0} tone="good" />
          <StatPill label="direct" value={`${data.result?.directFiles ?? 0}/${data.result?.directDirs ?? 0}`} tone="accent" />
          <StatPill label="skipped" value={data.result?.skippedCount ?? 0} />
          <StatPill label="errors" value={data.result?.errorCount ?? data.result?.failedCount ?? 0} tone={(data.result?.errorCount || data.result?.failedCount) ? "bad" : "neutral"} />
        </div>

        <ResultView className="flex-1 text-muted-foreground">
          {plan.length ? plan.slice(0, 80).map((item, index) => (
            <div key={`${index}:${item.sourcePath}:${item.targetPath}`} className="mb-1 truncate">
              {item.status} {item.mode} {item.operation} {item.sourcePath}{item.targetPath ? ` -> ${item.targetPath}` : item.reason ? ` / ${item.reason}` : ""}
            </div>
          )) : history.length ? history.slice(0, 20).map((item) => (
            <div key={item.id} className="mb-1 truncate">
              {item.id} / {item.mode} / {item.count} operation(s) {item.undone ? "/ undone" : ""}
            </div>
          )) : "No result"}
        </ResultView>
      </NodeBody>

      <NodeFooter>
        <LogView lines={logs} className="h-14" />
      </NodeFooter>
    </NodeContent>
  )
}

function selectedModes(nested: boolean, media: boolean, archive: boolean): string {
  const modes = [nested ? "nested" : "", media ? "media" : "", archive ? "archive" : ""].filter(Boolean)
  return modes.length ? modes.join("+") : "none"
}

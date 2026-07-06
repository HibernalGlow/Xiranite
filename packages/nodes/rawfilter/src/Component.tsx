import { useState } from "react"
import type { NodeComponentProps } from "@xiranite/contract"
import { Clipboard, Copy, FolderOpen, Play, RotateCcw, Search } from "lucide-react"
import { ActionButton, Field, IconButton, LogView, NodeBody, NodeContent, NodeFooter, NodeHeader, ResultView, SegmentButton, StatPill, createUnavailableNativeAction } from "@xiranite/ui"
import type { RawfilterData, RawfilterInput, RawfilterResult } from "./core.js"

interface RawfilterCardState {
  pathText?: string
  nameOnlyMode?: boolean
  createShortcuts?: boolean
  trashOnly?: boolean
  minSimilarity?: number
  result?: RawfilterData | null
  logs?: string[]
  phase?: string
}

export function Component({ compId, host }: NodeComponentProps) {
  const data = host.getData<RawfilterCardState>(compId) ?? {}
  const [running, setRunning] = useState(false)
  const logs = data.logs ?? []
  const nameOnlyMode = data.nameOnlyMode ?? false
  const createShortcuts = data.createShortcuts ?? false
  const trashOnly = data.trashOnly ?? false
  const minSimilarity = data.minSimilarity ?? 0.82
  const plan = data.result?.plan ?? []

  function patch(patchData: Partial<RawfilterCardState>) {
    host.patchData(compId, patchData)
  }

  function log(message: string) {
    patch({ logs: [...logs.slice(-40), message] })
  }

  async function pastePath() {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ pathText: text.trim() })
  }

  async function execute(action: RawfilterInput["action"]) {
    if (running) return
    const runNativeAction = createUnavailableNativeAction("Native action is unavailable in the shell-less Component. Use the xiranite-rawfilter CLI for filesystem actions.")
    setRunning(true)
    patch({ phase: action === "execute" ? "running" : "planning" })
    const response = await runNativeAction<RawfilterInput, RawfilterData>("rawfilter", {
      action,
      path: data.pathText,
      nameOnlyMode,
      createShortcuts,
      trashOnly,
      minSimilarity,
    }, (event) => {
      if (event.type === "progress") log(`[${event.progress ?? 0}%] ${event.message}`)
      else log(event.message)
    }) as RawfilterResult
    patch({ phase: response.success ? "completed" : "error", result: response.data ?? null })
    log(response.message)
    setRunning(false)
  }

  function reset() {
    patch({ result: null, logs: [], phase: "idle" })
  }

  async function copyPlan() {
    const text = plan.map((item) => `${item.destination} ${item.sourcePath}${item.targetPath ? ` -> ${item.targetPath}` : ""}`).join("\n")
    await host.clipboard?.writeText?.(text)
  }

  async function copyLogs() {
    await host.clipboard?.writeText?.(logs.join("\n"))
  }

  return (
    <NodeContent>
      <NodeHeader
        title="rawfilter"
        meta={`${data.phase ?? "idle"} / ${data.result?.archiveCount ?? 0} archive(s)`}
        actions={
          <>
            <ActionButton disabled={running} onClick={() => execute("plan")}><Search size={14} /> Plan</ActionButton>
            <ActionButton variant="primary" disabled={running} onClick={() => execute("execute")}><Play size={14} /> Run</ActionButton>
            <IconButton title="Copy plan" onClick={copyPlan}><Copy size={14} /></IconButton>
            <IconButton title="Copy logs" onClick={copyLogs}><Clipboard size={14} /></IconButton>
            <IconButton title="Reset" onClick={reset}><RotateCcw size={14} /></IconButton>
          </>
        }
      />

      <NodeBody className="flex flex-col gap-2">
        <div className="flex shrink-0 flex-wrap items-end gap-2">
          <Field label="folder" value={data.pathText ?? ""} disabled={running} onChange={(event) => patch({ pathText: event.currentTarget.value })} className="min-w-0 flex-1" />
          <IconButton title="Paste folder" disabled={running} onClick={pastePath}><FolderOpen size={14} /></IconButton>
          <Field label="similarity" type="number" min={0} max={1} step={0.01} value={minSimilarity} disabled={running || nameOnlyMode} onChange={(event) => patch({ minSimilarity: Number(event.currentTarget.value) })} className="min-w-0 flex-1" />
        </div>

        <div className="flex shrink-0 flex-wrap gap-1">
          <SegmentButton active={nameOnlyMode} disabled={running} onClick={() => patch({ nameOnlyMode: !nameOnlyMode })}>name only</SegmentButton>
          <SegmentButton active={createShortcuts} disabled={running || trashOnly} onClick={() => patch({ createShortcuts: !createShortcuts })}>shortcuts</SegmentButton>
          <SegmentButton active={trashOnly} disabled={running} onClick={() => patch({ trashOnly: !trashOnly, createShortcuts: trashOnly ? createShortcuts : false })}>trash only</SegmentButton>
        </div>

        <div className="flex shrink-0 flex-wrap gap-1">
          <StatPill label="groups" value={`${data.result?.duplicateGroups ?? 0}/${data.result?.totalGroups ?? 0}`} tone="accent" />
          <StatPill label="trash" value={statusCount(plan, "trash", data.result?.movedToTrash)} tone="bad" />
          <StatPill label="multi" value={statusCount(plan, "multi", data.result?.movedToMulti)} tone="good" />
          <StatPill label="links" value={statusCount(plan, "shortcut", data.result?.createdShortcuts)} tone="good" />
          <StatPill label="errors" value={data.result?.errorCount ?? 0} tone={(data.result?.errorCount ?? 0) ? "bad" : "neutral"} />
        </div>

        <ResultView className="flex-1 text-muted-foreground">
          {plan.length ? plan.slice(0, 80).map((item) => (
            <div key={`${item.sourcePath}:${item.targetPath}:${item.destination}`} className={item.status === "error" ? "mb-1 truncate text-red-500" : "mb-1 truncate"}>
              {item.status} {item.destination} {item.fileName}{item.targetPath ? ` -> ${item.targetPath}` : ` / ${item.reason}`}
            </div>
          )) : "No plan yet"}
        </ResultView>
      </NodeBody>

      <NodeFooter>
        <LogView lines={logs} className="h-14" />
      </NodeFooter>
    </NodeContent>
  )
}

function statusCount(plan: RawfilterData["plan"], destination: "trash" | "multi" | "shortcut", executedCount?: number): number {
  const pending = plan.filter((item) => item.status === "pending" && item.destination === destination).length
  return pending || executedCount || 0
}

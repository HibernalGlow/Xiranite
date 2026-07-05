import { useState } from "react"
import type { NodeCardProps } from "@xiranite/contract"
import { Clock, Copy, Play, RotateCcw, Trash2 } from "lucide-react"
import { ActionButton, Field, IconButton, LogView, NodeBody, NodeContent, NodeFooter, NodeHeader, SegmentButton, StatPill } from "@xiranite/ui"
import type { RecycleuData, RecycleuInput, RecycleuResult } from "./core.js"

interface RecycleuCardState {
  interval?: number
  cleanCount?: number
  lastCleanTime?: string | null
  phase?: string
  logs?: string[]
  progress?: number
  progressText?: string
  remainingSeconds?: number
}

export function Component({ compId, host }: NodeCardProps) {
  const data = host.getData<RecycleuCardState>(compId) ?? {}
  const [running, setRunning] = useState(false)
  const interval = data.interval ?? 10
  const phase = running ? "running" : (data.phase ?? "idle")
  const logs = data.logs ?? []
  const cleanCount = data.cleanCount ?? 0
  const remainingSeconds = data.remainingSeconds ?? interval
  const ringProgress = running ? Math.max(0, Math.min(100, (remainingSeconds / interval) * 100)) : 100

  function patch(patchData: Partial<RecycleuCardState>) {
    host.patchData(compId, patchData)
  }

  function log(message: string) {
    patch({ logs: [...logs.slice(-40), message] })
  }

  async function execute(input: RecycleuInput) {
    if (running) return
    const runNode = host.runner?.runNode
    if (!runNode) {
      log("Host runner unavailable. Use the xiranite-recycleu CLI for system actions.")
      return
    }

    setRunning(true)
    patch({ phase: "running", progress: 0, progressText: "Starting..." })
    const result = await runNode<RecycleuInput, RecycleuData>("recycleu", input, (event) => {
      const seconds = event.message.match(/(\d+)s/)?.[1]
      if (event.type === "progress") {
        patch({
          progress: event.progress ?? 0,
          progressText: event.message,
          remainingSeconds: seconds ? Number(seconds) : remainingSeconds,
        })
      } else {
        log(event.message)
      }
    }) as RecycleuResult

    patch({
      phase: result.success ? "completed" : "error",
      progress: result.success ? 100 : 0,
      progressText: result.message,
      cleanCount: result.data?.cleanCount ?? cleanCount,
      lastCleanTime: result.data?.lastCleanTime ?? data.lastCleanTime ?? null,
      remainingSeconds: interval,
    })
    log(result.message)
    setRunning(false)
  }

  function reset() {
    patch({ phase: "idle", progress: 0, progressText: "", cleanCount: 0, lastCleanTime: null, logs: [], remainingSeconds: interval })
  }

  async function copyLogs() {
    await host.clipboard?.writeText?.(logs.join("\n"))
  }

  return (
    <NodeContent>
      <NodeHeader
        title="recycleu"
        meta={`${phase} / ${interval}s interval`}
        actions={
          <>
            <ActionButton variant="primary" disabled={running} onClick={() => execute({ action: "start", interval })}><Play size={14} /> Start</ActionButton>
            <ActionButton disabled={running} onClick={() => execute({ action: "clean_now" })}><Trash2 size={14} /> Clean</ActionButton>
            <IconButton title="Copy logs" onClick={copyLogs}><Copy size={14} /></IconButton>
            <IconButton title="Reset" onClick={reset}><RotateCcw size={14} /></IconButton>
          </>
        }
      />

      <NodeBody className="flex flex-col gap-2">
        <div className="flex shrink-0 items-end gap-2">
          <Field label="interval seconds" type="number" min={5} max={3600} value={interval} disabled={running} onChange={(event) => patch({ interval: Number(event.currentTarget.value) || 10 })} className="flex-1" />
          {[5, 10, 30, 60].map((value) => (
            <SegmentButton key={value} active={interval === value} disabled={running} onClick={() => patch({ interval: value })}>
              {value < 60 ? `${value}s` : "1m"}
            </SegmentButton>
          ))}
        </div>

        <div className="min-h-0 flex flex-1 flex-col items-stretch gap-2">
          <div className="relative h-28 w-28 shrink-0">
            <svg className="-rotate-90" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="43" fill="none" stroke="currentColor" strokeWidth="8" className="text-muted/40" />
              <circle
                cx="50"
                cy="50"
                r="43"
                fill="none"
                stroke="currentColor"
                strokeWidth="8"
                strokeDasharray={`${ringProgress * 2.7} 270`}
                strokeLinecap="round"
                className={phase === "error" ? "text-red-500" : phase === "completed" ? "text-green-500" : "text-primary"}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              {running ? <span className="text-lg font-bold">{remainingSeconds}s</span> : <Trash2 size={28} className="text-muted-foreground" />}
              <span className="text-[10px] text-muted-foreground">{cleanCount} runs</span>
            </div>
          </div>

          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap gap-1">
              <StatPill label="phase" value={phase} tone={phase === "error" ? "bad" : phase === "completed" ? "good" : "neutral"} />
              <StatPill label="last" value={data.lastCleanTime ?? "-"} />
              <StatPill label="progress" value={`${data.progress ?? 0}%`} tone="accent" />
            </div>
            <div className="truncate text-[11px] text-muted-foreground">{data.progressText || "waiting"}</div>
          </div>
        </div>
      </NodeBody>

      <NodeFooter>
        <LogView lines={logs} className="h-14" />
      </NodeFooter>
    </NodeContent>
  )
}

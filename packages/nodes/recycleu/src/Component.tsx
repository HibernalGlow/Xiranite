import { useState } from "react"
import type { ReactNode } from "react"
import type { NodeCardProps } from "@xiranite/contract"
import { Clock, Copy, Play, RotateCcw, Square, Trash2 } from "lucide-react"
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
  const countdownProgress = running ? Math.max(0, Math.min(100, (remainingSeconds / interval) * 100)) : 100

  function patch(patchData: Partial<RecycleuCardState>) {
    host.patchData(compId, patchData)
  }

  function log(message: string) {
    patch({ logs: [...logs.slice(-40), message] })
  }

  async function execute(input: RecycleuInput) {
    if (running) return
    if (!host.runNode) {
      log("Host runner unavailable. Use the xiranite-recycleu CLI for system actions.")
      return
    }

    setRunning(true)
    patch({ phase: "running", progress: 0, progressText: "Starting..." })
    const result = await host.runNode<RecycleuInput, RecycleuData>("recycleu", input, (event) => {
      if (event.type === "progress") {
        const seconds = event.message.match(/(\d+)s/)?.[1]
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
    <div className="h-full min-h-[300px] overflow-hidden p-3 text-xs font-mono">
      <div className="grid h-full min-h-0 grid-cols-[170px_1fr_120px] grid-rows-[1fr_94px] gap-2">
        <Panel title="Settings" icon={<Clock size={14} />}>
          <div className="flex h-full flex-col gap-2">
            <label className="text-[11px] text-muted-foreground">Clean interval</label>
            <input
              type="number"
              min={5}
              max={3600}
              value={interval}
              disabled={running}
              onChange={(event) => patch({ interval: Number(event.currentTarget.value) || 10 })}
              className="h-8 rounded border border-border bg-background px-2 outline-none"
            />
            <div className="grid grid-cols-4 gap-1">
              {[5, 10, 30, 60].map((value) => (
                <button key={value} className="h-7 rounded border border-border hover:bg-muted disabled:opacity-50" disabled={running} onClick={() => patch({ interval: value })}>
                  {value < 60 ? `${value}s` : "1m"}
                </button>
              ))}
            </div>
            <button className="mt-auto flex h-9 items-center justify-center gap-1 rounded border border-border disabled:opacity-50" disabled={running} onClick={() => execute({ action: "clean_now" })}>
              <Trash2 size={14} /> Clean now
            </button>
          </div>
        </Panel>
        <Panel title="Status">
          <div className="grid h-full grid-cols-[132px_1fr] gap-3">
            <div className="relative mx-auto flex h-28 w-28 items-center justify-center">
              <svg className="-rotate-90" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="43" fill="none" stroke="currentColor" strokeWidth="8" className="text-muted/40" />
                <circle
                  cx="50"
                  cy="50"
                  r="43"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="8"
                  strokeDasharray={`${countdownProgress * 2.7} 270`}
                  strokeLinecap="round"
                  className={phase === "error" ? "text-red-500" : phase === "completed" ? "text-green-500" : "text-primary"}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                {running ? <span className="text-lg font-bold">{remainingSeconds}s</span> : <Trash2 size={28} className="text-muted-foreground" />}
                <span className="text-[10px] text-muted-foreground">{cleanCount} runs</span>
              </div>
            </div>
            <div className="grid content-center gap-2">
              <Stat label="phase" value={phase} />
              <Stat label="last clean" value={data.lastCleanTime ?? "-"} />
              <Stat label="progress" value={`${data.progress ?? 0}%`} />
            </div>
          </div>
        </Panel>
        <Panel title="Actions">
          <div className="flex h-full flex-col gap-2">
            {!running ? (
              <button className="flex flex-1 items-center justify-center gap-1 rounded bg-primary px-2 text-primary-foreground" onClick={() => execute({ action: "start", interval })}>
                <Play size={14} /> Start
              </button>
            ) : (
              <button className="flex flex-1 items-center justify-center gap-1 rounded border border-border text-red-500">
                <Square size={14} /> Running
              </button>
            )}
            <button className="flex h-8 items-center justify-center gap-1 rounded border border-border" onClick={reset}>
              <RotateCcw size={14} /> Reset
            </button>
          </div>
        </Panel>
        <Panel title="Log" action={<button title="Copy logs" onClick={copyLogs}><Copy size={13} /></button>} className="col-span-3">
          <div className="h-full overflow-auto rounded bg-muted/30 p-2 text-[11px] text-muted-foreground">
            {logs.length ? logs.slice(-12).map((line) => <div key={line}>{line}</div>) : "No logs"}
          </div>
        </Panel>
      </div>
    </div>
  )
}

function Panel(props: { title: string; icon?: ReactNode; action?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`flex min-h-0 flex-col gap-2 rounded border border-border bg-card/40 p-2 ${props.className ?? ""}`}>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1 font-semibold">{props.icon}{props.title}</span>
        {props.action ? <div className="text-muted-foreground">{props.action}</div> : null}
      </div>
      <div className="min-h-0 flex-1">{props.children}</div>
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border bg-muted/20 p-2">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="truncate font-semibold">{value}</div>
    </div>
  )
}

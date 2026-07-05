import { useMemo, useState } from "react"
import type { ReactNode } from "react"
import type { NodeCardProps, NodeRunEvent } from "@xiranite/contract"
import { Activity, Calendar, Cpu, Moon, Play, Power, RotateCcw, Square, Timer, Wifi } from "lucide-react"
import type { NetCounters, PowerMode, SleeptInput, SleeptRuntime } from "./core.js"
import { formatDuration, runSleept } from "./core.js"

interface SleeptCardState {
  timerMode?: "countdown" | "specific_time" | "netspeed" | "cpu"
  powerMode?: PowerMode
  hours?: number
  minutes?: number
  seconds?: number
  targetDatetime?: string
  uploadThreshold?: number
  downloadThreshold?: number
  netDuration?: number
  netTriggerMode?: "both" | "any"
  cpuThreshold?: number
  cpuDuration?: number
  dryrun?: boolean
}

type ResolvedSleeptCardState = Required<SleeptCardState>

export function Component({ compId, host }: NodeCardProps) {
  const data = host.getData<SleeptCardState>(compId) ?? {}
  const [phase, setPhase] = useState<"idle" | "running" | "completed" | "error" | "cancelled">("idle")
  const [progress, setProgress] = useState(0)
  const [progressText, setProgressText] = useState("")
  const [logs, setLogs] = useState<string[]>([])
  const [stats, setStats] = useState({ cpu: 0, upload: 0, download: 0 })

  const state = useMemo<ResolvedSleeptCardState>(() => ({
    timerMode: data.timerMode ?? "countdown",
    powerMode: data.powerMode ?? "sleep",
    hours: data.hours ?? 0,
    minutes: data.minutes ?? 0,
    seconds: data.seconds ?? 5,
    targetDatetime: data.targetDatetime ?? defaultTargetDatetime(),
    uploadThreshold: data.uploadThreshold ?? 242,
    downloadThreshold: data.downloadThreshold ?? 242,
    netDuration: data.netDuration ?? 2,
    netTriggerMode: data.netTriggerMode ?? "both",
    cpuThreshold: data.cpuThreshold ?? 10,
    cpuDuration: data.cpuDuration ?? 2,
    dryrun: data.dryrun ?? true,
  }), [data])

  function patch(patchData: Partial<SleeptCardState>) {
    host.patchData(compId, patchData)
  }

  function log(message: string) {
    setLogs((current) => [...current.slice(-30), message])
  }

  async function start() {
    setPhase("running")
    setProgress(0)
    setProgressText("starting")
    const input = buildInput(state)
    const onEvent = (event: NodeRunEvent) => {
      setProgress(event.progress ?? 0)
      setProgressText(event.message)
    }

    try {
      const result = host.runNode
        ? await host.runNode<SleeptInput, unknown>("sleept", input, onEvent)
        : await runSleept({ ...input, dryrun: true }, createBrowserRuntime(), onEvent)

      setPhase(result.success ? "completed" : "error")
      log(result.message)
    } catch (error) {
      setPhase("error")
      log(error instanceof Error ? error.message : String(error))
    }
  }

  async function refreshStats() {
    const result = await runSleept({ action: "get_stats" }, createBrowserRuntime())
    const data = result.data
    if (data) {
      setStats({ cpu: data.currentCpu, upload: data.currentUpload, download: data.currentDownload })
    }
  }

  function reset() {
    setPhase("idle")
    setProgress(0)
    setProgressText("")
    setLogs([])
  }

  return (
    <div className="h-full min-h-[320px] overflow-hidden p-3 text-xs font-mono">
      <div className="grid h-full min-h-0 grid-cols-[1.1fr_1.1fr_1fr] grid-rows-[132px_1fr_92px] gap-2">
        <Panel title="Mode" className="col-span-1">
          <div className="grid h-full grid-cols-2 gap-2">
            <ModeButton active={state.timerMode === "countdown"} onClick={() => patch({ timerMode: "countdown" })}><Timer size={14} /> Countdown</ModeButton>
            <ModeButton active={state.timerMode === "specific_time"} onClick={() => patch({ timerMode: "specific_time" })}><Calendar size={14} /> At time</ModeButton>
            <ModeButton active={state.timerMode === "netspeed"} onClick={() => patch({ timerMode: "netspeed" })}><Wifi size={14} /> Network</ModeButton>
            <ModeButton active={state.timerMode === "cpu"} onClick={() => patch({ timerMode: "cpu" })}><Cpu size={14} /> CPU</ModeButton>
          </div>
        </Panel>
        <Panel title="Power">
          <div className="grid h-full grid-cols-3 gap-2">
            <ModeButton active={state.powerMode === "sleep"} onClick={() => patch({ powerMode: "sleep" })}><Moon size={14} /> Sleep</ModeButton>
            <ModeButton active={state.powerMode === "shutdown"} onClick={() => patch({ powerMode: "shutdown" })}><Power size={14} /> Off</ModeButton>
            <ModeButton active={state.powerMode === "restart"} onClick={() => patch({ powerMode: "restart" })}><RotateCcw size={14} /> Reboot</ModeButton>
            <label className="col-span-3 flex items-center gap-2 rounded border border-border p-2">
              <input type="checkbox" checked={state.dryrun} onChange={(event) => patch({ dryrun: event.currentTarget.checked })} />
              Dry-run
            </label>
          </div>
        </Panel>
        <Panel title="Operation">
          <div className="flex h-full flex-col gap-2">
            <button className="flex flex-1 items-center justify-center gap-1 rounded bg-primary text-primary-foreground disabled:opacity-50" disabled={phase === "running"} onClick={start}>
              <Play size={14} /> Start
            </button>
            <button className="flex h-8 items-center justify-center gap-1 rounded border border-border" onClick={reset}>
              <Square size={14} /> Reset
            </button>
            <button className="flex h-8 items-center justify-center gap-1 rounded border border-border" onClick={refreshStats}>
              <Activity size={14} /> Refresh
            </button>
          </div>
        </Panel>
        <Panel title="Timer">
          <TimerSettings state={state} patch={patch} />
        </Panel>
        <Panel title="Status" className="col-span-2">
          <div className="flex h-full items-center gap-4">
            <div className="relative h-24 w-24 shrink-0">
              <svg viewBox="0 0 100 100" className="-rotate-90">
                <circle cx="50" cy="50" r="43" stroke="currentColor" strokeWidth="8" fill="none" className="text-muted/40" />
                <circle cx="50" cy="50" r="43" stroke="currentColor" strokeWidth="8" fill="none" strokeDasharray={`${progress * 2.7} 270`} className={phase === "error" ? "text-red-500" : phase === "completed" ? "text-green-500" : "text-primary"} />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-lg font-semibold">{progress}%</span>
                <span className="text-[10px] text-muted-foreground">{phase}</span>
              </div>
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <div className="truncate text-muted-foreground">{progressText || "waiting"}</div>
              <div className="grid grid-cols-3 gap-2">
                <Stat label="CPU" value={`${stats.cpu.toFixed(1)}%`} />
                <Stat label="UP" value={`${stats.upload.toFixed(1)}`} />
                <Stat label="DOWN" value={`${stats.download.toFixed(1)}`} />
              </div>
              <div className="text-muted-foreground">duration {formatDuration((state.hours * 3600) + (state.minutes * 60) + state.seconds)}</div>
            </div>
          </div>
        </Panel>
        <Panel title="Log" className="col-span-3">
          <div className="h-full overflow-auto rounded bg-muted/30 p-2 text-[11px] text-muted-foreground">
            {logs.length ? logs.map((line) => <div key={line}>{line}</div>) : "No logs"}
          </div>
        </Panel>
      </div>
    </div>
  )
}

function TimerSettings({ state, patch }: { state: ResolvedSleeptCardState; patch: (patchData: Partial<SleeptCardState>) => void }) {
  if (state.timerMode === "specific_time") {
    return <Input label="Target" value={state.targetDatetime} onChange={(value) => patch({ targetDatetime: value })} />
  }

  if (state.timerMode === "netspeed") {
    return (
      <div className="grid h-full grid-cols-2 gap-2">
        <Input label="Upload KB/s" value={state.uploadThreshold} onChange={(value) => patch({ uploadThreshold: Number(value) })} />
        <Input label="Download KB/s" value={state.downloadThreshold} onChange={(value) => patch({ downloadThreshold: Number(value) })} />
        <Input label="Minutes" value={state.netDuration} onChange={(value) => patch({ netDuration: Number(value) })} />
        <ModeButton active={state.netTriggerMode === "any"} onClick={() => patch({ netTriggerMode: state.netTriggerMode === "any" ? "both" : "any" })}>Trigger {state.netTriggerMode}</ModeButton>
      </div>
    )
  }

  if (state.timerMode === "cpu") {
    return (
      <div className="grid h-full grid-cols-2 gap-2">
        <Input label="Threshold %" value={state.cpuThreshold} onChange={(value) => patch({ cpuThreshold: Number(value) })} />
        <Input label="Minutes" value={state.cpuDuration} onChange={(value) => patch({ cpuDuration: Number(value) })} />
      </div>
    )
  }

  return (
    <div className="grid h-full grid-cols-3 gap-2">
      <Input label="Hours" value={state.hours} onChange={(value) => patch({ hours: Number(value) })} />
      <Input label="Minutes" value={state.minutes} onChange={(value) => patch({ minutes: Number(value) })} />
      <Input label="Seconds" value={state.seconds} onChange={(value) => patch({ seconds: Number(value) })} />
      {[5, 300, 1800].map((seconds) => (
        <button key={seconds} className="rounded border border-border" onClick={() => patch({ hours: 0, minutes: Math.floor(seconds / 60), seconds: seconds % 60 })}>{seconds < 60 ? `${seconds}s` : `${seconds / 60}m`}</button>
      ))}
    </div>
  )
}

function Panel(props: { title: string; className?: string; children: ReactNode }) {
  return (
    <section className={`flex min-h-0 flex-col gap-1 rounded border border-border bg-card/40 p-2 ${props.className ?? ""}`}>
      <div className="font-semibold">{props.title}</div>
      <div className="min-h-0 flex-1">{props.children}</div>
    </section>
  )
}

function ModeButton(props: { active?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <button className={`flex items-center justify-center gap-1 rounded border border-border p-2 ${props.active ? "bg-primary text-primary-foreground" : "bg-muted/20"}`} onClick={props.onClick}>
      {props.children}
    </button>
  )
}

function Input(props: { label: string; value: string | number; onChange: (value: string) => void }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[10px] text-muted-foreground">{props.label}</span>
      <input className="min-w-0 rounded border border-border bg-muted/30 px-2 py-1 outline-none" value={props.value} onChange={(event) => props.onChange(event.currentTarget.value)} />
    </label>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border p-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  )
}

function defaultTargetDatetime(): string {
  const value = new Date(Date.now() + 3600_000)
  const yyyy = value.getFullYear()
  const mm = String(value.getMonth() + 1).padStart(2, "0")
  const dd = String(value.getDate()).padStart(2, "0")
  const hh = String(value.getHours()).padStart(2, "0")
  const mi = String(value.getMinutes()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:00`
}

function buildInput(state: ResolvedSleeptCardState): SleeptInput {
  return {
    action: state.timerMode,
    powerMode: state.powerMode,
    hours: state.hours,
    minutes: state.minutes,
    seconds: state.seconds,
    targetDatetime: state.targetDatetime,
    uploadThreshold: state.uploadThreshold,
    downloadThreshold: state.downloadThreshold,
    netDuration: state.netDuration,
    netTriggerMode: state.netTriggerMode,
    cpuThreshold: state.cpuThreshold,
    cpuDuration: state.cpuDuration,
    dryrun: state.dryrun,
  }
}

function createBrowserRuntime(): SleeptRuntime {
  let sent = 0
  let received = 0
  return {
    now: () => new Date(),
    sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    getCpuPercent: () => 0,
    getNetCounters: (): NetCounters => {
      sent += 1024
      received += 1024
      return { bytesSent: sent, bytesReceived: received }
    },
    executePowerAction: () => {},
  }
}

import { useMemo, useState } from "react"
import type { NodeComponentProps, NodeRunEvent } from "@xiranite/contract"
import { Activity, Calendar, Cpu, Moon, Play, Power, RotateCcw, Square, Timer, Wifi } from "lucide-react"
import { ActionButton, Field, LogView, NodeBody, NodeContent, NodeFooter, NodeHeader, SegmentButton, StatPill } from "@xiranite/ui"
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

export function Component({ compId, host }: NodeComponentProps) {
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
      const result = await runSleept({ ...input, dryrun: true }, createBrowserRuntime(), onEvent)

      setPhase(result.success ? "completed" : "error")
      log(result.message)
    } catch (error) {
      setPhase("error")
      log(error instanceof Error ? error.message : String(error))
    }
  }

  async function refreshStats() {
    const result = await runSleept({ action: "get_stats" }, createBrowserRuntime())
    const next = result.data
    if (next) setStats({ cpu: next.currentCpu, upload: next.currentUpload, download: next.currentDownload })
  }

  function reset() {
    setPhase("idle")
    setProgress(0)
    setProgressText("")
    setLogs([])
  }

  const durationSeconds = state.hours * 3600 + state.minutes * 60 + state.seconds

  return (
    <NodeContent>
      <NodeHeader
        title="sleept"
        meta={`${state.timerMode} / ${state.powerMode} / ${state.dryrun ? "dry-run" : "live"}`}
        actions={
          <>
            <ActionButton variant="primary" disabled={phase === "running"} onClick={start}><Play size={14} /> Start</ActionButton>
            <ActionButton onClick={refreshStats}><Activity size={14} /> Stats</ActionButton>
            <ActionButton onClick={reset}><Square size={14} /> Reset</ActionButton>
          </>
        }
      />

      <NodeBody className="flex flex-col gap-2">
        <div className="flex shrink-0 flex-wrap gap-1">
          <SegmentButton active={state.timerMode === "countdown"} onClick={() => patch({ timerMode: "countdown" })}><Timer size={14} /> Countdown</SegmentButton>
          <SegmentButton active={state.timerMode === "specific_time"} onClick={() => patch({ timerMode: "specific_time" })}><Calendar size={14} /> At</SegmentButton>
          <SegmentButton active={state.timerMode === "netspeed"} onClick={() => patch({ timerMode: "netspeed" })}><Wifi size={14} /> Net</SegmentButton>
          <SegmentButton active={state.timerMode === "cpu"} onClick={() => patch({ timerMode: "cpu" })}><Cpu size={14} /> CPU</SegmentButton>
        </div>

        <div className="flex shrink-0 flex-wrap gap-1">
          <SegmentButton active={state.powerMode === "sleep"} onClick={() => patch({ powerMode: "sleep" })}><Moon size={14} /> Sleep</SegmentButton>
          <SegmentButton active={state.powerMode === "shutdown"} onClick={() => patch({ powerMode: "shutdown" })}><Power size={14} /> Off</SegmentButton>
          <SegmentButton active={state.powerMode === "restart"} onClick={() => patch({ powerMode: "restart" })}><RotateCcw size={14} /> Reboot</SegmentButton>
          <SegmentButton active={state.dryrun} onClick={() => patch({ dryrun: !state.dryrun })}>Dry</SegmentButton>
        </div>

        <div className="min-h-0 flex flex-1 flex-col gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <TimerSettings state={state} patch={patch} />
            <div className="flex flex-wrap gap-1">
              <StatPill label="duration" value={formatDuration(durationSeconds)} tone="accent" />
              <StatPill label="cpu" value={`${stats.cpu.toFixed(1)}%`} />
              <StatPill label="up" value={stats.upload.toFixed(1)} />
              <StatPill label="down" value={stats.download.toFixed(1)} />
            </div>
            <div className="truncate text-[11px] text-muted-foreground">{progressText || "waiting"}</div>
          </div>
          <ProgressRing progress={progress} phase={phase} />
        </div>
      </NodeBody>

      <NodeFooter>
        <LogView lines={logs} className="h-14" />
      </NodeFooter>
    </NodeContent>
  )
}

function TimerSettings({ state, patch }: { state: ResolvedSleeptCardState; patch: (patchData: Partial<SleeptCardState>) => void }) {
  if (state.timerMode === "specific_time") {
    return <Field label="target datetime" value={state.targetDatetime} onChange={(event) => patch({ targetDatetime: event.currentTarget.value })} />
  }

  if (state.timerMode === "netspeed") {
    return (
      <div className="flex flex-wrap gap-1">
        <Field label="upload" value={state.uploadThreshold} onChange={(event) => patch({ uploadThreshold: Number(event.currentTarget.value) })} />
        <Field label="download" value={state.downloadThreshold} onChange={(event) => patch({ downloadThreshold: Number(event.currentTarget.value) })} />
        <Field label="minutes" value={state.netDuration} onChange={(event) => patch({ netDuration: Number(event.currentTarget.value) })} />
        <SegmentButton active={state.netTriggerMode === "any"} onClick={() => patch({ netTriggerMode: state.netTriggerMode === "any" ? "both" : "any" })}>{state.netTriggerMode}</SegmentButton>
      </div>
    )
  }

  if (state.timerMode === "cpu") {
    return (
      <div className="flex flex-wrap gap-1">
        <Field label="threshold %" value={state.cpuThreshold} onChange={(event) => patch({ cpuThreshold: Number(event.currentTarget.value) })} />
        <Field label="minutes" value={state.cpuDuration} onChange={(event) => patch({ cpuDuration: Number(event.currentTarget.value) })} />
      </div>
    )
  }

  return (
    <div className="flex flex-wrap gap-1">
      <Field label="hours" value={state.hours} onChange={(event) => patch({ hours: Number(event.currentTarget.value) })} />
      <Field label="minutes" value={state.minutes} onChange={(event) => patch({ minutes: Number(event.currentTarget.value) })} />
      <Field label="seconds" value={state.seconds} onChange={(event) => patch({ seconds: Number(event.currentTarget.value) })} />
    </div>
  )
}

function ProgressRing({ progress, phase }: { progress: number; phase: string }) {
  return (
    <div className="relative h-24 w-24 shrink-0 self-center">
      <svg viewBox="0 0 100 100" className="-rotate-90">
        <circle cx="50" cy="50" r="43" stroke="currentColor" strokeWidth="8" fill="none" className="text-muted/40" />
        <circle cx="50" cy="50" r="43" stroke="currentColor" strokeWidth="8" fill="none" strokeDasharray={`${progress * 2.7} 270`} className={phase === "error" ? "text-red-500" : phase === "completed" ? "text-green-500" : "text-primary"} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-semibold">{progress}%</span>
        <span className="text-[10px] text-muted-foreground">{phase}</span>
      </div>
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

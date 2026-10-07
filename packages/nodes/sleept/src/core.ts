import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import { countdownSeconds, formatDuration } from "./duration.js"
import { parseTargetDatetime, type PowerMode, type NetTriggerMode } from "./schedule.js"

/** The GUI face reads the duration helpers through this subpath; `duration.ts` is the one implementation, and
 * the terminal faces import that module directly because a value import here would put a core in their process. */
export { countdownSeconds, formatDuration } from "./duration.js"

/**
 * Same reason for the vocabulary and its parser: `schedule.ts` defines them, `interaction.ts` imports them
 * from there, and this re-export keeps `@xiranite/node-sleept/core` answering with the names it always did.
 */
export { parseTargetDatetime, POWER_MODE_VALUES, type NetTriggerMode, type PowerMode } from "./schedule.js"

export type SleeptAction = "status" | "countdown" | "specific_time" | "netspeed" | "cpu" | "get_stats"
export interface SleeptInput {
  action?: SleeptAction
  powerMode?: PowerMode
  hours?: number
  minutes?: number
  seconds?: number
  targetDatetime?: string
  uploadThreshold?: number
  downloadThreshold?: number
  netDuration?: number
  netTriggerMode?: NetTriggerMode
  cpuThreshold?: number
  cpuDuration?: number
  dryrun?: boolean
  maxWaitSeconds?: number
}

export interface SleeptData {
  timerStatus: "idle" | "running" | "completed" | "cancelled"
  remainingSeconds: number
  currentUpload: number
  currentDownload: number
  currentCpu: number
  targetTime?: string
}

export interface NetCounters {
  bytesSent: number
  bytesReceived: number
}

export interface SleeptRuntime {
  now: () => Date
  sleep: (milliseconds: number) => Promise<void>
  /** How busy the machine is, from the host's `os` service. An unanswerable reading is a failed call, not a value. */
  getCpuPercent: () => Promise<number> | number
  getNetCounters: () => Promise<NetCounters> | NetCounters
  executePowerAction: (mode: PowerMode, dryrun: boolean) => Promise<void> | void
  isCancelled?: () => boolean
  waitWhilePaused?: () => Promise<void>
}

export type SleeptResult = NodeRunResult<SleeptData>

export const defaultSleeptInput: Required<Omit<SleeptInput, "targetDatetime">> & { targetDatetime?: string } = {
  action: "status",
  powerMode: "sleep",
  hours: 0,
  minutes: 0,
  seconds: 5,
  targetDatetime: undefined,
  uploadThreshold: 242,
  downloadThreshold: 242,
  netDuration: 2,
  netTriggerMode: "both",
  cpuThreshold: 10,
  cpuDuration: 2,
  dryrun: true,
  maxWaitSeconds: 3600,
}

export async function runSleept(
  rawInput: SleeptInput,
  runtime: SleeptRuntime,
  onEvent?: (event: NodeRunEvent) => void,
): Promise<SleeptResult> {
  const input = normalizeInput(rawInput)

  if (input.action === "status") {
    return statusResult(await runtime.getCpuPercent())
  }

  if (input.action === "get_stats") {
    return getStats(runtime)
  }

  if (input.action === "countdown") {
    return runCountdown(input, runtime, onEvent)
  }

  if (input.action === "specific_time") {
    return runSpecificTime(input, runtime, onEvent)
  }

  if (input.action === "netspeed") {
    return runNetSpeedMonitor(input, runtime, onEvent)
  }

  if (input.action === "cpu") {
    return runCpuMonitor(input, runtime, onEvent)
  }

  return {
    success: false,
    message: `Unknown action: ${input.action}`,
    data: idleData(),
  }
}

export function normalizeInput(raw: SleeptInput): Required<SleeptInput> {
  return {
    ...defaultSleeptInput,
    ...raw,
    action: raw.action ?? defaultSleeptInput.action,
    powerMode: raw.powerMode ?? defaultSleeptInput.powerMode,
    targetDatetime: raw.targetDatetime ?? "",
    maxWaitSeconds: Math.max(0, Math.trunc(raw.maxWaitSeconds ?? defaultSleeptInput.maxWaitSeconds)),
  }
}

async function runCountdown(
  input: Required<SleeptInput>,
  runtime: SleeptRuntime,
  onEvent?: (event: NodeRunEvent) => void,
): Promise<SleeptResult> {
  const totalSeconds = countdownSeconds(input)
  if (totalSeconds <= 0) {
    return { success: false, message: "Countdown duration must be greater than zero.", data: idleData() }
  }

  const target = new Date(runtime.now().getTime() + totalSeconds * 1000)
  if (!await tickCountdown(totalSeconds, runtime, onEvent)) {
    return countdownCancelled("Countdown")
  }
  await runtime.executePowerAction(input.powerMode, input.dryrun)

  return {
    success: true,
    message: input.dryrun ? `[dryrun] Countdown completed; simulated ${input.powerMode}.` : `Countdown completed; executed ${input.powerMode}.`,
    data: {
      ...idleData(),
      timerStatus: "completed",
      targetTime: formatDatetime(target),
    },
  }
}

async function runSpecificTime(
  input: Required<SleeptInput>,
  runtime: SleeptRuntime,
  onEvent?: (event: NodeRunEvent) => void,
): Promise<SleeptResult> {
  const target = parseTargetDatetime(input.targetDatetime, runtime.now())
  const totalSeconds = Math.ceil((target.getTime() - runtime.now().getTime()) / 1000)
  if (!await tickCountdown(totalSeconds, runtime, onEvent)) {
    return countdownCancelled("Scheduled timer")
  }
  await runtime.executePowerAction(input.powerMode, input.dryrun)

  return {
    success: true,
    message: input.dryrun ? `[dryrun] Scheduled time reached; simulated ${input.powerMode}.` : `Scheduled time reached; executed ${input.powerMode}.`,
    data: {
      ...idleData(),
      timerStatus: "completed",
      targetTime: formatDatetime(target),
    },
  }
}

async function runNetSpeedMonitor(
  input: Required<SleeptInput>,
  runtime: SleeptRuntime,
  onEvent?: (event: NodeRunEvent) => void,
): Promise<SleeptResult> {
  const durationSeconds = Math.max(1, input.netDuration * 60)
  let last = await runtime.getNetCounters()
  let lastTime = runtime.now().getTime()
  let lowStart: number | null = null

  for (let elapsedTotal = 0; input.maxWaitSeconds === 0 || elapsedTotal < input.maxWaitSeconds; elapsedTotal += 1) {
    await runtime.waitWhilePaused?.()
    if (runtime.isCancelled?.()) return monitorCancelled("Network")
    await runtime.sleep(1000)
    if (runtime.isCancelled?.()) return monitorCancelled("Network")
    const nowCounters = await runtime.getNetCounters()
    const nowTime = runtime.now().getTime()
    const intervalSeconds = Math.max(0.001, (nowTime - lastTime) / 1000)
    const upload = (nowCounters.bytesSent - last.bytesSent) / intervalSeconds / 1024
    const download = (nowCounters.bytesReceived - last.bytesReceived) / intervalSeconds / 1024
    const lowUp = upload < input.uploadThreshold
    const lowDown = download < input.downloadThreshold
    const triggered = input.netTriggerMode === "both" ? lowUp && lowDown : lowUp || lowDown

    if (triggered) {
      lowStart ??= nowTime
      const elapsed = (nowTime - lowStart) / 1000
      const progress = Math.min(99, Math.floor((elapsed / durationSeconds) * 100))
      onEvent?.({ type: "progress", progress, message: `low network ${Math.floor(elapsed)}s/${Math.floor(durationSeconds)}s (up ${upload.toFixed(1)} down ${download.toFixed(1)} KB/s)` })

      if (elapsed >= durationSeconds) {
        await runtime.executePowerAction(input.powerMode, input.dryrun)
        return {
          success: true,
          message: input.dryrun ? `[dryrun] Network monitor triggered; simulated ${input.powerMode}.` : `Network monitor triggered; executed ${input.powerMode}.`,
          data: { ...idleData(), timerStatus: "completed", currentUpload: upload, currentDownload: download },
        }
      }
    } else {
      lowStart = null
      onEvent?.({ type: "progress", progress: 0, message: `monitoring network (up ${upload.toFixed(1)} down ${download.toFixed(1)} KB/s)` })
    }

    last = nowCounters
    lastTime = nowTime
  }

  return { success: false, message: "Network monitor timed out.", data: { ...idleData(), timerStatus: "cancelled" } }
}

async function runCpuMonitor(
  input: Required<SleeptInput>,
  runtime: SleeptRuntime,
  onEvent?: (event: NodeRunEvent) => void,
): Promise<SleeptResult> {
  const durationSeconds = Math.max(1, input.cpuDuration * 60)
  let lowStart: number | null = null

  for (let elapsedTotal = 0; input.maxWaitSeconds === 0 || elapsedTotal < input.maxWaitSeconds; elapsedTotal += 1) {
    await runtime.waitWhilePaused?.()
    if (runtime.isCancelled?.()) return monitorCancelled("CPU")
    await runtime.sleep(1000)
    if (runtime.isCancelled?.()) return monitorCancelled("CPU")
    // The reading is asked for on purpose *after* the wait and the cancel checks: a host that refuses is an
    // error that ends the run, which is the only safe answer for a monitor whose whole job is to wait until
    // the machine is idle. An unknown load must never read as a low one.
    const cpu = await runtime.getCpuPercent()
    const nowTime = runtime.now().getTime()

    if (cpu < input.cpuThreshold) {
      lowStart ??= nowTime
      const elapsed = (nowTime - lowStart) / 1000
      const progress = Math.min(99, Math.floor((elapsed / durationSeconds) * 100))
      onEvent?.({ type: "progress", progress, message: `low CPU ${cpu.toFixed(1)}% ${Math.floor(elapsed)}s/${Math.floor(durationSeconds)}s` })

      if (elapsed >= durationSeconds) {
        await runtime.executePowerAction(input.powerMode, input.dryrun)
        return {
          success: true,
          message: input.dryrun ? `[dryrun] CPU monitor triggered; simulated ${input.powerMode}.` : `CPU monitor triggered; executed ${input.powerMode}.`,
          data: { ...idleData(), timerStatus: "completed", currentCpu: cpu },
        }
      }
    } else {
      lowStart = null
      onEvent?.({ type: "progress", progress: 0, message: `monitoring CPU ${cpu.toFixed(1)}%` })
    }
  }

  return { success: false, message: "CPU monitor timed out.", data: { ...idleData(), timerStatus: "cancelled" } }
}

function monitorCancelled(kind: "Network" | "CPU"): SleeptResult {
  return {
    success: false,
    message: `${kind} monitor cancelled.`,
    data: { ...idleData(), timerStatus: "cancelled" },
  }
}

function countdownCancelled(kind: "Countdown" | "Scheduled timer"): SleeptResult {
  return {
    success: false,
    message: `${kind} cancelled.`,
    data: { ...idleData(), timerStatus: "cancelled" },
  }
}

async function tickCountdown(totalSeconds: number, runtime: SleeptRuntime, onEvent?: (event: NodeRunEvent) => void): Promise<boolean> {
  for (let remaining = totalSeconds; remaining > 0; remaining -= 1) {
    await runtime.waitWhilePaused?.()
    if (runtime.isCancelled?.()) return false
    const progress = Math.floor((1 - remaining / totalSeconds) * 100)
    onEvent?.({ type: "progress", progress, message: `remaining ${formatDuration(remaining)}` })
    await runtime.sleep(1000)
    if (runtime.isCancelled?.()) return false
  }
  onEvent?.({ type: "progress", progress: 100, message: "time reached" })
  return true
}

async function getStats(runtime: SleeptRuntime): Promise<SleeptResult> {
  const first = await runtime.getNetCounters()
  await runtime.sleep(500)
  const second = await runtime.getNetCounters()
  const cpu = await runtime.getCpuPercent()
  const upload = (second.bytesSent - first.bytesSent) / 0.5 / 1024
  const download = (second.bytesReceived - first.bytesReceived) / 0.5 / 1024

  return {
    success: true,
    message: `CPU: ${cpu.toFixed(1)}%, upload: ${upload.toFixed(1)}KB/s, download: ${download.toFixed(1)}KB/s`,
    data: { ...idleData(), currentCpu: cpu, currentUpload: upload, currentDownload: download },
  }
}

function statusResult(cpu: number): SleeptResult {
  return {
    success: true,
    message: "Status ready.",
    data: { ...idleData(), currentCpu: cpu },
  }
}

function idleData(): SleeptData {
  return {
    timerStatus: "idle",
    remainingSeconds: 0,
    currentUpload: 0,
    currentDownload: 0,
    currentCpu: 0,
  }
}

function formatDatetime(value: Date): string {
  const yyyy = value.getFullYear()
  const mm = String(value.getMonth() + 1).padStart(2, "0")
  const dd = String(value.getDate()).padStart(2, "0")
  const hh = String(value.getHours()).padStart(2, "0")
  const mi = String(value.getMinutes()).padStart(2, "0")
  const ss = String(value.getSeconds()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`
}

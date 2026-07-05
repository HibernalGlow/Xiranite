import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"

export type RecycleuAction = "status" | "clean_now" | "start"
export type RecycleuTimerStatus = "idle" | "running" | "completed" | "error"
export type RecycleBinStatus = "cleaned" | "empty" | "unsupported" | "failed"

export interface RecycleuInput {
  action?: RecycleuAction
  interval?: number
  maxCycles?: number
}

export interface EmptyRecycleBinResult {
  status: RecycleBinStatus
  message: string
}

export interface RecycleuRuntime {
  now: () => Date
  sleep: (milliseconds: number) => Promise<void>
  emptyRecycleBin: () => Promise<EmptyRecycleBinResult>
}

export interface RecycleuState {
  timerStatus: RecycleuTimerStatus
  cleanCount: number
  lastCleanTime: string | null
}

export interface RecycleuData extends RecycleuState {
  remainingSeconds: number
}

export type RecycleuResult = NodeRunResult<RecycleuData>

export const DEFAULT_RECYCLEU_STATE: RecycleuState = {
  timerStatus: "idle",
  cleanCount: 0,
  lastCleanTime: null,
}

export function normalizeRecycleuInput(input: RecycleuInput): Required<RecycleuInput> {
  return {
    action: input.action ?? "status",
    interval: Math.max(1, Math.trunc(input.interval ?? 10)),
    maxCycles: Math.max(1, Math.trunc(input.maxCycles ?? 360)),
  }
}

export function formatClock(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export async function runRecycleu(
  input: RecycleuInput,
  runtime: RecycleuRuntime,
  onEvent: (event: NodeRunEvent) => void = () => {},
  initialState: RecycleuState = DEFAULT_RECYCLEU_STATE,
): Promise<RecycleuResult> {
  const normalized = normalizeRecycleuInput(input)
  const state: RecycleuState = { ...initialState }

  if (normalized.action === "status") {
    return {
      success: true,
      message: "Recycle cleaner is idle.",
      data: { ...state, remainingSeconds: 0 },
    }
  }

  if (normalized.action === "clean_now") {
    return cleanOnce(runtime, state, onEvent)
  }

  if (normalized.interval < 5) {
    return {
      success: false,
      message: "Clean interval cannot be less than 5 seconds.",
      data: { ...state, timerStatus: "error", remainingSeconds: 0 },
    }
  }

  state.timerStatus = "running"
  onEvent({ type: "log", message: `Start auto-clean, interval ${normalized.interval}s.` })

  for (let cycle = 0; cycle < normalized.maxCycles; cycle += 1) {
    const cleanResult = await cleanOnce(runtime, state, onEvent, false)
    if (!cleanResult.success) {
      return cleanResult
    }

    for (let remaining = normalized.interval; remaining > 0; remaining -= 1) {
      const progress = Math.min(99, Math.round(((cycle + (normalized.interval - remaining) / normalized.interval) / normalized.maxCycles) * 100))
      onEvent({
        type: "progress",
        progress,
        message: `cleaned ${state.cleanCount} time(s), next clean in ${remaining}s`,
      })
      await runtime.sleep(1000)
    }
  }

  state.timerStatus = "completed"
  onEvent({ type: "progress", progress: 100, message: "Auto-clean completed." })

  return {
    success: true,
    message: `Auto-clean completed, cleaned ${state.cleanCount} time(s).`,
    data: { ...state, remainingSeconds: 0 },
  }
}

async function cleanOnce(
  runtime: RecycleuRuntime,
  state: RecycleuState,
  onEvent: (event: NodeRunEvent) => void,
  setIdle = true,
): Promise<RecycleuResult> {
  const result = await runtime.emptyRecycleBin()
  const success = result.status === "cleaned" || result.status === "empty"

  if (result.status === "cleaned") {
    state.cleanCount += 1
    state.lastCleanTime = formatClock(runtime.now())
  }

  if (setIdle) {
    state.timerStatus = success ? "idle" : "error"
  }

  onEvent({ type: success ? "log" : "progress", progress: success ? undefined : 100, message: result.message })

  return {
    success,
    message: result.message,
    data: { ...state, remainingSeconds: 0 },
  }
}

const DEBUG_STORAGE_KEY = "xiranite.startupDebug"
const MAX_EVENTS = 500
const MAX_REMOTE_EVENTS = 200
const MAX_LONG_TASK_EVENTS = 50
const REMOTE_FLUSH_DELAY_MS = 100
const REMOTE_BATCH_SIZE = 20

export interface StartupDebugEvent {
  sequence: number
  elapsedMs: number
  label: string
  detail?: unknown
}

interface StartupDebugController {
  enabled: true
  startedAt: number
  events: StartupDebugEvent[]
  mark: (label: string, detail?: unknown) => void
}

declare global {
  interface Window {
    __xiraniteDebug?: StartupDebugController
  }
}

let installed = false
let sequence = 0
let remoteFlushTimer: number | undefined
let pendingRemoteEvents: StartupDebugEvent[] = []

export function isStartupDebugEnabled(): boolean {
  if (!import.meta.env.DEV || typeof window === "undefined") return false

  const params = new URLSearchParams(window.location.search)
  if (params.get("debug") === "1" || params.get("xiraniteDebug") === "1") return true

  try {
    return window.localStorage.getItem(DEBUG_STORAGE_KEY) === "1"
  } catch {
    return false
  }
}

export function installStartupDebug(): void {
  if (installed || !isStartupDebugEnabled()) return
  installed = true

  const startedAt = performance.now()
  const events: StartupDebugEvent[] = []
  const controller: StartupDebugController = {
    enabled: true,
    startedAt,
    events,
    mark: startupDebug,
  }
  window.__xiraniteDebug = controller

  window.addEventListener("error", (event) => {
    startupDebug("window:error", {
      message: event.message,
      filename: event.filename,
      line: event.lineno,
      column: event.colno,
      error: event.error,
    })
  })
  window.addEventListener("unhandledrejection", (event) => {
    startupDebug("window:unhandled-rejection", event.reason)
  })

  let expected = performance.now() + 250
  window.setInterval(() => {
    const now = performance.now()
    const lagMs = now - expected
    expected = now + 250
    if (lagMs >= 250) {
      startupDebug("event-loop:blocked", {
        lagMs: Math.round(lagMs),
        visibilityState: document.visibilityState,
        focused: document.hasFocus(),
      })
    }
  }, 250)

  observeLongTasks()

  startupDebug("debug:installed", { href: window.location.href })
}

function observeLongTasks(): void {
  if (typeof PerformanceObserver === "undefined") return

  let observed = 0
  try {
    const observer = new PerformanceObserver((entries) => {
      for (const entry of entries.getEntries()) {
        if (observed >= MAX_LONG_TASK_EVENTS) {
          observer.disconnect()
          return
        }
        observed += 1
        startupDebug("performance:long-task", {
          durationMs: Math.round(entry.duration * 10) / 10,
          startMs: Math.round(entry.startTime * 10) / 10,
          name: entry.name,
        })
      }
    })
    observer.observe({ type: "longtask", buffered: true })
  } catch {
    // Chromium may not expose Long Task entries in every WebView build.
  }
}

export function startupDebug(label: string, detail?: unknown): void {
  // React render markers can fire for every store subscription update. Keeping
  // them in DevTools or forwarding them to the local log server makes debug
  // mode itself capable of starving the page being diagnosed.
  if (isHotDebugLabel(label)) return

  const controller = typeof window !== "undefined" ? window.__xiraniteDebug : undefined
  if (!controller) return

  const event: StartupDebugEvent = {
    sequence: ++sequence,
    elapsedMs: Math.round((performance.now() - controller.startedAt) * 10) / 10,
    label,
    ...(detail === undefined ? {} : { detail }),
  }
  controller.events.push(event)
  if (controller.events.length > MAX_EVENTS) controller.events.shift()

  const prefix = `[xiranite debug #${event.sequence} +${event.elapsedMs}ms] ${label}`
  if (detail === undefined) console.info(prefix)
  else console.info(prefix, detail)

  if (event.sequence <= MAX_REMOTE_EVENTS) enqueueRemoteDebugEvent(event)
}

function enqueueRemoteDebugEvent(event: StartupDebugEvent): void {
  pendingRemoteEvents.push({
    ...event,
    ...(event.detail === undefined ? {} : { detail: summarizeDetail(event.detail) }),
  })
  if (remoteFlushTimer !== undefined) return
  remoteFlushTimer = window.setTimeout(flushRemoteDebugEvents, REMOTE_FLUSH_DELAY_MS)
}

function flushRemoteDebugEvents(): void {
  remoteFlushTimer = undefined
  const events = pendingRemoteEvents.splice(0, REMOTE_BATCH_SIZE)
  if (!events.length) return
  void fetch("/__xiranite-debug-log", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ events }),
    keepalive: true,
  }).catch(() => undefined)
  if (pendingRemoteEvents.length) {
    remoteFlushTimer = window.setTimeout(flushRemoteDebugEvents, 0)
  }
}

export function startupDebugAsync<T>(label: string, operation: () => T | PromiseLike<T>): Promise<T> {
  startupDebug(`${label}:begin`)
  const startedAt = performance.now()
  let result: T | PromiseLike<T>
  try {
    result = operation()
  } catch (error) {
    startupDebug(`${label}:error`, {
      durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
      error,
    })
    return Promise.reject(error)
  }

  return Promise.resolve(result).then(
    (result) => {
      startupDebug(`${label}:end`, { durationMs: Math.round((performance.now() - startedAt) * 10) / 10 })
      return result
    },
    (error) => {
      startupDebug(`${label}:error`, {
        durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
        error,
      })
      throw error
    },
  )
}

installStartupDebug()

function summarizeDetail(detail: unknown): unknown {
  if (detail instanceof Error) return { name: detail.name, message: detail.message, stack: detail.stack }
  try {
    return JSON.parse(JSON.stringify(detail)) as unknown
  } catch {
    return String(detail)
  }
}

function isHotDebugLabel(label: string): boolean {
  return label.startsWith("react:") && label.includes("render")
    || label.includes("progressive-step")
    || label.includes("page-image:")
}

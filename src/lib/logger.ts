import { createConsola, LogLevels, type ConsolaInstance, type ConsolaReporter, type LogObject } from "consola"

export const LOG_LEVEL_STORAGE_KEY = "xiranite.log.level"

const LEGACY_DEBUG_STORAGE_KEY = "xiranite.startupDebug"
const REMOTE_ENDPOINT = "/__xiranite-log"
const REMOTE_BATCH_SIZE = 20
const REMOTE_EVENT_LIMIT = 500
const REMOTE_FLUSH_DELAY_MS = 100

export const xiraniteLogLevels = ["silent", "error", "warn", "info", "debug", "trace"] as const

export type XiraniteLogLevel = typeof xiraniteLogLevels[number]
export type XiraniteLogger = ConsolaInstance

interface XiraniteLogController {
  getLevel: () => XiraniteLogLevel
  setLevel: (level: XiraniteLogLevel) => void
  reset: () => void
}

declare global {
  interface Window {
    __xiraniteLog?: XiraniteLogController
  }
}

const loggers = new Map<string, ConsolaInstance>()
const levelListeners = new Set<(level: XiraniteLogLevel) => void>()
const remoteReporter = createRemoteReporter()
const rootLogger = createConsola({
  level: LogLevels.warn,
})

if (remoteReporter) rootLogger.addReporter(remoteReporter)

let currentLevel = resolveInitialLogLevel()
applyLevel(currentLevel)

export function createLogger(scope: string): XiraniteLogger {
  const normalizedScope = scope.trim() || "app"
  const cached = loggers.get(normalizedScope)
  if (cached) return cached

  const logger = rootLogger.withTag(`xiranite:${normalizedScope}`)
  logger.level = LogLevels[currentLevel]
  loggers.set(normalizedScope, logger)
  return logger
}

export function getLogLevel(): XiraniteLogLevel {
  return currentLevel
}

export function isLogLevelEnabled(level: Exclude<XiraniteLogLevel, "silent">): boolean {
  return LogLevels[level] <= LogLevels[currentLevel]
}

export function setLogLevel(level: XiraniteLogLevel, options: { persist?: boolean } = {}): void {
  if (!isXiraniteLogLevel(level)) throw new TypeError(`Unsupported Xiranite log level: ${String(level)}`)
  currentLevel = level
  applyLevel(level)
  notifyLevelListeners(level)

  if (options.persist !== false && typeof window !== "undefined") {
    try {
      window.localStorage.setItem(LOG_LEVEL_STORAGE_KEY, level)
      window.localStorage.removeItem(LEGACY_DEBUG_STORAGE_KEY)
    } catch {
      // Storage can be unavailable in private or restricted WebViews.
    }
  }
}

export function resetLogLevel(): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(LOG_LEVEL_STORAGE_KEY)
      window.localStorage.removeItem(LEGACY_DEBUG_STORAGE_KEY)
    } catch {
      // Storage can be unavailable in private or restricted WebViews.
    }
  }
  currentLevel = defaultLogLevel()
  applyLevel(currentLevel)
  notifyLevelListeners(currentLevel)
}

export function onLogLevelChange(listener: (level: XiraniteLogLevel) => void): () => void {
  levelListeners.add(listener)
  listener(currentLevel)
  return () => levelListeners.delete(listener)
}

function installLogController(): void {
  if (typeof window === "undefined") return
  window.__xiraniteLog = {
    getLevel: getLogLevel,
    setLevel: setLogLevel,
    reset: resetLogLevel,
  }
}

function applyLevel(level: XiraniteLogLevel): void {
  const numericLevel = LogLevels[level]
  rootLogger.level = numericLevel
  for (const logger of loggers.values()) logger.level = numericLevel
}

function notifyLevelListeners(level: XiraniteLogLevel): void {
  for (const listener of levelListeners) listener(level)
}

function resolveInitialLogLevel(): XiraniteLogLevel {
  if (typeof window === "undefined") return defaultLogLevel()

  const params = new URLSearchParams(window.location.search)
  const queryLevel = params.get("log")
  if (isXiraniteLogLevel(queryLevel)) return queryLevel
  if (params.get("debug") === "1" || params.get("xiraniteDebug") === "1") return "debug"

  try {
    const storedLevel = window.localStorage.getItem(LOG_LEVEL_STORAGE_KEY)
    if (isXiraniteLogLevel(storedLevel)) return storedLevel
    if (window.localStorage.getItem(LEGACY_DEBUG_STORAGE_KEY) === "1") return "debug"
  } catch {
    // Fall through to the environment default.
  }

  return defaultLogLevel()
}

function defaultLogLevel(): XiraniteLogLevel {
  return "warn"
}

function isXiraniteLogLevel(value: unknown): value is XiraniteLogLevel {
  return typeof value === "string" && (xiraniteLogLevels as readonly string[]).includes(value)
}

function createRemoteReporter(): ConsolaReporter | undefined {
  if (!import.meta.env.DEV || typeof window === "undefined") return undefined

  let sentEvents = 0
  let flushTimer: number | undefined
  let pendingEvents: unknown[] = []

  const flush = () => {
    flushTimer = undefined
    const events = pendingEvents.splice(0, REMOTE_BATCH_SIZE)
    if (!events.length) return
    void fetch(REMOTE_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ events }),
      keepalive: true,
    }).catch(() => undefined)
    if (pendingEvents.length) flushTimer = window.setTimeout(flush, 0)
  }

  return {
    log(logObject: LogObject) {
      if (sentEvents >= REMOTE_EVENT_LIMIT) return
      sentEvents += 1
      pendingEvents.push(serializeLogObject(logObject))
      if (flushTimer === undefined) flushTimer = window.setTimeout(flush, REMOTE_FLUSH_DELAY_MS)
    },
  }
}

function serializeLogObject(logObject: LogObject): unknown {
  return {
    timestamp: logObject.date.toISOString(),
    level: logObject.level,
    type: logObject.type,
    scope: logObject.tag,
    message: logObject.message,
    args: logObject.args.map(serializeLogValue),
  }
}

function serializeLogValue(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      ...(value.cause === undefined ? {} : { cause: serializeLogValue(value.cause) }),
    }
  }
  try {
    return JSON.parse(JSON.stringify(value)) as unknown
  } catch {
    return String(value)
  }
}

installLogController()

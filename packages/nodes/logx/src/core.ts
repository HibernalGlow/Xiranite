import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import { aggregateLogs, queryLogs, type LogAggregate, type LogEnvelope, type LogQuery, type LogSeverityText } from "@xiranite/logging"

export type LogxAction = "query" | "sessions" | "stats" | "errors" | "doctor"

export interface LogxInput {
  action?: LogxAction
  directory?: string
  minimumSeverity?: LogSeverityText
  scope?: string
  eventName?: string
  sessionId?: string
  search?: string
  since?: string
  until?: string
  limit?: number
  order?: "asc" | "desc"
}

export interface LogxReadResult {
  directory: string
  events: LogEnvelope[]
  issues: Array<{ file: string; lineNumber: number; code: string; message: string }>
  files: string[]
}

export interface LogxRuntime {
  read(input: { directory?: string }): Promise<LogxReadResult>
}

export interface LogxSessionSummary {
  id: string
  startedAt: string
  eventCount: number
  errorCount: number
  processTypes: string[]
  scopes: string[]
}

export interface LogxAnomalyCell {
  index: number
  eventCount: number
  weightedScore: number
  intensity: number
}

export interface LogxTelemetry {
  durationMs: number
  eventsPerSecond: number
  stormIntensity: number
  anomalyCells: LogxAnomalyCell[]
}

export interface LogxData {
  action: LogxAction
  directory: string
  files: string[]
  issues: LogxReadResult["issues"]
  matchedCount: number
  returnedCount: number
  events: LogEnvelope[]
  aggregate: LogAggregate
  sessions: LogxSessionSummary[]
  telemetry: LogxTelemetry
}

export type LogxResult = NodeRunResult<LogxData>

export function normalizeLogxInput(input: LogxInput): Required<Omit<LogxInput, "directory" | "scope" | "eventName" | "sessionId" | "search" | "since" | "until">> & Pick<LogxInput, "directory" | "scope" | "eventName" | "sessionId" | "search" | "since" | "until"> {
  return {
    action: input.action ?? "query",
    directory: clean(input.directory),
    minimumSeverity: input.minimumSeverity ?? "trace",
    scope: clean(input.scope),
    eventName: clean(input.eventName),
    sessionId: clean(input.sessionId),
    search: clean(input.search),
    since: clean(input.since),
    until: clean(input.until),
    limit: clamp(input.limit, 1, 5_000, 500),
    order: input.order ?? "desc",
  }
}

export function createLogxQuery(input: LogxInput, includeLimit = true): LogQuery {
  const value = normalizeLogxInput(input)
  return {
    minimumSeverity: value.minimumSeverity,
    ...(value.scope ? { scopes: [value.scope] } : {}),
    ...(value.eventName ? { eventNames: [value.eventName] } : {}),
    ...(value.sessionId ? { sessionIds: [value.sessionId] } : {}),
    ...(value.search ? { search: value.search } : {}),
    ...(value.since ? { since: value.since } : {}),
    ...(value.until ? { until: value.until } : {}),
    order: value.order,
    ...(includeLimit ? { limit: value.limit } : {}),
  }
}

export function summarizeLogxSessions(events: readonly LogEnvelope[]): LogxSessionSummary[] {
  const rows = new Map<string, { id: string; startedAt: string; eventCount: number; errorCount: number; processTypes: Set<string>; scopes: Set<string> }>()
  for (const event of events) {
    const row = rows.get(event.session.id) ?? { id: event.session.id, startedAt: event.session.startedAt, eventCount: 0, errorCount: 0, processTypes: new Set(), scopes: new Set() }
    row.eventCount += 1
    if (event.error || event.severityNumber >= 17) row.errorCount += 1
    row.processTypes.add(event.resource.processType)
    row.scopes.add(event.scope.name)
    rows.set(row.id, row)
  }
  return [...rows.values()].map((row) => ({ ...row, processTypes: [...row.processTypes].sort(), scopes: [...row.scopes].sort() })).sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

export function createLogxTelemetry(events: readonly LogEnvelope[]): LogxTelemetry {
  const cells = Array.from({ length: 16 }, (_, index) => ({ index, eventCount: 0, weightedScore: 0, intensity: 0 }))
  if (!events.length) return { durationMs: 0, eventsPerSecond: 0, stormIntensity: 0, anomalyCells: cells }
  const timedEvents = events.map((event) => ({ event, time: Date.parse(event.timestamp) })).filter((item) => Number.isFinite(item.time))
  if (!timedEvents.length) return { durationMs: 0, eventsPerSecond: events.length, stormIntensity: stormIntensity(events.length), anomalyCells: cells }
  const start = Math.min(...timedEvents.map((item) => item.time))
  const end = Math.max(...timedEvents.map((item) => item.time))
  const durationMs = Math.max(0, end - start)
  const bucketSpan = Math.max(1, durationMs)
  for (const { event, time } of timedEvents) {
    const index = Math.min(15, Math.floor(((time - start) / bucketSpan) * 16))
    cells[index].eventCount += 1
    cells[index].weightedScore += severityWeight(event.severityText)
  }
  const peakScore = Math.max(1, ...cells.map((cell) => cell.weightedScore))
  const anomalyCells = cells.map((cell) => ({ ...cell, intensity: cell.weightedScore / peakScore }))
  const eventsPerSecond = events.length / Math.max(1, durationMs / 1_000)
  return { durationMs, eventsPerSecond, stormIntensity: stormIntensity(eventsPerSecond), anomalyCells }
}

export async function runLogx(input: LogxInput, runtime: LogxRuntime, onEvent: (event: NodeRunEvent) => void = () => {}): Promise<LogxResult> {
  const normalized = normalizeLogxInput(input)
  try {
    onEvent({ type: "progress", progress: 15, message: "Reading rotated JSONL log files." })
    const source = await runtime.read({ directory: normalized.directory })
    onEvent({ type: "progress", progress: 60, message: "Applying structured log query." })
    const allMatches = queryLogs(source.events, createLogxQuery(normalized, false))
    const events = allMatches.slice(0, normalized.limit)
    const data: LogxData = {
      action: normalized.action,
      directory: source.directory,
      files: source.files,
      issues: source.issues,
      matchedCount: allMatches.length,
      returnedCount: events.length,
      events,
      aggregate: aggregateLogs(allMatches),
      sessions: summarizeLogxSessions(allMatches),
      telemetry: createLogxTelemetry(allMatches),
    }
    onEvent({ type: "progress", progress: 100, message: `Matched ${data.matchedCount} log event(s).` })
    return { success: source.issues.length === 0, message: source.issues.length ? `Matched ${data.matchedCount} event(s) with ${source.issues.length} parse issue(s).` : `Matched ${data.matchedCount} log event(s).`, data }
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : String(error) }
  }
}

function severityWeight(severity: LogSeverityText): number {
  if (severity === "fatal") return 8
  if (severity === "error") return 5
  if (severity === "warn") return 2
  if (severity === "info") return 0.5
  if (severity === "debug") return 0.25
  return 0.1
}

function stormIntensity(eventsPerSecond: number): number {
  return Math.min(1, Math.log10(eventsPerSecond + 1) / 3)
}

function clean(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized || undefined
}

function clamp(value: number | undefined, minimum: number, maximum: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(maximum, Math.max(minimum, Math.trunc(value!)))
}

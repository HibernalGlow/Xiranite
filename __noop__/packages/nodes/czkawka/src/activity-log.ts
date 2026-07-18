import type { CzkawkaAction, CzkawkaTool } from "./core.js"

export type CzkawkaActivityKind = "scan" | "progress" | "operation" | "system"
export type CzkawkaActivityLevel = "info" | "success" | "warning" | "error"

export interface CzkawkaActivityLogEntry {
  id: string
  timestamp: number
  tool: CzkawkaTool
  kind: CzkawkaActivityKind
  level: CzkawkaActivityLevel
  message: string
  progress?: number
  action?: CzkawkaAction
  affectedCount?: number
  errorCount?: number
}

export type CzkawkaActivityLogInput = Omit<CzkawkaActivityLogEntry, "id" | "timestamp"> & { timestamp?: number }

export function appendCzkawkaActivityLog(entries: CzkawkaActivityLogEntry[], input: CzkawkaActivityLogInput, limit = 200): CzkawkaActivityLogEntry[] {
  const timestamp = input.timestamp ?? Date.now()
  const entry = { ...input, timestamp, id: `${timestamp}-${entries.length}-${input.kind}` }
  return [...entries, entry].slice(-Math.max(1, limit))
}

export function filterCzkawkaActivityLog(entries: CzkawkaActivityLogEntry[], query: string): CzkawkaActivityLogEntry[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return entries
  return entries.filter((entry) => [entry.tool, entry.kind, entry.level, entry.action, entry.message].some((value) => String(value ?? "").toLocaleLowerCase().includes(needle)))
}

export function formatCzkawkaActivityMessage(level: CzkawkaActivityLevel, message: string, progress?: number): string {
  const marker = ({ info: "·", success: "✓", warning: "!", error: "×" } as const)[level]
  const percentage = progress === undefined ? "" : ` [${Math.round(progress)}%]`
  return `${marker}${percentage} ${message}`
}

export function formatCzkawkaActivityLogEntry(entry: CzkawkaActivityLogEntry): string {
  const time = new Date(entry.timestamp).toISOString()
  const result = entry.affectedCount === undefined ? "" : ` · ${entry.affectedCount} affected / ${entry.errorCount ?? 0} errors`
  return `${time} · ${entry.tool} · ${entry.kind} · ${formatCzkawkaActivityMessage(entry.level, entry.message, entry.progress)}${result}`
}

export function serializeCzkawkaActivityLog(entries: CzkawkaActivityLogEntry[]): string {
  return entries.map(formatCzkawkaActivityLogEntry).join("\n")
}

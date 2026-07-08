import type { LoratAction, LoratRow, LoratScopeFilter, LoratStatusFilter } from "@xiranite/node-lorat/core"

export type LoratPhase = "idle" | "scanning" | "completed" | "error"

export interface LoratCardState {
  action?: LoratAction
  folderPath?: string
  triggerDbJson?: string
  search?: string
  statusFilter?: LoratStatusFilter
  scopeFilter?: LoratScopeFilter
  rows?: LoratRow[]
  logs?: string[]
  phase?: LoratPhase
  progress?: number
  progressText?: string
  dbOpen?: boolean
}

export interface LoratStatusMeta {
  label: string
  description: string
  tone: "idle" | "running" | "success" | "error"
  badgeVariant: "default" | "secondary" | "destructive" | "outline"
  iconClass: string
}

export const CONFIG_FIELDS: Array<keyof LoratCardState> = [
  "action",
  "folderPath",
  "triggerDbJson",
  "search",
  "statusFilter",
  "scopeFilter",
]

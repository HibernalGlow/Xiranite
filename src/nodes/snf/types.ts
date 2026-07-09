import type { SnfAction, SnfData, SnfMode } from "@xiranite/node-snf/core"

export type SnfPhase = "idle" | "running" | "completed" | "error"

export interface SnfCardState {
  action?: SnfAction
  pathsText?: string
  mode?: SnfMode
  keepTimestamp?: boolean
  dryRun?: boolean
  result?: SnfData | null
  logs?: string[]
  phase?: SnfPhase
  progress?: number
  progressText?: string
}

export interface SnfStatusMeta {
  label: string
  description: string
  tone: "idle" | "running" | "success" | "error"
  badgeVariant: "default" | "secondary" | "destructive" | "outline"
  iconClass: string
}

export const CONFIG_FIELDS = [
  "pathsText",
  "mode",
  "keepTimestamp",
  "dryRun",
] as const satisfies Array<keyof SnfCardState>

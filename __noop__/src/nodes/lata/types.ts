import type { LataData } from "@xiranite/node-lata/core"

export type LataPhase = "idle" | "loading" | "running" | "completed" | "error"

export interface LataCardState {
  taskfilePath?: string
  taskName?: string
  taskArgs?: string
  result?: LataData | null
  logs?: string[]
  phase?: LataPhase
  progress?: number
  progressText?: string
}

export interface LataStatusMeta {
  label: string
  description: string
  tone: "idle" | "running" | "success" | "error"
  badgeVariant: "default" | "secondary" | "destructive" | "outline"
  iconClass: string
}

export const CONFIG_FIELDS: Array<keyof LataCardState> = [
  "taskfilePath",
  "taskName",
  "taskArgs",
]

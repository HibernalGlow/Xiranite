import type { AudiovAction, AudiovData } from "@xiranite/node-audiov/core"

export type AudiovPhase = "idle" | "running" | "completed" | "error"

export interface AudiovCardState {
  action?: AudiovAction
  pathsText?: string
  dryRun?: boolean
  result?: AudiovData | null
  logs?: string[]
  phase?: AudiovPhase
  progress?: number
  progressText?: string
}

export interface AudiovStatusMeta {
  label: string
  description: string
  tone: "idle" | "running" | "success" | "error"
  badgeVariant: "default" | "secondary" | "destructive" | "outline"
  iconClass: string
}

export const CONFIG_FIELDS = ["dryRun"] as const satisfies ReadonlyArray<keyof AudiovCardState>

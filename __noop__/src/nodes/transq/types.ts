import type { TransqData } from "@xiranite/node-transq/core"

export type TransqPhase = "idle" | "planning" | "running" | "completed" | "error"

export interface TransqCardState {
  pathsText?: string
  preview?: boolean
  phase?: TransqPhase
  progress?: number
  progressText?: string
  result?: TransqData | null
  logs?: string[]
}

export interface TransqStatusMeta {
  label: string
  description: string
  tone: "idle" | "running" | "success" | "error"
  badgeVariant: "default" | "secondary" | "destructive" | "outline"
  iconClass: string
}

export const CONFIG_FIELDS = ["pathsText", "preview"] as const satisfies ReadonlyArray<keyof TransqCardState>

import type { ScoolpAction, ScoolpData } from "@xiranite/node-scoolp/core"

export type ScoolpPhase =
  | "idle"
  | "running"
  | "completed"
  | "error"

export interface ScoolpCardState {
  action?: ScoolpAction
  path?: string
  configText?: string
  packageName?: string
  packages?: string
  cachePath?: string
  scoopRoot?: string
  dryRun?: boolean
  phase?: ScoolpPhase
  progress?: number
  progressText?: string
  result?: ScoolpData | null
  logs?: string[]
}

export type ScoolpStatusTone = "idle" | "running" | "success" | "error" | "warning"

export interface ScoolpStatusMeta {
  label: string
  description: string
  tone: ScoolpStatusTone
  badgeVariant: "default" | "secondary" | "destructive" | "outline"
  iconClass: string
}

export const CONFIG_FIELDS: Array<keyof ScoolpCardState> = [
  "configText",
  "packageName",
  "packages",
  "cachePath",
  "scoopRoot",
  "dryRun",
]

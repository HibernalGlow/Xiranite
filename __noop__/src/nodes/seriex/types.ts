import type { SeriexAction, SeriexData } from "@xiranite/node-seriex/core"

export type SeriexPhase = "idle" | "running" | "completed" | "error"

export interface SeriexCardState {
  action?: SeriexAction
  directoryPath?: string
  configPath?: string
  configText?: string
  knownSeriesText?: string
  prefix?: string
  addPrefix?: boolean
  dryRun?: boolean
  phase?: SeriexPhase
  progress?: number
  progressText?: string
  result?: SeriexData | null
  logs?: string[]
}

export type SeriexStatusTone = "idle" | "running" | "success" | "error" | "warning"

export interface SeriexStatusMeta {
  label: string
  description: string
  tone: SeriexStatusTone
  badgeVariant: "default" | "secondary" | "destructive" | "outline"
  iconClass: string
}

export const CONFIG_FIELDS: Array<keyof SeriexCardState> = [
  "directoryPath",
  "configPath",
  "configText",
  "knownSeriesText",
  "prefix",
  "addPrefix",
  "dryRun",
]

import type { EnvuConfigAction, EnvuConfigData } from "@xiranite/node-envuconfig/core"

export type EnvuConfigPhase = "idle" | "running" | "completed" | "error"

export interface EnvuConfigCardState {
  action?: EnvuConfigAction
  root?: string
  includeText?: string
  backupDir?: string
  manifestName?: string
  databasePath?: string
  dryRun?: boolean
  recordRun?: boolean
  result?: EnvuConfigData | null
  logs?: string[]
  phase?: EnvuConfigPhase
  progress?: number
  progressText?: string
}

export interface EnvuConfigStatusMeta {
  label: string
  description: string
  tone: "idle" | "running" | "success" | "error"
  badgeVariant: "default" | "secondary" | "destructive" | "outline"
  iconClass: string
}

export const CONFIG_FIELDS: Array<keyof EnvuConfigCardState> = [
  "root",
  "includeText",
  "backupDir",
  "manifestName",
  "databasePath",
  "dryRun",
  "recordRun",
]

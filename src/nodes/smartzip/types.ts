import type { SmartZipAction, SmartZipData } from "@xiranite/node-smartzip/core"

export type SmartZipPhase = "idle" | "running" | "completed" | "error"

export interface SmartZipCardState {
  action?: SmartZipAction
  pathsText?: string
  smartZipExe?: string
  smartZipAhk?: string
  autohotkeyExe?: string
  iniPath?: string
  databasePath?: string
  dryRun?: boolean
  recordRun?: boolean
  result?: SmartZipData | null
  logs?: string[]
  phase?: SmartZipPhase
  progress?: number
  progressText?: string
}

export interface SmartZipStatusMeta {
  label: string
  description: string
  tone: "idle" | "running" | "success" | "error"
  badgeVariant: "default" | "secondary" | "destructive" | "outline"
  iconClass: string
}

export const CONFIG_FIELDS: Array<keyof SmartZipCardState> = [
  "smartZipExe",
  "smartZipAhk",
  "autohotkeyExe",
  "iniPath",
  "databasePath",
  "dryRun",
  "recordRun",
]

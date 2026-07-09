import type { JellyPotAction, JellyPotData } from "@xiranite/node-jellypot/core"

export type JellyPotPhase = "idle" | "running" | "completed" | "error"

export interface JellyPotCardState {
  action?: JellyPotAction
  configPath?: string
  databasePath?: string
  mediaPath?: string
  potplayerPath?: string
  browserPath?: string
  dryRun?: boolean
  recordRun?: boolean
  result?: JellyPotData | null
  logs?: string[]
  phase?: JellyPotPhase
  progress?: number
  progressText?: string
}

export interface JellyPotStatusMeta {
  label: string
  description: string
  tone: "idle" | "running" | "success" | "error"
  badgeVariant: "default" | "secondary" | "destructive" | "outline"
  iconClass: string
}

export const CONFIG_FIELDS: Array<keyof JellyPotCardState> = [
  "configPath",
  "databasePath",
  "mediaPath",
  "potplayerPath",
  "browserPath",
  "dryRun",
  "recordRun",
]

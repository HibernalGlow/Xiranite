import type { SynctAction, SynctData, SynctFormatKey, SynctSourceMode } from "@xiranite/node-synct/core"

export type SynctPhase = "idle" | "running" | "completed" | "error"

export interface SynctCardState {
  action?: SynctAction
  pathsText?: string
  sourceMode?: SynctSourceMode
  formatKey?: SynctFormatKey
  recursive?: boolean
  archiveFolder?: boolean
  fallbackToCreatedTime?: boolean
  syncFolderFileTimes?: boolean
  dryRun?: boolean
  phase?: SynctPhase
  progress?: number
  progressText?: string
  logs?: string[]
  result?: SynctData | null
}

export interface SynctStatusMeta {
  label: string
  description: string
  tone: "idle" | "running" | "success" | "error"
  badgeVariant: "default" | "secondary" | "destructive" | "outline"
  iconClass: string
}

export const CONFIG_FIELDS = [
  "pathsText",
  "sourceMode",
  "formatKey",
  "recursive",
  "archiveFolder",
  "fallbackToCreatedTime",
  "syncFolderFileTimes",
  "dryRun",
] as const satisfies Array<keyof SynctCardState>

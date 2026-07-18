import type { MoveaData } from "@xiranite/node-movea/core"

export type MoveaPhase =
  | "idle"
  | "scan"
  | "preview"
  | "running"
  | "completed"
  | "error"

export type MoveaAction = "scan" | "match" | "move_single" | "move"

export interface MoveaCardState {
  rootPath?: string
  regexText?: string
  archiveName?: string
  subfoldersText?: string
  level1Name?: string
  movePlanText?: string
  dryRun?: boolean
  phase?: MoveaPhase
  progress?: number
  progressText?: string
  result?: MoveaData | null
  matchedFolders?: string[]
  logs?: string[]
}

export interface MoveaStatusMeta {
  label: string
  description: string
  tone: "idle" | "running" | "success" | "error" | "warning"
  badgeVariant: "default" | "secondary" | "destructive" | "outline"
  iconClass: string
}

export const CONFIG_FIELDS: Array<keyof MoveaCardState> = [
  "rootPath",
  "regexText",
  "archiveName",
  "subfoldersText",
  "level1Name",
  "movePlanText",
  "dryRun",
]

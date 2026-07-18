import type { DinyData } from "@xiranite/node-gitalso/core"

export type DinyPhase = "idle" | "generating" | "committing" | "pushing" | "completed" | "error"

export type DinyAction = "status" | "generate" | "commit" | "push" | "gitbutler_commit"

export interface DinyCardState {
  repoPath?: string
  dinyPath?: string
  noVerify?: boolean
  dryRun?: boolean
  manualMessage?: string
  phase?: DinyPhase
  progress?: number
  progressText?: string
  result?: DinyData | null
  logs?: string[]
}

export interface DinyStatusMeta {
  label: string
  description: string
  tone: "idle" | "running" | "success" | "error"
  badgeVariant: "default" | "secondary" | "destructive" | "outline"
  iconClass: string
}

export const CONFIG_FIELDS: Array<keyof DinyCardState> = [
  "repoPath",
  "dinyPath",
  "noVerify",
  "dryRun",
]

import type { CoveruAction, CoveruData, CoveruOutputMode } from "@xiranite/node-coveru/core"

export type CoveruPhase = "idle" | "running" | "completed" | "error"

export interface CoveruCardState {
  action?: CoveruAction
  pathsText?: string
  outputDir?: string
  outputMode?: CoveruOutputMode
  preferredNamesText?: string
  overwrite?: boolean
  recursive?: boolean
  dryRun?: boolean
  phase?: CoveruPhase
  progress?: number
  progressText?: string
  logs?: string[]
  result?: CoveruData | null
}

export interface CoveruStatusMeta {
  label: string
  description: string
  tone: "idle" | "running" | "success" | "error"
  badgeVariant: "default" | "secondary" | "destructive" | "outline"
  iconClass: string
}

export const CONFIG_FIELDS = [
  "pathsText",
  "outputDir",
  "outputMode",
  "preferredNamesText",
  "overwrite",
  "recursive",
  "dryRun",
] as const satisfies Array<keyof CoveruCardState>

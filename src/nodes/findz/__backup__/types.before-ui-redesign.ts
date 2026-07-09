import type { FindzAction, FindzData, FindzOutputFormat } from "@xiranite/node-findz/core"

export type FindzPhase = "idle" | "searching" | "completed" | "error"

export interface FindzCardState {
  action?: FindzAction
  pathText?: string
  where?: string
  noArchive?: boolean
  followSymlinks?: boolean
  withImageMeta?: boolean
  longFormat?: boolean
  continueOnError?: boolean
  maxResults?: number
  maxReturnFiles?: number
  groupBy?: string
  refine?: string
  sortBy?: "name" | "count" | "totalSize" | "avgSize"
  sortDesc?: boolean
  outputFormat?: FindzOutputFormat
  outputPath?: string
  archiveSeparator?: string
  printZero?: boolean
  result?: FindzData | null
  logs?: string[]
  phase?: FindzPhase
  progress?: number
  progressText?: string
}

export interface FindzStatusMeta {
  label: string
  description: string
  tone: "idle" | "running" | "success" | "error"
  badgeVariant: "default" | "secondary" | "destructive" | "outline"
  iconClass: string
}

export const CONFIG_FIELDS: Array<keyof FindzCardState> = [
  "action",
  "pathText",
  "where",
  "noArchive",
  "followSymlinks",
  "withImageMeta",
  "longFormat",
  "continueOnError",
  "maxResults",
  "maxReturnFiles",
  "groupBy",
  "refine",
  "sortBy",
  "sortDesc",
  "outputFormat",
  "outputPath",
  "archiveSeparator",
  "printZero",
]

import type { KavvkaAction, KavvkaData } from "@xiranite/node-kavvka/core"

export type KavvkaPhase =
  | "idle"
  | "scanning"
  | "planning"
  | "processing"
  | "completed"
  | "error"

export interface KavvkaCardState {
  action?: KavvkaAction
  sourceText?: string
  scanRootText?: string
  keywordText?: string
  scanDepth?: number
  force?: boolean
  dryRun?: boolean
  strictArtist?: boolean
  phase?: KavvkaPhase
  progress?: number
  progressText?: string
  result?: KavvkaData | null
  logs?: string[]
}

export type KavvkaStatusTone = "idle" | "running" | "success" | "error" | "warning"

export interface KavvkaStatusMeta {
  label: string
  description: string
  tone: KavvkaStatusTone
  badgeVariant: "default" | "secondary" | "destructive" | "outline"
  iconClass: string
}

export const CONFIG_FIELDS: Array<keyof KavvkaCardState> = [
  "sourceText",
  "scanRootText",
  "keywordText",
  "scanDepth",
  "force",
  "dryRun",
  "strictArtist",
]

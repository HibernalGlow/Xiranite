import type { PackuToolAction, PackuToolData } from "@xiranite/packu-node-runtime/core"

export type NameuPhase = "idle" | "running" | "completed" | "error"

export interface NameuCardState {
  action?: PackuToolAction
  pathsText?: string
  configPath?: string
  databasePath?: string
  argsText?: string
  python?: string
  sourceRoot?: string
  moduleName?: string
  dryRun?: boolean
  recordRun?: boolean
  result?: PackuToolData | null
  logs?: string[]
  phase?: NameuPhase
  progress?: number
  progressText?: string
}

export interface NameuStatusMeta {
  label: string
  description: string
  tone: "idle" | "running" | "success" | "error"
  badgeVariant: "default" | "secondary" | "destructive" | "outline"
  iconClass: string
}

export const CONFIG_FIELDS: Array<keyof NameuCardState> = [
  "configPath",
  "databasePath",
  "argsText",
  "python",
  "sourceRoot",
  "moduleName",
  "dryRun",
  "recordRun",
]

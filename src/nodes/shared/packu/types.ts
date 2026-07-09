import type { LucideIcon } from "lucide-react"
import type { PackuToolAction, PackuToolData, PackuToolSpec } from "@xiranite/packu-node-runtime/core"

export type PackuPhase = "idle" | "running" | "completed" | "error"

export interface PackuCardState {
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
  phase?: PackuPhase
  progress?: number
  progressText?: string
}

export interface PackuStatusMeta {
  label: string
  description: string
  tone: "idle" | "running" | "success" | "error"
  badgeVariant: "default" | "secondary" | "destructive" | "outline"
  iconClass: string
}

export interface PackuNodeMeta {
  id: string
  title: string
  description: string
  icon: LucideIcon
  spec: PackuToolSpec
}

export const CONFIG_FIELDS: Array<keyof PackuCardState> = [
  "configPath",
  "databasePath",
  "argsText",
  "python",
  "sourceRoot",
  "moduleName",
  "dryRun",
  "recordRun",
]

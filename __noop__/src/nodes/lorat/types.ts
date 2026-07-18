import type { LoratAction, LoratCollectionItem, LoratCollectionResult, LoratRow, LoratScopeFilter, LoratStatusFilter } from "@xiranite/node-lorat/core"

export type LoratPhase = "idle" | "scanning" | "completed" | "error"

export interface LoratCardState {
  action?: LoratAction
  workspaceTab?: "manage" | "collect"
  folderPath?: string
  collectionRoot?: string
  collectionItems?: LoratCollectionDraft[]
  collectionOverwrite?: boolean
  collectionResults?: LoratCollectionResult[]
  triggerDbJson?: string
  search?: string
  statusFilter?: LoratStatusFilter
  scopeFilter?: LoratScopeFilter
  rows?: LoratRow[]
  logs?: string[]
  phase?: LoratPhase
  progress?: number
  progressText?: string
  dbOpen?: boolean
}

export interface LoratCollectionDraft extends LoratCollectionItem {
  id: string
  sourceName: string
  previewName?: string
}

export interface LoratStatusMeta {
  label: string
  description: string
  tone: "idle" | "running" | "success" | "error"
  badgeVariant: "default" | "secondary" | "destructive" | "outline"
  iconClass: string
}

export const CONFIG_FIELDS: Array<keyof LoratCardState> = [
  "action",
  "folderPath",
  "collectionRoot",
  "collectionOverwrite",
  "triggerDbJson",
  "search",
  "statusFilter",
  "scopeFilter",
]

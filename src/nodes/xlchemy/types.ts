import type { XlchemyAction, XlchemyData, XlchemyFormat, XlchemyOutputMode } from "@xiranite/node-xlchemy/core"

export type XlchemyPhase = "idle" | "running" | "completed" | "error"

export interface XlchemyCardState {
  action?: XlchemyAction
  pathsText?: string
  format?: XlchemyFormat
  lossless?: boolean
  quality?: number
  effort?: number
  threads?: number
  outputMode?: XlchemyOutputMode
  outputDir?: string
  preserveMetadata?: boolean
  preserveStructure?: boolean
  overwrite?: boolean
  recursive?: boolean
  selectedPreset?: string
  phase?: XlchemyPhase
  progress?: number
  progressText?: string
  currentFile?: string
  logs?: string[]
  result?: XlchemyData | null
}

export const XL_CONFIG_FIELDS = ["format", "lossless", "quality", "effort", "threads", "outputMode", "outputDir", "preserveMetadata", "preserveStructure", "overwrite", "recursive", "selectedPreset"] as const satisfies Array<keyof XlchemyCardState>

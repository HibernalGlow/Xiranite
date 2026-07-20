import type { ResourcePriority } from "./ResourceScheduler.js"

export type ReaderPreloadDirection = "forward" | "backward"
export type ReaderPreloadTier = "near" | "ahead" | "background"
export type ReaderPreloadMode = "paged" | "continuous" | "scrub"
export type ReaderPreloadAdmission = "normal" | "reduced" | "paused"

export interface ReaderPreloadContext {
  mode?: ReaderPreloadMode
  velocityPagesPerSecond?: number
  stableForMs?: number
  focused?: boolean
  queueWaitMs?: number
  memoryPressure?: "normal" | "elevated" | "critical"
}

export interface ReaderPreloadCandidate {
  tier: ReaderPreloadTier
  priority: ResourcePriority
  anchorPageIndex: number
  pageIndexes: readonly number[]
  pageIds: readonly string[]
}

export interface ReaderPreloadPlan {
  generation: number
  frameGeneration: number
  direction: ReaderPreloadDirection
  directionConfidence: number
  mode: ReaderPreloadMode
  admission: ReaderPreloadAdmission
  velocityPagesPerSecond: number
  stableForMs: number
  focused: boolean
  queueWaitMs: number
  memoryPressure: "normal" | "elevated" | "critical"
  currentPageIndexes: readonly number[]
  candidates: readonly ReaderPreloadCandidate[]
}

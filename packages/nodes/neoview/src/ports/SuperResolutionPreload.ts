import type { ReaderPage } from "../domain/page/page.js"
import type { ReaderPreloadPlan } from "./ReaderPreload.js"
import type {
  SuperResolutionArtifactDescriptor,
  SuperResolutionArtifactRunDecision,
  SuperResolutionArtifactWarmResult,
} from "./SuperResolutionArtifact.js"
import type { SuperResolutionPageInput, SuperResolutionPageResult } from "./SuperResolutionPage.js"
import type { ResourcePriority } from "./ResourceScheduler.js"

export interface SuperResolutionPreloadPageRunner {
  run(input: SuperResolutionPageInput, context?: { signal?: AbortSignal }): Promise<SuperResolutionPageResult>
}

export interface SuperResolutionArtifactDestinationContext {
  contextId: string
  generation: number
  trigger: "preload"
  signal: AbortSignal
}

export type SuperResolutionArtifactDestinationResolver = (
  page: ReaderPage,
  context: SuperResolutionArtifactDestinationContext,
) => string | Promise<string>

export type SuperResolutionArtifactDescriptorResolver = (
  page: ReaderPage,
  context: SuperResolutionArtifactDestinationContext & { decision: SuperResolutionArtifactRunDecision },
) => SuperResolutionArtifactDescriptor | Promise<SuperResolutionArtifactDescriptor>

export interface SuperResolutionPreloadPlanInput {
  contextId: string
  plan: ReaderPreloadPlan
  pages: readonly ReaderPage[]
  bookPath: string
  destinationFor?: SuperResolutionArtifactDestinationResolver
  artifactFor?: SuperResolutionArtifactDescriptorResolver
  metadataFor?: (page: ReaderPage) => Readonly<Record<string, unknown>> | undefined
  maxMaterializationBytes?: number
  signal?: AbortSignal
  onPageSettled?: (outcome: SuperResolutionPreloadPageOutcome) => void
}

export interface SuperResolutionProgressiveInput {
  contextId: string
  generation: number
  currentPageIndex: number
  pages: readonly ReaderPage[]
  bookPath: string
  destinationFor?: SuperResolutionArtifactDestinationResolver
  artifactFor?: SuperResolutionArtifactDescriptorResolver
  metadataFor?: (page: ReaderPage) => Readonly<Record<string, unknown>> | undefined
  maxMaterializationBytes?: number
  signal?: AbortSignal
  onPageSettled?: (outcome: SuperResolutionPreloadPageOutcome) => void
}

export type SuperResolutionPreloadPageOutcome =
  | {
      pageId: string
      pageIndex: number
      status: "settled"
      output: SuperResolutionPageResult | SuperResolutionArtifactWarmResult
    }
  | {
      pageId: string
      pageIndex: number
      status: "failed" | "cancelled"
      error: unknown
    }

export interface SuperResolutionPreloadBatchResult {
  contextId: string
  generation: number
  mode: "nearby" | "progressive"
  reason: "completed" | "disabled" | "empty"
  planned: number
  settled: number
  failed: number
  cancelled: number
  outcomes: readonly SuperResolutionPreloadPageOutcome[]
}

export type SuperResolutionPreloadLiveState =
  | "queued"
  | "countdown"
  | "running"
  | "completed"
  | "disabled"
  | "empty"
  | "paused"
  | "cancelled"
  | "failed"

export interface SuperResolutionPreloadLiveSnapshot {
  contextId: string
  generation: number
  mode: "nearby" | "progressive"
  state: SuperResolutionPreloadLiveState
  planned: number
  settled: number
  failed: number
  cancelled: number
  pending: number
  progress: number
  startedAt: number
  updatedAt: number
  completedAt?: number
}

export type { ResourcePriority }

import type { ReaderPage } from "../domain/page/page.js"
import type { ResourcePriority } from "./ResourceScheduler.js"
import type {
  SuperResolutionArtifactLease,
  SuperResolutionArtifactMetadata,
} from "./SuperResolutionArtifactStore.js"
import type { SuperResolutionExecutionContext, SuperResolutionResult } from "./SuperResolutionProvider.js"
import type { SuperResolutionPolicyDecision, SuperResolutionPolicyTrigger } from "./SuperResolutionPolicy.js"

export interface SuperResolutionArtifactDescriptor {
  key: string
  metadata: SuperResolutionArtifactMetadata
}

export interface SuperResolutionArtifactPageInput {
  page: ReaderPage
  artifactFor: SuperResolutionArtifactResolver
  trigger: SuperResolutionPolicyTrigger
  bookPath?: string
  width?: number
  height?: number
  metadata?: Readonly<Record<string, unknown>>
  priority?: ResourcePriority
  maxMaterializationBytes?: number
}

export type SuperResolutionArtifactRunDecision = Extract<SuperResolutionPolicyDecision, { kind: "run" }>
export type SuperResolutionArtifactResolver = (
  decision: SuperResolutionArtifactRunDecision,
) => SuperResolutionArtifactDescriptor | Promise<SuperResolutionArtifactDescriptor>

export type SuperResolutionArtifactExecution = Omit<SuperResolutionResult, "sourcePath" | "destinationPath">

export type SuperResolutionArtifactPageResult =
  | {
      status: "hit" | "shared"
      artifact: SuperResolutionArtifactLease
    }
  | {
      status: "generated"
      artifact: SuperResolutionArtifactLease
      execution: SuperResolutionArtifactExecution
    }
  | {
      status: "skipped"
      decision: Exclude<SuperResolutionPolicyDecision, { kind: "run" }>
    }
  | {
      status: "bypassed"
      decision: SuperResolutionArtifactRunDecision
    }
  | {
      status: "rejected"
      execution?: SuperResolutionArtifactExecution
    }

export type SuperResolutionArtifactWarmResult =
  | { status: "hit" | "shared" }
  | { status: "generated"; execution: SuperResolutionArtifactExecution }
  | { status: "rejected"; execution?: SuperResolutionArtifactExecution }
  | { status: "skipped"; decision: Exclude<SuperResolutionPolicyDecision, { kind: "run" }> }
  | { status: "bypassed"; decision: SuperResolutionArtifactRunDecision }

export type { SuperResolutionExecutionContext }

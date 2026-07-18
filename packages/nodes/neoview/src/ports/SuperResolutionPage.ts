import type { ReaderPage } from "../domain/page/page.js"
import type { ResourcePriority } from "./ResourceScheduler.js"
import type { SuperResolutionExecutionContext, SuperResolutionResult } from "./SuperResolutionProvider.js"
import type {
  SuperResolutionPolicyDecision,
  SuperResolutionPolicyInput,
  SuperResolutionPolicyTrigger,
} from "./SuperResolutionPolicy.js"

export interface SuperResolutionPageInput {
  page: ReaderPage
  destinationPath: string
  trigger: SuperResolutionPolicyTrigger
  bookPath?: string
  width?: number
  height?: number
  metadata?: Readonly<Record<string, unknown>>
  priority?: ResourcePriority
  maxMaterializationBytes?: number
}

export interface SuperResolutionPagePlan {
  decision: SuperResolutionPolicyDecision
}

export type SuperResolutionPageResult =
  | {
      decision: Exclude<SuperResolutionPolicyDecision, { kind: "run" }>
      result?: never
    }
  | {
      decision: Extract<SuperResolutionPolicyDecision, { kind: "run" }>
      result: SuperResolutionResult
    }

export interface SuperResolutionPolicyResolver {
  decide(input: SuperResolutionPolicyInput): SuperResolutionPolicyDecision
}

export type { SuperResolutionExecutionContext }

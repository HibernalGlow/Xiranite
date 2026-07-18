import type { ResourcePriority } from "../../ports/ResourceScheduler.js"
import type {
  SuperResolutionArtifactLease,
  SuperResolutionArtifactMetadata,
  SuperResolutionArtifactStore,
} from "../../ports/SuperResolutionArtifactStore.js"
import type { SuperResolutionExecutionContext, SuperResolutionResult } from "../../ports/SuperResolutionProvider.js"
import type { ReaderPage } from "../../domain/page/page.js"
import type {
  SuperResolutionPagePlan,
  SuperResolutionPageResult,
} from "./SuperResolutionPageService.js"
import { SuperResolutionPageService } from "./SuperResolutionPageService.js"
import type { SuperResolutionPolicyTrigger } from "./SuperResolutionPolicyService.js"

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

export type SuperResolutionArtifactRunDecision = Extract<SuperResolutionPagePlan["decision"], { kind: "run" }>
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
      decision: Exclude<SuperResolutionPageResult["decision"], { kind: "run" }>
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
  | { status: "skipped"; decision: Exclude<SuperResolutionPageResult["decision"], { kind: "run" }> }
  | { status: "bypassed"; decision: SuperResolutionArtifactRunDecision }

export class SuperResolutionArtifactPageService {
  constructor(
    private readonly pages: SuperResolutionPageService,
    private readonly artifacts: SuperResolutionArtifactStore,
  ) {}

  async acquireOrGenerate(
    input: SuperResolutionArtifactPageInput,
    context: SuperResolutionExecutionContext = {},
  ): Promise<SuperResolutionArtifactPageResult> {
    context.signal?.throwIfAborted()
    const plan = this.pages.plan(input)
    if (plan.decision.kind !== "run") return { status: "skipped", decision: plan.decision }
    if (!plan.decision.useCache) return { status: "bypassed", decision: plan.decision }
    const artifactDescriptor = await input.artifactFor(plan.decision)
    context.signal?.throwIfAborted()
    const cached = await this.artifacts.acquire(artifactDescriptor.key, context.signal)
    if (cached) return { status: "hit", artifact: cached }

    let pageResult: SuperResolutionPageResult | undefined
    let producerRan = false
    const published = await this.artifacts.publish(
      artifactDescriptor.key,
      artifactDescriptor.metadata,
      async (destinationPath, signal) => {
        producerRan = true
        pageResult = await this.pages.runPlanned({
          page: input.page,
          destinationPath,
          trigger: input.trigger,
          bookPath: input.bookPath,
          width: input.width,
          height: input.height,
          metadata: input.metadata,
          priority: input.priority,
          maxMaterializationBytes: input.maxMaterializationBytes,
        }, plan, { signal, onProgress: context.onProgress })
      },
      context.signal,
    )

    if (pageResult && pageResult.decision.kind !== "run") {
      return { status: "skipped", decision: pageResult.decision }
    }
    if (!published) {
      if (pageResult?.result) return { status: "rejected", execution: publicExecution(pageResult.result) }
      return { status: "rejected" }
    }
    const artifact = await this.artifacts.acquire(artifactDescriptor.key, context.signal)
    if (!artifact) throw new Error(`Published super-resolution artifact is unavailable: ${artifactDescriptor.key}`)
    if (!producerRan || !pageResult?.result) return { status: "shared", artifact }
    return { status: "generated", artifact, execution: publicExecution(pageResult.result) }
  }

  async warm(
    input: SuperResolutionArtifactPageInput,
    context: SuperResolutionExecutionContext = {},
  ): Promise<SuperResolutionArtifactWarmResult> {
    const result = await this.acquireOrGenerate(input, context)
    if ("artifact" in result) result.artifact.release()
    if (result.status === "generated") return { status: result.status, execution: result.execution }
    if (result.status === "skipped") return { status: result.status, decision: result.decision }
    if (result.status === "bypassed") return { status: result.status, decision: result.decision }
    return result.status === "rejected"
      ? { status: result.status, ...(result.execution ? { execution: result.execution } : {}) }
      : { status: result.status }
  }
}

function publicExecution(result: SuperResolutionResult): SuperResolutionArtifactExecution {
  return {
    modelId: result.modelId,
    engine: result.engine,
    scale: result.scale,
    width: result.width,
    height: result.height,
    elapsedMs: result.elapsedMs,
  }
}

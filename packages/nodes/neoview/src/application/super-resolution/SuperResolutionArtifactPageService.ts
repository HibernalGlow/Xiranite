import type { SuperResolutionArtifactStore } from "../../ports/SuperResolutionArtifactStore.js"
import type { SuperResolutionExecutionContext, SuperResolutionResult } from "../../ports/SuperResolutionProvider.js"
import type {
  SuperResolutionArtifactExecution,
  SuperResolutionArtifactLookupResult,
  SuperResolutionArtifactPageInput,
  SuperResolutionArtifactPageResult,
  SuperResolutionArtifactWarmResult,
} from "../../ports/SuperResolutionArtifact.js"
import type { SuperResolutionPageResult } from "../../ports/SuperResolutionPage.js"
import { SuperResolutionPageService } from "./SuperResolutionPageService.js"

export type {
  SuperResolutionArtifactDescriptor,
  SuperResolutionArtifactExecution,
  SuperResolutionArtifactLookupResult,
  SuperResolutionArtifactPageInput,
  SuperResolutionArtifactPageResult,
  SuperResolutionArtifactResolver,
  SuperResolutionArtifactRunDecision,
  SuperResolutionArtifactWarmResult,
} from "../../ports/SuperResolutionArtifact.js"

export class SuperResolutionArtifactPageService {
  constructor(
    private readonly pages: SuperResolutionPageService,
    private readonly artifacts: SuperResolutionArtifactStore,
  ) {}

  async acquireExisting(
    input: SuperResolutionArtifactPageInput,
    context: SuperResolutionExecutionContext = {},
  ): Promise<SuperResolutionArtifactLookupResult> {
    context.signal?.throwIfAborted()
    const plan = this.pages.plan(input)
    if (plan.decision.kind !== "run") return { status: "skipped", decision: plan.decision }
    if (!plan.decision.useCache) return { status: "bypassed", decision: plan.decision }
    const descriptor = await input.artifactFor(plan.decision)
    context.signal?.throwIfAborted()
    const artifact = await this.artifacts.acquire(descriptor.key, context.signal)
    return artifact ? { status: "hit", artifact } : { status: "miss" }
  }

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

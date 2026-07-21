import type { ReaderPageMaterializationLease, ReaderPageMaterializer } from "../../ports/ReaderPageMaterializer.js"
import type {
  SuperResolutionExecutionContext,
  SuperResolutionResult,
} from "../../ports/SuperResolutionProvider.js"
import type {
  SuperResolutionPageInput,
  SuperResolutionPagePlan,
  SuperResolutionPageResult,
  SuperResolutionPolicyResolver,
} from "../../ports/SuperResolutionPage.js"
import type { RunSuperResolutionInput } from "./SuperResolutionService.js"
import { isNativeSuperResolutionInput } from "../../domain/super-resolution/native-super-resolution-input.js"

export type {
  SuperResolutionPageInput,
  SuperResolutionPagePlan,
  SuperResolutionPageResult,
  SuperResolutionPolicyResolver,
} from "../../ports/SuperResolutionPage.js"

export interface SuperResolutionRunner {
  run(input: RunSuperResolutionInput, context?: SuperResolutionExecutionContext): Promise<SuperResolutionResult>
}

export class SuperResolutionPageService {
  constructor(
    private readonly runner: SuperResolutionRunner,
    private readonly policy: SuperResolutionPolicyResolver,
    private readonly materializer?: ReaderPageMaterializer,
  ) {}

  async run(
    input: SuperResolutionPageInput,
    context: SuperResolutionExecutionContext = {},
  ): Promise<SuperResolutionPageResult> {
    return this.runPlanned(input, this.plan(input), context)
  }

  plan(input: Omit<SuperResolutionPageInput, "destinationPath">): SuperResolutionPagePlan {
    const width = input.width ?? input.page.dimensions?.width
    const height = input.height ?? input.page.dimensions?.height
    if (width === undefined || height === undefined) {
      throw new Error(`Super-resolution requires page dimensions: ${input.page.id}`)
    }
    return {
      decision: this.policy.decide({
        trigger: input.trigger,
        width,
        height,
        bookPath: input.bookPath ?? input.page.sourcePath,
        imagePath: input.page.entryPath ?? input.page.sourcePath,
        innerPath: input.page.entryPath,
        createdAt: input.page.timestamps?.createdAtMs,
        modifiedAt: input.page.timestamps?.modifiedAtMs,
        metadata: input.metadata,
      }),
    }
  }

  async runPlanned(
    input: SuperResolutionPageInput,
    plan: SuperResolutionPagePlan,
    context: SuperResolutionExecutionContext = {},
  ): Promise<SuperResolutionPageResult> {
    context.signal?.throwIfAborted()
    const { decision } = plan
    if (decision.kind !== "run") return { decision }
    const destinationPath = requiredPath(input.destinationPath, "destination path")

    let materialization: ReaderPageMaterializationLease | undefined
    let result: SuperResolutionResult | undefined
    let operationError: unknown
    let operationFailed = false
    try {
      const sourcePath = input.page.entryPath || !isNativeSuperResolutionInput(input.page)
        ? (materialization = await this.#materialize(input, context.signal)).path
        : input.page.sourcePath
      result = await this.runner.run({
        sourcePath,
        destinationPath,
        modelId: decision.modelId,
        scale: decision.scale,
        noise: decision.noise,
        tileSize: decision.tileSize,
        tta: decision.tta,
        gpuId: decision.gpuId,
        priority: input.priority,
      }, context)
    } catch (error) {
      operationFailed = true
      operationError = error
    }
    let cleanupError: unknown
    if (materialization) {
      try {
        await materialization.release()
      } catch (error) {
        cleanupError = error
      }
    }
    if (operationFailed) throw operationError
    if (cleanupError !== undefined) throw cleanupError
    return { decision, result: result! }
  }

  async #materialize(input: SuperResolutionPageInput, signal?: AbortSignal): Promise<ReaderPageMaterializationLease> {
    if (!this.materializer) throw new Error("Archive page super-resolution requires a page materializer.")
    return await this.materializer.materialize(input.page, {
      signal,
      maxBytes: input.maxMaterializationBytes,
    })
  }
}

function requiredPath(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized) throw new TypeError(`Super-resolution ${label} is required.`)
  return normalized
}

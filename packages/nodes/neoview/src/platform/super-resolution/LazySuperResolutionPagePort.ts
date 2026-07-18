import type {
  ReaderHeadlessSuperResolutionPort,
} from "../../application/headless/ReaderHeadlessController.js"
import type {
  SuperResolutionPageInput,
  SuperResolutionPageResult,
} from "../../application/super-resolution/SuperResolutionPageService.js"
import type { SuperResolutionExecutionContext } from "../../ports/SuperResolutionProvider.js"
import type {
  SuperResolutionCapabilitySnapshot,
  SuperResolutionModelManifest,
} from "../../ports/SuperResolutionProvider.js"
import type { HeadlessSuperResolutionCapabilitySnapshot } from "../../application/headless/ReaderHeadlessController.js"
import type {
  SuperResolutionArtifactPageInput,
  SuperResolutionArtifactPageResult,
} from "../../application/super-resolution/SuperResolutionArtifactPageService.js"
import type { SuperResolutionArtifactPagePort } from "../../ports/SuperResolutionArtifactPagePort.js"
import type { SuperResolutionPreloadControlPort } from "../../ports/SuperResolutionPreloadControlPort.js"
import type {
  SuperResolutionPreloadBatchResult,
  SuperResolutionPreloadLiveSnapshot,
  SuperResolutionPreloadPlanInput,
  SuperResolutionProgressiveInput,
} from "../../application/super-resolution/SuperResolutionPreloadService.js"

export interface SuperResolutionPageCapability {
  pages: {
    run(
      input: SuperResolutionPageInput,
      context?: SuperResolutionExecutionContext,
    ): Promise<SuperResolutionPageResult>
  }
  artifactPages?: {
    acquireOrGenerate(
      input: SuperResolutionArtifactPageInput,
      context?: SuperResolutionExecutionContext,
    ): Promise<SuperResolutionArtifactPageResult>
  }
  preload?: {
    schedulePlan(input: SuperResolutionPreloadPlanInput): Promise<SuperResolutionPreloadBatchResult>
    scheduleProgressive(input: SuperResolutionProgressiveInput): Promise<SuperResolutionPreloadBatchResult>
    snapshots(contextId: string): readonly SuperResolutionPreloadLiveSnapshot[]
    pause(contextId: string): Promise<readonly SuperResolutionPreloadLiveSnapshot[]>
    retry(contextId: string, mode: "nearby" | "progressive"): Promise<SuperResolutionPreloadBatchResult>
    releaseContext(contextId: string): void
  }
  listModels(): readonly SuperResolutionModelManifest[]
  capabilities(options?: { refresh?: boolean; signal?: AbortSignal }): Promise<SuperResolutionCapabilitySnapshot>
  dispose(): Promise<void>
}

export class LazySuperResolutionPagePort implements ReaderHeadlessSuperResolutionPort, SuperResolutionArtifactPagePort, SuperResolutionPreloadControlPort {
  #capability?: Promise<SuperResolutionPageCapability | undefined>
  #resolvedCapability?: SuperResolutionPageCapability
  #disposed = false

  constructor(
    private readonly load: () => Promise<SuperResolutionPageCapability | undefined>,
  ) {}

  async run(
    input: SuperResolutionPageInput,
    context: SuperResolutionExecutionContext = {},
  ): Promise<SuperResolutionPageResult> {
    this.#assertActive()
    context.signal?.throwIfAborted()
    const capability = await waitForSharedPromise(this.#load(), context.signal)
    context.signal?.throwIfAborted()
    this.#assertActive()
    if (!capability) throw new Error("Reader super-resolution runtime is unavailable.")
    return capability.pages.run(input, context)
  }

  async inspect(
    options: { refresh?: boolean; signal?: AbortSignal } = {},
  ): Promise<HeadlessSuperResolutionCapabilitySnapshot> {
    this.#assertActive()
    const capability = await waitForSharedPromise(this.#load(), options.signal)
    options.signal?.throwIfAborted()
    this.#assertActive()
    if (!capability) return { available: false, reason: "runtime-unavailable", models: [], engines: [] }
    const snapshot = await capability.capabilities(options)
    return {
      available: true,
      models: capability.listModels(),
      engines: snapshot.engines,
      probedAt: snapshot.probedAt,
    }
  }

  async acquireOrGenerate(
    input: SuperResolutionArtifactPageInput,
    context: SuperResolutionExecutionContext = {},
  ): Promise<SuperResolutionArtifactPageResult> {
    this.#assertActive()
    context.signal?.throwIfAborted()
    const capability = await waitForSharedPromise(this.#load(), context.signal)
    context.signal?.throwIfAborted()
    this.#assertActive()
    if (!capability) throw new Error("Reader super-resolution runtime is unavailable.")
    if (!capability.artifactPages) throw new Error("Reader super-resolution artifact cache is unavailable.")
    return capability.artifactPages.acquireOrGenerate(input, context)
  }

  async startPlan(
    input: Omit<SuperResolutionPreloadPlanInput, "signal">,
    signal?: AbortSignal,
  ): Promise<readonly SuperResolutionPreloadLiveSnapshot[]> {
    const preload = await this.#preload(signal)
    signal?.throwIfAborted()
    observeBackground(preload.schedulePlan(input))
    return preload.snapshots(input.contextId)
  }

  async startProgressive(
    input: Omit<SuperResolutionProgressiveInput, "signal">,
    signal?: AbortSignal,
  ): Promise<readonly SuperResolutionPreloadLiveSnapshot[]> {
    const preload = await this.#preload(signal)
    signal?.throwIfAborted()
    observeBackground(preload.scheduleProgressive(input))
    return preload.snapshots(input.contextId)
  }

  async snapshots(contextId: string, signal?: AbortSignal): Promise<readonly SuperResolutionPreloadLiveSnapshot[]> {
    this.#assertActive()
    signal?.throwIfAborted()
    return this.#resolvedCapability?.preload?.snapshots(contextId) ?? []
  }

  async pause(contextId: string, signal?: AbortSignal): Promise<readonly SuperResolutionPreloadLiveSnapshot[]> {
    this.#assertActive()
    signal?.throwIfAborted()
    const capability = this.#resolvedCapability
    if (!capability?.preload) return []
    const operation = capability.preload.pause(contextId)
    return await waitForSharedPromise(operation, signal)
  }

  async retry(
    contextId: string,
    mode: "nearby" | "progressive",
    signal?: AbortSignal,
  ): Promise<readonly SuperResolutionPreloadLiveSnapshot[]> {
    this.#assertActive()
    signal?.throwIfAborted()
    const capability = this.#resolvedCapability
    if (!capability) throw new Error(`No super-resolution ${mode} request is available to retry.`)
    if (!capability?.preload) throw new Error("Reader super-resolution preload is unavailable.")
    observeBackground(capability.preload.retry(contextId, mode))
    return capability.preload.snapshots(contextId)
  }

  async releaseContext(contextId: string): Promise<void> {
    this.#resolvedCapability?.preload?.releaseContext(contextId)
    if (!this.#resolvedCapability && this.#capability) {
      void this.#capability.then((capability) => capability?.preload?.releaseContext(contextId)).catch(() => undefined)
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    const capability = await this.#capability
    await capability?.dispose()
  }

  #load(): Promise<SuperResolutionPageCapability | undefined> {
    if (!this.#capability) {
      const request = this.load()
      this.#capability = request
      void request.then((capability) => {
        if (!this.#disposed && this.#capability === request) this.#resolvedCapability = capability
      })
      void request.catch(() => {
        if (!this.#disposed && this.#capability === request) {
          this.#capability = undefined
          this.#resolvedCapability = undefined
        }
      })
    }
    return this.#capability
  }

  async #preload(signal?: AbortSignal): Promise<NonNullable<SuperResolutionPageCapability["preload"]>> {
    this.#assertActive()
    signal?.throwIfAborted()
    const capability = await waitForSharedPromise(this.#load(), signal)
    signal?.throwIfAborted()
    this.#assertActive()
    if (!capability) throw new Error("Reader super-resolution runtime is unavailable.")
    if (!capability.preload) throw new Error("Reader super-resolution preload is unavailable.")
    return capability.preload
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error("Reader super-resolution is disposed.")
  }
}

function observeBackground(operation: Promise<unknown>): void {
  void operation.catch(() => undefined)
}

async function waitForSharedPromise<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener("abort", abort, { once: true })
    void promise.then(
      (value) => {
        signal.removeEventListener("abort", abort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener("abort", abort)
        reject(error)
      },
    )
  })
}

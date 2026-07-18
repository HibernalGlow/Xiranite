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
  listModels(): readonly SuperResolutionModelManifest[]
  capabilities(options?: { refresh?: boolean; signal?: AbortSignal }): Promise<SuperResolutionCapabilitySnapshot>
  dispose(): Promise<void>
}

export class LazySuperResolutionPagePort implements ReaderHeadlessSuperResolutionPort, SuperResolutionArtifactPagePort {
  #capability?: Promise<SuperResolutionPageCapability | undefined>
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
      void request.catch(() => {
        if (!this.#disposed && this.#capability === request) this.#capability = undefined
      })
    }
    return this.#capability
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error("Reader super-resolution is disposed.")
  }
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

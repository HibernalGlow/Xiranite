import type { ResourcePriority, ResourceScheduler } from "../../ports/ResourceScheduler.js"
import { resolve } from "node:path"
import type {
  SuperResolutionCapabilitySnapshot,
  SuperResolutionExecutionContext,
  SuperResolutionModelManifest,
  SuperResolutionProvider,
  SuperResolutionRequest,
  SuperResolutionResult,
} from "../../ports/SuperResolutionProvider.js"

export interface SuperResolutionServiceOptions {
  scheduler?: ResourceScheduler
  ownerId?: string
  priority?: ResourcePriority
  models?: readonly SuperResolutionModelManifest[]
  ownsProvider?: boolean
}

export interface RunSuperResolutionInput {
  sourcePath: string
  destinationPath: string
  modelId: string
  scale: number
  noise?: number
  tileSize?: number
  tta?: boolean
  gpuId?: string
  priority?: ResourcePriority
}

export class SuperResolutionOutputBusyError extends Error {
  constructor(readonly destinationPath: string) {
    super(`Super-resolution output is already active: ${destinationPath}`)
    this.name = "SuperResolutionOutputBusyError"
  }
}

export class SuperResolutionService implements AsyncDisposable {
  readonly #provider: SuperResolutionProvider
  readonly #scheduler?: ResourceScheduler
  readonly #ownerId: string
  readonly #priority: ResourcePriority
  readonly #ownsProvider: boolean
  readonly #models = new Map<string, SuperResolutionModelManifest>()
  readonly #activeDestinations = new Set<string>()
  #capabilities?: Promise<SuperResolutionCapabilitySnapshot>
  #disposed = false

  constructor(provider: SuperResolutionProvider, options: SuperResolutionServiceOptions = {}) {
    this.#provider = provider
    this.#scheduler = options.scheduler
    this.#ownerId = options.ownerId ?? "neoview:super-resolution"
    this.#priority = options.priority ?? "view"
    this.#ownsProvider = options.ownsProvider ?? true
    for (const model of options.models ?? []) this.registerModel(model)
  }

  listModels(): readonly SuperResolutionModelManifest[] {
    return [...this.#models.values()]
  }

  getModel(modelId: string): SuperResolutionModelManifest | undefined {
    return this.#models.get(modelId)
  }

  registerModel(model: SuperResolutionModelManifest): void {
    this.#assertActive()
    const normalized = normalizeModelManifest(model)
    if (this.#models.has(normalized.id)) throw new Error(`Super-resolution model is already registered: ${normalized.id}`)
    this.#models.set(normalized.id, normalized)
  }

  unregisterModel(modelId: string): boolean {
    this.#assertActive()
    return this.#models.delete(normalizeIdentifier(modelId, "model id"))
  }

  async capabilities(options: { refresh?: boolean; signal?: AbortSignal } = {}): Promise<SuperResolutionCapabilitySnapshot> {
    this.#assertActive()
    options.signal?.throwIfAborted()
    if (options.refresh) this.#capabilities = undefined
    if (!this.#capabilities) {
      const request = this.#provider.capabilities()
      this.#capabilities = request
      void request.catch(() => {
        if (this.#capabilities === request) this.#capabilities = undefined
      })
    }
    return await waitForSharedPromise(this.#capabilities, options.signal)
  }

  async run(input: RunSuperResolutionInput, context: SuperResolutionExecutionContext = {}): Promise<SuperResolutionResult> {
    this.#assertActive()
    context.signal?.throwIfAborted()
    const request = this.#createRequest(input)
    const destinationKey = normalizeDestinationKey(request.destinationPath)
    if (destinationKey === normalizeDestinationKey(request.sourcePath)) throw new Error("Super-resolution source and destination must be different.")
    if (this.#activeDestinations.has(destinationKey)) throw new SuperResolutionOutputBusyError(request.destinationPath)
    this.#activeDestinations.add(destinationKey)

    let lease: Awaited<ReturnType<ResourceScheduler["acquire"]>> | undefined
    try {
      lease = await this.#scheduler?.acquire({
        resource: "gpu",
        kind: `neoview.super-resolution.${request.model.engine}`,
        priority: input.priority ?? this.#priority,
        ownerId: this.#ownerId,
      }, context.signal)
      return await this.#provider.upscale(request, context)
    } finally {
      lease?.release()
      this.#activeDestinations.delete(destinationKey)
    }
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    this.#capabilities = undefined
    if (this.#ownsProvider) await this.#provider.dispose?.()
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.dispose()
  }

  #createRequest(input: RunSuperResolutionInput): SuperResolutionRequest {
    const modelId = normalizeIdentifier(input.modelId, "model id")
    const model = this.#models.get(modelId)
    if (!model) throw new Error(`Super-resolution model is not registered: ${modelId}`)
    const scale = positiveFinite(input.scale, "scale")
    if (!model.scales.includes(scale)) throw new RangeError(`Model ${modelId} does not support scale ${scale}.`)
    return {
      sourcePath: normalizePath(input.sourcePath, "source path"),
      destinationPath: normalizePath(input.destinationPath, "destination path"),
      model,
      scale,
      noise: optionalFinite(input.noise, "noise"),
      tileSize: optionalPositiveInteger(input.tileSize, "tile size"),
      tta: input.tta === true,
      gpuId: input.gpuId?.trim() || undefined,
    }
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error("Super-resolution service is disposed.")
  }
}

function normalizeModelManifest(model: SuperResolutionModelManifest): SuperResolutionModelManifest {
  const id = normalizeIdentifier(model.id, "model id")
  const displayName = normalizeIdentifier(model.displayName, "model display name")
  const scales = [...new Set(model.scales.map((scale) => positiveFinite(scale, "model scale")))].sort((left, right) => left - right)
  if (!scales.length) throw new TypeError(`Super-resolution model ${id} must declare at least one scale.`)
  return Object.freeze({
    ...model,
    id,
    displayName,
    scales: Object.freeze(scales),
    sourceDirectories: model.sourceDirectories ? Object.freeze([...model.sourceDirectories]) : undefined,
    noise: model.noise ? Object.freeze([...model.noise]) : undefined,
    noiseByScale: model.noiseByScale
      ? Object.freeze(Object.fromEntries(Object.entries(model.noiseByScale).map(([scale, noise]) => [scale, Object.freeze([...noise])])))
      : undefined,
    modelFiles: model.modelFiles ? Object.freeze([...model.modelFiles]) : undefined,
  })
}

function normalizeIdentifier(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized) throw new TypeError(`Super-resolution ${label} is required.`)
  return normalized
}

function normalizePath(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized) throw new TypeError(`Super-resolution ${label} is required.`)
  return normalized
}

function normalizeDestinationKey(value: string): string {
  const normalized = resolve(value)
  return process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized
}

function positiveFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`Super-resolution ${label} must be positive.`)
  return value
}

function optionalFinite(value: number | undefined, label: string): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isFinite(value)) throw new RangeError(`Super-resolution ${label} must be finite.`)
  return value
}

function optionalPositiveInteger(value: number | undefined, label: string): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`Super-resolution ${label} must be a positive integer.`)
  return value
}

async function waitForSharedPromise<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return await promise
  signal.throwIfAborted()
  return await new Promise<T>((resolve, reject) => {
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

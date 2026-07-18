import { stat } from "node:fs/promises"
import { resolve } from "node:path"

import type {
  SuperResolutionCapabilitySnapshot,
  SuperResolutionEngine,
  SuperResolutionExecutionContext,
  SuperResolutionProvider,
  SuperResolutionRequest,
  SuperResolutionResult,
  SuperResolutionModelType,
} from "../../../ports/SuperResolutionProvider.js"
import { FilePageContent } from "../../content/FilePageContent.js"
import { StreamingImageMetadataProbe } from "../../images/StreamingImageMetadataProbe.js"

export interface OpenComicSystemBinaryRequest {
  upscaler: SuperResolutionEngine
  executableName: string
}

export interface OpenComicSystemStep {
  model: string
  scale: number
  noise?: number
  tileSize?: number
  gpuId?: string
  tta?: boolean
}

export interface OpenComicSystemModelInfo {
  name?: string
  upscaler: SuperResolutionEngine
  scales: readonly number[]
  folder?: string
  files?: readonly string[]
  scaleFiles?: Readonly<Record<number, string>>
  license?: string
  checksums?: Readonly<Record<string, string>>
  inputBlob?: string
  outputBlob?: string
}

export interface OpenComicSystemCustomModelManifest {
  id: string
  type: SuperResolutionModelType
  name: string
  upscaler: SuperResolutionEngine
  scales: number[]
  noise?: number[]
  latency?: number
  folder: string
  files: string[]
  scaleFiles?: Record<number, string>
  license: string
  checksums: Record<string, string>
  inputBlob: string
  outputBlob: string
  downloadBaseUrl?: string
}

export interface OpenComicSystemRuntime {
  readonly modelsList: readonly string[]
  model(modelId: string): OpenComicSystemModelInfo
  registerModels(manifests: readonly OpenComicSystemCustomModelManifest[]): readonly OpenComicSystemModelInfo[]
  unregisterModel(modelId: string): boolean
  setBinaryResolver(resolver?: (request: OpenComicSystemBinaryRequest) => string): void
  setModelsPath(path: string): void
  setConcurrentDaemons(count: number): void
  setDaemonIdleTimeout(timeoutMs: number): void
  pipeline(
    sourcePath: string,
    destinationPath: string,
    steps: readonly OpenComicSystemStep[],
    progress?: ((completed?: number) => void) | false,
    downloading?: false,
  ): Promise<string>
  closeAllProcesses(): void
}

export interface OpenComicSystemCapabilityResolver {
  resolve(engine: SuperResolutionEngine, options?: { refresh?: boolean; signal?: AbortSignal }): Promise<{
    engine: SuperResolutionEngine
    available: boolean
    executablePath?: string
    reason?: string
  }>
  capabilities(options?: { refresh?: boolean; signal?: AbortSignal }): Promise<SuperResolutionCapabilitySnapshot>
}

export interface SuperResolutionImageInspection {
  bytes: number
  width: number
  height: number
}

export interface OpenComicAiSystemProviderOptions {
  loadRuntime: () => Promise<OpenComicSystemRuntime>
  cliResolver: OpenComicSystemCapabilityResolver
  modelsDirectory: string
  maxDaemons?: number
  daemonIdleTimeoutMs?: number
  taskTimeoutMs?: number
  inspectImage?: (path: string, signal?: AbortSignal) => Promise<SuperResolutionImageInspection>
  now?: () => number
}

export class OpenComicAiSystemProvider implements SuperResolutionProvider, AsyncDisposable {
  readonly #loadRuntime: () => Promise<OpenComicSystemRuntime>
  readonly #cliResolver: OpenComicSystemCapabilityResolver
  readonly #modelsDirectory: string
  readonly #maxDaemons: number
  readonly #daemonIdleTimeoutMs: number
  readonly #taskTimeoutMs: number
  readonly #inspectImage: NonNullable<OpenComicAiSystemProviderOptions["inspectImage"]>
  readonly #now: () => number
  readonly #binaryPaths = new Map<SuperResolutionEngine, string>()
  #runtime?: Promise<OpenComicSystemRuntime>
  #configuredRuntime?: OpenComicSystemRuntime
  #disposed = false

  constructor(options: OpenComicAiSystemProviderOptions) {
    this.#loadRuntime = options.loadRuntime
    this.#cliResolver = options.cliResolver
    this.#modelsDirectory = requiredPath(options.modelsDirectory, "models directory")
    this.#maxDaemons = boundedInteger(options.maxDaemons ?? 1, "max daemons", 0, 8)
    this.#daemonIdleTimeoutMs = boundedInteger(options.daemonIdleTimeoutMs ?? 300_000, "daemon idle timeout", 1_000, 3_600_000)
    this.#taskTimeoutMs = boundedInteger(options.taskTimeoutMs ?? 10 * 60_000, "task timeout", 1_000, 24 * 60 * 60_000)
    this.#inspectImage = options.inspectImage ?? inspectImageFile
    this.#now = options.now ?? Date.now
  }

  capabilities(signal?: AbortSignal): Promise<SuperResolutionCapabilitySnapshot> {
    this.#assertActive()
    return this.#cliResolver.capabilities({ signal })
  }

  async upscale(request: SuperResolutionRequest, context: SuperResolutionExecutionContext = {}): Promise<SuperResolutionResult> {
    this.#assertActive()
    context.signal?.throwIfAborted()
    const capability = await this.#cliResolver.resolve(request.model.engine, { signal: context.signal })
    if (!capability.available || !capability.executablePath) {
      throw new Error(capability.reason ?? `System super-resolution CLI is unavailable: ${request.model.engine}`)
    }
    this.#binaryPaths.set(request.model.engine, capability.executablePath)

    const runtime = await this.#runtimeInstance()
    context.signal?.throwIfAborted()
    const startedAt = this.#now()
    const timeoutSignal = AbortSignal.timeout(this.#taskTimeoutMs)
    const executionSignal = context.signal ? AbortSignal.any([context.signal, timeoutSignal]) : timeoutSignal
    executionSignal.throwIfAborted()
    const work = runtime.pipeline(
      request.sourcePath,
      request.destinationPath,
      [{
        model: request.model.id,
        scale: request.scale,
        noise: request.noise,
        tileSize: request.tileSize,
        gpuId: request.gpuId,
        tta: request.tta,
      }],
      (completed) => context.onProgress?.({ completed: normalizeProgress(completed) }),
      false,
    )
    const outputPath = await raceWithAbort(work, executionSignal, () => runtime.closeAllProcesses())
    if (pathKey(outputPath) !== pathKey(request.destinationPath)) {
      throw new Error(`Super-resolution runtime returned an unexpected output path: ${outputPath}`)
    }

    const [source, output] = await Promise.all([
      this.#inspectImage(request.sourcePath, executionSignal),
      this.#inspectImage(request.destinationPath, executionSignal),
    ])
    const expectedWidth = source.width * request.scale
    const expectedHeight = source.height * request.scale
    if (output.bytes <= 0) throw new Error("Super-resolution output is empty.")
    if (output.width !== expectedWidth || output.height !== expectedHeight) {
      throw new Error(`Super-resolution output dimensions ${output.width}x${output.height} do not match expected ${expectedWidth}x${expectedHeight}.`)
    }

    return {
      sourcePath: request.sourcePath,
      destinationPath: request.destinationPath,
      modelId: request.model.id,
      engine: request.model.engine,
      scale: request.scale,
      width: output.width,
      height: output.height,
      elapsedMs: Math.max(0, this.#now() - startedAt),
    }
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    const runtime = this.#configuredRuntime ?? (this.#runtime ? await this.#runtime.catch(() => undefined) : undefined)
    runtime?.closeAllProcesses()
    runtime?.setBinaryResolver()
    this.#binaryPaths.clear()
    this.#runtime = undefined
    this.#configuredRuntime = undefined
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.dispose()
  }

  async #runtimeInstance(): Promise<OpenComicSystemRuntime> {
    let request = this.#runtime
    if (!request) {
      request = this.#loadRuntime()
      this.#runtime = request
      void request.catch(() => {
        if (this.#runtime === request) this.#runtime = undefined
      })
    }
    const runtime = await request
    this.#assertActive()
    if (this.#configuredRuntime !== runtime) {
      runtime.setModelsPath(this.#modelsDirectory)
      runtime.setConcurrentDaemons(this.#maxDaemons)
      runtime.setDaemonIdleTimeout(this.#daemonIdleTimeoutMs)
      runtime.setBinaryResolver(({ upscaler }) => {
        const executablePath = this.#binaryPaths.get(upscaler)
        if (!executablePath) throw new Error(`System super-resolution CLI has not been resolved: ${upscaler}`)
        return executablePath
      })
      this.#configuredRuntime = runtime
    }
    return runtime
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error("OpenComic system provider is disposed.")
  }
}

async function inspectImageFile(path: string, signal?: AbortSignal): Promise<SuperResolutionImageInspection> {
  signal?.throwIfAborted()
  const file = await stat(path)
  if (!file.isFile() || file.size <= 0) throw new Error(`Super-resolution image output is missing or empty: ${path}`)
  const metadata = await new StreamingImageMetadataProbe().probe(
    new FilePageContent(path, file.size, "application/octet-stream"),
    undefined,
    signal,
  )
  if (!metadata) throw new Error(`Unable to inspect super-resolution image dimensions: ${path}`)
  return { bytes: file.size, width: metadata.dimensions.width, height: metadata.dimensions.height }
}

async function raceWithAbort<T>(work: Promise<T>, signal: AbortSignal, onAbort: () => void): Promise<T> {
  if (signal.aborted) {
    onAbort()
    throw signal.reason
  }
  return await new Promise<T>((resolve, reject) => {
    const abort = () => {
      try {
        onAbort()
      } finally {
        reject(signal.reason)
      }
    }
    signal.addEventListener("abort", abort, { once: true })
    void work.then(
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

function requiredPath(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized) throw new TypeError(`OpenComic system ${label} is required.`)
  return normalized
}

function boundedInteger(value: number, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`OpenComic system ${label} must be between ${minimum} and ${maximum}.`)
  }
  return value
}

function normalizeProgress(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

function pathKey(value: string): string {
  const normalized = resolve(value)
  return process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized
}

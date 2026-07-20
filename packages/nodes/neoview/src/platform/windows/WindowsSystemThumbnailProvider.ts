import type { ResourceScheduler } from "../../ports/ResourceScheduler.js"
import type {
  SystemThumbnailProvider,
  SystemThumbnailRequest,
  SystemThumbnailResult,
} from "../../ports/SystemThumbnailProvider.js"
import { defaultImageTransformScheduler } from "../scheduler/PriorityResourceScheduler.js"
import { detectImageContentType } from "../thumbnails/ThumbnailBlobCodec.js"

const MAX_OUTPUT_BYTES = 2 * 1024 * 1024

export interface NativeEncodedSystemThumbnail {
  data: Uint8Array
  width: number
  height: number
  mimeType: string
}

export interface NativeSystemThumbnailApi {
  getCachedSystemThumbnailEncoded(options: {
    path: string
    maxDimension: number
    format: "webp"
    lossless: boolean
    quality: number
  }): Promise<NativeEncodedSystemThumbnail | undefined>
}

export interface WindowsSystemThumbnailProviderOptions {
  resourceScheduler?: ResourceScheduler
  loadNative?: () => Promise<NativeSystemThumbnailApi>
  enabled?: () => boolean
}

export class WindowsSystemThumbnailProvider implements SystemThumbnailProvider {
  readonly #resourceScheduler: ResourceScheduler
  readonly #loadNative: () => Promise<NativeSystemThumbnailApi>
  readonly #enabled: () => boolean
  #native?: Promise<NativeSystemThumbnailApi>

  constructor(options: WindowsSystemThumbnailProviderOptions = {}) {
    this.#resourceScheduler = options.resourceScheduler ?? defaultImageTransformScheduler
    this.#loadNative = options.loadNative ?? loadNativeSystemThumbnailApi
    this.#enabled = options.enabled ?? (() => true)
  }

  async getCached(request: SystemThumbnailRequest, signal?: AbortSignal): Promise<SystemThumbnailResult | undefined> {
    validateRequest(request)
    signal?.throwIfAborted()
    if (!this.#enabled()) return undefined
    const cpuLease = await this.#resourceScheduler.acquire({
      resource: "cpu",
      kind: "neoview.thumbnail.windows-shell-native-webp",
      priority: request.priority,
      ownerId: request.ownerId,
    }, signal)
    try {
      const image = await (await this.#getNative()).getCachedSystemThumbnailEncoded({
        path: request.sourcePath,
        maxDimension: request.maxEdge,
        format: "webp",
        lossless: request.lossless === true,
        quality: request.quality,
      })
      signal?.throwIfAborted()
      if (!image) return undefined
      validateImage(image, request.maxEdge)
      if (!image.data.byteLength || image.data.byteLength > MAX_OUTPUT_BYTES) {
        throw new RangeError(`Windows Shell WebP output must be from 1 to ${MAX_OUTPUT_BYTES} bytes.`)
      }
      if (image.mimeType !== "image/webp" || detectImageContentType(image.data) !== "image/webp") {
        throw new Error("Windows Shell native encoder returned a non-WebP image.")
      }
      return { bytes: image.data, contentType: "image/webp" }
    } finally {
      cpuLease.release()
    }
  }

  #getNative(): Promise<NativeSystemThumbnailApi> {
    if (!this.#native) {
      const pending = this.#loadNative()
      const guarded = pending.catch((error) => {
        if (this.#native === guarded) this.#native = undefined
        throw error
      })
      this.#native = guarded
    }
    return this.#native
  }
}

async function loadNativeSystemThumbnailApi(): Promise<NativeSystemThumbnailApi> {
  return import("@xiranite/arcthumb-native")
}

function validateRequest(request: SystemThumbnailRequest): void {
  if (!request.sourcePath) throw new Error("System thumbnail sourcePath cannot be empty.")
  if (!Number.isSafeInteger(request.maxEdge) || request.maxEdge < 32 || request.maxEdge > 2_048) {
    throw new RangeError("System thumbnail maxEdge must be an integer from 32 to 2048.")
  }
  if (!Number.isSafeInteger(request.quality) || request.quality < 1 || request.quality > 100) {
    throw new RangeError("System thumbnail quality must be an integer from 1 to 100.")
  }
}

function validateImage(image: NativeEncodedSystemThumbnail, maxEdge: number): void {
  if (!Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height)
    || image.width < 1 || image.height < 1 || image.width > maxEdge || image.height > maxEdge) {
    throw new RangeError(`Windows Shell RGBA has invalid dimensions ${image.width}x${image.height}.`)
  }
}

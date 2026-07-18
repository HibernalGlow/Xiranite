import type { ResourceScheduler } from "../../ports/ResourceScheduler.js"
import type {
  SystemThumbnailProvider,
  SystemThumbnailRequest,
  SystemThumbnailResult,
} from "../../ports/SystemThumbnailProvider.js"
import { defaultImageTransformScheduler } from "../scheduler/PriorityResourceScheduler.js"
import { detectImageContentType } from "../thumbnails/ThumbnailBlobCodec.js"

const MAX_OUTPUT_BYTES = 2 * 1024 * 1024

export interface NativeSystemThumbnail {
  rgba: Uint8Array
  width: number
  height: number
  premultiplied: boolean
}

export interface NativeSystemThumbnailApi {
  getCachedSystemThumbnail(options: { path: string; maxDimension: number }): Promise<NativeSystemThumbnail | undefined>
}

export interface WindowsSystemThumbnailProviderOptions {
  resourceScheduler?: ResourceScheduler
  loadNative?: () => Promise<NativeSystemThumbnailApi>
  encodeWebp?: typeof encodeWebp
}

export class WindowsSystemThumbnailProvider implements SystemThumbnailProvider {
  readonly #resourceScheduler: ResourceScheduler
  readonly #loadNative: () => Promise<NativeSystemThumbnailApi>
  readonly #encodeWebp: typeof encodeWebp
  #native?: Promise<NativeSystemThumbnailApi>

  constructor(options: WindowsSystemThumbnailProviderOptions = {}) {
    this.#resourceScheduler = options.resourceScheduler ?? defaultImageTransformScheduler
    this.#loadNative = options.loadNative ?? loadNativeSystemThumbnailApi
    this.#encodeWebp = options.encodeWebp ?? encodeWebp
  }

  async getCached(request: SystemThumbnailRequest, signal?: AbortSignal): Promise<SystemThumbnailResult | undefined> {
    validateRequest(request)
    signal?.throwIfAborted()
    const ioLease = await this.#resourceScheduler.acquire({
      resource: "io",
      kind: "neoview.thumbnail.windows-shell-cache",
      priority: request.priority,
      ownerId: request.ownerId,
    }, signal)
    let image: NativeSystemThumbnail | undefined
    try {
      image = await (await this.#getNative()).getCachedSystemThumbnail({
        path: request.sourcePath,
        maxDimension: request.maxEdge,
      })
    } finally {
      ioLease.release()
    }
    signal?.throwIfAborted()
    if (!image) return undefined
    validateImage(image, request.maxEdge)

    const cpuLease = await this.#resourceScheduler.acquire({
      resource: "cpu",
      kind: "neoview.thumbnail.windows-shell-webp",
      priority: request.priority,
      ownerId: request.ownerId,
    }, signal)
    try {
      const bytes = await this.#encodeWebp(image, request.quality, signal)
      if (!bytes.byteLength || bytes.byteLength > MAX_OUTPUT_BYTES) {
        throw new RangeError(`Windows Shell WebP output must be from 1 to ${MAX_OUTPUT_BYTES} bytes.`)
      }
      if (detectImageContentType(bytes) !== "image/webp") throw new Error("Windows Shell encoder returned a non-WebP image.")
      return { bytes, contentType: "image/webp" }
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

async function encodeWebp(image: NativeSystemThumbnail, quality: number, signal?: AbortSignal): Promise<Uint8Array> {
  signal?.throwIfAborted()
  const { default: sharp } = await import("sharp")
  const bytes = await sharp(image.rgba, {
    raw: {
      width: image.width,
      height: image.height,
      channels: 4,
      premultiplied: image.premultiplied,
    },
  }).webp({ quality, effort: 2, smartSubsample: true }).toBuffer()
  signal?.throwIfAborted()
  return bytes
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

function validateImage(image: NativeSystemThumbnail, maxEdge: number): void {
  if (!Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height)
    || image.width < 1 || image.height < 1 || image.width > maxEdge || image.height > maxEdge) {
    throw new RangeError(`Windows Shell RGBA has invalid dimensions ${image.width}x${image.height}.`)
  }
  if (image.rgba.byteLength !== image.width * image.height * 4) {
    throw new RangeError("Windows Shell RGBA byte length does not match its dimensions.")
  }
}

import { Readable } from "node:stream"
import type sharp from "sharp"

import type {
  MosaicImageComposer,
  MosaicImageComposeExecution,
  MosaicImageComposeRequest,
} from "../../../ports/MosaicImageComposer.js"
import type { ResourceScheduler } from "../../../ports/ResourceScheduler.js"
import { defaultImageTransformScheduler } from "../../scheduler/PriorityResourceScheduler.js"

type SharpFactory = typeof sharp

let sharpFactory: Promise<SharpFactory> | undefined

export class SharpMosaicImageComposer implements MosaicImageComposer {
  constructor(private readonly scheduler: ResourceScheduler = defaultImageTransformScheduler) {}

  async compose(
    inputs: readonly ReadableStream<Uint8Array>[],
    request: MosaicImageComposeRequest,
    signal?: AbortSignal,
    execution: MosaicImageComposeExecution = {},
  ): Promise<{ bytes: Uint8Array; contentType: "image/webp" }> {
    validateRequest(inputs, request)
    signal?.throwIfAborted()
    const lease = await this.scheduler.acquire({
      resource: "cpu",
      kind: execution.kind ?? "neoview.thumbnail.mosaic",
      priority: execution.priority ?? "background",
      ownerId: execution.ownerId,
    }, signal)
    try {
      const sharp = await loadSharp()
      const columns = Math.sqrt(request.count)
      const tileSize = Math.floor(request.size / columns)
      const tiles: Buffer[] = []
      for (const input of inputs.slice(0, request.count)) {
        signal?.throwIfAborted()
        tiles.push(await renderTile(sharp, input, tileSize, request.quality, signal))
      }
      signal?.throwIfAborted()
      const composites = tiles.map((input, index) => ({
        input,
        left: (index % columns) * tileSize,
        top: Math.floor(index / columns) * tileSize,
      }))
      const bytes = await sharp({
        create: {
          width: request.size,
          height: request.size,
          channels: 4,
          background: { r: 24, g: 24, b: 27, alpha: 1 },
        },
      }).composite(composites).webp({ quality: request.quality, smartSubsample: true }).toBuffer()
      signal?.throwIfAborted()
      return { bytes: Uint8Array.from(bytes), contentType: "image/webp" }
    } finally {
      lease.release()
    }
  }
}

async function renderTile(
  sharp: SharpFactory,
  input: ReadableStream<Uint8Array>,
  size: number,
  quality: number,
  signal?: AbortSignal,
): Promise<Buffer> {
  const source = Readable.fromWeb(input as never)
  const pipeline = sharp({ animated: false, failOn: "warning", limitInputPixels: 100_000_000, sequentialRead: true })
    .rotate()
    .resize(size, size, { fit: "cover", position: "centre" })
    .webp({ quality, smartSubsample: true })
  const abort = () => {
    source.destroy(signal?.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError"))
    pipeline.destroy(signal?.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError"))
  }
  signal?.addEventListener("abort", abort, { once: true })
  source.pipe(pipeline)
  try {
    return await pipeline.toBuffer()
  } finally {
    signal?.removeEventListener("abort", abort)
    source.destroy()
    pipeline.destroy()
  }
}

function validateRequest(inputs: readonly unknown[], request: MosaicImageComposeRequest): void {
  if (request.count !== 4 && request.count !== 9 && request.count !== 16) throw new RangeError("Mosaic count must be 4, 9 or 16.")
  if (!inputs.length || inputs.length > request.count) throw new RangeError("Mosaic inputs must contain 1..count streams.")
  if (!Number.isSafeInteger(request.size) || request.size < 64 || request.size > 1_024) throw new RangeError("Mosaic size must be 64..1024 pixels.")
  if (!Number.isSafeInteger(request.quality) || request.quality < 1 || request.quality > 100) throw new RangeError("Mosaic quality must be 1..100.")
}

async function loadSharp(): Promise<SharpFactory> {
  if (!sharpFactory) {
    sharpFactory = import("sharp").then((module) => {
      const namespace = module as unknown as { default?: SharpFactory }
      return (namespace.default ?? module) as SharpFactory
    })
  }
  return sharpFactory
}

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
      const tileCount = Math.min(inputs.length, request.count)
      const columns = tileCount < request.count ? Math.max(1, tileCount) : Math.sqrt(request.count)
      const rows = Math.ceil(tileCount / columns)
      const cellWidth = Math.floor(request.size / columns)
      const cellHeight = Math.floor(request.size / rows)
      const tiles: Buffer[] = []
      for (const input of inputs.slice(0, tileCount)) {
        signal?.throwIfAborted()
        tiles.push(await renderTile(sharp, input, cellWidth, cellHeight, request.quality, signal))
      }
      signal?.throwIfAborted()
      const composites = tiles.map((input, index) => ({
        input,
        left: (index % columns) * cellWidth,
        top: Math.floor(index / columns) * cellHeight,
      }))
      const bytes = await sharp({
        create: {
          width: cellWidth * columns,
          height: cellHeight * rows,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
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
  width: number,
  height: number,
  quality: number,
  signal?: AbortSignal,
): Promise<Buffer> {
  const source = Readable.fromWeb(input as never)
  const pipeline = sharp({ animated: false, failOn: "warning", limitInputPixels: 100_000_000, sequentialRead: true })
    .rotate()
    .resize(width, height, { fit: "contain", position: "centre", background: { r: 0, g: 0, b: 0, alpha: 0 } })
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

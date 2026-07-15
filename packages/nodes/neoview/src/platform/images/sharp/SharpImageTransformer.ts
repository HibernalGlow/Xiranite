import { Duplex } from "node:stream"
import type sharp from "sharp"

import { imageTransformContentType } from "../../../domain/image/image-transform.js"
import type { ImageTransformer, ImageTransformExecution, ImageTransformResult } from "../../../ports/ImageTransformer.js"
import type { ResourceScheduler } from "../../../ports/ResourceScheduler.js"
import { defaultImageTransformScheduler } from "../../scheduler/PriorityResourceScheduler.js"

type SharpFactory = typeof sharp

let sharpFactory: Promise<SharpFactory> | undefined

export class SharpImageTransformer implements ImageTransformer {
  constructor(private readonly scheduler: ResourceScheduler = defaultImageTransformScheduler) {}

  async transform(
    input: ReadableStream<Uint8Array>,
    request: Parameters<ImageTransformer["transform"]>[1],
    signal?: AbortSignal,
    execution: ImageTransformExecution = {},
  ): Promise<ImageTransformResult> {
    signal?.throwIfAborted()
    const lease = await this.scheduler.acquire({
      resource: "cpu",
      kind: execution.kind ?? "neoview.image-transform",
      priority: execution.priority ?? "interactive",
      ownerId: execution.ownerId,
    }, signal)
    try {
      const sharp = await loadSharp()
      signal?.throwIfAborted()

      let pipeline = sharp({
        animated: true,
        failOn: "warning",
        limitInputPixels: 100_000_000,
        sequentialRead: true,
      }).rotate()
      if (request.width !== undefined || request.height !== undefined) {
        pipeline = pipeline.resize({
          width: request.width === undefined ? undefined : Math.round(request.width * request.dpr),
          height: request.height === undefined ? undefined : Math.round(request.height * request.dpr),
          fit: request.fit,
          withoutEnlargement: true,
        })
      }
      switch (request.format) {
        case "jpeg": pipeline = pipeline.jpeg({ quality: request.quality, mozjpeg: true }); break
        case "png": pipeline = pipeline.png({ quality: request.quality, progressive: true }); break
        case "webp": pipeline = pipeline.webp({ quality: request.quality, smartSubsample: true }); break
        case "avif": pipeline = pipeline.avif({ quality: request.quality, effort: 4 }); break
      }

      const duplex = Duplex.toWeb(pipeline)
      const pumping = input.pipeTo(duplex.writable as WritableStream<Uint8Array>, { signal })
      void pumping.catch((error: unknown) => pipeline.destroy(asError(error)))
      return {
        stream: releaseWithStream(duplex.readable as ReadableStream<Uint8Array>, lease.release, signal),
        contentType: imageTransformContentType(request.format),
      }
    } catch (error) {
      lease.release()
      throw error
    }
  }
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

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function releaseWithStream(
  stream: ReadableStream<Uint8Array>,
  releaseLease: () => void,
  signal?: AbortSignal,
): ReadableStream<Uint8Array> {
  const reader = stream.getReader()
  let released = false
  const release = () => {
    if (released) return
    released = true
    signal?.removeEventListener("abort", release)
    releaseLease()
  }
  signal?.addEventListener("abort", release, { once: true })
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read()
        if (result.done) {
          release()
          controller.close()
        } else {
          controller.enqueue(result.value)
        }
      } catch (error) {
        release()
        controller.error(error)
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason)
      } finally {
        release()
      }
    },
  })
}

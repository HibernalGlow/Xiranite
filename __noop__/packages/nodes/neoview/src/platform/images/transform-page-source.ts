import type { ImageTransformRequest } from "../../domain/image/image-transform.js"
import type { PageSource } from "../../domain/page/page-content.js"
import type {
  ImageTransformer,
  ImageTransformExecution,
  ImageTransformResult,
} from "../../ports/ImageTransformer.js"
import type { ResourceLease, ResourceScheduler } from "../../ports/ResourceScheduler.js"
import { defaultImageTransformScheduler } from "../scheduler/PriorityResourceScheduler.js"

export async function transformPageSource(
  source: PageSource,
  transformer: ImageTransformer,
  request: ImageTransformRequest,
  signal?: AbortSignal,
  execution: ImageTransformExecution = {},
  scheduler: ResourceScheduler = defaultImageTransformScheduler,
): Promise<ImageTransformResult> {
  signal?.throwIfAborted()
  const lease = source.transformResource
    ? await scheduler.acquire({
        resource: source.transformResource,
        kind: execution.kind ?? "neoview.image-transform",
        priority: execution.priority ?? "interactive",
        ownerId: execution.ownerId,
      }, signal)
    : undefined
  let input: ReadableStream<Uint8Array> | undefined
  try {
    input = await source.open(signal, undefined, { resourceLease: lease })
    const result = await transformer.transform(input, request, signal, {
      ...execution,
      resourceLease: lease,
    })
    if (!lease) return result
    return { ...result, stream: releaseLeaseWithStream(result.stream, lease, signal) }
  } catch (error) {
    await input?.cancel(error).catch(() => undefined)
    lease?.release()
    throw error
  }
}

function releaseLeaseWithStream(
  stream: ReadableStream<Uint8Array>,
  lease: ResourceLease,
  signal?: AbortSignal,
): ReadableStream<Uint8Array> {
  const reader = stream.getReader()
  let released = false
  const release = () => {
    if (released) return
    released = true
    signal?.removeEventListener("abort", release)
    lease.release()
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

import type { ImageTransformRequest } from "../domain/image/image-transform.js"
import type { ResourcePriority } from "./ResourceScheduler.js"

export interface ImageTransformResult {
  stream: ReadableStream<Uint8Array>
  contentType: string
}

export interface ImageTransformExecution {
  priority?: ResourcePriority
  kind?: string
  ownerId?: string
}

export interface ImageTransformer {
  transform(
    input: ReadableStream<Uint8Array>,
    request: ImageTransformRequest,
    signal?: AbortSignal,
    execution?: ImageTransformExecution,
  ): Promise<ImageTransformResult>
}

export type ImageTransformerLoader = () => Promise<ImageTransformer>

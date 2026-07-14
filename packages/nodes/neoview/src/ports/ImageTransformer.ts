import type { ImageTransformRequest } from "../domain/image/image-transform.js"

export interface ImageTransformResult {
  stream: ReadableStream<Uint8Array>
  contentType: string
}

export interface ImageTransformer {
  transform(
    input: ReadableStream<Uint8Array>,
    request: ImageTransformRequest,
    signal?: AbortSignal,
  ): Promise<ImageTransformResult>
}

export type ImageTransformerLoader = () => Promise<ImageTransformer>

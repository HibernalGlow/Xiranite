import type { ResourcePriority } from "./ResourceScheduler.js"

export type MosaicPreviewCount = 4 | 9 | 16

export interface MosaicImageComposeRequest {
  count: MosaicPreviewCount
  size: number
  lossless?: boolean
  quality: number
}

export interface MosaicImageComposeExecution {
  priority?: ResourcePriority
  kind?: string
  ownerId?: string
}

export interface MosaicImageComposer {
  compose(
    inputs: readonly ReadableStream<Uint8Array>[],
    request: MosaicImageComposeRequest,
    signal?: AbortSignal,
    execution?: MosaicImageComposeExecution,
  ): Promise<{ bytes: Uint8Array; contentType: "image/webp" }>
}

export type MosaicImageComposerLoader = () => Promise<MosaicImageComposer>

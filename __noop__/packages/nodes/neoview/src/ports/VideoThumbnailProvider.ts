import type { ResourcePriority, ResourceScheduler } from "./ResourceScheduler.js"

export type VideoThumbnailInput =
  | { sourcePath: string; sourceStream?: never }
  | { sourcePath?: never; sourceStream: ReadableStream<Uint8Array> }

export type VideoThumbnailRequest = VideoThumbnailInput & {
  maxEdge: number
  quality: number
  priority: ResourcePriority
  ownerId?: string
}

export interface VideoThumbnailResult {
  bytes: Uint8Array
  contentType: "image/webp"
}

export interface VideoThumbnailProvider {
  generate(request: VideoThumbnailRequest, signal?: AbortSignal): Promise<VideoThumbnailResult>
}

export type VideoThumbnailProviderLoader = () => Promise<VideoThumbnailProvider>

export interface VideoThumbnailProviderSchedulerOptions {
  resourceScheduler?: ResourceScheduler
}

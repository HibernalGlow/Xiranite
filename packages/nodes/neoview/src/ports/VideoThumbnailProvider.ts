import type { ResourcePriority, ResourceScheduler } from "./ResourceScheduler.js"

export interface VideoThumbnailRequest {
  sourcePath: string
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

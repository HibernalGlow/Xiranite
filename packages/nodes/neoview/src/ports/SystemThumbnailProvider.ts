import type { ResourcePriority, ResourceScheduler } from "./ResourceScheduler.js"

export interface SystemThumbnailRequest {
  sourcePath: string
  maxEdge: number
  lossless?: boolean
  quality: number
  priority: ResourcePriority
  ownerId?: string
}

export interface SystemThumbnailResult {
  bytes: Uint8Array
  contentType: "image/webp"
}

export interface SystemThumbnailProvider {
  getCached(request: SystemThumbnailRequest, signal?: AbortSignal): Promise<SystemThumbnailResult | undefined>
}

export type SystemThumbnailProviderLoader = () => Promise<SystemThumbnailProvider>

export interface SystemThumbnailProviderSchedulerOptions {
  resourceScheduler?: ResourceScheduler
}

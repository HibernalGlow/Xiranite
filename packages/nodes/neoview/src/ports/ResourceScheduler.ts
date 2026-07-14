export type ResourcePriority = "interactive" | "prefetch" | "background"

export interface ResourceTaskRequest {
  kind: "image-transform" | "archive-read" | "archive-extract" | "thumbnail" | "super-resolution"
  priority: ResourcePriority
  ownerId?: string
}

export interface ResourceLease {
  release(): void
}

export interface ResourceScheduler {
  acquire(request: ResourceTaskRequest, signal?: AbortSignal): Promise<ResourceLease>
}

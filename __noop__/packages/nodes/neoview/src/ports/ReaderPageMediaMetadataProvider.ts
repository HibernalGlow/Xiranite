import type { ResourcePriority, ResourceScheduler } from "./ResourceScheduler.js"

export interface ReaderPageMediaDetails {
  durationSeconds?: number
  frameRate?: number
  bitRateBps?: number
  videoCodec?: string
  audioCodec?: string
}

export type ReaderPageMediaMetadataInput =
  | { sourcePath: string; sourceStream?: never }
  | { sourcePath?: never; sourceStream: ReadableStream<Uint8Array> }

export type ReaderPageMediaMetadataRequest = ReaderPageMediaMetadataInput & {
  priority: ResourcePriority
  ownerId?: string
}

export interface ReaderPageMediaMetadataProvider {
  inspect(request: ReaderPageMediaMetadataRequest, signal?: AbortSignal): Promise<ReaderPageMediaDetails>
}

export type ReaderPageMediaMetadataProviderLoader = () => Promise<ReaderPageMediaMetadataProvider>

export interface ReaderPageMediaMetadataProviderSchedulerOptions {
  resourceScheduler?: ResourceScheduler
}

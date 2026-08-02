import { useMemo } from "react"

import type { ReaderHttpClient, ReaderLibraryThumbnailRegistrationDto } from "../../adapters/reader-http-client"
import {
  useSourceThumbnails,
  type SourceThumbnailRequest,
  type SourceThumbnailsState,
} from "../../../shared/useSourceThumbnails"

export interface ReaderLibraryThumbnailItem extends ReaderLibraryThumbnailRegistrationDto {
  id: string
}

export type ReaderLibraryThumbnailsState = SourceThumbnailsState

export function useReaderLibraryThumbnails(
  client: ReaderHttpClient,
  owner: string,
  items: readonly ReaderLibraryThumbnailItem[],
): ReaderLibraryThumbnailsState {
  const sourceClient = useMemo(() => client.registerLibraryThumbnails ? {
    register: client.registerLibraryThumbnails,
    releaseContext: client.releaseLibraryThumbnailContext ?? (async () => undefined),
  } : undefined, [client])
  return useSourceThumbnails(sourceClient, owner, items as readonly SourceThumbnailRequest[])
}

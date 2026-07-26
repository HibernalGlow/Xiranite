import { QueryClient } from "@tanstack/react-query"

import type { ReaderLibraryThumbnailBatchDto } from "../../adapters/reader-http-client"

const MAX_AUTOMATIC_RETRY_DELAY_MS = 5_000
const libraryThumbnailQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 60_000,
      staleTime: 30_000,
    },
  },
})

type ThumbnailRequest = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/**
 * Wait for one registered visible batch before publishing its URLs to image elements.
 * TanStack Query shares concurrent tab demands and owns the bounded Retry-After lifecycle.
 */
export async function waitForLibraryThumbnailBatch(
  batch: Pick<ReaderLibraryThumbnailBatchDto, "contextId" | "generation" | "items">,
  signal?: AbortSignal,
  request: ThumbnailRequest = globalThis.fetch,
): Promise<void> {
  const urls = [...new Set(batch.items.flatMap((item) => item.thumbnailUrls?.length ? item.thumbnailUrls : [item.thumbnailUrl]))]
    .filter(isManagedLibraryThumbnailUrl)
  if (!urls.length) return

  signal?.throwIfAborted()
  await libraryThumbnailQueryClient.fetchQuery({
    queryKey: ["neoview", "library-thumbnail-ready", batch.contextId, batch.generation, ...urls.map(thumbnailQueryKeyUrl)],
    queryFn: async ({ signal: querySignal }) => {
      const responses = await Promise.all(urls.map((url) => request(url, {
        method: "HEAD",
        cache: "no-store",
        signal: querySignal,
      })))
      const deferred = responses.flatMap((response) => retryDelayForResponse(response))
      if (deferred.length) throw new ThumbnailBatchDeferredError(Math.max(...deferred))
      return true
    },
    retry: (failureCount, error) =>
      error instanceof ThumbnailBatchDeferredError
      && error.retryAfterMs <= MAX_AUTOMATIC_RETRY_DELAY_MS
      && failureCount < 2,
    retryDelay: (_attempt, error) => error instanceof ThumbnailBatchDeferredError ? error.retryAfterMs : 0,
  })
  signal?.throwIfAborted()
}

function isManagedLibraryThumbnailUrl(value: string): boolean {
  try {
    return /^\/reader\/library\/t\/[^/]+$/u.test(new URL(value).pathname)
  } catch {
    return false
  }
}

function retryDelayForResponse(response: Response): number[] {
  if (response.status !== 429 && response.status !== 503 && response.status !== 504) return []
  const seconds = Number(response.headers.get("retry-after"))
  return [Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : 250]
}

function thumbnailQueryKeyUrl(value: string): string {
  const url = new URL(value)
  url.searchParams.delete("token")
  return url.href
}

class ThumbnailBatchDeferredError extends Error {
  constructor(readonly retryAfterMs: number) {
    super(`Library thumbnail batch is deferred for ${retryAfterMs}ms.`)
    this.name = "ThumbnailBatchDeferredError"
  }
}

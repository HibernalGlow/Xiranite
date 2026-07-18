import { useEffect } from "react"

import type { ReaderHttpClient, ReaderPageDto } from "../../adapters/reader-http-client"

export function useReaderAdjacentPagePreloader({
  client,
  sessionId,
  activePageIndex,
  totalPages,
  enabled = true,
  preload,
}: {
  client: ReaderHttpClient
  sessionId?: string
  activePageIndex?: number
  totalPages?: number
  enabled?: boolean
  preload(pages: readonly ReaderPageDto[]): void
}): void {
  useEffect(() => {
    if (!enabled || !sessionId || activePageIndex === undefined || !totalPages || totalPages < 2) return
    const controller = new AbortController()
    const cursor = Math.max(0, activePageIndex - 1)
    const limit = Math.min(3, totalPages - cursor)
    void client.listPages(sessionId, cursor, limit, controller.signal).then((result) => {
      if (controller.signal.aborted) return
      const adjacent = result.pages.filter((page) => Math.abs(page.index - activePageIndex) === 1)
      if (adjacent.length) preload(adjacent)
    }).catch(() => undefined)
    return () => controller.abort()
  }, [activePageIndex, client, enabled, preload, sessionId, totalPages])
}

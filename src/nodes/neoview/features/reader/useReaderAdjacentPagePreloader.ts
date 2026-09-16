import { useEffect } from "react"

import type { ReaderHttpClient, ReaderPageDto, ReaderPreloadPlanDto } from "../../adapters/reader-http-client"
import { readerPreloadPlanRequiresRelease } from "./readerPreloadPolicy"

export function useReaderAdjacentPagePreloader({
  client,
  sessionId,
  activePageIndex,
  totalPages,
  plan,
  enabled = true,
  preload,
  cancel,
}: {
  client: ReaderHttpClient
  sessionId?: string
  activePageIndex?: number
  totalPages?: number
  plan?: ReaderPreloadPlanDto
  enabled?: boolean
  preload(pages: readonly ReaderPageDto[], generation?: number): void
  cancel?(): void
}): void {
  useEffect(() => {
    if (!enabled || !sessionId || activePageIndex === undefined || !totalPages || totalPages < 2) {
      if (!enabled) cancel?.()
      return
    }
    if (plan?.admission === "paused") {
      // Paused only means "start no new work". Releasing the retained window here
      // is what made the next turn cold: the budget pauses precisely because a
      // page turn just happened, so the eviction landed exactly when the decoded
      // window was worth keeping. Real teardown signals still release.
      if (readerPreloadPlanRequiresRelease(plan)) cancel?.()
      return
    }
    const controller = new AbortController()
    const plannedIndexes = plan
      ? [...new Set(plan.candidates.flatMap((candidate) => candidate.pageIndexes))].slice(0, 4)
      : [activePageIndex - 1, activePageIndex + 1].filter((index) => index >= 0 && index < totalPages)
    if (!plannedIndexes.length) return
    const desired = new Set(plannedIndexes)
    const cursor = Math.min(...plannedIndexes)
    const end = Math.max(...plannedIndexes)
    const limit = end - cursor + 1
    const center = Math.floor((cursor + end) / 2)
    const loadPages = client.frameWindow
      ? client.frameWindow(
          sessionId,
          center,
          Math.max(center - cursor, end - center),
          controller.signal,
        ).then((result) => result.visiblePages)
      : client.listPages(sessionId, cursor, limit, controller.signal).then((result) => result.pages)
    void loadPages.then((pages) => {
      if (controller.signal.aborted) return
      const pagesByIndex = new Map(pages.map((page) => [page.index, page]))
      const candidates = plannedIndexes.flatMap((index) => {
        const page = pagesByIndex.get(index)
        return page && desired.has(page.index) ? [page] : []
      })
      if (candidates.length) {
        if (plan) preload(candidates, plan.generation)
        else preload(candidates)
      }
    }).catch(() => undefined)
    return () => controller.abort()
  }, [activePageIndex, cancel, client, enabled, plan, preload, sessionId, totalPages])
}

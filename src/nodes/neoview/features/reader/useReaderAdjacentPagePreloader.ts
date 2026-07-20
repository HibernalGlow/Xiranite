import { useEffect } from "react"

import type { ReaderHttpClient, ReaderPageDto, ReaderPreloadPlanDto } from "../../adapters/reader-http-client"

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
    if (!enabled || !sessionId || activePageIndex === undefined || !totalPages || totalPages < 2) return
    if (plan?.admission === "paused") {
      cancel?.()
      return
    }
    const controller = new AbortController()
    const plannedIndexes = plan
      ? [...new Set(plan.candidates.flatMap((candidate) => candidate.pageIndexes))].slice(0, 4)
      : [activePageIndex - 1, activePageIndex + 1].filter((index) => index >= 0 && index < totalPages)
    if (!plannedIndexes.length) return
    const desired = new Set(plannedIndexes)
    const cursor = Math.min(...plannedIndexes)
    const limit = Math.max(...plannedIndexes) - cursor + 1
    void client.listPages(sessionId, cursor, limit, controller.signal).then((result) => {
      if (controller.signal.aborted) return
      const candidates = result.pages.filter((page) => desired.has(page.index))
      if (candidates.length) {
        if (plan) preload(candidates, plan.generation)
        else preload(candidates)
      }
    }).catch(() => undefined)
    return () => controller.abort()
  }, [activePageIndex, cancel, client, enabled, plan, preload, sessionId, totalPages])
}

import { useEffect } from "react"

import type { ReaderHttpClient, ReaderPageDto, ReaderPreloadPlanDto, ReaderUpscaleArtifactProbeResultDto } from "../../adapters/reader-http-client"
import { readerUpscaleArtifactPage, setReaderUpscaleArtifact } from "./ReaderUpscaleArtifactStore"

const MAX_UPSCALE_PROBE_CANDIDATES = 2
const UPSCALE_PENDING_POLL_MS = 500
const UPSCALE_PENDING_POLL_LIMIT = 60

export function useReaderAdjacentPagePreloader({
  client,
  sessionId,
  activePageIndex,
  totalPages,
  plan,
  enabled = true,
  upscaleEnabled = false,
  preload,
  cancel,
}: {
  client: ReaderHttpClient
  sessionId?: string
  activePageIndex?: number
  totalPages?: number
  plan?: ReaderPreloadPlanDto
  enabled?: boolean
  upscaleEnabled?: boolean
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
    void loadPages.then(async (pages) => {
      if (controller.signal.aborted) return
      const pagesByIndex = new Map(pages.map((page) => [page.index, page]))
      const candidates = plannedIndexes.flatMap((index) => {
        const page = pagesByIndex.get(index)
        return page && desired.has(page.index) ? [page] : []
      })
      if (!candidates.length) return
      const generation = plan?.generation
      const preloadResolved = (resolvedPages: readonly ReaderPageDto[]) => {
        if (generation === undefined) preload(resolvedPages)
        else preload(resolvedPages, generation)
      }
      if (!upscaleEnabled || !client.probeUpscalePage) {
        preloadResolved(candidates)
        return
      }
      // This is deliberately a native Promise.all rather than p-map. There
      // are at most two probes, and p-map v4 resolves a Node-only os branch in
      // Vite's browser bundle even when auto-upscale is disabled.
      const probes = await Promise.all(candidates.slice(0, MAX_UPSCALE_PROBE_CANDIDATES).map(async (page) => ({
        page,
        result: await client.probeUpscalePage!(sessionId, page.id, controller.signal).catch(() => ({ status: "miss" as const })),
      })))
      if (controller.signal.aborted) return
      const results = new Map(probes.map(({ page, result }) => [page.id, result]))
      const preloadPages = candidates.map((page) => artifactPageFromProbe(sessionId, page, results.get(page.id)) ?? page)
      preloadResolved(preloadPages)

      const nearestPending = probes.find(({ result }) => result.status === "pending")
      if (nearestPending) {
        void waitForUpscaleArtifact(client, sessionId, nearestPending.page, controller.signal).then((artifactPage) => {
          if (artifactPage && !controller.signal.aborted) preloadResolved([artifactPage])
        }).catch(() => undefined)
      }
    }).catch(() => undefined)
    return () => controller.abort()
  }, [activePageIndex, cancel, client, enabled, plan, preload, sessionId, totalPages, upscaleEnabled])
}

function artifactPageFromProbe(
  sessionId: string,
  page: ReaderPageDto,
  result: ReaderUpscaleArtifactProbeResultDto | undefined,
): ReaderPageDto | undefined {
  if (!result || result.status === "miss" || result.status === "pending") return undefined
  const completed = result.status !== "skipped" && result.status !== "bypassed" && result.status !== "rejected"
  setReaderUpscaleArtifact(sessionId, page.id, { state: completed ? "completed" : "skipped", result })
  return readerUpscaleArtifactPage(page, result)
}

async function waitForUpscaleArtifact(
  client: ReaderHttpClient,
  sessionId: string,
  page: ReaderPageDto,
  signal: AbortSignal,
): Promise<ReaderPageDto | undefined> {
  for (let attempt = 0; attempt < UPSCALE_PENDING_POLL_LIMIT; attempt += 1) {
    await abortableDelay(UPSCALE_PENDING_POLL_MS, signal)
    const result = await client.probeUpscalePage!(sessionId, page.id, signal)
    if (result.status === "pending") continue
    return artifactPageFromProbe(sessionId, page, result)
  }
  return undefined
}

async function abortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); resolve() }, delayMs)
    const abort = () => { clearTimeout(timer); cleanup(); reject(signal.reason) }
    const cleanup = () => signal.removeEventListener("abort", abort)
    signal.addEventListener("abort", abort, { once: true })
  })
}

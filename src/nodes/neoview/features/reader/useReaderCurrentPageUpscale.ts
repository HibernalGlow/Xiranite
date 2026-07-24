import { useEffect } from "react"

import { createLogger } from "@/lib/logger"
import type { ReaderHttpClient, ReaderPageDto, ReaderSuperResolutionConfigDto } from "../../adapters/reader-http-client"
import { readerUpscaleArtifactSnapshot, setReaderUpscaleArtifact } from "./ReaderUpscaleArtifactStore"

interface CurrentPageQueue {
  client: ReaderHttpClient
  pending: Map<string, ReaderPageDto>
  running: boolean
}

const queues = new Map<string, CurrentPageQueue>()
const logger = createLogger("neoview.super-resolution")
const CURRENT_PAGE_QUEUE_OWNER = "current-page-queue"

export function useReaderCurrentPageUpscale({
  client,
  sessionId,
  pages,
  superResolution,
}: {
  client: ReaderHttpClient
  sessionId: string
  pages: readonly ReaderPageDto[]
  superResolution?: ReaderSuperResolutionConfigDto
}): void {
  const enabled = superResolution?.provider !== "disabled"
    && superResolution?.preferences.globalUpscaleEnabled !== false
    && superResolution?.preferences.autoUpscaleEnabled === true
    && superResolution?.preferences.currentImageUpscaleEnabled !== false
  const pageRevision = pages.map((page) => `${page.id}:${page.contentVersion}`).join("\0")

  useEffect(() => {
    if (!enabled || !client.upscalePage) return
    const images = pages.filter((page) => page.mediaKind === "image")
    if (!images.length) return
    enqueueCurrentPages(client, sessionId, images)
  }, [client, enabled, pageRevision, sessionId])
}

function enqueueCurrentPages(client: ReaderHttpClient, sessionId: string, pages: readonly ReaderPageDto[]): void {
  const queue = queues.get(sessionId) ?? { client, pending: new Map<string, ReaderPageDto>(), running: false }
  queue.client = client
  // Navigation replaces queued intermediate pages. A page already executing is
  // allowed to publish, then the newest visible page runs next.
  const next = new Map<string, ReaderPageDto>()
  for (const page of pages) {
    const existing = readerUpscaleArtifactSnapshot(sessionId, page.id)
    if (existing.result?.artifactUrl && existing.result.version) continue
    // PageImage can begin its request before this parent effect runs. Do not
    // enqueue the same page a second time while either owner is processing it.
    if (existing.state === "processing") continue
    next.set(page.id, page)
    setReaderUpscaleArtifact(sessionId, page.id, { state: "queued", owner: CURRENT_PAGE_QUEUE_OWNER })
  }
  for (const page of queue.pending.values()) {
    const existing = readerUpscaleArtifactSnapshot(sessionId, page.id)
    if (!next.has(page.id) && existing.state === "queued" && existing.owner === CURRENT_PAGE_QUEUE_OWNER) {
      setReaderUpscaleArtifact(sessionId, page.id, { state: "idle" })
    }
  }
  queue.pending = next
  queues.set(sessionId, queue)
  if (!queue.running) void drainCurrentPages(sessionId, queue)
}

async function drainCurrentPages(sessionId: string, queue: CurrentPageQueue): Promise<void> {
  queue.running = true
  try {
    while (queue.pending.size) {
      const pages = [...queue.pending.values()]
      queue.pending.clear()
      await Promise.all(pages.map((page) => upscaleCurrentPage(queue.client, sessionId, page)))
    }
  } finally {
    queue.running = false
    if (queue.pending.size) void drainCurrentPages(sessionId, queue)
    else if (queues.get(sessionId) === queue) queues.delete(sessionId)
  }
}

async function upscaleCurrentPage(client: ReaderHttpClient, sessionId: string, page: ReaderPageDto): Promise<void> {
  const existing = readerUpscaleArtifactSnapshot(sessionId, page.id)
  if (existing.result?.artifactUrl && existing.result.version) return
  setReaderUpscaleArtifact(sessionId, page.id, { state: "processing", owner: CURRENT_PAGE_QUEUE_OWNER })
  logger.info("Started current-page super-resolution", { sessionId, pageId: page.id, pageIndex: page.index, priority: "interactive" })
  try {
    const result = await client.upscalePage!(sessionId, page.id, "automatic-current")
    const skipped = result.status === "skipped" || result.status === "bypassed" || result.status === "rejected"
    setReaderUpscaleArtifact(sessionId, page.id, { state: skipped ? "skipped" : "completed", result })
    logger.info("Finished current-page super-resolution", {
      sessionId,
      pageId: page.id,
      pageIndex: page.index,
      status: result.status,
      bytes: result.bytes,
      width: result.execution?.width,
      height: result.execution?.height,
      elapsedMs: result.execution?.elapsedMs,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    setReaderUpscaleArtifact(sessionId, page.id, { state: "failed", error: message })
    logger.error("Current-page super-resolution failed", error, { sessionId, pageId: page.id, pageIndex: page.index })
  }
}

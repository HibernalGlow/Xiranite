import { ListPlus, LoaderCircle, Sparkles } from "lucide-react"
import { useCallback, useEffect, useSyncExternalStore } from "react"

import { cn } from "@/lib/utils"
import type { ReaderHttpClient } from "../../adapters/reader-http-client"
import {
  EMPTY_READER_UPSCALE_ARTIFACT_SNAPSHOT,
  readerUpscaleArtifactSnapshot,
  setReaderUpscaleArtifact,
  subscribeReaderUpscaleArtifact,
} from "./ReaderUpscaleArtifactStore"
import { readerUpscaleCoverageSnapshot, subscribeReaderUpscaleCoverage } from "./ReaderUpscaleCoverageStore"

const probeFlights = new Map<string, Promise<void>>()

export function ReaderUpscaleMark({ sessionId, pageId, pageIndex, client, className }: {
  sessionId: string
  pageId: string
  pageIndex: number
  client: ReaderHttpClient
  className?: string
}) {
  const subscribeArtifact = useCallback((listener: () => void) => subscribeReaderUpscaleArtifact(sessionId, pageId, listener), [pageId, sessionId])
  const getArtifact = useCallback(() => readerUpscaleArtifactSnapshot(sessionId, pageId), [pageId, sessionId])
  const artifact = useSyncExternalStore(subscribeArtifact, getArtifact, () => EMPTY_READER_UPSCALE_ARTIFACT_SNAPSHOT)
  const subscribeCoverage = useCallback((listener: () => void) => subscribeReaderUpscaleCoverage(sessionId, listener), [sessionId])
  const getCoverage = useCallback(() => readerUpscaleCoverageSnapshot(sessionId), [sessionId])
  const coverage = useSyncExternalStore(subscribeCoverage, getCoverage, getCoverage)
  const completed = coverage.completed.has(pageIndex) || Boolean(artifact.result?.artifactUrl && artifact.result.version)
  const processing = !completed && (coverage.processing.has(pageIndex) || artifact.state === "processing")
  const queued = !completed && !processing && (coverage.queued.has(pageIndex) || artifact.state === "queued")

  useEffect(() => {
    if (completed || processing || !client.probeUpscalePage) return
    probeArtifact(client, sessionId, pageId)
  }, [client, completed, pageId, processing, sessionId])

  if (!completed && !processing && !queued) return null
  const label = completed ? "已超分" : processing ? "超分中" : "已进入超分队列"
  return (
    <span
      title={label}
      aria-label={label}
      data-reader-upscale-mark={completed ? "completed" : processing ? "processing" : "queued"}
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center rounded-sm border border-cyan-300/55 bg-black/70 text-cyan-200",
        processing && "animate-pulse border-yellow-300/55 text-yellow-200",
        queued && "border-sky-300/55 text-sky-200",
        className,
      )}
    >
      {completed ? <Sparkles className="size-2.5" aria-hidden="true" /> : processing
        ? <LoaderCircle className="size-2.5 animate-spin" aria-hidden="true" />
        : <ListPlus className="size-2.5" aria-hidden="true" />}
    </span>
  )
}

function probeArtifact(client: ReaderHttpClient, sessionId: string, pageId: string): void {
  const key = `${sessionId}:${pageId}`
  if (probeFlights.has(key)) return
  const operation = client.probeUpscalePage!(sessionId, pageId).then((result) => {
    if (result.status === "miss" || result.status === "pending") return
    const skipped = result.status === "skipped" || result.status === "bypassed" || result.status === "rejected"
    setReaderUpscaleArtifact(sessionId, pageId, { state: skipped ? "skipped" : "completed", result })
  }).catch(() => undefined).finally(() => probeFlights.delete(key))
  probeFlights.set(key, operation)
}

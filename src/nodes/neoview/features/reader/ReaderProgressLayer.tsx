import { useCallback, useSyncExternalStore } from "react"

import { cn } from "@/lib/utils"
import type { ReaderUpscalePreloadSnapshotDto } from "../../adapters/reader-http-client"
import type { ReaderViewerTogglePort } from "../viewer/ReaderViewerToggleStore"
import {
  EMPTY_READER_UPSCALE_ARTIFACT_SNAPSHOT,
  readerUpscaleArtifactSnapshot,
  subscribeReaderUpscaleArtifact,
} from "./ReaderUpscaleArtifactStore"

const DEFAULT_VIEWER_TOGGLES = {
  progressBarVisible: true,
  progressBarGlow: true,
  pageInfoVisible: true,
}
const NOOP_SUBSCRIBE = () => () => undefined
const DEFAULT_TOGGLE_SNAPSHOT = () => DEFAULT_VIEWER_TOGGLES

export function ReaderProgressLayer({
  sessionId,
  currentPageId,
  currentPageIndex,
  totalPages,
  direction,
  superResolutionEnabled,
  snapshots,
  error,
  viewerToggles,
}: {
  sessionId: string
  currentPageId?: string
  currentPageIndex: number
  totalPages: number
  direction: "left-to-right" | "right-to-left"
  superResolutionEnabled: boolean
  snapshots: readonly ReaderUpscalePreloadSnapshotDto[]
  error?: string
  viewerToggles?: ReaderViewerTogglePort
}) {
  const toggles = useSyncExternalStore(
    viewerToggles?.subscribe ?? NOOP_SUBSCRIBE,
    viewerToggles?.getSnapshot ?? DEFAULT_TOGGLE_SNAPSHOT,
    viewerToggles?.getSnapshot ?? DEFAULT_TOGGLE_SNAPSHOT,
  )
  const subscribeArtifact = useCallback((listener: () => void) => currentPageId
    ? subscribeReaderUpscaleArtifact(sessionId, currentPageId, listener)
    : NOOP_SUBSCRIBE(), [currentPageId, sessionId])
  const getArtifact = useCallback(() => currentPageId
    ? readerUpscaleArtifactSnapshot(sessionId, currentPageId)
    : EMPTY_READER_UPSCALE_ARTIFACT_SNAPSHOT, [currentPageId, sessionId])
  const artifact = useSyncExternalStore(subscribeArtifact, getArtifact, getArtifact)

  if (!toggles.progressBarVisible || totalPages <= 0) return null
  const rtl = direction === "right-to-left"
  const readingProgress = clampPercent(((currentPageIndex + 1) / totalPages) * 100)
  const nearby = snapshots.find((snapshot) => snapshot.mode === "nearby")
  const planned = snapshots.reduce((total, snapshot) => total + snapshot.planned, 0)
  const settled = snapshots.reduce((total, snapshot) => total + snapshot.settled, 0)
  const coverageTotal = snapshots.reduce((maximum, snapshot) => Math.max(maximum, snapshot.totalPages ?? 0), 0)
  const scheduledPages = snapshots.reduce((maximum, snapshot) => Math.max(maximum, snapshot.scheduledPages ?? 0), 0)
  const upscaledPages = snapshots.reduce((maximum, snapshot) => Math.max(maximum, snapshot.upscaledPages ?? 0), 0)
  const upscaleProgress = coverageTotal > 0
    ? clampPercent((upscaledPages / coverageTotal) * 100)
    : planned > 0 ? clampPercent((settled / planned) * 100) : 0
  const nearbyProgress = coverageTotal > 0
    ? clampPercent((scheduledPages / coverageTotal) * 100)
    : clampPercent((nearby?.progress ?? 0) * 100)
  const active = artifact.state === "processing" || snapshots.some((snapshot) => snapshot.state === "queued" || snapshot.state === "countdown" || snapshot.state === "running")
  const readingColor = artifact.state === "processing"
    ? "#ffffff"
    : artifact.state === "completed"
      ? "#bbf7d0"
      : artifact.state === "failed"
        ? "#ef4444"
        : currentPageIndex >= totalPages - 1 ? "var(--primary)" : "var(--accent)"

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 z-[65] h-7"
      data-reader-progress-layer="true"
      data-upscale-preload-error={error || undefined}
    >
      {superResolutionEnabled ? (
        <div
          role="progressbar"
          aria-label="超分进度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(upscaleProgress)}
          data-reader-upscale-scheduled-pages={scheduledPages || undefined}
          data-reader-upscaled-pages={upscaledPages || undefined}
          className="absolute inset-x-0 bottom-0 h-[3px] overflow-hidden bg-cyan-500/20"
          data-reader-progress-track="upscale"
        >
          {nearbyProgress > 0 ? <div className="absolute inset-y-0 bg-yellow-400/70 transition-[width] duration-300" style={progressStyle(nearbyProgress, rtl)} data-reader-pre-upscale-progress="true" /> : null}
          {upscaleProgress > 0 ? <div className={cn("absolute inset-y-0 bg-cyan-400 shadow-[0_0_8px_rgb(34_211_238/0.75)] transition-[width] duration-300", active && "animate-pulse")} style={progressStyle(upscaleProgress, rtl)} data-reader-upscale-progress="true" /> : null}
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-label="翻页进度"
        aria-valuemin={1}
        aria-valuemax={totalPages}
        aria-valuenow={Math.min(totalPages, currentPageIndex + 1)}
        className="absolute inset-x-0 bottom-[3px] h-[3px] overflow-hidden bg-white/15"
        data-reader-progress-track="reading"
      >
        <div
          className={cn("absolute inset-y-0 transition-[width,background-color] duration-300", artifact.state === "processing" && "animate-pulse")}
          style={{ ...progressStyle(readingProgress, rtl), backgroundColor: readingColor, ...(toggles.progressBarGlow && artifact.state !== "processing" ? { boxShadow: `0 0 8px ${readingColor}` } : {}) }}
          data-reader-reading-progress="true"
        />
      </div>
    </div>
  )
}

function progressStyle(progress: number, rtl: boolean): React.CSSProperties {
  return { width: `${clampPercent(progress)}%`, ...(rtl ? { right: 0 } : { left: 0 }) }
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0))
}

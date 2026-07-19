/**
 * @migrated-from src/lib/stackview/StackView.svelte
 * @source-hash sha256:f54ee3722b87db292abadc01c07613518bdfbd3e6ae68212300d91a5cd79909e
 * @features panels-toolbar-shell
 * @migration-status adapted
 */
import { lazy, Suspense, useEffect, useRef, useState } from "react"
import {
  calculateReaderFrameSize,
  calculateReaderScale,
  calculateReaderPageStretchScales,
  effectiveReaderRotation,
  rotatePresentationSize,
  type PresentationSize,
  type ReaderPresentation,
} from "@xiranite/node-neoview/ui-core"

import type { ReaderHttpClient, ReaderMediaConfigDto, ReaderPageDto, ReaderSubtitleConfigDto, ReaderSuperResolutionConfigDto } from "../../adapters/reader-http-client"
import type { ReaderColorFilterPort } from "../color-filter/ReaderColorFilterStore"
import type { ReaderImageTrimPort } from "../image-trim/ReaderImageTrimStore"
import type { ReaderPageTransitionPort } from "../page-transition/ReaderPageTransitionStore"
import type { ReaderVideoController } from "../video/ReaderVideoController"
import { ReaderPageTransitionLayer } from "../page-transition/ReaderPageTransitionLayer"
import { PageMedia } from "./PageMedia"

const LazyReaderPanoramaFrame = lazy(async () => ({ default: (await import("./ReaderPanoramaFrame")).ReaderPanoramaFrame }))

export function ReaderFrame({ pages, presentation, panorama, direction, pageMode, totalPages, anchorPageIndex, colorFilter, imageTrim, pageTransition, videoController, sessionId, client, media, superResolution, onSubtitleConfigChange, onVisiblePageChange, onVideoListEnded }: {
  pages: ReaderPageDto[]
  presentation: ReaderPresentation
  panorama?: boolean
  direction?: "left-to-right" | "right-to-left"
  pageMode?: "single" | "double"
  totalPages: number
  anchorPageIndex: number
  colorFilter?: ReaderColorFilterPort
  imageTrim?: ReaderImageTrimPort
  pageTransition?: ReaderPageTransitionPort
  videoController: ReaderVideoController
  sessionId: string
  client: ReaderHttpClient
  media?: ReaderMediaConfigDto
  superResolution?: ReaderSuperResolutionConfigDto
  onSubtitleConfigChange(patch: Partial<ReaderSubtitleConfigDto>): Promise<void>
  onVideoListEnded: () => void
  onVisiblePageChange?: (pageIndex: number) => void
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const viewport = useObservedSize(viewportRef, panorama)
  if (panorama) return <Suspense fallback={null}><LazyReaderPanoramaFrame sessionId={sessionId} totalPages={totalPages} anchorPageIndex={anchorPageIndex} currentPages={pages} presentation={presentation} direction={direction ?? "left-to-right"} pageMode={pageMode ?? "single"} colorFilter={colorFilter} imageTrim={imageTrim} videoController={videoController} client={client} media={media} superResolution={superResolution} onSubtitleConfigChange={onSubtitleConfigChange} onVisiblePageChange={onVisiblePageChange} onVideoListEnded={onVideoListEnded} /></Suspense>
  const frameOrientation = pages.length > 1 ? "horizontal" : presentation.orientation
  const dimensions = pages.flatMap((page) => page.dimensions ? [page.dimensions] : [])
  const frameSize = dimensions.length === pages.length
    ? calculateReaderFrameSize(dimensions, presentation.rotation, frameOrientation, presentation.autoRotation, presentation.widePageStretch)
    : undefined
  const gap = pages.length > 1 ? 4 * (pages.length - 1) : 0
  const available = viewport
    ? { width: Math.max(1, viewport.width - 16 - gap), height: Math.max(1, viewport.height - 16) }
    : undefined
  const scale = frameSize && available
    ? calculateReaderScale(presentation.fitMode, frameSize, available, presentation.manualScale)
    : undefined
  const rotatedDimensions = dimensions.map((dimension) => rotatePresentationSize(dimension, effectiveReaderRotation(presentation.rotation, presentation.autoRotation, dimension)))
  const pageStretchScales = calculateReaderPageStretchScales(rotatedDimensions, presentation.widePageStretch)
  const imageTrimDetectionPageIndex = pages.some((page) => page.index === anchorPageIndex)
    ? anchorPageIndex
    : pages[0]?.index

  return (
    <div
      ref={viewportRef}
      className="h-full min-h-0 w-full overflow-auto overscroll-contain"
      data-reader-frame-viewport="true"
      data-reader-fit-mode={presentation.fitMode}
      data-reader-manual-scale={presentation.manualScale}
      data-reader-rotation={presentation.rotation}
      data-reader-auto-rotation={presentation.autoRotation}
      data-reader-orientation={presentation.orientation}
      data-reader-wide-page-stretch={presentation.widePageStretch}
      data-reader-effective-scale={scale}
    >
      <div className={presentation.fitMode === "fit-left"
        ? "grid h-max min-h-full w-max min-w-full items-center justify-items-start p-2"
        : presentation.fitMode === "fit-right"
          ? "grid h-max min-h-full w-max min-w-full items-center justify-items-end p-2"
          : "grid h-max min-h-full w-max min-w-full place-items-center p-2"}>
        <ReaderPageTransitionLayer pageIndex={pages[0]?.index} store={pageTransition}>
          <div
            className="flex shrink-0 items-center justify-center gap-1"
            data-reader-frame="true"
            style={frameSize && scale ? {
              width: frameSize.width * scale + gap,
              height: frameSize.height * scale,
            } : undefined}
          >
            {pages.map((page, slotIndex) => (
              <PageMedia
                key={`${page.mediaKind}:${slotIndex}`}
                page={page}
                rotation={page.dimensions
                  ? effectiveReaderRotation(presentation.rotation, presentation.autoRotation, page.dimensions)
                  : presentation.rotation}
                scale={scale === undefined ? undefined : scale * (pageStretchScales[slotIndex] ?? 1)}
                fallbackSize={available}
                colorFilter={colorFilter}
                imageTrim={imageTrim}
                imageTrimDetectionActive={page.index === imageTrimDetectionPageIndex}
                videoController={videoController}
                sessionId={sessionId}
                client={client}
                media={media}
                superResolution={superResolution}
                onSubtitleConfigChange={onSubtitleConfigChange}
                onVideoListEnded={onVideoListEnded}
              />
            ))}
          </div>
        </ReaderPageTransitionLayer>
      </div>
    </div>
  )
}

function useObservedSize(ref: React.RefObject<HTMLElement | null>, inactive = false): PresentationSize | undefined {
  const [size, setSize] = useState<PresentationSize | undefined>(undefined)

  useEffect(() => {
    if (inactive) return
    const element = ref.current
    if (!element) return
    const update = (width: number, height: number) => {
      const next = { width: Math.round(width), height: Math.round(height) }
      if (next.width <= 0 || next.height <= 0) return
      setSize((current) => current?.width === next.width && current.height === next.height ? current : next)
    }
    update(element.clientWidth, element.clientHeight)
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) update(entry.contentRect.width, entry.contentRect.height)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [inactive, ref])

  return size
}

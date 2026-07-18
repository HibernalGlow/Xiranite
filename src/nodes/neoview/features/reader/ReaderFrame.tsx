/**
 * @migrated-from src/lib/stackview/StackView.svelte
 * @source-hash sha256:f54ee3722b87db292abadc01c07613518bdfbd3e6ae68212300d91a5cd79909e
 * @features panels-toolbar-shell
 * @migration-status adapted
 */
import { useEffect, useRef, useState } from "react"
import {
  calculateReaderFrameSize,
  calculateReaderScale,
  type PresentationSize,
  type ReaderPresentation,
} from "@xiranite/node-neoview/ui-core"

import type { ReaderPageDto } from "../../adapters/reader-http-client"
import type { ReaderColorFilterPort } from "../color-filter/ReaderColorFilterStore"
import type { ReaderPageTransitionPort } from "../page-transition/ReaderPageTransitionStore"
import { ReaderPageTransitionLayer } from "../page-transition/ReaderPageTransitionLayer"
import { PageImage } from "./PageImage"

export function ReaderFrame({ pages, presentation, colorFilter, pageTransition }: {
  pages: ReaderPageDto[]
  presentation: ReaderPresentation
  colorFilter?: ReaderColorFilterPort
  pageTransition?: ReaderPageTransitionPort
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const viewport = useObservedSize(viewportRef)
  const dimensions = pages.flatMap((page) => page.dimensions ? [page.dimensions] : [])
  const frameSize = dimensions.length === pages.length
    ? calculateReaderFrameSize(dimensions, presentation.rotation)
    : undefined
  const gap = pages.length > 1 ? 4 * (pages.length - 1) : 0
  const available = viewport
    ? { width: Math.max(1, viewport.width - 16 - gap), height: Math.max(1, viewport.height - 16) }
    : undefined
  const scale = frameSize && available
    ? calculateReaderScale(presentation.fitMode, frameSize, available, presentation.manualScale)
    : undefined

  return (
    <div
      ref={viewportRef}
      className="h-full min-h-0 w-full overflow-auto overscroll-contain"
      data-reader-frame-viewport="true"
      data-reader-fit-mode={presentation.fitMode}
      data-reader-manual-scale={presentation.manualScale}
      data-reader-rotation={presentation.rotation}
      data-reader-effective-scale={scale}
    >
      <div className="grid h-max min-h-full w-max min-w-full place-items-center p-2">
        <ReaderPageTransitionLayer pageIndex={pages[0]?.index} store={pageTransition}>
          <div
            className="flex shrink-0 items-center justify-center gap-1"
            data-reader-frame="true"
            style={frameSize && scale ? {
              width: frameSize.width * scale + gap,
              height: frameSize.height * scale,
            } : undefined}
          >
            {pages.map((page) => (
              <PageImage
                key={`${page.id}:${page.contentVersion}`}
                page={page}
                rotation={presentation.rotation}
                scale={scale}
                colorFilter={colorFilter}
              />
            ))}
          </div>
        </ReaderPageTransitionLayer>
      </div>
    </div>
  )
}

function useObservedSize(ref: React.RefObject<HTMLElement | null>): PresentationSize | undefined {
  const [size, setSize] = useState<PresentationSize | undefined>(undefined)

  useEffect(() => {
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
  }, [ref])

  return size
}

import { rotatePresentationSize, type ReaderRotation } from "@xiranite/node-neoview/ui-core"
import { useEffect, useRef } from "react"

import type { ReaderPageDto } from "../../adapters/reader-http-client"
import type { ReaderVideoController } from "../video/ReaderVideoController"

export function PageVideo({ page, controller, onListEnded, rotation = 0, scale }: {
  page: ReaderPageDto
  controller: ReaderVideoController
  onListEnded: () => void
  rotation?: ReaderRotation
  scale?: number
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const dimensions = page.dimensions
  const measured = dimensions !== undefined && scale !== undefined
  const rotated = dimensions ? rotatePresentationSize(dimensions, rotation) : undefined

  useEffect(() => {
    const element = videoRef.current
    if (!element) return
    return controller.register(element, onListEnded)
  }, [controller, onListEnded, page.assetUrl, page.contentVersion])

  const videoStyle: React.CSSProperties = measured ? {
    width: dimensions.width * scale,
    height: dimensions.height * scale,
    maxWidth: "none",
    maxHeight: "none",
    position: "absolute",
    left: "50%",
    top: "50%",
    transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
  } : {}

  return (
    <div
      className={measured ? "relative shrink-0 overflow-hidden" : "contents"}
      data-reader-page-box={page.id}
      data-input-context="video"
      style={measured ? { width: rotated!.width * scale, height: rotated!.height * scale } : undefined}
    >
      <video
        ref={videoRef}
        src={page.assetUrl}
        aria-label={page.name}
        autoPlay
        controls
        playsInline
        crossOrigin="anonymous"
        preload="metadata"
        className="max-h-full min-h-0 max-w-full select-none object-contain"
        data-reader-page-video={page.id}
        data-input-context="video"
        style={videoStyle}
      />
    </div>
  )
}

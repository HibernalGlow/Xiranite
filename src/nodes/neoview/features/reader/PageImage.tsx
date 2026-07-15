import type { ReaderPageDto } from "../../adapters/reader-http-client"
import { rotatePresentationSize, type ReaderRotation } from "@xiranite/node-neoview/core"

export interface PageImageProps {
  page: ReaderPageDto
  rotation?: ReaderRotation
  scale?: number
}

export function PageImage({ page, rotation = 0, scale }: PageImageProps) {
  const dimensions = page.dimensions
  const measured = dimensions !== undefined && scale !== undefined
  const rotated = dimensions ? rotatePresentationSize(dimensions, rotation) : undefined
  return (
    <div
      className={measured ? "relative shrink-0 overflow-hidden" : "contents"}
      data-reader-page-box={page.id}
      style={measured ? { width: rotated!.width * scale, height: rotated!.height * scale } : undefined}
    >
      {image(page, measured ? {
        width: dimensions.width * scale,
        height: dimensions.height * scale,
        maxWidth: "none",
        maxHeight: "none",
        position: "absolute",
        left: "50%",
        top: "50%",
        transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
      } : undefined)}
    </div>
  )
}

function image(page: ReaderPageDto, style?: React.CSSProperties) {
  return (
    <img
      src={page.assetUrl}
      alt={page.name}
      draggable={false}
      decoding="async"
      fetchPriority="high"
      className="max-h-full min-h-0 max-w-full select-none object-contain"
      data-reader-page-image={page.id}
      style={style}
    />
  )
}

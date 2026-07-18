import {
  rotatePresentationSize,
  type ReaderRotation,
} from "@xiranite/node-neoview/ui-core"
import {
  DEFAULT_READER_COLOR_FILTER,
  projectReaderColorFilterCss,
  projectReaderColorFilterTables,
  type ReaderColorFilterSettings,
} from "@xiranite/node-neoview/color-filter"
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react"

import type { ReaderPageDto } from "../../adapters/reader-http-client"
import type { ReaderColorFilterPort } from "../color-filter/ReaderColorFilterStore"

export interface PageImageProps {
  page: ReaderPageDto
  rotation?: ReaderRotation
  scale?: number
  colorFilter?: ReaderColorFilterPort
}

const NOOP_SUBSCRIBE = () => () => undefined
const DEFAULT_COLOR_FILTER_SNAPSHOT = () => DEFAULT_READER_COLOR_FILTER

export function PageImage({ page, rotation = 0, scale, colorFilter }: PageImageProps) {
  const imageRef = useRef<HTMLImageElement>(null)
  const generatedId = useId()
  const filterId = `neoview-color-filter-${generatedId.replaceAll(":", "")}`
  const settings = useSyncExternalStore(
    colorFilter?.subscribe ?? NOOP_SUBSCRIBE,
    colorFilter?.getSnapshot ?? DEFAULT_COLOR_FILTER_SNAPSHOT,
    colorFilter?.getSnapshot ?? DEFAULT_COLOR_FILTER_SNAPSHOT,
  )
  const [blackAndWhite, setBlackAndWhite] = useState<boolean>()
  const dimensions = page.dimensions
  const measured = dimensions !== undefined && scale !== undefined
  const rotated = dimensions ? rotatePresentationSize(dimensions, rotation) : undefined
  const colorizeAllowed = settings.colorizeEnabled && (!settings.onlyBlackAndWhite || blackAndWhite === true)
  const tables = projectReaderColorFilterTables(settings)
  const filter = projectReaderColorFilterCss(settings, { filterId, colorizeAllowed })

  useEffect(() => {
    if (!settings.colorizeEnabled || !settings.onlyBlackAndWhite) {
      setBlackAndWhite(undefined)
      return
    }
    const element = imageRef.current
    if (!element) return
    let active = true
    const sample = () => {
      const result = detectBlackAndWhite(element)
      if (active) setBlackAndWhite(result)
    }
    if (element.complete && element.naturalWidth > 0) sample()
    else element.addEventListener("load", sample, { once: true })
    return () => {
      active = false
      element.removeEventListener("load", sample)
    }
  }, [page.assetUrl, page.contentVersion, settings.colorizeEnabled, settings.onlyBlackAndWhite])

  const imageStyle: React.CSSProperties = {
    ...(measured ? {
      width: dimensions.width * scale,
      height: dimensions.height * scale,
      maxWidth: "none",
      maxHeight: "none",
      position: "absolute",
      left: "50%",
      top: "50%",
      transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
    } satisfies React.CSSProperties : {}),
    filter: filter || undefined,
  }
  return (
    <div
      className={measured ? "relative shrink-0 overflow-hidden" : "contents"}
      data-reader-page-box={page.id}
      data-reader-colorize-allowed={colorizeAllowed ? "true" : "false"}
      style={measured ? { width: rotated!.width * scale, height: rotated!.height * scale } : undefined}
    >
      <ColorizationFilter id={filterId} settings={settings} tables={tables} />
      <img
        ref={imageRef}
        crossOrigin="anonymous"
        src={page.assetUrl}
        alt={page.name}
        draggable={false}
        decoding="async"
        fetchPriority="high"
        className="max-h-full min-h-0 max-w-full select-none object-contain"
        data-reader-page-image={page.id}
        style={imageStyle}
      />
    </div>
  )
}

function ColorizationFilter({ id, settings, tables }: {
  id: string
  settings: ReaderColorFilterSettings
  tables: ReturnType<typeof projectReaderColorFilterTables>
}) {
  return (
    <svg aria-hidden="true" width="0" height="0" className="pointer-events-none absolute">
      <filter id={id} colorInterpolationFilters="sRGB">
        <feComponentTransfer>
          <feFuncR type="table" tableValues={tables.r.join(" ")} />
          <feFuncG type="table" tableValues={tables.g.join(" ")} />
          <feFuncB type="table" tableValues={tables.b.join(" ")} />
        </feComponentTransfer>
      </filter>
      <metadata data-color-filter-preset={settings.colorizePreset} />
    </svg>
  )
}

function detectBlackAndWhite(image: HTMLImageElement): boolean {
  try {
    const canvas = document.createElement("canvas")
    canvas.width = 64
    canvas.height = 64
    const context = canvas.getContext("2d", { willReadFrequently: true })
    if (!context) return false
    context.drawImage(image, 0, 0, 64, 64)
    const pixels = context.getImageData(0, 0, 64, 64).data
    let saturationTotal = 0
    let maximumSaturation = 0
    let midtoneCount = 0
    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index]!
      const green = pixels[index + 1]!
      const blue = pixels[index + 2]!
      const maximum = Math.max(red, green, blue)
      const minimum = Math.min(red, green, blue)
      if (maximum < 5 || minimum > 250) continue
      const saturation = maximum === 0 ? 0 : ((maximum - minimum) / maximum) * 100
      saturationTotal += saturation
      maximumSaturation = Math.max(maximumSaturation, saturation)
      midtoneCount += 1
    }
    if (midtoneCount === 0) return true
    return saturationTotal / midtoneCount < 5 && maximumSaturation < 10
  } catch {
    return false
  }
}

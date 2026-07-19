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
import { readerImageTrimClipPath } from "@xiranite/node-neoview/image-trim"
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react"

import type { ReaderHttpClient, ReaderPageDto, ReaderSuperResolutionConfigDto } from "../../adapters/reader-http-client"
import type { ReaderColorFilterPort } from "../color-filter/ReaderColorFilterStore"
import type { ReaderImageTrimPort } from "../image-trim/ReaderImageTrimStore"
import { setReaderUpscaleArtifact } from "./ReaderUpscaleArtifactStore"

export interface PageImageProps {
  page: ReaderPageDto
  rotation?: ReaderRotation
  scale?: number
  colorFilter?: ReaderColorFilterPort
  imageTrim?: ReaderImageTrimPort
  sessionId?: string
  client?: ReaderHttpClient
  superResolution?: ReaderSuperResolutionConfigDto
}

const NOOP_SUBSCRIBE = () => () => undefined
const DEFAULT_COLOR_FILTER_SNAPSHOT = () => DEFAULT_READER_COLOR_FILTER
const DEFAULT_IMAGE_TRIM_SNAPSHOT = () => undefined

export function PageImage({ page, rotation = 0, scale, colorFilter, imageTrim, sessionId, client, superResolution }: PageImageProps) {
  const imageRef = useRef<HTMLImageElement>(null)
  const upscaleTarget = useUpscaleTarget(page, sessionId, client, superResolution)
  const targetIdentity = imageIdentity(upscaleTarget)
  const targetIdentityRef = useRef(targetIdentity)
  targetIdentityRef.current = targetIdentity
  const [committedPage, setCommittedPage] = useState(page)
  const committedIdentity = imageIdentity(committedPage)
  const pendingPage = committedIdentity === targetIdentity ? undefined : upscaleTarget
  const generatedId = useId()
  const filterId = `neoview-color-filter-${generatedId.replaceAll(":", "")}`
  const settings = useSyncExternalStore(
    colorFilter?.subscribe ?? NOOP_SUBSCRIBE,
    colorFilter?.getSnapshot ?? DEFAULT_COLOR_FILTER_SNAPSHOT,
    colorFilter?.getSnapshot ?? DEFAULT_COLOR_FILTER_SNAPSHOT,
  )
  const trimSettings = useSyncExternalStore(
    imageTrim?.subscribe ?? NOOP_SUBSCRIBE,
    imageTrim?.getSnapshot ?? DEFAULT_IMAGE_TRIM_SNAPSHOT,
    imageTrim?.getSnapshot ?? DEFAULT_IMAGE_TRIM_SNAPSHOT,
  )
  const [blackAndWhite, setBlackAndWhite] = useState<boolean>()
  const dimensions = committedPage.dimensions
  const measured = dimensions !== undefined && scale !== undefined
  const rotated = dimensions ? rotatePresentationSize(dimensions, rotation) : undefined
  const colorizeAllowed = settings.colorizeEnabled && (!settings.onlyBlackAndWhite || blackAndWhite === true)
  const tables = projectReaderColorFilterTables(settings)
  const filter = projectReaderColorFilterCss(settings, { filterId, colorizeAllowed })
  const trimClipPath = trimSettings ? readerImageTrimClipPath(trimSettings) : undefined

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
  }, [committedPage.assetUrl, committedPage.contentVersion, settings.colorizeEnabled, settings.onlyBlackAndWhite])

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
    clipPath: trimClipPath,
  }
  return (
    <div
      className={measured ? "relative shrink-0 overflow-hidden" : "contents"}
      data-reader-page-box={committedPage.id}
      data-reader-page-target={upscaleTarget.id}
      data-reader-colorize-allowed={colorizeAllowed ? "true" : "false"}
      style={measured ? { width: rotated!.width * scale, height: rotated!.height * scale } : undefined}
    >
      <ColorizationFilter id={filterId} settings={settings} tables={tables} />
      {[committedPage, ...(pendingPage ? [pendingPage] : [])].map((candidate) => {
        const identity = imageIdentity(candidate)
        const pending = identity !== committedIdentity
        return (
          <img
            key={identity}
            ref={pending ? undefined : imageRef}
            crossOrigin="anonymous"
            src={candidate.assetUrl}
            alt={candidate.name}
            draggable={false}
            decoding="async"
            fetchPriority="high"
            className="max-h-full min-h-0 max-w-full select-none object-contain"
            data-reader-page-image={pending ? undefined : candidate.id}
            data-reader-page-image-pending={pending ? candidate.id : undefined}
            style={pending ? PENDING_IMAGE_STYLE : imageStyle}
            onLoad={pending ? (event) => {
              void commitDecodedImage(event.currentTarget, candidate, identity, targetIdentityRef, setCommittedPage)
            } : undefined}
          />
        )
      })}
    </div>
  )
}

function useUpscaleTarget(
  page: ReaderPageDto,
  sessionId: string | undefined,
  client: ReaderHttpClient | undefined,
  config: ReaderSuperResolutionConfigDto | undefined,
): ReaderPageDto {
  const enabled = config?.provider !== "disabled" && config?.preferences.autoUpscaleEnabled === true
  const sourceIdentity = imageIdentity(page)
  const pageRef = useRef(page)
  pageRef.current = page
  const [artifact, setArtifact] = useState<{ sourceIdentity: string; page: ReaderPageDto }>()
  const configRevision = JSON.stringify(config?.preferences ?? {})

  useEffect(() => {
    if (!enabled || !sessionId || !client?.upscalePage) return
    const controller = new AbortController()
    const sourcePage = pageRef.current
    setReaderUpscaleArtifact(sessionId, sourcePage.id, { state: "processing" })
    void client.upscalePage(sessionId, sourcePage.id, "automatic-current", controller.signal).then((result) => {
      if (controller.signal.aborted) return
      setReaderUpscaleArtifact(sessionId, sourcePage.id, { state: result.status === "skipped" || result.status === "bypassed" || result.status === "rejected" ? "skipped" : "completed", result })
      if (!result.artifactUrl || !result.version) return
      setArtifact({
        sourceIdentity,
        page: {
          ...sourcePage,
          assetUrl: result.artifactUrl,
          contentVersion: `${sourcePage.contentVersion}:upscale:${result.version}`,
          mimeType: result.contentType ?? sourcePage.mimeType,
          byteLength: result.bytes ?? sourcePage.byteLength,
        },
      })
    }).catch(() => { if (!controller.signal.aborted) setReaderUpscaleArtifact(sessionId, sourcePage.id, { state: "failed" }) })
    return () => controller.abort()
  }, [client, configRevision, enabled, sessionId, sourceIdentity])

  return enabled && artifact?.sourceIdentity === sourceIdentity ? artifact.page : page
}

const PENDING_IMAGE_STYLE: React.CSSProperties = {
  position: "fixed",
  width: 1,
  height: 1,
  opacity: 0,
  pointerEvents: "none",
}

function imageIdentity(page: ReaderPageDto): string {
  return `${page.id}:${page.contentVersion}:${page.assetUrl}`
}

async function commitDecodedImage(
  image: HTMLImageElement,
  page: ReaderPageDto,
  identity: string,
  targetIdentityRef: React.RefObject<string>,
  commit: React.Dispatch<React.SetStateAction<ReaderPageDto>>,
): Promise<void> {
  try {
    await image.decode?.()
  } catch {
    if (!image.complete || image.naturalWidth <= 0) return
  }
  if (targetIdentityRef.current === identity) commit(page)
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

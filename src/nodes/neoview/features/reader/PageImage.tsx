import {
  rotatePresentationSize,
  type ReaderRotation,
} from "@xiranite/node-neoview/ui-core"
import {
  DEFAULT_READER_COLOR_FILTER,
  projectReaderColorFilterCss,
  projectReaderColorFilterTables,
  type ReaderColorFilterSettings,
} from "@xiranite/node-neoview/ui-core"
import { DEFAULT_READER_IMAGE_TRIM, readerImageCropTranslation, readerImageTrimClipPath, readerImageTrimEffectiveDimensions, type ReaderImageCropInsets } from "@xiranite/node-neoview/ui-core"
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react"

import type { ReaderHttpClient, ReaderPageDto, ReaderSuperResolutionConfigDto } from "../../adapters/reader-http-client"
import type { ReaderColorFilterPort } from "../color-filter/ReaderColorFilterStore"
import type { ReaderImageTrimPort } from "../image-trim/ReaderImageTrimStore"
import { noteReaderDecodedImage } from "./edgeMatchBackground"
import { readerUpscaleArtifactPage, readerUpscaleArtifactSnapshot, setReaderUpscaleArtifact } from "./ReaderUpscaleArtifactStore"

export interface PageImageProps {
  page: ReaderPageDto
  rotation?: ReaderRotation
  scale?: number
  colorFilter?: ReaderColorFilterPort
  imageTrim?: ReaderImageTrimPort
  imageTrimDetectionActive?: boolean
  presentationCropInsets?: ReaderImageCropInsets
  sessionId?: string
  client?: ReaderHttpClient
  superResolution?: ReaderSuperResolutionConfigDto
  onCommittedPage?: (page: ReaderPageDto) => void
}

const NOOP_SUBSCRIBE = () => () => undefined
const DEFAULT_COLOR_FILTER_SNAPSHOT = () => DEFAULT_READER_COLOR_FILTER
const DEFAULT_IMAGE_TRIM_SNAPSHOT = () => undefined

export function PageImage({ page, rotation = 0, scale, colorFilter, imageTrim, imageTrimDetectionActive = true, presentationCropInsets, sessionId, client, superResolution, onCommittedPage }: PageImageProps) {
  const imageRef = useRef<HTMLImageElement>(null)
  const visible = useReaderImageVisibility(imageRef)
  const sourceIdentity = imageIdentity(page)
  const sourceIdentityRef = useRef(sourceIdentity)
  sourceIdentityRef.current = sourceIdentity
  const [decodedSourceIdentity, setDecodedSourceIdentity] = useState<string>()
  const [decodedCommittedIdentity, setDecodedCommittedIdentity] = useState<string>()
  const { page: upscaleTarget, probing: probingUpscale } = useUpscaleTarget(
    page,
    sessionId,
    client,
    superResolution,
    decodedSourceIdentity === sourceIdentity,
    visible,
  )
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
  const presentationDimensions = dimensions
    ? readerImageTrimEffectiveDimensions(dimensions, DEFAULT_READER_IMAGE_TRIM, presentationCropInsets)
    : undefined
  const rotated = presentationDimensions ? rotatePresentationSize(presentationDimensions, rotation) : undefined
  const colorizeAllowed = settings.colorizeEnabled && (!settings.onlyBlackAndWhite || blackAndWhite === true)
  const tables = projectReaderColorFilterTables(settings)
  const filter = projectReaderColorFilterCss(settings, { filterId, colorizeAllowed })
  const trimClipPath = trimSettings ? readerImageTrimClipPath(trimSettings, presentationCropInsets) : readerImageTrimClipPath(DEFAULT_READER_IMAGE_TRIM, presentationCropInsets)
  const cropTranslation = readerImageCropTranslation(presentationCropInsets)

  useEffect(() => {
    if (!imageTrim || !imageTrimDetectionActive || decodedCommittedIdentity !== committedIdentity) return
    const element = imageRef.current
    if (!element) return
    return imageTrim.registerImage(committedIdentity, element)
  }, [committedIdentity, decodedCommittedIdentity, imageTrim, imageTrimDetectionActive])

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
      transform: `translate(-50%, -50%) translate(${cropTranslation.xPercent}%, ${cropTranslation.yPercent}%) rotate(${rotation}deg)`,
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
        const concealedForProbe = !pending && probingUpscale && identity === sourceIdentity
        return (
          <img
            key={identity}
            ref={pending ? undefined : imageRef}
            crossOrigin="anonymous"
            src={candidate.assetUrl}
            alt={candidate.name}
            draggable={false}
            decoding="async"
            loading={visible ? "eager" : "lazy"}
            fetchPriority={visible ? "high" : "low"}
            className="max-h-full min-h-0 max-w-full select-none object-contain"
            data-reader-page-image={pending ? undefined : candidate.id}
            data-reader-page-image-pending={pending ? candidate.id : undefined}
            data-reader-page-image-decoded={!pending && decodedCommittedIdentity === identity ? candidate.id : undefined}
            style={pending || concealedForProbe ? { ...imageStyle, visibility: "hidden", pointerEvents: "none" } : imageStyle}
            onLoad={(event) => {
              const element = event.currentTarget
              if (pending) {
                void decodeTargetImage(element, identity, targetIdentityRef).then((decoded) => {
                  if (!decoded) return
                  noteReaderDecodedImage(candidate.assetUrl, element)
                  // Parent frame geometry and the visible bitmap must commit in
                  // one React batch, especially when orientation changes.
                  onCommittedPage?.(candidate)
                  setCommittedPage(candidate)
                  setDecodedCommittedIdentity(identity)
                  if (identity === sourceIdentityRef.current) setDecodedSourceIdentity(identity)
                })
              } else if (identity === sourceIdentityRef.current) {
                void decodeImage(element).then((decoded) => {
                  if (!decoded || identity !== sourceIdentityRef.current) return
                  noteReaderDecodedImage(candidate.assetUrl, element)
                  setDecodedSourceIdentity(identity)
                  setDecodedCommittedIdentity(identity)
                })
              } else {
                void decodeImage(element).then((decoded) => {
                  if (!decoded || identity !== targetIdentityRef.current) return
                  noteReaderDecodedImage(candidate.assetUrl, element)
                  setDecodedCommittedIdentity(identity)
                })
              }
            }}
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
  sourceReady: boolean,
  visible: boolean,
): { page: ReaderPageDto; probing: boolean } {
  const enabled = config?.provider !== "disabled" && config?.preferences.autoUpscaleEnabled === true
  const sourceIdentity = imageIdentity(page)
  const pageRef = useRef(page)
  pageRef.current = page
  const [artifact, setArtifact] = useState<{ sourceIdentity: string; page: ReaderPageDto }>()
  const [probe, setProbe] = useState<{ sourceIdentity: string; state: "pending" | "scheduled" | "miss" | "terminal" }>()
  const configRevision = JSON.stringify(config?.preferences ?? {})
  const probeSupported = Boolean(client?.probeUpscalePage)
  const storedResult = sessionId ? readerUpscaleArtifactSnapshot(sessionId, page.id).result : undefined
  const storedArtifact = probeSupported && storedResult?.artifactUrl && storedResult.version
    ? artifactTarget(page, sourceIdentity, storedResult)
    : undefined
  const activeArtifact = artifact?.sourceIdentity === sourceIdentity ? artifact : storedArtifact

  useEffect(() => {
    if (!enabled || !sessionId || !client?.probeUpscalePage || activeArtifact) return
    const controller = new AbortController()
    const sourcePage = pageRef.current
    setProbe({ sourceIdentity, state: "pending" })
    void client.probeUpscalePage(sessionId, sourcePage.id, controller.signal).then((result) => {
      if (controller.signal.aborted) return
      if (result.status === "pending") {
        setProbe({ sourceIdentity, state: "scheduled" })
        return
      }
      if (result.status === "miss") {
        setProbe({ sourceIdentity, state: "miss" })
        return
      }
      const completed = result.status !== "skipped" && result.status !== "bypassed" && result.status !== "rejected"
      setReaderUpscaleArtifact(sessionId, sourcePage.id, { state: completed ? "completed" : "skipped", result })
      const target = result.artifactUrl && result.version ? artifactTarget(sourcePage, sourceIdentity, result) : undefined
      if (target) setArtifact(target)
      setProbe({ sourceIdentity, state: "terminal" })
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return
      setProbe({ sourceIdentity, state: "miss" })
      setReaderUpscaleArtifact(sessionId, sourcePage.id, {
        state: "failed",
        error: error instanceof Error ? error.message : String(error),
      })
    })
    return () => controller.abort()
  }, [activeArtifact, client, configRevision, enabled, sessionId, sourceIdentity])

  const scheduled = probeSupported && probe?.sourceIdentity === sourceIdentity && probe.state === "scheduled"
  const generationReady = scheduled || sourceReady
  useEffect(() => {
    if (!enabled || !visible || !generationReady || !sessionId || !client?.upscalePage) return
    if (activeArtifact) return
    if (probeSupported && !scheduled && (probe?.sourceIdentity !== sourceIdentity || probe.state !== "miss")) return
    const controller = new AbortController()
    const sourcePage = pageRef.current
    setReaderUpscaleArtifact(sessionId, sourcePage.id, { state: "processing" })
    void client.upscalePage(sessionId, sourcePage.id, "automatic-current", controller.signal).then((result) => {
      if (controller.signal.aborted) return
      setReaderUpscaleArtifact(sessionId, sourcePage.id, { state: result.status === "skipped" || result.status === "bypassed" || result.status === "rejected" ? "skipped" : "completed", result })
      if (!result.artifactUrl || !result.version) {
        setProbe({ sourceIdentity, state: "terminal" })
        return
      }
      setArtifact(artifactTarget(sourcePage, sourceIdentity, result))
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setProbe({ sourceIdentity, state: "terminal" })
        setReaderUpscaleArtifact(sessionId, sourcePage.id, {
          state: "failed",
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })
    return () => controller.abort()
  }, [activeArtifact, client, configRevision, enabled, generationReady, probe?.sourceIdentity, probe?.state, probeSupported, scheduled, sessionId, sourceIdentity, visible])

  const probing = enabled && probeSupported && !activeArtifact
    && (probe?.sourceIdentity !== sourceIdentity || probe.state === "pending" || probe.state === "scheduled")
  return { page: enabled && activeArtifact ? activeArtifact.page : page, probing }
}

function useReaderImageVisibility(ref: React.RefObject<HTMLElement | null>): boolean {
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined")
  useEffect(() => {
    const element = ref.current
    if (!element || typeof IntersectionObserver === "undefined") {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver(([entry]) => setVisible(entry?.isIntersecting === true), { threshold: 0.01 })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return visible
}

function artifactTarget(
  sourcePage: ReaderPageDto,
  sourceIdentity: string,
  result: { artifactUrl?: string; version?: string; contentType?: string; bytes?: number },
): { sourceIdentity: string; page: ReaderPageDto } {
  return { sourceIdentity, page: readerUpscaleArtifactPage(sourcePage, result)! }
}

function imageIdentity(page: ReaderPageDto): string {
  return `${page.id}:${page.contentVersion}:${page.assetUrl}`
}

async function decodeTargetImage(
  image: HTMLImageElement,
  identity: string,
  targetIdentityRef: React.RefObject<string>,
): Promise<boolean> {
  if (!await decodeImage(image)) return false
  if (targetIdentityRef.current !== identity) return false
  return true
}

async function decodeImage(image: HTMLImageElement): Promise<boolean> {
  try {
    await image.decode?.()
  } catch {
    if (!image.complete || image.naturalWidth <= 0) return false
  }
  return true
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

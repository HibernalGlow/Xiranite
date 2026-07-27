import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react"

import { DEFAULT_READER_IMAGE_TRIM, readerImageCropTranslation, readerImageTrimClipPath, readerImageTrimEffectiveDimensions, rotatePresentationSize, type ReaderImageCropInsets, type ReaderRotation } from "@xiranite/node-neoview/ui-core"

import type { ReaderMediaConfigDto, ReaderPageDto } from "../../adapters/reader-http-client"
import type { ReaderImageTrimPort } from "../image-trim/ReaderImageTrimStore"
import { ReaderAnimatedImagePlayback } from "../video/ReaderAnimatedImagePlayback"
import { ReaderAnimatedImageControlOverlay } from "../video/ReaderAnimatedImageControlOverlay"
import type { ReaderVideoController } from "../video/ReaderVideoController"

const NOOP_SUBSCRIBE = () => () => undefined
const UNDEFINED_SNAPSHOT = () => undefined

export function PageAnimatedImageVideo({
  page,
  controller,
  media,
  imageTrim,
  presentationCropInsets,
  onVideoControlsPinnedChange,
  onListEnded,
  onUnavailable,
  rotation = 0,
  scale,
  fallbackSize,
}: {
  page: ReaderPageDto
  controller: ReaderVideoController
  media?: ReaderMediaConfigDto
  imageTrim?: ReaderImageTrimPort
  presentationCropInsets?: ReaderImageCropInsets
  onVideoControlsPinnedChange?: (pinned: boolean) => Promise<void>
  onListEnded(): void
  onUnavailable(): void
  rotation?: ReaderRotation
  scale?: number
  fallbackSize?: { width: number; height: number }
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const onUnavailableRef = useRef(onUnavailable)
  onUnavailableRef.current = onUnavailable
  const [controlsVisible, setControlsVisible] = useState(true)
  const [controlsPinned, setControlsPinned] = useState(media?.videoControlsPinned ?? false)
  const [overlayOpen, setOverlayOpen] = useState(false)
  const [ready, setReady] = useState(false)
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const trimSettings = useSyncExternalStore(
    imageTrim?.subscribe ?? NOOP_SUBSCRIBE,
    imageTrim?.getSnapshot ?? UNDEFINED_SNAPSHOT,
    imageTrim?.getSnapshot ?? UNDEFINED_SNAPSHOT,
  )
  const dimensions = page.dimensions
  const measured = dimensions !== undefined && scale !== undefined
  const presentationDimensions = dimensions
    ? readerImageTrimEffectiveDimensions(dimensions, DEFAULT_READER_IMAGE_TRIM, presentationCropInsets)
    : undefined
  const rotated = presentationDimensions ? rotatePresentationSize(presentationDimensions, rotation) : undefined
  const fallbackMeasured = !measured && fallbackSize !== undefined
  const cropTranslation = readerImageCropTranslation(presentationCropInsets)

  useEffect(() => {
    setControlsPinned(media?.videoControlsPinned ?? false)
  }, [media?.videoControlsPinned])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    setReady(false)
    const abort = new AbortController()
    const playback = new ReaderAnimatedImagePlayback(canvas, () => onUnavailableRef.current())
    const unregister = controller.registerPlaybackTarget(playback, onListEnded)
    void playback.load(page.assetUrl, abort.signal).then((result) => {
      if (result !== "ready") onUnavailableRef.current()
      else setReady(true)
    }).catch(() => {
      if (!abort.signal.aborted) onUnavailableRef.current()
    })
    return () => {
      abort.abort()
      unregister()
      playback.dispose()
    }
  }, [controller, onListEnded, page.assetUrl, page.contentVersion])

  useEffect(() => {
    if (!ready) return
    if (!snapshot.playing || controlsPinned || overlayOpen) {
      setControlsVisible(true)
      return
    }
    if (!controlsVisible) return
    const timer = window.setTimeout(() => setControlsVisible(false), 3_000)
    return () => window.clearTimeout(timer)
  }, [controlsPinned, controlsVisible, overlayOpen, ready, snapshot.playing])

  function changeControlsPinned(pinned: boolean): void {
    const previous = controlsPinned
    setControlsPinned(pinned)
    void onVideoControlsPinnedChange?.(pinned).catch(() => setControlsPinned(previous))
  }

  const canvasStyle: CSSProperties = {
    ...(measured ? {
      width: dimensions.width * scale,
      height: dimensions.height * scale,
      maxWidth: "none",
      maxHeight: "none",
      position: "absolute",
      left: "50%",
      top: "50%",
      transform: `translate(-50%, -50%) translate(${cropTranslation.xPercent}%, ${cropTranslation.yPercent}%) rotate(${rotation}deg)`,
    } : { width: "100%", height: "100%", objectFit: "contain" }),
    clipPath: trimSettings ? readerImageTrimClipPath(trimSettings, presentationCropInsets) : readerImageTrimClipPath(DEFAULT_READER_IMAGE_TRIM, presentationCropInsets),
  }
  const boxStyle = measured
    ? { width: rotated!.width * scale, height: rotated!.height * scale }
    : fallbackMeasured ? fallbackSize : undefined

  return (
    <div
      ref={containerRef}
      className={measured ? "group relative shrink-0 overflow-hidden" : "group relative min-h-0 min-w-0 overflow-hidden"}
      data-reader-page-box={page.id}
      data-reader-animated-video-player="true"
      data-input-context="video"
      role="region"
      aria-label="动图视频播放器"
      aria-busy={!ready}
      style={boxStyle}
      onMouseEnter={() => setControlsVisible(true)}
      onMouseMove={() => setControlsVisible(true)}
      onMouseLeave={() => { if (snapshot.playing && !controlsPinned && !overlayOpen) setControlsVisible(false) }}
      onPointerDown={() => setControlsVisible(true)}
      onFocusCapture={() => setControlsVisible(true)}
      onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setControlsVisible(false) }}
    >
      <canvas
        ref={canvasRef}
        aria-label={page.name}
        className="max-h-full min-h-0 max-w-full select-none object-contain"
        data-reader-page-animated-image={page.id}
        style={canvasStyle}
      />
      <ReaderAnimatedImageControlOverlay
        controller={controller}
        snapshot={snapshot}
        containerRef={containerRef}
        visible={controlsVisible || controlsPinned || overlayOpen || !snapshot.playing}
        pinned={controlsPinned}
        onPinnedChange={changeControlsPinned}
        onOpenChange={setOverlayOpen}
      />
    </div>
  )
}

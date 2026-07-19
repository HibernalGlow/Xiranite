import { rotatePresentationSize, type ReaderRotation } from "@xiranite/node-neoview/ui-core"
import { DEFAULT_READER_IMAGE_TRIM, readerImageCropTranslation, readerImageTrimClipPath, readerImageTrimEffectiveDimensions, type ReaderImageCropInsets } from "@xiranite/node-neoview/image-trim"
import { MediaController } from "media-chrome/react"
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react"

import type { ReaderHttpClient, ReaderMediaConfigDto, ReaderMediaProgressDto, ReaderPageDto, ReaderSubtitleConfigDto, ReaderSubtitleTrackDto } from "../../adapters/reader-http-client"
import type { ReaderVideoController } from "../video/ReaderVideoController"
import { ReaderVideoControlOverlay } from "../video/ReaderVideoControlOverlay"
import type { ReaderImageTrimPort } from "../image-trim/ReaderImageTrimStore"

const DEFAULT_SUBTITLE_CONFIG: ReaderSubtitleConfigDto = { fontSize: 1, color: "#ffffff", backgroundOpacity: 0.7, bottomPercent: 5 }

export function PageVideo({ page, controller, sessionId, client, media, imageTrim, presentationCropInsets, onSubtitleConfigChange, onListEnded, rotation = 0, scale, fallbackSize }: {
  page: ReaderPageDto
  controller: ReaderVideoController
  sessionId?: string
  client?: ReaderHttpClient
  media?: ReaderMediaConfigDto
  imageTrim?: ReaderImageTrimPort
  presentationCropInsets?: ReaderImageCropInsets
  onSubtitleConfigChange?: (patch: Partial<ReaderSubtitleConfigDto>) => Promise<void>
  onListEnded: () => void
  rotation?: ReaderRotation
  scale?: number
  fallbackSize?: { width: number; height: number }
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [controlsPinned, setControlsPinned] = useState(false)
  const [overlayOpen, setOverlayOpen] = useState(false)
  const [videoReady, setVideoReady] = useState(false)
  const [subtitleTracks, setSubtitleTracks] = useState<readonly ReaderSubtitleTrackDto[]>([])
  const [selectedSubtitleId, setSelectedSubtitleId] = useState<string>()
  const [subtitleText, setSubtitleText] = useState("")
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const trimSettings = useSyncExternalStore(
    imageTrim?.subscribe ?? subscribeNoop,
    imageTrim?.getSnapshot ?? getUndefinedSnapshot,
    imageTrim?.getSnapshot ?? getUndefinedSnapshot,
  )
  const dimensions = page.dimensions
  const measured = dimensions !== undefined && scale !== undefined
  const presentationDimensions = dimensions
    ? readerImageTrimEffectiveDimensions(dimensions, DEFAULT_READER_IMAGE_TRIM, presentationCropInsets)
    : undefined
  const rotated = presentationDimensions ? rotatePresentationSize(presentationDimensions, rotation) : undefined
  const fallbackMeasured = !measured && fallbackSize !== undefined
  const subtitleConfig = media?.subtitle ?? DEFAULT_SUBTITLE_CONFIG

  useEffect(() => {
    if (!videoReady) return
    if (!snapshot.playing || controlsPinned || overlayOpen) {
      setControlsVisible(true)
      return
    }
    if (!controlsVisible) return
    const timer = window.setTimeout(() => setControlsVisible(false), 3_000)
    return () => window.clearTimeout(timer)
  }, [controlsPinned, controlsVisible, overlayOpen, snapshot.playing, videoReady])

  useEffect(() => {
    const element = videoRef.current
    if (!element) return
    return controller.register(element, onListEnded)
  }, [controller, onListEnded, page.assetUrl, page.contentVersion])

  useEffect(() => {
    if (!client?.subtitleTracks || !sessionId) return
    const request = new AbortController()
    void client.subtitleTracks(sessionId, page.id, request.signal).then((tracks) => {
      if (request.signal.aborted) return
      setSubtitleTracks(tracks)
      setSelectedSubtitleId(tracks[0]?.id)
    }).catch(() => { if (!request.signal.aborted) setSubtitleTracks([]) })
    return () => request.abort()
  }, [client, page.id, page.contentVersion, sessionId])

  useEffect(() => {
    if (!client?.mediaProgress || !sessionId) return
    const request = new AbortController()
    void client.mediaProgress(sessionId, request.signal).then((progress) => {
      if (!request.signal.aborted && progress) restoreProgress(videoRef.current, progress)
    }).catch(() => undefined)
    return () => request.abort()
  }, [client, page.id, page.contentVersion, sessionId])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const selectedIndex = subtitleTracks.findIndex((track) => track.id === selectedSubtitleId)
    for (let index = 0; index < video.textTracks.length; index += 1) {
      video.textTracks[index]!.mode = index === selectedIndex ? "hidden" : "disabled"
    }
    const selected = selectedIndex >= 0 ? video.textTracks[selectedIndex] : undefined
    if (!selected) {
      setSubtitleText("")
      return
    }
    const update = () => setSubtitleText(Array.from(selected.activeCues ?? []).flatMap((cue) => "text" in cue && typeof cue.text === "string" ? [cue.text] : []).join("\n"))
    selected.addEventListener("cuechange", update)
    update()
    return () => selected.removeEventListener("cuechange", update)
  }, [selectedSubtitleId, subtitleTracks])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !client?.updateMediaProgress || !sessionId) return
    let lastRecordedAt = 0
    const record = (flush: boolean) => {
      const duration = video.duration
      if (!Number.isFinite(duration) || duration <= 0) return
      const now = Date.now()
      if (!flush && now - lastRecordedAt < 5_000) return
      lastRecordedAt = now
      const position = Math.max(0, Math.min(video.currentTime, duration))
      const completed = video.ended || position >= duration - Math.min(5, duration * 0.05)
      void client.updateMediaProgress!(sessionId, { position, duration, completed }, flush).catch(() => undefined)
    }
    const timeUpdate = () => record(false)
    const ended = () => record(true)
    video.addEventListener("timeupdate", timeUpdate)
    video.addEventListener("ended", ended)
    return () => {
      video.removeEventListener("timeupdate", timeUpdate)
      video.removeEventListener("ended", ended)
      record(true)
    }
  }, [client, page.id, page.contentVersion, sessionId])

  const cropTranslation = readerImageCropTranslation(presentationCropInsets)
  const videoStyle: React.CSSProperties = {
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
      className={measured ? "group relative shrink-0 overflow-hidden" : "group relative min-h-0 min-w-0 overflow-hidden"}
      data-reader-page-box={page.id}
      data-input-context="video"
      role="region"
      aria-label="视频播放器"
      style={{
        ...boxStyle,
        "--reader-subtitle-font-size": `${subtitleConfig.fontSize}em`,
        "--reader-subtitle-color": subtitleConfig.color,
        "--reader-subtitle-background": `rgba(0, 0, 0, ${subtitleConfig.backgroundOpacity})`,
        "--reader-subtitle-bottom": `${subtitleConfig.bottomPercent}%`,
      } as CSSProperties}
      onMouseEnter={() => setControlsVisible(true)}
      onMouseMove={() => setControlsVisible(true)}
      onMouseLeave={() => { if (snapshot.playing && !controlsPinned && !overlayOpen) setControlsVisible(false) }}
      onPointerDown={() => setControlsVisible(true)}
      onFocusCapture={() => setControlsVisible(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setControlsVisible(false)
      }}
    >
      <MediaController
        className="group relative grid size-full place-items-center overflow-hidden bg-transparent text-white"
        style={{
          "--media-background-color": "transparent",
          width: "100%",
          height: "100%",
          position: "relative",
          display: "grid",
        } as CSSProperties}
        data-reader-video-player="media-chrome"
        data-video-ready={videoReady ? "true" : "false"}
      >
        <video
          ref={videoRef}
          slot="media"
          src={page.assetUrl}
          aria-label={page.name}
          autoPlay
          playsInline
          crossOrigin="anonymous"
          preload="metadata"
          className="max-h-full min-h-0 max-w-full select-none object-contain"
          data-reader-page-video={page.id}
          data-input-context="video"
          style={videoStyle}
          onLoadedMetadata={() => { setVideoReady(true); setControlsVisible(true) }}
          onLoadedData={() => { setVideoReady(true); setControlsVisible(true) }}
          onEmptied={() => setVideoReady(false)}
        >
          {subtitleTracks.map((track) => <track key={`${track.id}:${track.contentVersion}`} kind="captions" src={track.assetUrl} srcLang="zh" label={track.name} default={track.id === selectedSubtitleId} />)}
        </video>
        {subtitleText ? (
          <div className="pointer-events-none absolute inset-x-0 flex justify-center px-4" style={{ bottom: `${subtitleConfig.bottomPercent}%` }}>
            <div
              className="max-w-[80%] whitespace-pre-wrap rounded px-3 py-1 text-center leading-[1.4] shadow-sm"
              style={{
                fontSize: `${subtitleConfig.fontSize}em`,
                color: subtitleConfig.color,
                backgroundColor: `rgba(0, 0, 0, ${subtitleConfig.backgroundOpacity})`,
                textShadow: "1px 1px 2px rgba(0, 0, 0, 0.8)",
              }}
            >{subtitleText}</div>
          </div>
        ) : null}
        <ReaderVideoControlOverlay
          controller={controller}
          snapshot={snapshot}
          videoRef={videoRef}
          pageName={page.name}
          sourceUrl={page.assetUrl}
          subtitleTracks={subtitleTracks}
          selectedSubtitleId={selectedSubtitleId}
          onSelectedSubtitleId={setSelectedSubtitleId}
          subtitleConfig={subtitleConfig}
          onSubtitleConfigChange={onSubtitleConfigChange}
          visible={controlsVisible || controlsPinned || overlayOpen || !snapshot.playing}
          pinned={controlsPinned}
          onPinnedChange={setControlsPinned}
          onOpenChange={setOverlayOpen}
        />
      </MediaController>
    </div>
  )
}

function subscribeNoop(): () => void {
  return () => undefined
}

function getUndefinedSnapshot(): undefined {
  return undefined
}

function restoreProgress(video: HTMLVideoElement | null, progress: ReaderMediaProgressDto): void {
  if (!video || progress.completed || progress.position <= 0) return
  const apply = () => {
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : progress.duration
    if (duration > 0 && progress.position < duration - 5) video.currentTime = Math.min(progress.position, duration)
  }
  if (video.readyState >= 1) apply()
  else video.addEventListener("loadedmetadata", apply, { once: true })
}

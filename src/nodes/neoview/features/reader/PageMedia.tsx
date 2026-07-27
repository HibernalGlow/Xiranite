import { useCallback, useState } from "react"
import type { ReaderRotation } from "@xiranite/node-neoview/ui-core"
import type { ReaderImageCropInsets } from "@xiranite/node-neoview/ui-core"

import type { ReaderHttpClient, ReaderMediaConfigDto, ReaderPageDto, ReaderSubtitleConfigDto, ReaderSuperResolutionConfigDto } from "../../adapters/reader-http-client"
import type { ReaderColorFilterPort } from "../color-filter/ReaderColorFilterStore"
import type { ReaderImageTrimPort } from "../image-trim/ReaderImageTrimStore"
import type { ReaderVideoController } from "../video/ReaderVideoController"
import { supportsReaderAnimatedImagePlayback } from "../video/ReaderAnimatedImagePlayback"
import { shouldOpenAnimatedImageAsVideo } from "./animated-image-video-mode"
import { PageAnimatedImageVideo } from "./PageAnimatedImageVideo"
import { PageImage } from "./PageImage"
import { PageVideo } from "./PageVideo"

export function PageMedia({ page, rotation, scale, fallbackSize, colorFilter, imageTrim, imageTrimDetectionActive, presentationCropInsets, videoController, sessionId, client, media, superResolution, onSubtitleConfigChange, onVideoControlsPinnedChange, onVideoListEnded, onCommittedPage }: {
  page: ReaderPageDto
  rotation?: ReaderRotation
  scale?: number
  fallbackSize?: { width: number; height: number }
  colorFilter?: ReaderColorFilterPort
  imageTrim?: ReaderImageTrimPort
  imageTrimDetectionActive?: boolean
  presentationCropInsets?: ReaderImageCropInsets
  videoController: ReaderVideoController
  sessionId?: string
  client?: ReaderHttpClient
  media?: ReaderMediaConfigDto
  superResolution?: ReaderSuperResolutionConfigDto
  onSubtitleConfigChange?: (patch: Partial<ReaderSubtitleConfigDto>) => Promise<void>
  onVideoControlsPinnedChange?: (pinned: boolean) => Promise<void>
  onVideoListEnded: () => void
  onCommittedPage?: (page: ReaderPageDto) => void
}) {
  const pageIdentity = `${page.id}:${page.contentVersion}:${page.assetUrl}`
  const [unsupportedAnimatedIdentity, setUnsupportedAnimatedIdentity] = useState<string>()
  const animatedVideo = shouldOpenAnimatedImageAsVideo(page, media)
    && supportsReaderAnimatedImagePlayback()
    && unsupportedAnimatedIdentity !== pageIdentity
  const onAnimatedPlaybackUnavailable = useCallback(() => setUnsupportedAnimatedIdentity(pageIdentity), [pageIdentity])

  return page.mediaKind === "video" ? (
    <PageVideo page={page} rotation={rotation} scale={scale} fallbackSize={fallbackSize} controller={videoController} sessionId={sessionId} client={client} media={media} imageTrim={imageTrim} presentationCropInsets={presentationCropInsets} onSubtitleConfigChange={onSubtitleConfigChange} onVideoControlsPinnedChange={onVideoControlsPinnedChange} onListEnded={onVideoListEnded} />
  ) : animatedVideo ? (
    <PageAnimatedImageVideo page={page} rotation={rotation} scale={scale} fallbackSize={fallbackSize} controller={videoController} media={media} imageTrim={imageTrim} presentationCropInsets={presentationCropInsets} onVideoControlsPinnedChange={onVideoControlsPinnedChange} onListEnded={onVideoListEnded} onUnavailable={onAnimatedPlaybackUnavailable} />
  ) : (
    <PageImage page={page} rotation={rotation} scale={scale} colorFilter={colorFilter} imageTrim={imageTrim} imageTrimDetectionActive={imageTrimDetectionActive} presentationCropInsets={presentationCropInsets} sessionId={sessionId} client={client} superResolution={superResolution} onCommittedPage={onCommittedPage} />
  )
}

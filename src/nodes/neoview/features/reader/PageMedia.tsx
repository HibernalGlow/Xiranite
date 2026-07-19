import type { ReaderRotation } from "@xiranite/node-neoview/ui-core"
import type { ReaderImageCropInsets } from "@xiranite/node-neoview/image-trim"

import type { ReaderHttpClient, ReaderMediaConfigDto, ReaderPageDto, ReaderSubtitleConfigDto, ReaderSuperResolutionConfigDto } from "../../adapters/reader-http-client"
import type { ReaderColorFilterPort } from "../color-filter/ReaderColorFilterStore"
import type { ReaderImageTrimPort } from "../image-trim/ReaderImageTrimStore"
import type { ReaderVideoController } from "../video/ReaderVideoController"
import { PageImage } from "./PageImage"
import { PageVideo } from "./PageVideo"

export function PageMedia({ page, rotation, scale, fallbackSize, colorFilter, imageTrim, imageTrimDetectionActive, presentationCropInsets, videoController, sessionId, client, media, superResolution, onSubtitleConfigChange, onVideoListEnded }: {
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
  onVideoListEnded: () => void
}) {
  return page.mediaKind === "video" ? (
    <PageVideo page={page} rotation={rotation} scale={scale} fallbackSize={fallbackSize} controller={videoController} sessionId={sessionId} client={client} media={media} imageTrim={imageTrim} presentationCropInsets={presentationCropInsets} onSubtitleConfigChange={onSubtitleConfigChange} onListEnded={onVideoListEnded} />
  ) : (
    <PageImage page={page} rotation={rotation} scale={scale} colorFilter={colorFilter} imageTrim={imageTrim} imageTrimDetectionActive={imageTrimDetectionActive} presentationCropInsets={presentationCropInsets} sessionId={sessionId} client={client} superResolution={superResolution} />
  )
}

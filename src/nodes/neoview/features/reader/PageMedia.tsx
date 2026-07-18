import type { ReaderRotation } from "@xiranite/node-neoview/ui-core"

import type { ReaderHttpClient, ReaderMediaConfigDto, ReaderPageDto, ReaderSubtitleConfigDto } from "../../adapters/reader-http-client"
import type { ReaderColorFilterPort } from "../color-filter/ReaderColorFilterStore"
import type { ReaderVideoController } from "../video/ReaderVideoController"
import { PageImage } from "./PageImage"
import { PageVideo } from "./PageVideo"

export function PageMedia({ page, rotation, scale, fallbackSize, colorFilter, videoController, sessionId, client, media, onSubtitleConfigChange, onVideoListEnded }: {
  page: ReaderPageDto
  rotation?: ReaderRotation
  scale?: number
  fallbackSize?: { width: number; height: number }
  colorFilter?: ReaderColorFilterPort
  videoController: ReaderVideoController
  sessionId?: string
  client?: ReaderHttpClient
  media?: ReaderMediaConfigDto
  onSubtitleConfigChange?: (patch: Partial<ReaderSubtitleConfigDto>) => Promise<void>
  onVideoListEnded: () => void
}) {
  return page.mediaKind === "video" ? (
    <PageVideo page={page} rotation={rotation} scale={scale} fallbackSize={fallbackSize} controller={videoController} sessionId={sessionId} client={client} media={media} onSubtitleConfigChange={onSubtitleConfigChange} onListEnded={onVideoListEnded} />
  ) : (
    <PageImage page={page} rotation={rotation} scale={scale} colorFilter={colorFilter} />
  )
}

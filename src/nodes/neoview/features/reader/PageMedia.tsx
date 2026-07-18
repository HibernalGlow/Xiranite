import type { ReaderRotation } from "@xiranite/node-neoview/ui-core"

import type { ReaderPageDto } from "../../adapters/reader-http-client"
import type { ReaderColorFilterPort } from "../color-filter/ReaderColorFilterStore"
import type { ReaderVideoController } from "../video/ReaderVideoController"
import { PageImage } from "./PageImage"
import { PageVideo } from "./PageVideo"

export function PageMedia({ page, rotation, scale, colorFilter, videoController, onVideoListEnded }: {
  page: ReaderPageDto
  rotation?: ReaderRotation
  scale?: number
  colorFilter?: ReaderColorFilterPort
  videoController: ReaderVideoController
  onVideoListEnded: () => void
}) {
  return page.mediaKind === "video" ? (
    <PageVideo page={page} rotation={rotation} scale={scale} controller={videoController} onListEnded={onVideoListEnded} />
  ) : (
    <PageImage page={page} rotation={rotation} scale={scale} colorFilter={colorFilter} />
  )
}

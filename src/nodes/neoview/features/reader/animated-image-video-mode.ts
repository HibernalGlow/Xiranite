import { matchesReaderAnimatedVideoKeyword } from "@xiranite/node-neoview/ui-core"

import type { ReaderMediaConfigDto, ReaderPageDto } from "../../adapters/reader-http-client"

const ANIMATED_IMAGE_EXTENSIONS = new Set(["apng", "gif"])

export function shouldOpenAnimatedImageAsVideo(page: ReaderPageDto, media: ReaderMediaConfigDto | undefined): boolean {
  if (!media?.animatedVideoEnabled || page.mediaKind === "video") return false
  if (page.mediaKind === "animated-image") return true
  if (matchesReaderAnimatedVideoKeyword(page.name, media.animatedVideoKeywords)) return true
  return ANIMATED_IMAGE_EXTENSIONS.has(pathExtension(page.name))
}

function pathExtension(path: string): string {
  const filename = path.replaceAll("\\", "/").split("/").at(-1) ?? ""
  const index = filename.lastIndexOf(".")
  return index > 0 ? filename.slice(index + 1).toLowerCase() : ""
}

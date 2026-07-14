import type { PageMediaKind } from "./page.js"

const IMAGE_MIME_TYPES: Readonly<Record<string, string>> = {
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jxl: "image/jxl",
  jpg: "image/jpeg",
  png: "image/png",
  tif: "image/tiff",
  tiff: "image/tiff",
  webp: "image/webp",
}

const VIDEO_MIME_TYPES: Readonly<Record<string, string>> = {
  "3g2": "video/3gpp2",
  "3gp": "video/3gpp",
  avi: "video/x-msvideo",
  flv: "video/x-flv",
  m4v: "video/x-m4v",
  mkv: "video/x-matroska",
  mov: "video/quicktime",
  mp4: "video/mp4",
  mpeg: "video/mpeg",
  mpg: "video/mpeg",
  nov: "video/mp4",
  ogg: "video/ogg",
  ogv: "video/ogg",
  webm: "video/webm",
  wmv: "video/x-ms-wmv",
}

export interface PageMediaType {
  kind: PageMediaKind
  mimeType: string
}

export function pageMediaType(path: string): PageMediaType | undefined {
  const extension = pathExtension(path)
  const imageMimeType = IMAGE_MIME_TYPES[extension]
  if (imageMimeType) {
    return {
      kind: extension === "gif" ? "animated-image" : "image",
      mimeType: imageMimeType,
    }
  }
  const videoMimeType = VIDEO_MIME_TYPES[extension]
  return videoMimeType ? { kind: "video", mimeType: videoMimeType } : undefined
}

export function pathExtension(path: string): string {
  const filename = path.replaceAll("\\", "/").split("/").at(-1) ?? ""
  const index = filename.lastIndexOf(".")
  return index > 0 ? filename.slice(index + 1).toLowerCase() : ""
}

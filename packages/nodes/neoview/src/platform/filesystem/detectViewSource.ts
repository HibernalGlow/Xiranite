import { stat } from "node:fs/promises"

import type { ViewSource } from "../../domain/book/book.js"
import { pageMediaType, pathExtension, type ReaderMediaTypeResolver } from "../../domain/page/media.js"
import { canonicalizePlatformDirectoryPath } from "./PlatformDirectoryPath.js"

export async function detectViewSource(path: string, signal?: AbortSignal, mediaFormats?: ReaderMediaTypeResolver): Promise<Exclude<ViewSource, { kind: "path" }>> {
  signal?.throwIfAborted()
  const canonicalPath = await canonicalizePlatformDirectoryPath(path)
  const sourceStats = await stat(canonicalPath)
  signal?.throwIfAborted()
  if (sourceStats.isDirectory()) return { kind: "directory", path: canonicalPath }
  if (!sourceStats.isFile()) throw new Error(`Reader path is not a file or directory: ${path}`)
  const media = pageMediaType(canonicalPath, mediaFormats)
  if (media) return { kind: media.kind === "video" ? "media" : "image", path: canonicalPath }
  const extension = pathExtension(canonicalPath)
  if (extension === "zip" || extension === "cbz" || extension === "rar" || extension === "cbr" || extension === "7z" || extension === "cb7") {
    return { kind: "archive", path: canonicalPath }
  }
  if (extension === "pdf" || extension === "epub") return { kind: "document", path: canonicalPath, format: extension }
  throw new Error(`Unsupported reader path: ${path}`)
}

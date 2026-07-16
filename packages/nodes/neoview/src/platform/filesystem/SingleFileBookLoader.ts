import { realpath, stat } from "node:fs/promises"
import { basename } from "node:path"

import type { ReaderBook, ViewSource } from "../../domain/book/book.js"
import { pageMediaType } from "../../domain/page/media.js"
import type { ReaderPage } from "../../domain/page/page.js"
import { createReaderBook, stableOpaqueId, timestampsFromFileStats, versionFromFile } from "../books/book-utils.js"
import { FilePageContent } from "../content/FilePageContent.js"

type SingleFileSource = Extract<ViewSource, { kind: "image" | "media" }>

export async function loadSingleFileBook(source: SingleFileSource, signal?: AbortSignal): Promise<ReaderBook> {
  signal?.throwIfAborted()
  const filePath = await realpath(source.path)
  const media = pageMediaType(filePath)
  if (!media || (source.kind === "image" && media.kind === "video") || (source.kind === "media" && media.kind !== "video")) {
    throw new Error(`Reader source does not match ${source.kind}: ${source.path}`)
  }
  const fileStats = await stat(filePath)
  if (!fileStats.isFile()) throw new Error(`Reader source is not a file: ${source.path}`)
  signal?.throwIfAborted()
  const normalizedSource: SingleFileSource = { kind: source.kind, path: filePath }
  const bookId = stableOpaqueId("book", normalizedSource.kind, filePath)
  const name = basename(filePath)
  const contentVersion = versionFromFile(fileStats.size, fileStats.mtimeMs)
  const page: ReaderPage = {
    id: stableOpaqueId("page", bookId, name),
    index: 0,
    name,
    sourcePath: filePath,
    thumbnailSource: { key: filePath, category: "file" },
    mediaKind: media.kind,
    mimeType: media.mimeType,
    byteLength: fileStats.size,
    timestamps: timestampsFromFileStats(fileStats),
    contentVersion,
    content: new FilePageContent(filePath, fileStats.size, media.mimeType),
  }
  return createReaderBook({ id: bookId, source: normalizedSource, displayName: name, pages: [page] })
}

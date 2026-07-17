import { readdir, realpath, stat } from "node:fs/promises"
import { basename, dirname, join } from "node:path"

import type { ReaderBook, ReaderSubtitleAsset, ViewSource } from "../../domain/book/book.js"
import { pageMediaType, type ReaderMediaTypeResolver } from "../../domain/page/media.js"
import type { ReaderPage } from "../../domain/page/page.js"
import { subtitleFormatFromPath, subtitleMatchesVideo } from "../../domain/subtitle/subtitle.js"
import { createReaderBook, stableOpaqueId, timestampsFromFileStats, versionFromFile } from "../books/book-utils.js"
import { FilePageContent } from "../content/FilePageContent.js"

type SingleFileSource = Extract<ViewSource, { kind: "image" | "media" }>

export async function loadSingleFileBook(source: SingleFileSource, signal?: AbortSignal, mediaFormats?: ReaderMediaTypeResolver): Promise<ReaderBook> {
  signal?.throwIfAborted()
  const filePath = await realpath(source.path)
  const media = pageMediaType(filePath, mediaFormats)
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
  const subtitleAssets = media.kind === "video"
    ? await discoverAdjacentSubtitles(filePath, name, bookId, signal)
    : []
  return createReaderBook({ id: bookId, source: normalizedSource, displayName: name, pages: [page], subtitleAssets })
}

async function discoverAdjacentSubtitles(
  videoPath: string,
  videoName: string,
  bookId: string,
  signal?: AbortSignal,
): Promise<ReaderSubtitleAsset[]> {
  const directory = dirname(videoPath)
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    signal?.throwIfAborted()
    return []
  }
  const matches = entries
    .filter((entry) => entry.isFile() && subtitleFormatFromPath(entry.name) && subtitleMatchesVideo({ name: videoName }, { name: entry.name }))
    .slice(0, 16)
  return (await Promise.all(matches.map(async (entry): Promise<ReaderSubtitleAsset | undefined> => {
    signal?.throwIfAborted()
    const path = join(directory, entry.name)
    let stats
    try {
      stats = await stat(path)
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined
      throw error
    }
    if (!stats.isFile()) return undefined
    const format = subtitleFormatFromPath(entry.name)!
    return {
      id: stableOpaqueId("subtitle", bookId, entry.name),
      name: entry.name,
      sourcePath: path,
      format,
      byteLength: stats.size,
      contentVersion: versionFromFile(stats.size, stats.mtimeMs),
      content: new FilePageContent(path, stats.size, format === "vtt" ? "text/vtt" : "text/plain"),
    }
  }))).filter((asset): asset is ReaderSubtitleAsset => Boolean(asset))
}

import type { Stats } from "node:fs"
import { readdir, realpath, stat } from "node:fs/promises"
import { basename, join } from "node:path"

import type { ReaderBook, ReaderSubtitleAsset } from "../../domain/book/book.js"
import { pageMediaType, type ReaderMediaTypeResolver } from "../../domain/page/media.js"
import { subtitleFormatFromPath } from "../../domain/subtitle/subtitle.js"
import type { ReaderPage } from "../../domain/page/page.js"
import { compareNaturalPath } from "../../domain/sorting/natural-sort.js"
import { createReaderBook, stableOpaqueId, timestampsFromFileStats, versionFromFile } from "../books/book-utils.js"
import { FilePageContent } from "../content/FilePageContent.js"

const STAT_CONCURRENCY = 32

interface DirectoryFile {
  name: string
  path: string
  stats: Stats
}

export async function loadDirectoryBook(path: string, signal?: AbortSignal, mediaFormats?: ReaderMediaTypeResolver): Promise<ReaderBook> {
  signal?.throwIfAborted()
  const directoryPath = await realpath(path)
  signal?.throwIfAborted()
  const directoryStats = await stat(directoryPath)
  if (!directoryStats.isDirectory()) throw new Error(`Reader source is not a directory: ${path}`)
  const source = { kind: "directory" as const, path: directoryPath }
  const bookId = stableOpaqueId("book", source.kind, directoryPath)
  const entries = await readdir(directoryPath, { withFileTypes: true })
  const candidates = entries.filter((entry) => entry.isFile() && (pageMediaType(entry.name, mediaFormats) || subtitleFormatFromPath(entry.name)))
  const files = (await mapWithConcurrency(candidates, STAT_CONCURRENCY, async (entry) => {
    signal?.throwIfAborted()
    const filePath = join(directoryPath, entry.name)
    try {
      return { name: entry.name, path: filePath, stats: await stat(filePath) }
    } catch (error) {
      if (isMissingFile(error)) return undefined
      throw error
    }
  })).filter((file): file is DirectoryFile => Boolean(file?.stats.isFile()))
  signal?.throwIfAborted()
  files.sort((left, right) => compareNaturalPath(left.name, right.name))
  const pageFiles = files.filter((file) => pageMediaType(file.name, mediaFormats))
  const pages = pageFiles.map((file, index): ReaderPage => {
    const media = pageMediaType(file.name, mediaFormats)!
    const contentVersion = versionFromFile(file.stats.size, file.stats.mtimeMs)
    return {
      id: stableOpaqueId("page", bookId, file.name),
      index,
      name: file.name,
      sourcePath: file.path,
      thumbnailSource: { key: file.path, category: "file" },
      mediaKind: media.kind,
      mimeType: media.mimeType,
      byteLength: file.stats.size,
      timestamps: timestampsFromFileStats(file.stats),
      contentVersion,
      content: new FilePageContent(file.path, file.stats.size, media.mimeType),
    }
  })
  const subtitleAssets = files.filter((file) => subtitleFormatFromPath(file.name)).slice(0, 512).flatMap((file): ReaderSubtitleAsset[] => {
    const format = subtitleFormatFromPath(file.name)
    if (!format) return []
    const contentVersion = versionFromFile(file.stats.size, file.stats.mtimeMs)
    return [{
      id: stableOpaqueId("subtitle", bookId, file.name),
      name: file.name,
      sourcePath: file.path,
      format,
      byteLength: file.stats.size,
      contentVersion,
      content: new FilePageContent(file.path, file.stats.size, subtitleContentType(format)),
    }]
  })
  return createReaderBook({ id: bookId, source, displayName: basename(directoryPath), pages, subtitleAssets })
}

function subtitleContentType(format: string): string {
  return format === "vtt" ? "text/vtt" : "text/plain"
}

async function mapWithConcurrency<T, R>(
  input: readonly T[],
  concurrency: number,
  transform: (value: T) => Promise<R>,
): Promise<R[]> {
  const output: R[] = []
  output.length = input.length
  let nextIndex = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, input.length) }, async () => {
    while (nextIndex < input.length) {
      const index = nextIndex++
      output[index] = await transform(input[index]!)
    }
  }))
  return output
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT")
}

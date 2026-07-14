import { realpath, stat } from "node:fs/promises"
import { basename } from "node:path"

import type { ReaderBook, ViewSource } from "../../domain/book/book.js"
import { pageMediaType, pathExtension } from "../../domain/page/media.js"
import type { ReaderPage } from "../../domain/page/page.js"
import { compareNaturalPath } from "../../domain/sorting/natural-sort.js"
import type { ArchiveProvider } from "../../ports/ArchiveProvider.js"
import { createReaderBook, stableOpaqueId, versionFromFile } from "../books/book-utils.js"
import { ArchivePageContent } from "../content/ArchivePageContent.js"

export async function loadArchiveBook(source: Extract<ViewSource, { kind: "archive" }>, signal?: AbortSignal): Promise<ReaderBook> {
  signal?.throwIfAborted()
  if (source.entryPath) throw new Error("Nested archive entry sources are not implemented yet.")
  const archivePath = await realpath(source.path)
  const extension = pathExtension(archivePath)
  if (extension !== "zip" && extension !== "cbz") {
    throw new Error(`Archive format is not available yet: .${extension || "unknown"}`)
  }
  const archiveStats = await stat(archivePath)
  if (!archiveStats.isFile()) throw new Error(`Reader source is not an archive file: ${source.path}`)
  signal?.throwIfAborted()
  const { ZipArchiveProvider } = await import("./zip/ZipArchiveProvider.js")
  const provider: ArchiveProvider = new ZipArchiveProvider(archivePath)
  try {
    const entries = await provider.list(signal)
    const pageEntries = entries
      .filter((entry) => entry.kind === "file" && pageMediaType(entry.path))
      .sort((left, right) => compareNaturalPath(left.path, right.path))
    const normalizedSource = { kind: "archive" as const, path: archivePath }
    const bookId = stableOpaqueId("book", normalizedSource.kind, archivePath)
    const archiveVersion = versionFromFile(archiveStats.size, archiveStats.mtimeMs)
    const pages = pageEntries.map((entry, index): ReaderPage => {
      const media = pageMediaType(entry.path)!
      return {
        id: stableOpaqueId("page", bookId, entry.id),
        index,
        name: basename(entry.path),
        sourcePath: archivePath,
        entryPath: entry.path,
        mediaKind: media.kind,
        mimeType: media.mimeType,
        byteLength: entry.uncompressedSize,
        contentVersion: `${archiveVersion}-${entry.crc32?.toString(16) ?? entry.id}`,
        content: new ArchivePageContent(provider, entry.id, entry.uncompressedSize, media.mimeType),
      }
    })
    return createReaderBook({
      id: bookId,
      source: normalizedSource,
      displayName: basename(archivePath),
      pages,
      dispose: () => provider.close(),
    })
  } catch (error) {
    await provider.close()
    throw error
  }
}

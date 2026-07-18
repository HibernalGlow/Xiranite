import type { ViewSource } from "../../domain/book/book.js"
import type { ReaderMediaTypeResolver } from "../../domain/page/media.js"
import type { ReaderBookLoader } from "../../ports/ReaderBookLoader.js"
import type { ReaderBookLoadOptions } from "../../ports/ReaderBookLoader.js"
import type { ResourceScheduler } from "../../ports/ResourceScheduler.js"
import type { SolidArchiveCache } from "../archives/sevenzip/SolidArchiveCache.js"

export interface PlatformReaderBookLoaderOptions {
  resourceScheduler?: ResourceScheduler
  archiveTempDirectory?: string
  maxArchiveDepth?: number
  maxArchiveMaterializedBytes?: number
  solidArchiveCache?: SolidArchiveCache
  maxSolidArchiveCacheBytes?: number
  mediaFormats?: ReaderMediaTypeResolver
}

export function createPlatformReaderBookLoader(options: PlatformReaderBookLoaderOptions = {}): ReaderBookLoader {
  const load: ReaderBookLoader = async (source: ViewSource, loadOptions: ReaderBookLoadOptions = {}) => {
    const signal = loadOptions.signal
    switch (source.kind) {
      case "path": {
        const { detectViewSource } = await import("../filesystem/detectViewSource.js")
        return load(await detectViewSource(source.path, signal, options.mediaFormats), loadOptions)
      }
      case "directory": {
        const { loadDirectoryBook } = await import("../filesystem/DirectoryBookLoader.js")
        return loadDirectoryBook(source.path, signal, options.mediaFormats)
      }
      case "image": {
        const { loadSingleFileBook } = await import("../filesystem/SingleFileBookLoader.js")
        return loadSingleFileBook(source, signal, options.mediaFormats)
      }
      case "media": {
        const { loadSingleFileBook } = await import("../filesystem/SingleFileBookLoader.js")
        return loadSingleFileBook(source, signal, options.mediaFormats)
      }
      case "archive": {
        const { loadArchiveBook } = await import("../archives/ArchiveBookLoader.js")
        return loadArchiveBook(source, loadOptions, options)
      }
      case "document": {
        if (source.format === "epub") {
          const { loadEpubBook } = await import("../epub/EpubBookLoader.js")
          return loadEpubBook(
            source as Extract<ViewSource, { kind: "document" }> & { format: "epub" },
            signal,
            options.mediaFormats,
            options.resourceScheduler,
          )
        }
        throw new Error(`Document provider is not available yet: ${source.format}`)
      }
    }
  }
  return load
}

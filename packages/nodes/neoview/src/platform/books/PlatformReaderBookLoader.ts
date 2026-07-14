import type { ViewSource } from "../../domain/book/book.js"
import type { ReaderBookLoader } from "../../ports/ReaderBookLoader.js"
import type { ReaderBookLoadOptions } from "../../ports/ReaderBookLoader.js"
import type { ResourceScheduler } from "../../ports/ResourceScheduler.js"

export interface PlatformReaderBookLoaderOptions {
  resourceScheduler?: ResourceScheduler
  archiveTempDirectory?: string
  maxArchiveDepth?: number
  maxArchiveMaterializedBytes?: number
}

export function createPlatformReaderBookLoader(options: PlatformReaderBookLoaderOptions = {}): ReaderBookLoader {
  const load: ReaderBookLoader = async (source: ViewSource, loadOptions: ReaderBookLoadOptions = {}) => {
    const signal = loadOptions.signal
    switch (source.kind) {
      case "path": {
        const { detectViewSource } = await import("../filesystem/detectViewSource.js")
        return load(await detectViewSource(source.path, signal), loadOptions)
      }
      case "directory": {
        const { loadDirectoryBook } = await import("../filesystem/DirectoryBookLoader.js")
        return loadDirectoryBook(source.path, signal)
      }
      case "image": {
        const { loadSingleFileBook } = await import("../filesystem/SingleFileBookLoader.js")
        return loadSingleFileBook(source, signal)
      }
      case "media": {
        const { loadSingleFileBook } = await import("../filesystem/SingleFileBookLoader.js")
        return loadSingleFileBook(source, signal)
      }
      case "archive": {
        const { loadArchiveBook } = await import("../archives/ArchiveBookLoader.js")
        return loadArchiveBook(source, loadOptions, options)
      }
      case "document":
        throw new Error(`Document provider is not available yet: ${source.format}`)
    }
  }
  return load
}

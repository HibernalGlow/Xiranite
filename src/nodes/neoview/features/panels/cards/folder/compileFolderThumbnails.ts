import type {
  ReaderDirectoryEntryDto,
  ReaderHttpClient,
  ReaderLibraryThumbnailRegistrationDto,
} from "../../../../adapters/reader-http-client"

const COMPILE_BATCH_SIZE = 256

export interface FolderThumbnailCompileProgress {
  processed: number
  total: number
  completed: number
  failed: number
}

export async function compileFolderThumbnails(
  client: ReaderHttpClient,
  sessionId: string,
  total: number,
  options: { previewCount: 1 | 4 | 9 | 16 },
  signal: AbortSignal,
  onProgress?: (progress: FolderThumbnailCompileProgress) => void,
): Promise<FolderThumbnailCompileProgress> {
  if (!client.listDirectoryBrowser || !client.prewarmLibraryThumbnails || total <= 0) {
    return { processed: 0, total: Math.max(0, total), completed: 0, failed: 0 }
  }
  let cursor = 0
  let completed = 0
  let failed = 0
  while (cursor < total) {
    signal.throwIfAborted()
    const page = await client.listDirectoryBrowser(sessionId, cursor, Math.min(COMPILE_BATCH_SIZE, total - cursor), signal)
    signal.throwIfAborted()
    if (!page.entries.length) break
    const items = page.entries.flatMap((entry, offset) => compileItem(entry, cursor + offset, options.previewCount))
    if (items.length) {
      const summary = await client.prewarmLibraryThumbnails(items, { mode: "ensure", concurrency: 2 }, signal)
      completed += summary.completed
      failed += summary.failed
    }
    cursor += page.entries.length
    onProgress?.({ processed: cursor, total, completed, failed })
  }
  return { processed: cursor, total, completed, failed }
}

function compileItem(
  entry: ReaderDirectoryEntryDto,
  index: number,
  previewCount: 1 | 4 | 9 | 16,
): ReaderLibraryThumbnailRegistrationDto[] {
  if (entry.kind === "directory") {
    return [{ id: `folder-compile-${index}`, path: entry.path, kind: "folder", previewCount }]
  }
  if (entry.kind === "file" && entry.readerSupported) {
    return [{ id: `folder-compile-${index}`, path: entry.path, kind: "file", previewCount: 1 }]
  }
  return []
}

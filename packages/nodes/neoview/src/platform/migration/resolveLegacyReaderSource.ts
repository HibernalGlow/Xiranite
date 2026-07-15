import { realpath } from "node:fs/promises"
import { resolve } from "node:path"

import type { ViewSource } from "../../domain/book/book.js"
import type { ResolvedReaderSourceIdentity } from "../../migration/LegacyReaderDataImporter.js"
import { stableOpaqueId } from "../books/book-utils.js"
import { detectViewSource } from "../filesystem/detectViewSource.js"

export async function resolveLegacyReaderSource(source: ViewSource): Promise<ResolvedReaderSourceIdentity> {
  let normalized = source
  let canonical = true
  try {
    if (source.kind === "path") {
      normalized = await detectViewSource(source.path)
    } else {
      const path = await realpath(source.path)
      normalized = source.kind === "archive"
        ? { kind: "archive", path, ...(source.entryPaths?.length ? { entryPaths: [...source.entryPaths] } : source.entryPath ? { entryPaths: [source.entryPath] } : {}) }
        : { ...source, path }
    }
  } catch {
    canonical = false
    normalized = { ...source, path: resolve(source.path) }
  }
  const entryPaths = normalized.kind === "archive"
    ? normalized.entryPaths ?? (normalized.entryPath ? [normalized.entryPath] : [])
    : []
  return {
    bookId: stableOpaqueId("book", normalized.kind, normalized.path, ...entryPaths),
    source: normalized,
    canonical,
  }
}

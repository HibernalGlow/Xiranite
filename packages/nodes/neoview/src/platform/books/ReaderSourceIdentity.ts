import { clipmStableFilenameIdentity } from "@xiranite/node-clipm/filename"

import type { ViewSource } from "../../domain/book/book.js"
import { stableOpaqueId } from "./book-utils.js"

export function readerSourceIdentityPath(path: string): string {
  return clipmStableFilenameIdentity(path)
}

export function readerBookIdForSource(source: ViewSource): string {
  const discriminator = source.kind === "document" ? source.format : source.kind
  const entryPaths = source.kind === "archive"
    ? source.entryPaths ?? (source.entryPath ? [source.entryPath] : [])
    : []
  return stableOpaqueId("book", discriminator, readerSourceIdentityPath(source.path), ...entryPaths)
}

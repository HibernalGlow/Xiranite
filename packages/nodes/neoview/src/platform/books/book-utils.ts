import { createHash } from "node:crypto"
import type { Stats } from "node:fs"

import type { ReaderBook, ViewSource } from "../../domain/book/book.js"
import type { ReaderPage, ReaderPageTimestamps } from "../../domain/page/page.js"

export function stableOpaqueId(prefix: string, ...parts: Array<string | number>): string {
  const hash = createHash("sha256")
  for (const part of parts) {
    hash.update(String(part))
    hash.update("\0")
  }
  return `${prefix}-${hash.digest("hex").slice(0, 24)}`
}

export function versionFromFile(size: number, modifiedAtMs: number): string {
  return `${size.toString(36)}-${Math.trunc(modifiedAtMs).toString(36)}`
}

export function timestampsFromFileStats(
  stats: Pick<Stats, "atimeMs" | "birthtimeMs" | "mtimeMs">,
): ReaderPageTimestamps {
  return {
    source: "filesystem",
    createdAtMs: validTimestamp(stats.birthtimeMs),
    modifiedAtMs: validTimestamp(stats.mtimeMs),
    accessedAtMs: validTimestamp(stats.atimeMs),
  }
}

export function timestampsFromArchiveEntry(modifiedAt?: string): ReaderPageTimestamps | undefined {
  if (!modifiedAt) return undefined
  const modifiedAtMs = Date.parse(modifiedAt)
  return Number.isFinite(modifiedAtMs) ? { source: "archive-entry", modifiedAtMs } : undefined
}

export function createReaderBook(input: {
  id: string
  source: ViewSource
  displayName: string
  pages: readonly ReaderPage[]
  dispose?: () => Promise<void>
}): ReaderBook {
  let closing: Promise<void> | undefined
  const close = (): Promise<void> => {
    closing ??= Promise.resolve().then(async () => {
      await input.dispose?.()
    })
    return closing
  }
  return {
    id: input.id,
    source: input.source,
    displayName: input.displayName,
    pages: input.pages,
    close,
    [Symbol.asyncDispose]: close,
  }
}

function validTimestamp(value: number): number | undefined {
  return Number.isFinite(value) && value >= 0 ? value : undefined
}

import { createHash } from "node:crypto"

import type { ReaderBook, ViewSource } from "../../domain/book/book.js"
import type { ReaderPage } from "../../domain/page/page.js"

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

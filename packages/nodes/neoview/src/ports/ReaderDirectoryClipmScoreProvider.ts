import type { ReaderDirectoryEntry } from "./ReaderDirectoryListingProvider.js"

export interface ReaderDirectoryClipmScoreProvider {
  hydrate(
    entries: readonly ReaderDirectoryEntry[],
    signal?: AbortSignal,
  ): Promise<readonly ReaderDirectoryEntry[]>
}

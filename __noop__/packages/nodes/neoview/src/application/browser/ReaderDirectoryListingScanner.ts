import ignore from "ignore"

import type { ReaderDirectoryEntry } from "../../ports/ReaderDirectoryListingProvider.js"
import type {
  ReaderFileTreeEntry,
  ReaderFileTreeScanOptions,
  ReaderFileTreeScanner,
} from "../../ports/ReaderFileTreeScanner.js"

const DEFAULT_MAXIMUM_ENTRIES = 1_000_000

/** Adapts an existing stable directory snapshot to the shared search scanner contract. */
export class ReaderDirectoryListingScanner implements ReaderFileTreeScanner {
  constructor(private readonly entries: readonly ReaderDirectoryEntry[]) {}

  async *scan(
    _rootPath: string,
    options: ReaderFileTreeScanOptions = {},
    signal?: AbortSignal,
  ): AsyncIterable<ReaderFileTreeEntry> {
    signal?.throwIfAborted()
    const exclusions = options.excludePatterns?.length ? ignore().add(options.excludePatterns) : undefined
    const maximumEntries = options.maximumEntries ?? DEFAULT_MAXIMUM_ENTRIES
    let count = 0
    for (const entry of this.entries) {
      signal?.throwIfAborted()
      if (!included(entry.kind, options)) continue
      const relativePath = entry.name.replaceAll("\\", "/")
      if (exclusions?.ignores(entry.kind === "directory" ? `${relativePath}/` : relativePath)) continue
      count += 1
      if (count > maximumEntries) throw new RangeError(`Directory listing exceeds the ${maximumEntries} entry limit.`)
      yield {
        name: entry.name,
        path: entry.path,
        relativePath: entry.name,
        depth: 0,
        kind: entry.kind,
      }
    }
  }
}

function included(kind: ReaderDirectoryEntry["kind"], options: ReaderFileTreeScanOptions): boolean {
  if (kind === "directory") return options.includeDirectories ?? true
  if (kind === "file") return options.includeFiles ?? true
  return options.includeOther ?? false
}

import readdirp from "readdirp"
import type { ReaddirpStream } from "readdirp"
import ignore from "ignore"

import type {
  ReaderFileTreeEntry,
  ReaderFileTreeScanOptions,
  ReaderFileTreeScanner,
} from "../../ports/ReaderFileTreeScanner.js"
import type { ResourceScheduler } from "../../ports/ResourceScheduler.js"

const DEFAULT_MAXIMUM_ENTRIES = 1_000_000

export class PlatformFileTreeScanner implements ReaderFileTreeScanner {
  constructor(
    private readonly resourceScheduler?: ResourceScheduler,
    private readonly ownerId = "neoview:file-tree",
  ) {}

  async *scan(
    rootPath: string,
    options: ReaderFileTreeScanOptions = {},
    signal?: AbortSignal,
  ): AsyncIterable<ReaderFileTreeEntry> {
    signal?.throwIfAborted()
    const maximumDepth = boundedInteger(options.maximumDepth, 0, 4_096, Number.POSITIVE_INFINITY)
    const maximumEntries = boundedInteger(options.maximumEntries, 1, 10_000_000, DEFAULT_MAXIMUM_ENTRIES)
    const exclusions = createExclusions(options.excludePatterns)
    const lease = await this.resourceScheduler?.acquire({
      resource: "io",
      kind: "reader.file-tree.scan",
      priority: options.resourcePriority ?? "background",
      ownerId: this.ownerId,
    }, signal)
    let stream: ReaddirpStream | undefined
    const abort = () => stream?.destroy(abortReason(signal))
    let count = 0
    try {
      stream = readdirp(rootPath, {
        depth: maximumDepth,
        type: "all",
        alwaysStat: false,
        highWaterMark: 256,
        directoryFilter: exclusions ? (entry) => !exclusions.ignores(normalizeRelativePath(entry.path, true)) : undefined,
        fileFilter: exclusions ? (entry) => !exclusions.ignores(normalizeRelativePath(entry.path, false)) : undefined,
      })
      signal?.addEventListener("abort", abort, { once: true })
      for await (const entry of stream) {
        signal?.throwIfAborted()
        const kind = entry.dirent?.isDirectory() ? "directory" : entry.dirent?.isFile() ? "file" : "other"
        if (!included(kind, options)) continue
        count += 1
        if (count > maximumEntries) {
          stream.destroy()
          throw new RangeError(`File tree exceeds the ${maximumEntries} entry limit: ${rootPath}`)
        }
        yield {
          name: entry.basename,
          path: entry.fullPath,
          relativePath: entry.path,
          depth: pathDepth(entry.path),
          kind,
        }
      }
    } finally {
      signal?.removeEventListener("abort", abort)
      if (stream && !stream.destroyed) stream.destroy()
      lease?.release()
    }
  }
}

function createExclusions(patterns: readonly string[] | undefined): ReturnType<typeof ignore> | undefined {
  if (!patterns?.length) return undefined
  return ignore().add(patterns)
}

function normalizeRelativePath(path: string, directory: boolean): string {
  const normalized = path.replaceAll("\\", "/")
  return directory ? `${normalized}/` : normalized
}

function included(kind: ReaderFileTreeEntry["kind"], options: ReaderFileTreeScanOptions): boolean {
  if (kind === "directory") return options.includeDirectories ?? true
  if (kind === "file") return options.includeFiles ?? true
  return options.includeOther ?? false
}

function pathDepth(relativePath: string): number {
  return relativePath.split(/[\\/]+/u).filter(Boolean).length - 1
}

function boundedInteger(value: number | undefined, minimum: number, maximum: number, fallback: number): number {
  return value === undefined ? fallback : Number.isSafeInteger(value) && value >= minimum && value <= maximum
    ? value
    : fallback
}

function abortReason(signal: AbortSignal | undefined): Error {
  return signal?.reason instanceof Error ? signal.reason : new DOMException("File tree scan aborted", "AbortError")
}

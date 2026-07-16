import picomatch from "picomatch"

import type { ReaderFileTreeEntry, ReaderFileTreeScanner } from "../../ports/ReaderFileTreeScanner.js"

export type ReaderFileTreeSearchMode = "text" | "glob"
export type ReaderFileTreeSearchKind = "all" | "file" | "directory"

export interface ReaderFileTreeSearchOptions {
  mode?: ReaderFileTreeSearchMode
  kind?: ReaderFileTreeSearchKind
  caseSensitive?: boolean
  searchInPath?: boolean
  maximumDepth?: number
  maximumResults?: number
  maximumEntries?: number
  excludePatterns?: readonly string[]
}

export type ReaderFileTreeSearchEvent =
  | { type: "meta"; sessionId: string; rootPath: string; generation: number; query: string; mode: ReaderFileTreeSearchMode }
  | { type: "entry"; index: number; entry: ReaderFileTreeEntry }
  | { type: "complete"; scanned: number; matched: number; truncated: boolean }

export interface ReaderFileTreeSearchHandle extends AsyncDisposable {
  readonly events: AsyncIterable<ReaderFileTreeSearchEvent>
  close(): Promise<void>
}

export function searchReaderFileTree(
  scanner: ReaderFileTreeScanner,
  session: { id: string; rootPath: string; generation: number },
  query: string,
  options: ReaderFileTreeSearchOptions = {},
  signal?: AbortSignal,
): AsyncIterable<ReaderFileTreeSearchEvent> {
  const normalizedQuery = requireQuery(query)
  const mode = options.mode ?? "text"
  const kind = options.kind ?? "all"
  if (mode !== "text" && mode !== "glob") throw new Error(`Unsupported file tree search mode: ${String(mode)}`)
  if (kind !== "all" && kind !== "file" && kind !== "directory") throw new Error(`Unsupported file tree search kind: ${String(kind)}`)
  const maximumResults = boundedInteger(options.maximumResults, 1, 10_000, 512, "maximumResults")
  const maximumEntries = boundedInteger(options.maximumEntries, 1, 10_000_000, 1_000_000, "maximumEntries")
  const maximumDepth = options.maximumDepth === undefined
    ? undefined
    : boundedInteger(options.maximumDepth, 0, 4_096, 0, "maximumDepth")
  const excludePatterns = validatePatterns(options.excludePatterns)
  const matches = createMatcher(normalizedQuery, mode, options.caseSensitive ?? false, options.searchInPath ?? false)
  return search(scanner, session, normalizedQuery, mode, kind, matches, {
    maximumDepth,
    maximumEntries,
    maximumResults,
    excludePatterns,
  }, signal)
}

async function* search(
  scanner: ReaderFileTreeScanner,
  session: { id: string; rootPath: string; generation: number },
  query: string,
  mode: ReaderFileTreeSearchMode,
  kind: ReaderFileTreeSearchKind,
  matches: (entry: ReaderFileTreeEntry) => boolean,
  limits: { maximumDepth?: number; maximumEntries: number; maximumResults: number; excludePatterns?: readonly string[] },
  signal?: AbortSignal,
): AsyncIterable<ReaderFileTreeSearchEvent> {
  signal?.throwIfAborted()
  yield { type: "meta", sessionId: session.id, rootPath: session.rootPath, generation: session.generation, query, mode }
  let scanned = 0
  let matched = 0
  let truncated = false
  const includeDirectories = kind !== "file"
  const includeFiles = kind !== "directory"
  for await (const entry of scanner.scan(session.rootPath, {
    maximumDepth: limits.maximumDepth,
    maximumEntries: limits.maximumEntries,
    includeDirectories,
    includeFiles,
    includeOther: false,
    excludePatterns: limits.excludePatterns,
    resourcePriority: "view",
  }, signal)) {
    signal?.throwIfAborted()
    scanned += 1
    if (!matches(entry)) continue
    if (matched >= limits.maximumResults) {
      truncated = true
      break
    }
    yield { type: "entry", index: matched, entry }
    matched += 1
  }
  signal?.throwIfAborted()
  yield { type: "complete", scanned, matched, truncated }
}

function createMatcher(
  query: string,
  mode: ReaderFileTreeSearchMode,
  caseSensitive: boolean,
  searchInPath: boolean,
): (entry: ReaderFileTreeEntry) => boolean {
  if (mode === "glob") {
    const matches = picomatch(query, { nocase: !caseSensitive, dot: true })
    return (entry) => matches(normalizeRelativePath(entry.relativePath))
  }
  const expected = caseSensitive ? query : query.toLocaleLowerCase()
  return (entry) => {
    const name = caseSensitive ? entry.name : entry.name.toLocaleLowerCase()
    const normalizedPath = normalizeRelativePath(entry.relativePath)
    const relativePath = caseSensitive ? normalizedPath : normalizedPath.toLocaleLowerCase()
    return name.includes(expected) || (searchInPath && relativePath.includes(expected))
  }
}

function normalizeRelativePath(path: string): string {
  return path.replaceAll("\\", "/")
}

function requireQuery(query: string): string {
  const value = query.trim()
  if (!value || value.length > 512 || value.includes("\0")) throw new Error("File tree search query must be 1..512 characters without NUL.")
  return value
}

function validatePatterns(patterns: readonly string[] | undefined): readonly string[] | undefined {
  if (!patterns?.length) return undefined
  if (patterns.length > 64) throw new Error("File tree search accepts at most 64 exclusion patterns.")
  for (const pattern of patterns) {
    if (!pattern || pattern.length > 512 || pattern.includes("\0")) {
      throw new Error("File tree exclusion patterns must be 1..512 characters without NUL.")
    }
  }
  return [...patterns]
}

function boundedInteger(value: number | undefined, minimum: number, maximum: number, fallback: number, name: string): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer from ${minimum} to ${maximum}.`)
  }
  return value
}

import picomatch from "picomatch"

import type { ReaderFileTreeEntry, ReaderFileTreeScanner } from "../../ports/ReaderFileTreeScanner.js"
import {
  readerDirectoryEntryMatchesFilter,
  type ReaderDirectoryEntryType,
  type ReaderDirectoryFilter,
} from "../../domain/browser/ReaderDirectoryFilter.js"

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
  includeTags?: readonly string[]
  excludeTags?: readonly string[]
  tagMode?: "all" | "any"
}

export type ReaderFileTreeSearchEvent =
  | { type: "meta"; sessionId: string; rootPath: string; generation: number; query: string; mode: ReaderFileTreeSearchMode; filter?: ReaderDirectoryFilter }
  | { type: "entry"; index: number; entry: ReaderFileTreeEntry }
  | { type: "complete"; scanned: number; matched: number; truncated: boolean }

export interface ReaderFileTreeSearchHandle extends AsyncDisposable {
  readonly events: AsyncIterable<ReaderFileTreeSearchEvent>
  close(): Promise<void>
}

export function searchReaderFileTree(
  scanner: ReaderFileTreeScanner,
  session: { id: string; rootPath: string; generation: number; filter?: ReaderDirectoryFilter },
  query: string,
  options: ReaderFileTreeSearchOptions = {},
  signal?: AbortSignal,
  classifyEntry?: (entry: ReaderFileTreeEntry) => ReaderDirectoryEntryType,
): AsyncIterable<ReaderFileTreeSearchEvent> {
  const includeTags = validateTags(options.includeTags, "includeTags")
  const excludeTags = validateTags(options.excludeTags, "excludeTags")
  const normalizedQuery = requireQuery(query, Boolean(includeTags.length || excludeTags.length))
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
  const matchesTags = createTagMatcher(includeTags, excludeTags, options.tagMode ?? "all")
  return search(scanner, session, normalizedQuery, mode, kind, (entry) => matches(entry) && matchesTags(entry), {
    maximumDepth,
    maximumEntries,
    maximumResults,
    excludePatterns,
  }, signal, classifyEntry)
}

async function* search(
  scanner: ReaderFileTreeScanner,
  session: { id: string; rootPath: string; generation: number; filter?: ReaderDirectoryFilter },
  query: string,
  mode: ReaderFileTreeSearchMode,
  kind: ReaderFileTreeSearchKind,
  matches: (entry: ReaderFileTreeEntry) => boolean,
  limits: { maximumDepth?: number; maximumEntries: number; maximumResults: number; excludePatterns?: readonly string[] },
  signal?: AbortSignal,
  classifyEntry?: (entry: ReaderFileTreeEntry) => ReaderDirectoryEntryType,
): AsyncIterable<ReaderFileTreeSearchEvent> {
  signal?.throwIfAborted()
  yield {
    type: "meta",
    sessionId: session.id,
    rootPath: session.rootPath,
    generation: session.generation,
    query,
    mode,
    ...(session.filter ? { filter: session.filter } : {}),
  }
  let scanned = 0
  let matched = 0
  let truncated = false
  const includeDirectories = kind !== "file" && (session.filter === undefined || session.filter === "all" || session.filter === "directory")
  const includeFiles = kind !== "directory" && session.filter !== "directory"
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
    if (session.filter && session.filter !== "all") {
      const type = entry.kind === "directory" ? "directory" : classifyEntry?.(entry) ?? "other"
      if (!readerDirectoryEntryMatchesFilter(type, session.filter)) continue
    }
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
  if (!query) return () => true
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

function requireQuery(query: string, tagOnly: boolean): string {
  const value = query.trim()
  if ((!value && !tagOnly) || value.length > 512 || value.includes("\0")) throw new Error("File tree search query must be 1..512 characters without NUL, unless tag filters are present.")
  return value
}

function createTagMatcher(include: readonly string[], exclude: readonly string[], mode: "all" | "any"): (entry: ReaderFileTreeEntry) => boolean {
  if (mode !== "all" && mode !== "any") throw new Error("tagMode must be all or any.")
  const included = include.map(normalizeTag)
  const excluded = new Set(exclude.map(normalizeTag))
  return (entry) => {
    if (!included.length && !excluded.size) return true
    const tags = new Set((entry.tags ?? []).map(normalizeTag))
    if ([...excluded].some((tag) => tags.has(tag))) return false
    return mode === "all" ? included.every((tag) => tags.has(tag)) : !included.length || included.some((tag) => tags.has(tag))
  }
}

function validateTags(values: readonly string[] | undefined, name: string): string[] {
  if (!values?.length) return []
  if (values.length > 64) throw new Error(`${name} accepts at most 64 tags.`)
  const output = new Set<string>()
  for (const value of values) {
    const tag = value.trim()
    if (!tag || tag.length > 384 || tag.includes("\0")) throw new Error(`${name} values must be 1..384 characters without NUL.`)
    output.add(tag)
  }
  return [...output]
}

function normalizeTag(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase()
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

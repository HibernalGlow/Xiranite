/**
 * Pure folder-search domain helpers shared by GUI, tests and tab snapshots.
 * Keeps request shaping and virtual-list page building out of React components.
 */
import type {
  ReaderDirectoryEntryDto,
  ReaderDirectoryPageDto,
  ReaderDirectorySearchKindDto,
  ReaderDirectorySearchModeDto,
  ReaderDirectorySearchOptionsDto,
  ReaderDirectorySearchResultDto,
  ReaderDirectorySortDto,
  ReaderFolderSearchConfig,
} from "../../../../../../adapters/reader-http-client"

export const SEARCH_RESULT_LIMIT = 512
export const SEARCH_HISTORY_LIMIT = 20
/** Virtual listing path for search results — same File Card views consume this catalog. */
export const VIRTUAL_SEARCH_PATH = "virtual://search"

const DEFAULT_SEARCH_SORT: ReaderDirectorySortDto = {
  field: "name",
  order: "asc",
  directoriesFirst: true,
}

export type FolderSearchCriteria = {
  query: string
  mode: ReaderDirectorySearchModeDto
  kind: ReaderDirectorySearchKindDto
  caseSensitive: boolean
  includeSubfolders: boolean
  searchInPath: boolean
  includeTags: string[]
  excludeTags: string[]
  tagMode: "all" | "any"
}

export type FolderSearchResultSnapshot = {
  entries: ReaderDirectoryEntryDto[]
  scanned: number
  matched: number
  truncated: boolean
  rootPath: string
  generation: number
  query: string
  mode: ReaderDirectorySearchModeDto
}

export type FolderSearchTabSnapshot = {
  criteria: FolderSearchCriteria
  result?: FolderSearchResultSnapshot
  rootPath: string
}

export function isVirtualSearchPath(path: string | undefined | null): boolean {
  return typeof path === "string" && (path === VIRTUAL_SEARCH_PATH || path.startsWith(`${VIRTUAL_SEARCH_PATH}/`))
}

export function virtualSearchPath(query: string): string {
  const normalized = query.trim()
  return normalized ? `${VIRTUAL_SEARCH_PATH}/${encodeURIComponent(normalized)}` : VIRTUAL_SEARCH_PATH
}

export function virtualSearchLabel(path: string): string {
  if (!isVirtualSearchPath(path)) return path
  if (path === VIRTUAL_SEARCH_PATH) return "搜索结果"
  try {
    return decodeURIComponent(path.slice(VIRTUAL_SEARCH_PATH.length + 1)) || "搜索结果"
  } catch {
    return path.slice(VIRTUAL_SEARCH_PATH.length + 1) || "搜索结果"
  }
}

/**
 * Build a directory page from search hits so list/grid/details/mosaic
 * renderers can reuse the normal File Card virtualization path.
 */
export function createSearchDirectoryPage(input: {
  sessionId: string
  rootPath: string
  result: Pick<ReaderDirectorySearchResultDto, "entries" | "generation" | "query" | "mode">
  criteria: Pick<FolderSearchCriteria, "query">
  base?: Pick<
    ReaderDirectoryPageDto,
    | "filter"
    | "filterOptions"
    | "sort"
    | "sortFields"
    | "metadataFields"
    | "metadataCapabilities"
    | "sortSource"
    | "sortTemporary"
    | "globalDefaultSort"
    | "tabDefaultSort"
    | "navigationEntryId"
    | "generation"
  >
}): ReaderDirectoryPageDto {
  const query = input.criteria.query.trim() || input.result.query
  const sort = input.base?.sort ?? DEFAULT_SEARCH_SORT
  const sortFields = input.base?.sortFields ?? ["name", "date", "size", "type", "path"]
  const metadataFields = input.base?.metadataFields ?? []
  const generation = Math.max(1, input.result.generation || (input.base?.generation ?? 0) + 1)
  return {
    sessionId: input.sessionId,
    // Negative ids keep search listings out of real browser history slots.
    navigationEntryId: -(1_000_000 + (generation % 1_000_000)),
    path: virtualSearchPath(query),
    parentPath: input.rootPath || undefined,
    entries: [...input.result.entries],
    cursor: 0,
    total: input.result.entries.length,
    canGoBack: true,
    canGoForward: false,
    generation,
    filter: input.base?.filter ?? "all",
    filterOptions: input.base?.filterOptions ?? ["all", "archive", "directory", "video"],
    sort,
    sortFields: [...sortFields],
    metadataFields: [...metadataFields],
    metadataCapabilities: [...(input.base?.metadataCapabilities ?? metadataFields)],
    sortSource: input.base?.sortSource ?? "temporary",
    sortTemporary: true,
    globalDefaultSort: input.base?.globalDefaultSort ?? sort,
    tabDefaultSort: input.base?.tabDefaultSort ?? sort,
    watching: false,
  }
}

export function createDefaultSearchCriteria(
  settings: Pick<ReaderFolderSearchConfig, "includeSubfolders" | "searchInPath">,
  overrides: Partial<FolderSearchCriteria> = {},
): FolderSearchCriteria {
  return {
    query: overrides.query ?? "",
    mode: overrides.mode ?? "text",
    kind: overrides.kind ?? "all",
    caseSensitive: overrides.caseSensitive ?? false,
    includeSubfolders: overrides.includeSubfolders ?? settings.includeSubfolders,
    searchInPath: overrides.searchInPath ?? settings.searchInPath,
    includeTags: [...(overrides.includeTags ?? [])],
    excludeTags: [...(overrides.excludeTags ?? [])],
    tagMode: overrides.tagMode ?? "all",
  }
}

export function hasSearchCriteria(criteria: Pick<FolderSearchCriteria, "query" | "includeTags" | "excludeTags">): boolean {
  return criteria.query.trim().length > 0 || criteria.includeTags.length > 0 || criteria.excludeTags.length > 0
}

export function canSaveSearchToTab(input: {
  criteria: Pick<FolderSearchCriteria, "query" | "includeTags" | "excludeTags">
  hasResult: boolean
  loading: boolean
  rootPath?: string
  tabCount: number
  maxTabs: number
}): boolean {
  if (input.loading) return false
  if (!input.hasResult) return false
  if (!hasSearchCriteria(input.criteria)) return false
  if (!input.rootPath?.trim()) return false
  if (input.tabCount >= input.maxTabs) return false
  return true
}

export function buildDirectorySearchOptions(
  criteria: FolderSearchCriteria,
  extras: {
    maximumResults?: number
    onEntries?: ReaderDirectorySearchOptionsDto["onEntries"]
  } = {},
): ReaderDirectorySearchOptionsDto {
  return {
    mode: criteria.mode,
    kind: criteria.kind,
    caseSensitive: criteria.caseSensitive,
    searchInPath: criteria.searchInPath,
    maximumDepth: criteria.includeSubfolders ? undefined : 0,
    maximumResults: extras.maximumResults ?? SEARCH_RESULT_LIMIT,
    includeTags: criteria.includeTags,
    excludeTags: criteria.excludeTags,
    tagMode: criteria.tagMode,
    onEntries: extras.onEntries,
  }
}

export function snapshotSearchResult(
  result: ReaderDirectorySearchResultDto,
): FolderSearchResultSnapshot {
  return {
    entries: [...result.entries],
    scanned: result.scanned,
    matched: result.matched,
    truncated: result.truncated,
    rootPath: result.rootPath,
    generation: result.generation,
    query: result.query,
    mode: result.mode,
  }
}

export function createSearchTabSnapshot(input: {
  criteria: FolderSearchCriteria
  rootPath: string
  result?: ReaderDirectorySearchResultDto
}): FolderSearchTabSnapshot {
  return {
    criteria: {
      ...input.criteria,
      query: input.criteria.query.trim(),
      includeTags: [...input.criteria.includeTags],
      excludeTags: [...input.criteria.excludeTags],
    },
    rootPath: input.rootPath,
    result: input.result ? snapshotSearchResult(input.result) : undefined,
  }
}

export function searchTabTitle(criteria: Pick<FolderSearchCriteria, "query" | "includeTags" | "excludeTags">): string {
  const query = criteria.query.trim()
  if (query) {
    const short = query.length > 24 ? `${query.slice(0, 23)}…` : query
    return `搜索: ${short}`
  }
  const tags = [...criteria.includeTags, ...criteria.excludeTags.map((tag) => `-${tag}`)]
  if (tags.length) {
    const joined = tags.join(" ")
    const short = joined.length > 24 ? `${joined.slice(0, 23)}…` : joined
    return `搜索: ${short}`
  }
  return "搜索结果"
}

export function restoreResultFromSnapshot(
  snapshot: FolderSearchResultSnapshot,
  sessionId: string,
): ReaderDirectorySearchResultDto {
  return {
    sessionId,
    rootPath: snapshot.rootPath,
    generation: snapshot.generation,
    query: snapshot.query,
    mode: snapshot.mode,
    entries: snapshot.entries,
    scanned: snapshot.scanned,
    matched: snapshot.matched,
    truncated: snapshot.truncated,
  }
}

export function mergeCriteriaSettings(
  criteria: FolderSearchCriteria,
  settings: Pick<ReaderFolderSearchConfig, "includeSubfolders" | "searchInPath">,
): FolderSearchCriteria {
  return {
    ...criteria,
    includeSubfolders: settings.includeSubfolders,
    searchInPath: settings.searchInPath,
  }
}

export function normalizeTagKey(tag: { category: string; tag: string }): string {
  return `${tag.category}:${tag.tag}`
}

export function splitTagKey(value: string): { category: string; tag: string } {
  const separator = value.indexOf(":")
  return separator < 0
    ? { category: "", tag: value }
    : { category: value.slice(0, separator), tag: value.slice(separator + 1) }
}

export function applyTagSelection(
  current: Pick<FolderSearchCriteria, "includeTags" | "excludeTags">,
  tag: { category: string; tag: string },
  action: "replace-include" | "toggle-include" | "toggle-exclude",
): Pick<FolderSearchCriteria, "includeTags" | "excludeTags"> {
  const key = normalizeTagKey(tag)
  const include = new Set(action === "replace-include" ? [] : current.includeTags)
  const exclude = new Set(action === "replace-include" ? [] : current.excludeTags)
  if (action === "toggle-exclude") {
    include.delete(key)
    if (exclude.has(key)) exclude.delete(key)
    else exclude.add(key)
  } else {
    exclude.delete(key)
    if (action === "replace-include") include.add(key)
    else if (include.has(key)) include.delete(key)
    else include.add(key)
  }
  return {
    includeTags: [...include],
    excludeTags: [...exclude],
  }
}

export type FolderSearchSessionMode = ReaderDirectorySearchModeDto
export type FolderSearchSessionKind = ReaderDirectorySearchKindDto

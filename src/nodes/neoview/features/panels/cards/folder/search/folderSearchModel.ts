/**
 * Pure folder-search domain helpers shared by GUI, tests and tab snapshots.
 * Keeps request shaping and tab titles out of React components.
 */
import { z } from "zod"

import type {
  ReaderDirectoryEntryDto,
  ReaderDirectorySearchKindDto,
  ReaderDirectorySearchModeDto,
  ReaderDirectorySearchOptionsDto,
  ReaderDirectorySearchResultDto,
  ReaderFolderSearchConfig,
} from "../../../../../../adapters/reader-http-client"

export const SEARCH_RESULT_LIMIT = 512
export const SEARCH_HISTORY_LIMIT = 20

export const folderSearchModeSchema = z.enum(["text", "glob"])
export const folderSearchKindSchema = z.enum(["all", "file", "directory"])
export const folderSearchTagModeSchema = z.enum(["all", "any"])

export const folderSearchCriteriaSchema = z.object({
  query: z.string(),
  mode: folderSearchModeSchema,
  kind: folderSearchKindSchema,
  caseSensitive: z.boolean(),
  includeSubfolders: z.boolean(),
  searchInPath: z.boolean(),
  includeTags: z.array(z.string().min(1)).max(64),
  excludeTags: z.array(z.string().min(1)).max(64),
  tagMode: folderSearchTagModeSchema,
})

export type FolderSearchCriteria = z.infer<typeof folderSearchCriteriaSchema>

export const folderSearchResultSnapshotSchema = z.object({
  entries: z.array(z.custom<ReaderDirectoryEntryDto>()),
  scanned: z.number().int().nonnegative(),
  matched: z.number().int().nonnegative(),
  truncated: z.boolean(),
  rootPath: z.string(),
  generation: z.number().int().nonnegative(),
  query: z.string(),
  mode: folderSearchModeSchema,
})

export type FolderSearchResultSnapshot = z.infer<typeof folderSearchResultSnapshotSchema>

export const folderSearchTabSnapshotSchema = z.object({
  criteria: folderSearchCriteriaSchema,
  result: folderSearchResultSnapshotSchema.optional(),
  rootPath: z.string().min(1),
})

export type FolderSearchTabSnapshot = z.infer<typeof folderSearchTabSnapshotSchema>

export function createDefaultSearchCriteria(
  settings: Pick<ReaderFolderSearchConfig, "includeSubfolders" | "searchInPath">,
  overrides: Partial<FolderSearchCriteria> = {},
): FolderSearchCriteria {
  return folderSearchCriteriaSchema.parse({
    query: "",
    mode: "text",
    kind: "all",
    caseSensitive: false,
    includeSubfolders: settings.includeSubfolders,
    searchInPath: settings.searchInPath,
    includeTags: [],
    excludeTags: [],
    tagMode: "all",
    ...overrides,
  })
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
  return folderSearchResultSnapshotSchema.parse({
    entries: result.entries,
    scanned: result.scanned,
    matched: result.matched,
    truncated: result.truncated,
    rootPath: result.rootPath,
    generation: result.generation,
    query: result.query,
    mode: result.mode,
  })
}

export function createSearchTabSnapshot(input: {
  criteria: FolderSearchCriteria
  rootPath: string
  result?: ReaderDirectorySearchResultDto
}): FolderSearchTabSnapshot {
  return folderSearchTabSnapshotSchema.parse({
    criteria: {
      ...input.criteria,
      query: input.criteria.query.trim(),
    },
    rootPath: input.rootPath,
    result: input.result ? snapshotSearchResult(input.result) : undefined,
  })
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

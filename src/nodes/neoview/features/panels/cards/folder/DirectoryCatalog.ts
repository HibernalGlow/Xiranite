import type {
  ReaderDirectoryEntryDto,
  ReaderDirectoryMetadataFieldDto,
  ReaderDirectoryPageDto,
  ReaderDirectorySortDto,
  ReaderDirectorySortFieldDto,
  ReaderDirectorySortSourceDto,
} from "../../../../adapters/reader-http-client"

export interface DirectoryCatalog {
  sessionId: string
  path: string
  parentPath?: string
  total: number
  generation: number
  canGoBack: boolean
  canGoForward: boolean
  sort: ReaderDirectorySortDto
  sortFields: readonly ReaderDirectorySortFieldDto[]
  metadataFields: readonly ReaderDirectoryMetadataFieldDto[]
  metadataCapabilities: readonly ReaderDirectoryMetadataFieldDto[]
  sortSource: ReaderDirectorySortSourceDto
  sortTemporary: boolean
  globalDefaultSort: ReaderDirectorySortDto
  tabDefaultSort: ReaderDirectorySortDto
  suggestedSelection?: { path: string; index: number }
  pages: ReadonlyMap<number, readonly ReaderDirectoryEntryDto[]>
  pageMetadataFields: ReadonlyMap<number, ReadonlySet<ReaderDirectoryMetadataFieldDto>>
}

export function createDirectoryCatalog(page: ReaderDirectoryPageDto): DirectoryCatalog {
  return {
    sessionId: page.sessionId,
    path: page.path,
    parentPath: page.parentPath,
    total: page.total,
    generation: page.generation,
    canGoBack: page.canGoBack,
    canGoForward: page.canGoForward,
    sort: page.sort,
    sortFields: page.sortFields,
    metadataFields: page.metadataFields,
    metadataCapabilities: page.metadataCapabilities ?? page.metadataFields,
    sortSource: page.sortSource,
    sortTemporary: page.sortTemporary,
    globalDefaultSort: page.globalDefaultSort,
    tabDefaultSort: page.tabDefaultSort,
    suggestedSelection: page.suggestedSelection,
    pages: new Map([[page.cursor, page.entries]]),
    pageMetadataFields: new Map([[page.cursor, new Set(page.metadataFields)]]),
  }
}

export function mergeDirectoryPage(catalog: DirectoryCatalog, page: ReaderDirectoryPageDto): DirectoryCatalog {
  if (
    page.sessionId !== catalog.sessionId
    || page.path !== catalog.path
    || page.generation !== catalog.generation
    || page.total !== catalog.total
  ) return catalog
  const pages = new Map(catalog.pages)
  pages.set(page.cursor, page.entries)
  const pageMetadataFields = new Map(catalog.pageMetadataFields)
  pageMetadataFields.set(page.cursor, new Set(page.metadataFields))
  return {
    ...catalog,
    metadataFields: [...new Set([...catalog.metadataFields, ...page.metadataFields])],
    metadataCapabilities: page.metadataCapabilities ?? catalog.metadataCapabilities,
    pages,
    pageMetadataFields,
  }
}

export function trimDirectoryPages(catalog: DirectoryCatalog, anchorIndex: number, maximumPages: number): DirectoryCatalog {
  if (catalog.pages.size <= maximumPages) return catalog
  const keep = new Set(
    [...catalog.pages.keys()]
      .toSorted((left, right) => Math.abs(left - anchorIndex) - Math.abs(right - anchorIndex))
      .slice(0, maximumPages),
  )
  return {
    ...catalog,
    pages: new Map([...catalog.pages].filter(([cursor]) => keep.has(cursor))),
    pageMetadataFields: new Map([...catalog.pageMetadataFields].filter(([cursor]) => keep.has(cursor))),
  }
}

export function directoryPageHasMetadata(
  catalog: DirectoryCatalog,
  cursor: number,
  fields: readonly ReaderDirectoryMetadataFieldDto[],
): boolean {
  const hydrated = catalog.pageMetadataFields.get(cursor)
  return Boolean(hydrated && fields.every((field) => hydrated.has(field)))
}

export function directoryEntryAt(catalog: DirectoryCatalog, index: number): ReaderDirectoryEntryDto | undefined {
  for (const [cursor, entries] of catalog.pages) {
    if (index >= cursor && index < cursor + entries.length) return entries[index - cursor]
  }
  return undefined
}

export function directoryPageCursors(startIndex: number, endIndex: number, total: number, pageSize: number): number[] {
  if (total <= 0 || endIndex < 0 || startIndex >= total) return []
  const first = Math.floor(Math.max(0, startIndex) / pageSize) * pageSize
  const last = Math.floor(Math.min(total - 1, Math.max(startIndex, endIndex)) / pageSize) * pageSize
  const cursors: number[] = []
  for (let cursor = first; cursor <= last; cursor += pageSize) cursors.push(cursor)
  return cursors
}

export function directoryLoadedEntries(
  catalog: DirectoryCatalog,
  startIndex: number,
  endIndex: number,
  maximum: number,
): Array<{ index: number; entry: ReaderDirectoryEntryDto }> {
  const output: Array<{ index: number; entry: ReaderDirectoryEntryDto }> = []
  for (let index = Math.max(0, startIndex); index <= Math.min(catalog.total - 1, endIndex); index += 1) {
    const entry = directoryEntryAt(catalog, index)
    if (entry) output.push({ index, entry })
    if (output.length >= maximum) break
  }
  return output
}

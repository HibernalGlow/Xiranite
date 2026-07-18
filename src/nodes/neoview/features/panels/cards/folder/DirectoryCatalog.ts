import type {
  ReaderDirectoryEntryDto,
  ReaderDirectoryMetadataFieldDto,
  ReaderDirectoryPageDto,
  ReaderDirectorySortDto,
  ReaderDirectorySortFieldDto,
  ReaderDirectorySortSourceDto,
  ReaderFolderRegionPosition,
  ReaderFolderViewMode,
} from "../../../../adapters/reader-http-client"
import { rebaseDirectorySelection, type DirectorySelectionModel } from "./DirectorySelection"

const DIRECTORY_VIEWPORT_HEIGHT = 288

export interface DirectoryCatalog {
  sessionId: string
  navigationEntryId: number
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
  watching: boolean
  watchError?: string
  pages: ReadonlyMap<number, readonly ReaderDirectoryEntryDto[]>
  pageMetadataFields: ReadonlyMap<number, ReadonlySet<ReaderDirectoryMetadataFieldDto>>
}

export function restoreDirectoryVisitState<T extends {
  selection: DirectorySelectionModel
  focusedPath?: string
  focusedIndex?: number
  anchorIndex: number
  listSnapshot?: unknown
  gridSnapshot?: unknown
  gridScrollTop?: number
  detailsScrollTop?: number
}>(
  page: ReaderDirectoryPageDto,
  preferred: T | undefined,
  states: ReadonlyMap<number, T>,
  fallback: T,
): T {
  const saved = preferred ?? states.get(page.navigationEntryId) ?? fallback
  const restored = saved.selection.generation === page.generation
    ? saved
    : { ...saved, selection: rebaseDirectorySelection(saved.selection, page.generation) }
  const suggested = page.suggestedSelection
  if (!suggested) return restored
  const focusMoved = restored.focusedIndex !== suggested.index
  return {
    ...restored,
    focusedPath: suggested.path,
    focusedIndex: suggested.index,
    anchorIndex: suggested.index,
    listSnapshot: focusMoved ? undefined : restored.listSnapshot,
    gridSnapshot: focusMoved ? undefined : restored.gridSnapshot,
    gridScrollTop: focusMoved ? undefined : restored.gridScrollTop,
    detailsScrollTop: focusMoved ? undefined : restored.detailsScrollTop,
  }
}

export function rememberDirectoryVisitState<T>(states: Map<number, T>, id: number, state: T, maximum = 50): void {
  states.delete(id)
  states.set(id, state)
  while (states.size > maximum) states.delete(states.keys().next().value as number)
}

export function createDirectoryCatalog(page: ReaderDirectoryPageDto): DirectoryCatalog {
  return {
    sessionId: page.sessionId,
    navigationEntryId: page.navigationEntryId,
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
    watching: page.watching,
    watchError: page.watchError,
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

export function viewUsesGrid(mode: ReaderFolderViewMode): boolean {
  return viewUsesBanner(mode) || viewUsesThumbnailGrid(mode)
}

export function viewUsesBanner(mode: ReaderFolderViewMode): boolean {
  return mode === "mosaic-list"
}

export function viewUsesThumbnailGrid(mode: ReaderFolderViewMode): boolean {
  return mode === "cover-grid" || mode === "mosaic-grid"
}

export function viewUsesMosaic(mode: ReaderFolderViewMode): boolean {
  return mode === "mosaic-list" || mode === "mosaic-grid"
}

export function viewUsesThumbnails(mode: ReaderFolderViewMode): boolean {
  return mode === "cover-list" || mode === "mosaic-list" || mode === "cover-grid" || mode === "mosaic-grid"
}

export function viewUsesVirtuosoList(mode: ReaderFolderViewMode): boolean {
  return mode === "compact" || mode === "cover-list"
}

export function visibleGridColumnCount(host: HTMLElement | null): number {
  const width = host?.clientWidth ?? 112
  return Math.max(1, Math.floor((width + 4) / 116))
}

export function visiblePageStep(mode: ReaderFolderViewMode, gridColumns: number): number {
  if (viewUsesGrid(mode)) return gridColumns * 2
  if (mode === "compact") return Math.floor(DIRECTORY_VIEWPORT_HEIGHT / 34)
  if (mode === "details") return Math.floor(DIRECTORY_VIEWPORT_HEIGHT / 36)
  return Math.floor(DIRECTORY_VIEWPORT_HEIGHT / 76)
}

export function thumbnailPixelSize(percent: number): number {
  return Math.round(48 + (percent - 10) * 3)
}

export function formatFolderRating(value: number | undefined): string {
  return Number.isFinite(value) ? value!.toFixed(1) : "-"
}

export function isEditableKeyboardEvent(event: { nativeEvent: { isComposing?: boolean }; target: EventTarget | null }): boolean {
  if (event.nativeEvent.isComposing) return true
  const target = event.target
  return target instanceof HTMLElement
    && (target.isContentEditable || target.matches("input, textarea, select, [role='textbox'], [role='menu'], [role='dialog']"))
}

export function isVerticalFolderRegion(position: ReaderFolderRegionPosition): boolean {
  return position === "left" || position === "right"
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
}

export function folderErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

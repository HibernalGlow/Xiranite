import type {
  ReaderDirectoryEntryDto,
  ReaderDirectoryFilterDto,
  ReaderDirectoryMetadataFieldDto,
  ReaderDirectoryPageDto,
  ReaderDirectorySortDto,
  ReaderDirectorySortFieldDto,
  ReaderDirectorySortSourceDto,
  ReaderFolderRegionPosition,
  ReaderFolderViewMode,
} from "../../../../adapters/reader-http-client"
import { compareClipmFilenameScores } from "@xiranite/node-clipm/filename"
import { rebaseDirectorySelection, type DirectorySelectionModel } from "./DirectorySelection"
import { sameFolderPath } from "./FolderPathIdentity"

const DIRECTORY_VIEWPORT_HEIGHT = 288
// A larger virtualized batch lets CSS grid dense packing fill gaps across the
// visible viewport without turning a large directory into one unbounded grid.
export const FOLDER_MOSAIC_GROUP_SIZE = 30
export const FOLDER_EMM_METADATA_FIELDS: readonly ReaderDirectoryMetadataFieldDto[] = [
  "rating", "collectTagCount", "tags",
]

export interface DirectoryCatalog {
  sessionId: string
  navigationEntryId: number
  path: string
  parentPath?: string
  sourceKind?: ReaderDirectoryPageDto["sourceKind"]
  total: number
  generation: number
  canGoBack: boolean
  canGoForward: boolean
  filter: ReaderDirectoryFilterDto
  filterOptions: readonly ReaderDirectoryFilterDto[]
  showHiddenFolders: boolean
  hideMissingEfuEntries: boolean
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

export function cloneDirectoryCatalog(source: DirectoryCatalog): DirectoryCatalog {
  return {
    ...source,
    pages: new Map([...source.pages].map(([cursor, entries]) => [cursor, [...entries]])),
    pageMetadataFields: new Map([...source.pageMetadataFields].map(([cursor, fields]) => [cursor, new Set(fields)])),
  }
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
    sourceKind: page.sourceKind,
    total: page.total,
    generation: page.generation,
    canGoBack: page.canGoBack,
    canGoForward: page.canGoForward,
    filter: page.filter ?? "all",
    filterOptions: page.filterOptions ?? ["all", "archive", "directory", "video"],
    showHiddenFolders: page.showHiddenFolders ?? false,
    hideMissingEfuEntries: page.hideMissingEfuEntries ?? false,
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

export function sortDirectoryCatalogEntries(
  catalog: DirectoryCatalog,
  sort: ReaderDirectorySortDto,
): DirectoryCatalog {
  const entries = [...catalog.pages.values()].flat()
  const direction = sort.order === "desc" ? -1 : 1
  const sorted = entries.toSorted((left, right) => {
    if (sort.directoriesFirst && left.kind !== right.kind) return entryKindRank(left.kind) - entryKindRank(right.kind)
    const comparison = compareDirectoryField(left, right, sort.field)
    return comparison ? comparison * direction : naturalCompare(left.name, right.name) || naturalCompare(left.path, right.path)
  })
  return { ...catalog, sort, pages: new Map([[0, sorted]]) }
}

function compareDirectoryField(
  left: ReaderDirectoryEntryDto,
  right: ReaderDirectoryEntryDto,
  field: ReaderDirectorySortFieldDto,
): number {
  if (field === "name") return naturalCompare(left.name, right.name)
  if (field === "date") return numberValue(left.modifiedAt) - numberValue(right.modifiedAt)
  if (field === "size") return numberValue(left.size) - numberValue(right.size)
  if (field === "type") return naturalCompare(fileExtension(left.name), fileExtension(right.name))
  if (field === "rating") return numberValue(left.rating) - numberValue(right.rating)
  if (field === "cmRating") return compareClipmFilenameScores(left.name, right.name)
  if (field === "path") return naturalCompare(left.path, right.path)
  if (field === "collectTagCount") return numberValue(left.collectTagCount) - numberValue(right.collectTagCount)
  return stablePathRank(left.path) - stablePathRank(right.path)
}

function entryKindRank(kind: ReaderDirectoryEntryDto["kind"]): number {
  return kind === "directory" ? 0 : kind === "file" ? 1 : 2
}

function numberValue(value: number | undefined): number {
  return Number.isFinite(value) ? value! : 0
}

function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".")
  return dot < 0 ? "" : name.slice(dot + 1)
}

function naturalCompare(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" })
}

function stablePathRank(path: string): number {
  let hash = 2_166_136_261
  for (let index = 0; index < path.length; index += 1) hash = Math.imul(hash ^ path.charCodeAt(index), 16_777_619)
  return hash >>> 0
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

/**
 * Rich folder renderers show EMM fields and probe visible directory entries
 * for emptiness. Keep compact browsing free of metadata work and let the
 * server advertise unsupported fields through the page capabilities.
 */
export function folderMetadataFieldsForView(
  mode: ReaderFolderViewMode,
  capabilities: readonly ReaderDirectoryMetadataFieldDto[],
): readonly ReaderDirectoryMetadataFieldDto[] {
  if (mode === "compact" || mode === "details") return []
  const fields = mode === "mosaic-grid"
    ? ["dimensions", ...FOLDER_EMM_METADATA_FIELDS, "directoryEmpty"] as const
    : [...FOLDER_EMM_METADATA_FIELDS, "directoryEmpty"] as const
  return fields.filter((field) => capabilities.includes(field))
}

export function directoryEntryAt(catalog: DirectoryCatalog, index: number): ReaderDirectoryEntryDto | undefined {
  for (const [cursor, entries] of catalog.pages) {
    if (index >= cursor && index < cursor + entries.length) return entries[index - cursor]
  }
  return undefined
}

export function directoryEntryIndex(catalog: DirectoryCatalog, path: string): number | undefined {
  for (const [cursor, entries] of catalog.pages) {
    const offset = entries.findIndex((entry) => sameFolderPath(entry.path, path))
    if (offset >= 0) return cursor + offset
  }
  return undefined
}

export function nearestLoadedDirectoryEntry(
  catalog: DirectoryCatalog,
  targetIndex: number,
): { index: number; entry: ReaderDirectoryEntryDto } | undefined {
  let previous: { index: number; entry: ReaderDirectoryEntryDto } | undefined
  let next: { index: number; entry: ReaderDirectoryEntryDto } | undefined
  for (const [cursor, entries] of catalog.pages) {
    entries.forEach((entry, offset) => {
      const index = cursor + offset
      if (index >= catalog.total) return
      if (index >= targetIndex && (!next || index < next.index)) next = { index, entry }
      if (index < targetIndex && (!previous || index > previous.index)) previous = { index, entry }
    })
  }
  return next ?? previous
}

export function removeDirectoryCatalogEntry(catalog: DirectoryCatalog, path: string): DirectoryCatalog {
  let removedCursor: number | undefined
  let removedOffset: number | undefined
  for (const [cursor, entries] of catalog.pages) {
    const offset = entries.findIndex((entry) => sameFolderPath(entry.path, path))
    if (offset < 0) continue
    removedCursor = cursor
    removedOffset = offset
    break
  }
  if (removedCursor === undefined || removedOffset === undefined) return catalog

  const pages = new Map<number, readonly ReaderDirectoryEntryDto[]>()
  const pageMetadataFields = new Map<number, ReadonlySet<ReaderDirectoryMetadataFieldDto>>()
  for (const [cursor, entries] of catalog.pages) {
    const nextEntries = cursor === removedCursor ? entries.toSpliced(removedOffset, 1) : entries
    if (nextEntries.length === 0) continue
    pages.set(cursor, nextEntries)
    const metadataFields = catalog.pageMetadataFields.get(cursor)
    if (metadataFields) pageMetadataFields.set(cursor, metadataFields)
  }
  return {
    ...catalog,
    total: Math.max(0, catalog.total - 1),
    pages,
    pageMetadataFields,
  }
}

export function replaceDirectoryCatalogEntry(
  catalog: DirectoryCatalog,
  sourcePath: string,
  replacement: ReaderDirectoryEntryDto,
): DirectoryCatalog {
  for (const [cursor, entries] of catalog.pages) {
    const offset = entries.findIndex((entry) => sameFolderPath(entry.path, sourcePath))
    if (offset < 0) continue
    const pages = new Map(catalog.pages)
    pages.set(cursor, entries.with(offset, replacement))
    return { ...catalog, pages }
  }
  return catalog
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
  return viewUsesFixedGrid(mode) || viewUsesMosaicGrid(mode)
}

export function viewUsesFixedGrid(mode: ReaderFolderViewMode): boolean {
  return viewUsesBanner(mode) || viewUsesThumbnailGrid(mode)
}

export function viewUsesBanner(mode: ReaderFolderViewMode): boolean {
  return mode === "mosaic-list"
}

export function viewUsesThumbnailGrid(mode: ReaderFolderViewMode): boolean {
  return mode === "cover-grid"
}

export function viewUsesMosaicGrid(mode: ReaderFolderViewMode): boolean {
  return mode === "mosaic-grid"
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
  if (viewUsesMosaicGrid(mode)) return gridColumns * 3
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

/** Keep Windows drive roots directory-shaped before they reach the HTTP/filesystem boundary. */
export function normalizeFolderNavigationPath(path: string): string {
  const value = path.trim()
  if (!value || /^(?:bookmark|history):/iu.test(value)) return value
  // Node treats `E:` as a drive-relative path on Windows. Keep every drive
  // root directory-shaped before it crosses the HTTP/filesystem boundary.
  if (/^[A-Za-z]:[\\/]?$/u.test(value)) return `${value.slice(0, 2)}\\`
  return value
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
  const code = errorCode(error)
  const raw = error instanceof Error ? error.message : String(error)
  const normalized = raw.toLocaleLowerCase("en-US")
  if (code === "EACCES" || code === "EPERM" || /permission denied|access denied|拒绝访问|权限/u.test(normalized)) {
    return "没有权限访问此目录。"
  }
  if (code === "ENOENT" || code === "ENOTDIR" || /no such file|not found|cannot find|scandir|目录不存在|找不到/u.test(normalized)) {
    return "目录不存在或已断开。"
  }
  if (code === "EBUSY" || code === "ENODEV" || code === "ENXIO" || /device is not ready|input\/output error|设备未就绪|输入\/输出错误/u.test(normalized)) {
    return "目录当前不可用，请检查磁盘或网络连接。"
  }
  if (isAbortError(error)) return "读取已取消。"
  return sanitizeFolderErrorText(raw)
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === "string" ? code.toUpperCase() : undefined
}

function sanitizeFolderErrorText(value: string): string {
  const text = value.trim()
  if (!text) return "无法读取当前目录。"
  // Error strings from Node and the filesystem often embed a full local path.
  // Keep a short diagnostic when it is safe, otherwise use an actionable generic message.
  const withoutPaths = text
    .replace(/['"](?:[A-Za-z]:[\\/][^'"]*|\\\\[^'"]+|\/[^'"]+)['"]/gu, "<路径>")
    .replace(/(?:[A-Za-z]:[\\/][^\s,;:)]+|\\\\[^\s,;:)]+|\/(?:Users|home|mnt|Volumes|media)\/[^\s,;:)]+)/gu, "<路径>")
    .replace(/\s+/gu, " ")
    .trim()
  if (!withoutPaths || withoutPaths.includes("<路径>")) return "无法读取当前目录，请重试。"
  return withoutPaths.slice(0, 160)
}

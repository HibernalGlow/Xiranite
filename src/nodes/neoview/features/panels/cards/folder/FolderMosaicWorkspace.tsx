import {
  Virtuoso,
  type ListRange,
  type StateSnapshot,
  type VirtuosoHandle,
} from "react-virtuoso"
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react"

import type { ReaderDirectoryEntryDto } from "../../../../adapters/reader-http-client"
import { ReaderThumbnailSurface } from "../../../thumbnails/ReaderThumbnailSurface"
import { directoryEntryAt, FOLDER_MOSAIC_GROUP_SIZE, type DirectoryCatalog } from "./DirectoryCatalog"
import { FolderEntryFileMetadata, FolderEntryIcon, FolderEntryMetadata } from "./FolderEntryPresentation"
import { folderEntryIsEmptyDirectory } from "./FolderEntryContentState"
import { FolderHoverPreview } from "./FolderHoverPreview"
import { FolderPenetrationFileNames, type FolderPenetrationFileName } from "./FolderPenetrationFileNames"
import FolderDeleteButton, { type FolderDeleteStrategy } from "./FolderDeleteButton"
import { EMPTY_VIRTUOSO_COMPONENTS, FOLDER_LIST_COMPONENTS, type FolderReturnFooterContext } from "./FolderEmptyAreaBehavior"
import { folderThumbnailIsLoading, type FolderThumbnailStore } from "./FolderThumbnailStore"
import { useFolderThumbnail } from "./useFolderThumbnail"
import { folderTitleClassName } from "./FolderViewPresentation"

export type FolderMosaicSpan = "square" | "wide" | "tall"

export function folderMosaicSpan(width?: number, height?: number): FolderMosaicSpan {
  if (!width || !height || width <= 0 || height <= 0) return "square"
  const ratio = width / height
  if (ratio >= 1.2) return "wide"
  if (ratio <= 0.85) return "tall"
  return "square"
}

export default function FolderMosaicWorkspace({
  virtualKey,
  mosaicRef,
  catalog,
  disabled,
  selectedPaths,
  focusedIndex,
  itemIdPrefix,
  thumbnailStore,
  thumbnailProbeEnabled = true,
  thumbnailUrls = EMPTY_THUMBNAIL_URLS,
  thumbnailUrlSets = EMPTY_THUMBNAIL_URL_SETS,
  tileSize,
  hoverPreviewEnabled,
  hoverPreviewDelayMs,
  wrapTitle = false,
  penetrationFiles = EMPTY_PENETRATION_FILES,
  deleteMode = false,
  deleteStrategy = "trash",
  confirmDelete = true,
  showReturnFooter,
  returnFooterContext,
  restoreSnapshot,
  initialScrollTop,
  initialIndex,
  inlineBranch,
  inlineBranchPath,
  onRangeChange,
  onScrollTopChange,
  onSelect,
}: {
  virtualKey: string
  mosaicRef: RefObject<VirtuosoHandle | null>
  catalog: DirectoryCatalog
  disabled: boolean
  selectedPaths: ReadonlySet<string>
  focusedIndex?: number
  itemIdPrefix?: string
  thumbnailStore?: FolderThumbnailStore
  thumbnailProbeEnabled?: boolean
  thumbnailUrls?: ReadonlyMap<string, string>
  thumbnailUrlSets?: ReadonlyMap<string, readonly string[]>
  tileSize: number
  hoverPreviewEnabled: boolean
  hoverPreviewDelayMs: number
  wrapTitle?: boolean
  penetrationFiles?: ReadonlyMap<string, readonly FolderPenetrationFileName[]>
  deleteMode?: boolean
  deleteStrategy?: FolderDeleteStrategy
  confirmDelete?: boolean
  showReturnFooter: boolean
  returnFooterContext: FolderReturnFooterContext
  restoreSnapshot?: StateSnapshot
  initialScrollTop?: number
  initialIndex?: number
  inlineBranch?: ReactNode
  inlineBranchPath?: string
  onRangeChange(range: ListRange): void
  onScrollTopChange(scrollTop: number): void
  onSelect(entry: ReaderDirectoryEntryDto, index: number, event: ReactMouseEvent): void
}) {
  const [measuredSpans, setMeasuredSpans] = useState<ReadonlyMap<string, FolderMosaicSpan>>(() => new Map())
  const [scroller, setScroller] = useState<HTMLElement | null>(null)
  const [viewportWidth, setViewportWidth] = useState(0)
  const scrollerElementRef = useRef<HTMLElement | null>(null)
  const onScrollTopChangeRef = useRef(onScrollTopChange)
  const restoreKeyRef = useRef(virtualKey)
  const pendingScrollTopRef = useRef(initialScrollTop)
  const restoreFramesRef = useRef<readonly number[]>([])
  onScrollTopChangeRef.current = onScrollTopChange

  if (restoreKeyRef.current !== virtualKey) {
    restoreKeyRef.current = virtualKey
    pendingScrollTopRef.current = initialScrollTop
  }

  useEffect(() => {
    if (!scroller) return
    const onScroll = () => onScrollTopChangeRef.current(scroller.scrollTop)
    scroller.addEventListener("scroll", onScroll, { passive: true })
    return () => scroller.removeEventListener("scroll", onScroll)
  }, [scroller, virtualKey])

  useEffect(() => {
    if (!scroller) return
    const updateWidth = () => setViewportWidth((current) => current === scroller.clientWidth ? current : scroller.clientWidth)
    updateWidth()
    const observer = new ResizeObserver(updateWidth)
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [scroller])

  useEffect(() => {
    setMeasuredSpans(new Map())
  }, [virtualKey])

  useEffect(() => () => {
    for (const frame of restoreFramesRef.current) cancelAnimationFrame(frame)
  }, [])

  const reportDimensions = useCallback((path: string, width: number, height: number) => {
    const span = folderMosaicSpan(width, height)
    setMeasuredSpans((current) => {
      if (current.get(path) === span) return current
      const next = new Map(current)
      next.set(path, span)
      return next
    })
  }, [])
  const columnCount = Math.max(2, Math.floor(((viewportWidth || tileSize * 4) + 4) / (tileSize + 4)))

  function handleRangeChange(range: ListRange) {
    const startIndex = range.startIndex * FOLDER_MOSAIC_GROUP_SIZE
    const endIndex = Math.min(catalog.total - 1, (range.endIndex + 1) * FOLDER_MOSAIC_GROUP_SIZE - 1)
    onRangeChange({ startIndex, endIndex })
    const restoreScrollTop = pendingScrollTopRef.current
    if (restoreScrollTop === undefined) return
    pendingScrollTopRef.current = undefined
    const firstFrame = requestAnimationFrame(() => {
      const secondFrame = requestAnimationFrame(() => {
        scrollerElementRef.current?.scrollTo({ top: restoreScrollTop })
        onScrollTopChangeRef.current(restoreScrollTop)
        restoreFramesRef.current = []
      })
      restoreFramesRef.current = [secondFrame]
    })
    restoreFramesRef.current = [firstFrame]
  }

  return (
    <Virtuoso
      key={virtualKey}
      ref={mosaicRef}
      scrollerRef={(element) => {
        scrollerElementRef.current = element
        setScroller(element)
      }}
      data-folder-navigation-entry-id={catalog.navigationEntryId}
      data-folder-mosaic-grid="true"
      data-folder-restore-scroll-top={initialScrollTop}
      style={{ height: "100%" }}
      totalCount={Math.ceil(catalog.total / FOLDER_MOSAIC_GROUP_SIZE)}
      components={showReturnFooter ? FOLDER_LIST_COMPONENTS : EMPTY_VIRTUOSO_COMPONENTS}
      context={showReturnFooter ? returnFooterContext : undefined}
      increaseViewportBy={{ top: tileSize * 2, bottom: tileSize * 3 }}
      computeItemKey={(groupIndex) => `${catalog.generation}:${groupIndex}`}
      rangeChanged={handleRangeChange}
      restoreStateFrom={restoreSnapshot}
      initialTopMostItemIndex={initialIndex !== undefined
        ? { index: Math.floor(initialIndex / FOLDER_MOSAIC_GROUP_SIZE), align: "center" }
        : undefined}
      itemContent={(groupIndex) => (
        <DirectoryMosaicGroup
          catalog={catalog}
          startIndex={groupIndex * FOLDER_MOSAIC_GROUP_SIZE}
          inlineBranch={inlineBranch}
          inlineBranchPath={inlineBranchPath}
          disabled={disabled}
          selectedPaths={selectedPaths}
          focusedIndex={focusedIndex}
          itemIdPrefix={itemIdPrefix}
          thumbnailStore={thumbnailStore}
          thumbnailProbeEnabled={thumbnailProbeEnabled}
          thumbnailUrls={thumbnailUrls}
          thumbnailUrlSets={thumbnailUrlSets}
          measuredSpans={measuredSpans}
          tileSize={tileSize}
          columnCount={columnCount}
          wrapTitle={wrapTitle}
          hoverPreviewEnabled={hoverPreviewEnabled}
          hoverPreviewDelayMs={hoverPreviewDelayMs}
          penetrationFiles={penetrationFiles}
          deleteMode={deleteMode}
          deleteStrategy={deleteStrategy}
          confirmDelete={confirmDelete}
          onDimensions={reportDimensions}
          onSelect={onSelect}
        />
      )}
    />
  )
}

function DirectoryMosaicGroup({
  catalog,
  startIndex,
  inlineBranch,
  inlineBranchPath,
  disabled,
  selectedPaths,
  focusedIndex,
  itemIdPrefix,
  thumbnailStore,
  thumbnailProbeEnabled,
  thumbnailUrls,
  thumbnailUrlSets,
  measuredSpans,
  tileSize,
  columnCount,
  wrapTitle,
  hoverPreviewEnabled,
  hoverPreviewDelayMs,
  penetrationFiles,
  deleteMode,
  deleteStrategy,
  confirmDelete,
  onDimensions,
  onSelect,
}: {
  catalog: DirectoryCatalog
  startIndex: number
  inlineBranch?: ReactNode
  inlineBranchPath?: string
  disabled: boolean
  selectedPaths: ReadonlySet<string>
  focusedIndex?: number
  itemIdPrefix?: string
  thumbnailStore?: FolderThumbnailStore
  thumbnailProbeEnabled: boolean
  thumbnailUrls: ReadonlyMap<string, string>
  thumbnailUrlSets: ReadonlyMap<string, readonly string[]>
  measuredSpans: ReadonlyMap<string, FolderMosaicSpan>
  tileSize: number
  columnCount: number
  wrapTitle: boolean
  hoverPreviewEnabled: boolean
  hoverPreviewDelayMs: number
  penetrationFiles: ReadonlyMap<string, readonly FolderPenetrationFileName[]>
  deleteMode: boolean
  deleteStrategy: FolderDeleteStrategy
  confirmDelete: boolean
  onDimensions(path: string, width: number, height: number): void
  onSelect(entry: ReaderDirectoryEntryDto, index: number, event: ReactMouseEvent): void
}) {
  const endIndex = Math.min(catalog.total, startIndex + FOLDER_MOSAIC_GROUP_SIZE)
  const indexes = Array.from({ length: endIndex - startIndex }, (_, offset) => startIndex + offset)
  const style = {
    gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
    gridAutoRows: `${tileSize}px`,
  } satisfies CSSProperties

  return (
    <div className="grid grid-flow-dense gap-1 px-1 pb-1" style={style} data-folder-mosaic-group={startIndex / FOLDER_MOSAIC_GROUP_SIZE}>
      {indexes.map((index) => {
        const entry = directoryEntryAt(catalog, index)
        if (!entry) return <div key={`${catalog.generation}:${index}`} className="min-h-0 animate-pulse rounded bg-muted/30" aria-hidden="true" />
        const measuredSpan = measuredSpans.get(entry.path)
        const span = measuredSpan ?? "square"
        const item = <DirectoryMosaicItem
          key={entry.path}
          itemId={`${itemIdPrefix}-item-${index}`}
          entry={entry}
          index={index}
          span={span}
          previewReady={measuredSpan !== undefined}
          columnCount={columnCount}
          disabled={disabled}
          selected={selectedPaths.has(entry.path)}
          focused={index === focusedIndex}
          showRating={catalog.metadataFields.includes("rating")}
          showCollectTagCount={catalog.metadataFields.includes("collectTagCount")}
          thumbnailStore={thumbnailStore}
          thumbnailProbeEnabled={thumbnailProbeEnabled}
          thumbnailUrl={thumbnailUrls.get(entry.path)}
          thumbnailUrls={thumbnailUrlSets.get(entry.path)}
          hoverPreviewEnabled={hoverPreviewEnabled}
          hoverPreviewDelayMs={hoverPreviewDelayMs}
          wrapTitle={wrapTitle}
          penetrationFiles={penetrationFiles.get(entry.path)}
          deleteMode={deleteMode}
          deleteStrategy={deleteStrategy}
          confirmDelete={confirmDelete}
          onDimensions={onDimensions}
          onSelect={onSelect}
        />
        return entry.path === inlineBranchPath && inlineBranch ? (
          <Fragment key={entry.path}>
            {item}
            <FolderMosaicInlineBranchDrawer tileSize={tileSize}>{inlineBranch}</FolderMosaicInlineBranchDrawer>
          </Fragment>
        ) : item
      })}
    </div>
  )
}

function FolderMosaicInlineBranchDrawer({ children, tileSize }: { children: ReactNode; tileSize: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [rowSpan, setRowSpan] = useState(1)

  useLayoutEffect(() => {
    const container = ref.current
    if (!container) return
    const measure = () => {
      const child = container.firstElementChild as HTMLElement | null
      const height = child?.getBoundingClientRect().height ?? container.scrollHeight
      setRowSpan(Math.max(1, Math.ceil(height / tileSize)))
    }
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    for (const child of container.children) observer.observe(child)
    const mutations = new MutationObserver(() => {
      for (const child of container.children) observer.observe(child)
      measure()
    })
    mutations.observe(container, { childList: true })
    measure()
    return () => {
      observer.disconnect()
      mutations.disconnect()
    }
  }, [tileSize])

  return (
    <div
      ref={ref}
      className="min-w-0"
      style={{ gridColumn: "1 / -1", gridRow: `span ${rowSpan}` }}
      data-folder-inline-mosaic-drawer="true"
    >
      {children}
    </div>
  )
}

export function DirectoryMosaicItem({
  itemId,
  entry,
  index,
  span,
  previewReady,
  columnCount,
  disabled,
  selected,
  focused,
  showRating,
  showCollectTagCount,
  thumbnailStore,
  thumbnailProbeEnabled = true,
  thumbnailUrl,
  thumbnailUrls,
  hoverPreviewEnabled,
  hoverPreviewDelayMs,
  wrapTitle = false,
  penetrationFiles,
  deleteMode,
  deleteStrategy,
  confirmDelete,
  onDimensions,
  onSelect,
}: {
  itemId: string
  entry: ReaderDirectoryEntryDto
  index: number
  span: FolderMosaicSpan
  previewReady: boolean
  columnCount: number
  disabled: boolean
  selected: boolean
  focused: boolean
  showRating: boolean
  showCollectTagCount: boolean
  thumbnailStore?: FolderThumbnailStore
  thumbnailProbeEnabled?: boolean
  thumbnailUrl?: string
  thumbnailUrls?: readonly string[]
  hoverPreviewEnabled: boolean
  hoverPreviewDelayMs: number
  wrapTitle?: boolean
  penetrationFiles?: readonly FolderPenetrationFileName[]
  deleteMode: boolean
  deleteStrategy: FolderDeleteStrategy
  confirmDelete: boolean
  onDimensions(path: string, width: number, height: number): void
  onSelect(entry: ReaderDirectoryEntryDto, index: number, event: ReactMouseEvent): void
}) {
  const directoryEmpty = folderEntryIsEmptyDirectory(entry)
  const thumbnailEligible = !directoryEmpty && (entry.kind === "directory" || entry.readerSupported)
  const storedThumbnail = useFolderThumbnail(thumbnailStore, entry.path, thumbnailEligible, thumbnailProbeEnabled)
  const resolvedThumbnailUrl = thumbnailStore ? storedThumbnail.thumbnailUrl : thumbnailUrl
  const resolvedThumbnailUrls = thumbnailStore ? storedThumbnail.thumbnailUrls : thumbnailUrls
  const thumbnailLoading = Boolean(!directoryEmpty && thumbnailStore && folderThumbnailIsLoading(storedThumbnail.availability))
  const geometry = folderMosaicGeometry(span, previewReady, columnCount)
  return (
    <FolderHoverPreview thumbnailUrl={directoryEmpty ? undefined : resolvedThumbnailUrl} enabled={hoverPreviewEnabled && !directoryEmpty} delayMs={hoverPreviewDelayMs} label={entry.name}>
      <div
        className="relative size-full min-h-0 min-w-0"
        style={{ gridColumn: `span ${geometry.columns}`, gridRow: `span ${geometry.rows}` }}
      >
      {deleteMode ? <FolderDeleteButton entry={{ index, ...entry }} strategy={deleteStrategy} disabled={disabled} overlay confirm={confirmDelete} /> : null}
      <button
        id={itemId}
        type="button"
        className="grid size-full min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_auto] overflow-hidden rounded border bg-background text-left text-xs hover:bg-muted aria-selected:border-primary aria-selected:bg-accent data-[focused=true]:ring-1 data-[focused=true]:ring-inset data-[focused=true]:ring-primary"
        style={{ gridColumn: `span ${geometry.columns}`, gridRow: `span ${geometry.rows}` }}
        aria-selected={selected}
        data-focused={focused || undefined}
        disabled={disabled}
        title={entry.path}
        onClick={(event) => onSelect(entry, index, event)}
        tabIndex={-1}
        data-preview-mode="mosaic-grid"
        data-folder-mosaic-span={span}
        data-folder-mosaic-ready={previewReady || undefined}
        data-folder-entry="true"
        data-context-menu="neoview-folder-entry"
        data-folder-index={index}
        data-folder-path={entry.path}
        data-folder-name={entry.name}
        data-folder-kind={entry.kind}
        data-folder-reader-supported={entry.readerSupported}
        data-folder-empty-directory={directoryEmpty || undefined}
      >
        <span className="relative grid min-h-0 place-items-center overflow-hidden bg-muted/30" data-folder-thumbnail="true">
          {directoryEmpty ? <FolderEntryIcon entry={entry} className="size-8" /> : resolvedThumbnailUrl || thumbnailLoading
            ? <ReaderThumbnailSurface
                url={resolvedThumbnailUrl}
                urls={resolvedThumbnailUrls}
                kind={entry.kind === "directory" ? "folder" : "file"}
                fit="contain"
                imageLoading="eager"
                loading={thumbnailLoading && !resolvedThumbnailUrl}
                retryKey={storedThumbnail.availability === "ready" ? storedThumbnail.revision : undefined}
                className="size-full rounded-none bg-transparent"
                onDimensions={(width, height) => onDimensions(entry.path, width, height)}
              />
            : entry.kind === "directory" ? null : <FolderEntryIcon entry={entry} className="size-8" />}
          {penetrationFiles?.length ? <span className="absolute inset-x-1 bottom-1 max-h-20 overflow-hidden"><FolderPenetrationFileNames files={penetrationFiles} variant="overlay" /></span> : null}
        </span>
        <span className={`grid min-w-0 gap-0.5 border-t px-1.5 py-1 ${wrapTitle ? "min-h-10" : ""}`}>
          <span className="flex min-w-0 items-center gap-1">
            <FolderEntryIcon entry={entry} className="size-3.5" />
            <span className={folderTitleClassName(wrapTitle) + " font-medium"} data-folder-entry-title-wrap={wrapTitle || undefined}>{entry.name}</span>
          </span>
          {span !== "square" ? (
            <span className="flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground">
              <FolderEntryFileMetadata entry={entry} className="min-w-0" />
              <FolderEntryMetadata entry={entry} showRating={showRating} showCollectTagCount={showCollectTagCount} className="min-w-0" />
            </span>
          ) : null}
        </span>
      </button>
      </div>
    </FolderHoverPreview>
  )
}

const EMPTY_THUMBNAIL_URLS: ReadonlyMap<string, string> = new Map()
const EMPTY_THUMBNAIL_URL_SETS: ReadonlyMap<string, readonly string[]> = new Map()
const EMPTY_PENETRATION_FILES: ReadonlyMap<string, readonly FolderPenetrationFileName[]> = new Map()

export function folderMosaicGeometry(span: FolderMosaicSpan, previewReady: boolean, columnCount: number): { columns: number; rows: number } {
  const maximumColumns = Math.max(1, columnCount)
  if (!previewReady) return { columns: 1, rows: 1 }
  return span === "wide"
    ? { columns: Math.min(2, maximumColumns), rows: 1 }
    : span === "tall" ? { columns: 1, rows: 2 } : { columns: 1, rows: 1 }
}

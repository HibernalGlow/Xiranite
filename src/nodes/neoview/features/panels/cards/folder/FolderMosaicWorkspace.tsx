import {
  Virtuoso,
  type ListRange,
  type StateSnapshot,
  type VirtuosoHandle,
} from "react-virtuoso"
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react"

import type { ReaderDirectoryEntryDto } from "../../../../adapters/reader-http-client"
import { ReaderThumbnailSurface } from "../../../thumbnails/ReaderThumbnailSurface"
import { directoryEntryAt, FOLDER_MOSAIC_GROUP_SIZE, type DirectoryCatalog } from "./DirectoryCatalog"
import { FolderEntryFileMetadata, FolderEntryIcon, FolderEntryMetadata } from "./FolderEntryPresentation"
import { FolderHoverPreview } from "./FolderHoverPreview"
import { EMPTY_VIRTUOSO_COMPONENTS, FOLDER_LIST_COMPONENTS, type FolderReturnFooterContext } from "./FolderEmptyAreaBehavior"

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
  thumbnailUrls,
  thumbnailUrlSets = EMPTY_THUMBNAIL_URL_SETS,
  tileSize,
  hoverPreviewEnabled,
  hoverPreviewDelayMs,
  showReturnFooter,
  returnFooterContext,
  restoreSnapshot,
  initialScrollTop,
  initialIndex,
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
  thumbnailUrls: ReadonlyMap<string, string>
  thumbnailUrlSets?: ReadonlyMap<string, readonly string[]>
  tileSize: number
  hoverPreviewEnabled: boolean
  hoverPreviewDelayMs: number
  showReturnFooter: boolean
  returnFooterContext: FolderReturnFooterContext
  restoreSnapshot?: StateSnapshot
  initialScrollTop?: number
  initialIndex?: number
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
          disabled={disabled}
          selectedPaths={selectedPaths}
          focusedIndex={focusedIndex}
          itemIdPrefix={itemIdPrefix}
          thumbnailUrls={thumbnailUrls}
          thumbnailUrlSets={thumbnailUrlSets}
          measuredSpans={measuredSpans}
          tileSize={tileSize}
          columnCount={columnCount}
          hoverPreviewEnabled={hoverPreviewEnabled}
          hoverPreviewDelayMs={hoverPreviewDelayMs}
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
  disabled,
  selectedPaths,
  focusedIndex,
  itemIdPrefix,
  thumbnailUrls,
  thumbnailUrlSets,
  measuredSpans,
  tileSize,
  columnCount,
  hoverPreviewEnabled,
  hoverPreviewDelayMs,
  onDimensions,
  onSelect,
}: {
  catalog: DirectoryCatalog
  startIndex: number
  disabled: boolean
  selectedPaths: ReadonlySet<string>
  focusedIndex?: number
  itemIdPrefix?: string
  thumbnailUrls: ReadonlyMap<string, string>
  thumbnailUrlSets: ReadonlyMap<string, readonly string[]>
  measuredSpans: ReadonlyMap<string, FolderMosaicSpan>
  tileSize: number
  columnCount: number
  hoverPreviewEnabled: boolean
  hoverPreviewDelayMs: number
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
        return (
          <DirectoryMosaicItem
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
            thumbnailUrl={thumbnailUrls.get(entry.path)}
            thumbnailUrls={thumbnailUrlSets.get(entry.path)}
            hoverPreviewEnabled={hoverPreviewEnabled}
            hoverPreviewDelayMs={hoverPreviewDelayMs}
            onDimensions={onDimensions}
            onSelect={onSelect}
          />
        )
      })}
    </div>
  )
}

function DirectoryMosaicItem({
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
  thumbnailUrl,
  thumbnailUrls,
  hoverPreviewEnabled,
  hoverPreviewDelayMs,
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
  thumbnailUrl?: string
  thumbnailUrls?: readonly string[]
  hoverPreviewEnabled: boolean
  hoverPreviewDelayMs: number
  onDimensions(path: string, width: number, height: number): void
  onSelect(entry: ReaderDirectoryEntryDto, index: number, event: ReactMouseEvent): void
}) {
  const geometry = folderMosaicGeometry(span, previewReady, columnCount)
  return (
    <FolderHoverPreview thumbnailUrl={thumbnailUrl} enabled={hoverPreviewEnabled} delayMs={hoverPreviewDelayMs} label={entry.name}>
      <button
        id={itemId}
        type="button"
        className="grid size-full min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_auto] overflow-hidden rounded border bg-background text-left text-xs hover:bg-muted aria-selected:border-primary aria-selected:bg-accent data-[focused=true]:ring-1 data-[focused=true]:ring-inset data-[focused=true]:ring-primary"
        style={{
          gridColumn: `span ${geometry.columns}`,
          gridRow: `span ${geometry.rows}`,
        }}
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
      >
        <span className="grid min-h-0 place-items-center overflow-hidden bg-muted/30" data-folder-thumbnail="true">
          {thumbnailUrl
            ? <ReaderThumbnailSurface
                url={thumbnailUrl}
                urls={thumbnailUrls}
                kind={entry.kind === "directory" ? "folder" : "file"}
                fit="contain"
                className="size-full rounded-none bg-transparent"
                onDimensions={(width, height) => onDimensions(entry.path, width, height)}
              />
            : entry.kind === "directory" ? null : <FolderEntryIcon entry={entry} className="size-8" />}
        </span>
        <span className="grid min-w-0 gap-0.5 border-t px-1.5 py-1">
          <span className="flex min-w-0 items-center gap-1">
            <FolderEntryIcon entry={entry} className="size-3.5" />
            <span className="truncate font-medium">{entry.name}</span>
          </span>
          {span !== "square" ? (
            <span className="flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground">
              <FolderEntryFileMetadata entry={entry} className="min-w-0" />
              <FolderEntryMetadata entry={entry} showRating={showRating} showCollectTagCount={showCollectTagCount} className="min-w-0" />
            </span>
          ) : null}
        </span>
      </button>
    </FolderHoverPreview>
  )
}

const EMPTY_THUMBNAIL_URL_SETS: ReadonlyMap<string, readonly string[]> = new Map()

export function folderMosaicGeometry(span: FolderMosaicSpan, previewReady: boolean, columnCount: number): { columns: number; rows: number } {
  const maximumColumns = Math.max(1, columnCount)
  if (!previewReady) return { columns: 1, rows: 1 }
  return span === "wide"
    ? { columns: Math.min(2, maximumColumns), rows: 1 }
    : span === "tall" ? { columns: 1, rows: 2 } : { columns: 1, rows: 1 }
}

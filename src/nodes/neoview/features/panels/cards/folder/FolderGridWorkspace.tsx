import {
  VirtuosoGrid,
  type GridStateSnapshot,
  type ListRange,
  type VirtuosoGridHandle,
} from "react-virtuoso"
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject } from "react"

import type { ReaderDirectoryEntryDto, ReaderFolderViewMode } from "../../../../adapters/reader-http-client"
import { directoryEntryAt, viewUsesBanner, type DirectoryCatalog } from "./DirectoryCatalog"
import { FolderEntryIcon, FolderEntryMetadata } from "./FolderEntryPresentation"
import { FolderHoverPreview } from "./FolderHoverPreview"
import { EMPTY_VIRTUOSO_COMPONENTS, FOLDER_GRID_COMPONENTS, type FolderReturnFooterContext } from "./FolderEmptyAreaBehavior"

const GRID_HEIGHT = 288

export default function FolderGridWorkspace({
  virtualKey,
  gridRef,
  catalog,
  viewMode,
  disabled,
  selectedPaths,
  focusedIndex,
  itemIdPrefix,
  thumbnailUrls,
  hoverPreviewEnabled,
  hoverPreviewDelayMs,
  showReturnFooter,
  returnFooterContext,
  restoreSnapshot,
  initialScrollTop,
  initialIndex,
  onRangeChange,
  onStateChange,
  onScrollTopChange,
  onSelect,
}: {
  virtualKey: string
  gridRef: RefObject<VirtuosoGridHandle | null>
  catalog: DirectoryCatalog
  viewMode: ReaderFolderViewMode
  disabled: boolean
  selectedPaths: ReadonlySet<string>
  focusedIndex?: number
  itemIdPrefix?: string
  thumbnailUrls: ReadonlyMap<string, string>
  hoverPreviewEnabled: boolean
  hoverPreviewDelayMs: number
  showReturnFooter: boolean
  returnFooterContext: FolderReturnFooterContext
  restoreSnapshot?: GridStateSnapshot
  initialScrollTop?: number
  initialIndex?: number
  onRangeChange(range: ListRange): void
  onStateChange(snapshot: GridStateSnapshot): void
  onScrollTopChange(scrollTop: number): void
  onSelect(entry: ReaderDirectoryEntryDto, index: number, event: ReactMouseEvent): void
}) {
  const banner = viewUsesBanner(viewMode)
  const showRating = catalog.metadataFields.includes("rating")
  const showCollectTagCount = catalog.metadataFields.includes("collectTagCount")
  const [scroller, setScroller] = useState<HTMLElement | null>(null)
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
    return () => {
      scroller.removeEventListener("scroll", onScroll)
    }
  }, [scroller, virtualKey])

  useEffect(() => () => {
    for (const frame of restoreFramesRef.current) cancelAnimationFrame(frame)
  }, [])

  function handleRangeChange(range: ListRange) {
    onRangeChange(range)
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
    <VirtuosoGrid
      key={virtualKey}
      ref={gridRef}
      scrollerRef={(element) => {
        scrollerElementRef.current = element
        setScroller(element)
      }}
      data-folder-navigation-entry-id={catalog.navigationEntryId}
      data-folder-restore-scroll-top={initialScrollTop}
      style={{ height: GRID_HEIGHT }}
      totalCount={catalog.total}
      components={showReturnFooter ? FOLDER_GRID_COMPONENTS : EMPTY_VIRTUOSO_COMPONENTS}
      context={showReturnFooter ? returnFooterContext : undefined}
      listClassName={banner
        ? "grid gap-1 p-1 [grid-template-columns:repeat(auto-fill,minmax(max(var(--folder-grid-width),10rem),1fr))]"
        : "grid gap-1 p-1 [grid-template-columns:repeat(auto-fill,minmax(max(var(--folder-grid-width),5.5rem),1fr))]"}
      itemClassName="min-w-0"
      increaseViewportBy={{ top: 144, bottom: 288 }}
      computeItemKey={(index) => directoryEntryAt(catalog, index)?.path ?? `${catalog.generation}:${index}`}
      rangeChanged={handleRangeChange}
      restoreStateFrom={restoreSnapshot}
      initialTopMostItemIndex={initialIndex !== undefined ? { index: initialIndex, align: "center" } : undefined}
      stateChanged={onStateChange}
      itemContent={(index) => {
        const entry = directoryEntryAt(catalog, index)
        const Item = banner ? DirectoryBannerItem : DirectoryGridItem
        return (
          <Item
            itemId={`${itemIdPrefix}-item-${index}`}
            entry={entry}
            index={index}
            disabled={disabled}
            selected={Boolean(entry && selectedPaths.has(entry.path))}
            focused={index === focusedIndex}
            showRating={showRating}
            showCollectTagCount={showCollectTagCount}
            visualMode={viewMode}
            thumbnailUrl={entry ? thumbnailUrls.get(entry.path) : undefined}
            hoverPreviewEnabled={hoverPreviewEnabled}
            hoverPreviewDelayMs={hoverPreviewDelayMs}
            onSelect={onSelect}
          />
        )
      }}
    />
  )
}

interface DirectoryGridItemProps {
  itemId: string
  entry?: ReaderDirectoryEntryDto
  index: number
  disabled: boolean
  selected: boolean
  focused: boolean
  showRating: boolean
  showCollectTagCount: boolean
  visualMode: ReaderFolderViewMode
  thumbnailUrl?: string
  hoverPreviewEnabled: boolean
  hoverPreviewDelayMs: number
  onSelect(entry: ReaderDirectoryEntryDto, index: number, event: ReactMouseEvent): void
}

function DirectoryBannerItem({ itemId, entry, index, disabled, selected, focused, showRating, showCollectTagCount, visualMode, thumbnailUrl, hoverPreviewEnabled, hoverPreviewDelayMs, onSelect }: DirectoryGridItemProps) {
  if (!entry) return <div className="h-24 animate-pulse rounded bg-muted/30" aria-hidden="true" />
  return (
    <FolderHoverPreview thumbnailUrl={thumbnailUrl} enabled={hoverPreviewEnabled} delayMs={hoverPreviewDelayMs} label={entry.name}>
    <button
      id={itemId}
      type="button"
      className="grid h-24 w-full grid-cols-[5rem_minmax(0,1fr)] overflow-hidden rounded border bg-background text-left text-xs hover:bg-muted aria-selected:border-primary aria-selected:bg-accent data-[focused=true]:ring-1 data-[focused=true]:ring-primary"
      aria-selected={selected}
      data-focused={focused || undefined}
      disabled={disabled}
      title={entry.path}
      onClick={(event) => onSelect(entry, index, event)}
      tabIndex={-1}
      data-preview-mode={visualMode}
      data-folder-entry="true"
      data-context-menu="neoview-folder-entry"
      data-folder-index={index}
      data-folder-path={entry.path}
      data-folder-name={entry.name}
      data-folder-kind={entry.kind}
      data-folder-reader-supported={entry.readerSupported}
    >
      <span className="grid min-h-0 place-items-center overflow-hidden bg-muted/30">
        {thumbnailUrl
          ? <img src={thumbnailUrl} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
          : <FolderEntryIcon entry={entry} className="size-8" />}
      </span>
      <span className="grid min-w-0 content-center gap-1 px-2 py-1.5">
        <span className="truncate font-medium">{entry.name}</span>
        <span className="truncate text-[10px] text-muted-foreground">{entry.path}</span>
        <FolderEntryMetadata entry={entry} showRating={showRating} showCollectTagCount={showCollectTagCount} />
      </span>
    </button>
    </FolderHoverPreview>
  )
}

function DirectoryGridItem({ itemId, entry, index, disabled, selected, focused, showRating, showCollectTagCount, visualMode, thumbnailUrl, hoverPreviewEnabled, hoverPreviewDelayMs, onSelect }: DirectoryGridItemProps) {
  if (!entry) return <div className="h-36 animate-pulse rounded bg-muted/30" aria-hidden="true" />
  const showMetadata = showRating || showCollectTagCount
  return (
    <FolderHoverPreview thumbnailUrl={thumbnailUrl} enabled={hoverPreviewEnabled} delayMs={hoverPreviewDelayMs} label={entry.name}>
    <button
      id={itemId}
      type="button"
      className={`grid h-36 w-full overflow-hidden rounded border bg-background text-left text-xs hover:bg-muted aria-selected:border-primary aria-selected:bg-accent data-[focused=true]:ring-1 data-[focused=true]:ring-primary ${showMetadata ? "grid-rows-[1fr_auto_auto]" : "grid-rows-[1fr_auto]"}`}
      aria-selected={selected}
      data-focused={focused || undefined}
      disabled={disabled}
      title={entry.path}
      onClick={(event) => onSelect(entry, index, event)}
      tabIndex={-1}
      data-preview-mode={visualMode}
      data-folder-entry="true"
      data-context-menu="neoview-folder-entry"
      data-folder-index={index}
      data-folder-path={entry.path}
      data-folder-name={entry.name}
      data-folder-kind={entry.kind}
      data-folder-reader-supported={entry.readerSupported}
    >
      <span className="grid min-h-0 place-items-center overflow-hidden bg-muted/30">
        {thumbnailUrl
          ? <img src={thumbnailUrl} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
          : <FolderEntryIcon entry={entry} className="size-8" />}
      </span>
      <span className="flex min-w-0 items-center gap-1 border-t px-1.5 py-1.5">
        <FolderEntryIcon entry={entry} className="size-3.5" />
        <span className="truncate">{entry.name}</span>
      </span>
      {showMetadata ? <FolderEntryMetadata entry={entry} showRating={showRating} showCollectTagCount={showCollectTagCount} className="h-5 border-t px-1.5" /> : null}
    </button>
    </FolderHoverPreview>
  )
}

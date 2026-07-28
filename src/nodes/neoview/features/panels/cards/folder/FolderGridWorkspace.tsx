import {
  VirtuosoGrid,
  type GridComponents,
  type GridItemProps,
  type GridStateSnapshot,
  type ListRange,
  type VirtuosoGridHandle,
} from "react-virtuoso"
import { forwardRef, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject } from "react"

import type { ReaderDirectoryEntryDto, ReaderFolderViewMode } from "../../../../adapters/reader-http-client"
import { ReaderThumbnailSurface } from "../../../thumbnails/ReaderThumbnailSurface"
import { directoryEntryAt, directoryEntryIndex, viewUsesBanner, type DirectoryCatalog } from "./DirectoryCatalog"
import { FolderEntryFileMetadata, FolderEntryIcon, FolderEntryMetadata } from "./FolderEntryPresentation"
import { folderEntryIsEmptyDirectory } from "./FolderEntryContentState"
import { FolderHoverPreview } from "./FolderHoverPreview"
import { FolderPenetrationFileNames, type FolderPenetrationFileName } from "./FolderPenetrationFileNames"
import FolderDeleteButton, { type FolderDeleteStrategy } from "./FolderDeleteButton"
import { FOLDER_GRID_COMPONENTS, type FolderReturnFooterContext } from "./FolderEmptyAreaBehavior"
import { folderThumbnailIsLoading, type FolderThumbnailStore } from "./FolderThumbnailStore"
import { useFolderThumbnail } from "./useFolderThumbnail"
import { folderTitleClassName } from "./FolderViewPresentation"

interface FolderGridContext extends FolderReturnFooterContext {
  inlineBranchDrawerIndex?: number
}

const FolderGridItem = forwardRef<HTMLDivElement, GridItemProps & { context: FolderGridContext }>(function FolderGridItem(
  { children, context, style, ...props },
  ref,
) {
  const isDrawer = props["data-index"] === context.inlineBranchDrawerIndex
  return <div ref={ref} {...props} style={isDrawer ? { ...style, gridColumn: "1 / -1" } : style}>{children}</div>
})

const FOLDER_GRID_COMPONENTS_WITH_DRAWER = {
  ...FOLDER_GRID_COMPONENTS,
  Item: FolderGridItem,
} satisfies GridComponents<FolderGridContext>

const EMPTY_GRID_COMPONENTS_WITH_DRAWER = {
  Item: FolderGridItem,
} satisfies GridComponents<FolderGridContext>

export default function FolderGridWorkspace({
  virtualKey,
  gridRef,
  catalog,
  viewMode,
  disabled,
  selectedPaths,
  focusedIndex,
  itemIdPrefix,
  thumbnailStore,
  thumbnailProbeEnabled = true,
  thumbnailUrls = EMPTY_THUMBNAIL_URLS,
  thumbnailUrlSets = EMPTY_THUMBNAIL_URL_SETS,
  hoverPreviewEnabled,
  hoverPreviewDelayMs,
  wrapTitle = false,
  penetrationFiles = EMPTY_PENETRATION_FILES,
  deleteMode,
  deleteStrategy,
  confirmDelete = true,
  showReturnFooter,
  returnFooterContext,
  restoreSnapshot,
  initialScrollTop,
  initialIndex,
  inlineBranchPath,
  inlineBranch,
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
  thumbnailStore?: FolderThumbnailStore
  thumbnailProbeEnabled?: boolean
  thumbnailUrls?: ReadonlyMap<string, string>
  thumbnailUrlSets?: ReadonlyMap<string, readonly string[]>
  hoverPreviewEnabled: boolean
  hoverPreviewDelayMs: number
  wrapTitle?: boolean
  penetrationFiles?: ReadonlyMap<string, readonly FolderPenetrationFileName[]>
  deleteMode?: boolean
  deleteStrategy?: FolderDeleteStrategy
  confirmDelete?: boolean
  showReturnFooter: boolean
  returnFooterContext: FolderReturnFooterContext
  restoreSnapshot?: GridStateSnapshot
  initialScrollTop?: number
  initialIndex?: number
  inlineBranchPath?: string
  inlineBranch?: ReactNode
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
  const inlineBranchIndex = inlineBranchPath && inlineBranch ? directoryEntryIndex(catalog, inlineBranchPath) : undefined
  const inlineBranchDrawerIndex = inlineBranchIndex === undefined ? undefined : inlineBranchIndex + 1
  const hasInlineBranch = inlineBranchDrawerIndex !== undefined
  const gridContext: FolderGridContext = { ...returnFooterContext, inlineBranchDrawerIndex }
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
    onRangeChange(hasInlineBranch ? {
      startIndex: directoryIndexForGridIndex(range.startIndex, inlineBranchIndex),
      endIndex: directoryIndexForGridIndex(range.endIndex, inlineBranchIndex),
    } : range)
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
      style={{ height: "100%" }}
      totalCount={catalog.total + (hasInlineBranch ? 1 : 0)}
      components={showReturnFooter ? FOLDER_GRID_COMPONENTS_WITH_DRAWER : EMPTY_GRID_COMPONENTS_WITH_DRAWER}
      context={gridContext}
      listClassName={banner
        ? "grid grid-flow-dense gap-1 p-1 [grid-template-columns:repeat(auto-fill,minmax(max(var(--folder-grid-width),10rem),1fr))]"
        : "grid grid-flow-dense gap-1 p-1 [grid-template-columns:repeat(auto-fill,minmax(max(var(--folder-grid-width),5.5rem),1fr))]"}
      itemClassName="min-w-0"
      increaseViewportBy={{ top: 144, bottom: 288 }}
      computeItemKey={(index) => index === inlineBranchDrawerIndex
        ? `folder-inline-branch:${inlineBranchPath}`
        : directoryEntryAt(catalog, directoryIndexForGridIndex(index, inlineBranchIndex))?.path ?? `${catalog.generation}:${index}`}
      rangeChanged={handleRangeChange}
      restoreStateFrom={restoreSnapshot}
      initialTopMostItemIndex={initialIndex !== undefined ? { index: initialIndex, align: "center" } : undefined}
      stateChanged={onStateChange}
      itemContent={(index) => {
        if (index === inlineBranchDrawerIndex && inlineBranch) {
          return <div className="w-full min-w-0" data-folder-inline-grid-drawer="true">{inlineBranch}</div>
        }
        const entryIndex = directoryIndexForGridIndex(index, inlineBranchIndex)
        const entry = directoryEntryAt(catalog, entryIndex)
        const Item = banner ? DirectoryBannerItem : DirectoryGridItem
        return (
          <Item
            itemId={`${itemIdPrefix}-item-${entryIndex}`}
            entry={entry}
            index={entryIndex}
            disabled={disabled}
            selected={Boolean(entry && selectedPaths.has(entry.path))}
            focused={entryIndex === focusedIndex}
            showRating={showRating}
            showCollectTagCount={showCollectTagCount}
            visualMode={viewMode}
            thumbnailStore={thumbnailStore}
            thumbnailProbeEnabled={thumbnailProbeEnabled}
            thumbnailUrl={entry ? thumbnailUrls.get(entry.path) : undefined}
            thumbnailUrls={entry ? thumbnailUrlSets.get(entry.path) : undefined}
            hoverPreviewEnabled={hoverPreviewEnabled}
            hoverPreviewDelayMs={hoverPreviewDelayMs}
            wrapTitle={wrapTitle}
            penetrationFiles={entry ? penetrationFiles.get(entry.path) : undefined}
            deleteMode={Boolean(deleteMode)}
            deleteStrategy={deleteStrategy ?? "trash"}
            confirmDelete={confirmDelete}
            onSelect={onSelect}
          />
        )
      }}
    />
  )
}

function directoryIndexForGridIndex(index: number, inlineBranchIndex: number | undefined): number {
  if (inlineBranchIndex === undefined || index <= inlineBranchIndex) return index
  return index - 1
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
  thumbnailStore?: FolderThumbnailStore
  thumbnailUrl?: string
  thumbnailUrls?: readonly string[]
  thumbnailProbeEnabled?: boolean
  hoverPreviewEnabled: boolean
  hoverPreviewDelayMs: number
  wrapTitle?: boolean
  penetrationFiles?: readonly FolderPenetrationFileName[]
  deleteMode?: boolean
  deleteStrategy?: FolderDeleteStrategy
  confirmDelete?: boolean
  onSelect(entry: ReaderDirectoryEntryDto, index: number, event: ReactMouseEvent): void
}

export function DirectoryBannerItem({ itemId, entry, index, disabled, selected, focused, showRating, showCollectTagCount, visualMode, thumbnailStore, thumbnailUrl, thumbnailUrls, thumbnailProbeEnabled = true, hoverPreviewEnabled, hoverPreviewDelayMs, wrapTitle = false, penetrationFiles, deleteMode = false, deleteStrategy = "trash", confirmDelete = true, onSelect }: DirectoryGridItemProps) {
  const directoryEmpty = entry ? folderEntryIsEmptyDirectory(entry) : false
  const thumbnailEligible = Boolean(entry && !directoryEmpty && (entry.kind === "directory" || entry.readerSupported))
  const storedThumbnail = useFolderThumbnail(thumbnailStore, entry?.path, thumbnailEligible, thumbnailProbeEnabled)
  const resolvedThumbnailUrl = thumbnailStore ? storedThumbnail.thumbnailUrl : thumbnailUrl
  const resolvedThumbnailUrls = thumbnailStore ? storedThumbnail.thumbnailUrls : thumbnailUrls
  const thumbnailLoading = Boolean(!directoryEmpty && thumbnailStore && folderThumbnailIsLoading(storedThumbnail.availability))
  if (!entry) return <div className="h-24 animate-pulse rounded bg-muted/30" aria-hidden="true" />
  return (
    <FolderHoverPreview thumbnailUrl={directoryEmpty ? undefined : resolvedThumbnailUrl} enabled={hoverPreviewEnabled && !directoryEmpty} delayMs={hoverPreviewDelayMs} label={entry.name}>
    <div className="relative">
    {deleteMode ? <FolderDeleteButton entry={{ index, ...entry }} strategy={deleteStrategy} disabled={disabled} overlay confirm={confirmDelete} /> : null}
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
      data-folder-empty-directory={directoryEmpty || undefined}
    >
      <span className="grid min-h-0 place-items-center overflow-hidden bg-muted/30" data-folder-thumbnail="true">
        {directoryEmpty ? <FolderEntryIcon entry={entry} className="size-8" /> : resolvedThumbnailUrl || thumbnailLoading
          ? <ReaderThumbnailSurface url={resolvedThumbnailUrl} urls={resolvedThumbnailUrls} kind={entry.kind === "directory" ? "folder" : "file"} fit="contain" imageLoading="eager" loading={thumbnailLoading && !resolvedThumbnailUrl} retryKey={storedThumbnail.availability === "ready" ? storedThumbnail.revision : undefined} className="size-full rounded-none bg-transparent" />
          : entry.kind === "directory" ? null : <FolderEntryIcon entry={entry} className="size-8" />}
      </span>
      <span className="grid min-w-0 content-center gap-0.5 px-2 py-1.5" data-folder-entry-info="two-line">
        <span className={folderTitleClassName(wrapTitle) + " font-medium"} data-folder-entry-line="name" data-folder-entry-title-wrap={wrapTitle || undefined}>{entry.name}</span>
        <FolderPenetrationFileNames files={penetrationFiles} />
        <span className="flex min-w-0 items-center gap-1" data-folder-entry-line="metadata">
          <FolderEntryFileMetadata entry={entry} className="min-w-0" />
          <FolderEntryMetadata entry={entry} showRating={showRating} showCollectTagCount={showCollectTagCount} className="min-w-0" />
        </span>
      </span>
    </button>
    </div>
    </FolderHoverPreview>
  )
}

const EMPTY_THUMBNAIL_URL_SETS: ReadonlyMap<string, readonly string[]> = new Map()
const EMPTY_THUMBNAIL_URLS: ReadonlyMap<string, string> = new Map()
const EMPTY_PENETRATION_FILES: ReadonlyMap<string, readonly FolderPenetrationFileName[]> = new Map()

export function DirectoryGridItem({ itemId, entry, index, disabled, selected, focused, showRating, showCollectTagCount, visualMode, thumbnailStore, thumbnailUrl, thumbnailUrls, thumbnailProbeEnabled = true, hoverPreviewEnabled, hoverPreviewDelayMs, wrapTitle = false, penetrationFiles, deleteMode = false, deleteStrategy = "trash", confirmDelete = true, onSelect }: DirectoryGridItemProps) {
  const directoryEmpty = entry ? folderEntryIsEmptyDirectory(entry) : false
  const thumbnailEligible = Boolean(entry && !directoryEmpty && (entry.kind === "directory" || entry.readerSupported))
  const storedThumbnail = useFolderThumbnail(thumbnailStore, entry?.path, thumbnailEligible, thumbnailProbeEnabled)
  const resolvedThumbnailUrl = thumbnailStore ? storedThumbnail.thumbnailUrl : thumbnailUrl
  const resolvedThumbnailUrls = thumbnailStore ? storedThumbnail.thumbnailUrls : thumbnailUrls
  const thumbnailLoading = Boolean(!directoryEmpty && thumbnailStore && folderThumbnailIsLoading(storedThumbnail.availability))
  if (!entry) return (
    <div className="grid w-full grid-rows-[auto_1.75rem] overflow-hidden rounded border bg-background" aria-hidden="true">
      <span className="aspect-[2/3] w-full animate-pulse bg-muted/30" />
      <span className="border-t bg-muted/20" />
    </div>
  )
  const showMetadata = showRating || showCollectTagCount || Boolean(entry.tags?.length)
  return (
    <FolderHoverPreview thumbnailUrl={directoryEmpty ? undefined : resolvedThumbnailUrl} enabled={hoverPreviewEnabled && !directoryEmpty} delayMs={hoverPreviewDelayMs} label={entry.name}>
    <div className="relative">
    {deleteMode ? <FolderDeleteButton entry={{ index, ...entry }} strategy={deleteStrategy} disabled={disabled} overlay confirm={confirmDelete} /> : null}
    <button
      id={itemId}
      type="button"
      className={`grid w-full overflow-hidden rounded border bg-background text-left text-xs hover:bg-muted aria-selected:border-primary aria-selected:bg-accent data-[focused=true]:ring-1 data-[focused=true]:ring-primary ${showMetadata ? "grid-rows-[auto_auto_auto]" : "grid-rows-[auto_auto]"}`}
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
      data-folder-empty-directory={directoryEmpty || undefined}
    >
      <span className="relative grid aspect-[2/3] w-full min-h-0 place-items-center overflow-hidden bg-muted/30" data-folder-thumbnail="true" data-folder-thumbnail-orientation="portrait">
        {directoryEmpty ? <FolderEntryIcon entry={entry} className="size-8" /> : resolvedThumbnailUrl || thumbnailLoading
          ? <ReaderThumbnailSurface url={resolvedThumbnailUrl} urls={resolvedThumbnailUrls} kind={entry.kind === "directory" ? "folder" : "file"} fit="contain" imageLoading="eager" loading={thumbnailLoading && !resolvedThumbnailUrl} retryKey={storedThumbnail.availability === "ready" ? storedThumbnail.revision : undefined} className="size-full rounded-none bg-transparent" />
          : entry.kind === "directory" ? null : <FolderEntryIcon entry={entry} className="size-8" />}
        {penetrationFiles?.length ? <span className="absolute inset-x-1 bottom-1 max-h-20 overflow-hidden"><FolderPenetrationFileNames files={penetrationFiles} variant="overlay" /></span> : null}
      </span>
      <span className={`flex min-w-0 gap-1 border-t px-1.5 py-1.5 ${wrapTitle ? "min-h-10 items-start" : "items-center"}`}>
        <FolderEntryIcon entry={entry} className="size-3.5" />
        <span className={folderTitleClassName(wrapTitle)} data-folder-entry-title-wrap={wrapTitle || undefined}>{entry.name}</span>
      </span>
      {showMetadata ? <FolderEntryMetadata entry={entry} showRating={showRating} showCollectTagCount={showCollectTagCount} className="h-5 border-t px-1.5" /> : null}
    </button>
    </div>
    </FolderHoverPreview>
  )
}

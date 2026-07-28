import { lazy, Suspense, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject } from "react"
import { Virtuoso, type GridStateSnapshot, type ListRange, type VirtuosoGridHandle, type VirtuosoHandle } from "react-virtuoso"

import type { ReaderDirectoryEntryDto, ReaderFolderDetailsConfig } from "../../../../adapters/reader-http-client"
import {
  directoryEntryAt,
  thumbnailPixelSize,
  viewUsesFixedGrid,
  viewUsesMosaicGrid,
  viewUsesVirtuosoList,
  type DirectoryCatalog,
} from "./DirectoryCatalog"
import { DirectoryListItem } from "./FolderDirectoryListItem"
import { EMPTY_VIRTUOSO_COMPONENTS, FOLDER_LIST_COMPONENTS, type FolderReturnFooterContext } from "./FolderEmptyAreaBehavior"
import type { FolderEntryViewSpec } from "./FolderEntryViewSpec"
import type { FolderPenetrationFileName } from "./FolderPenetrationFileNames"
import type { SavedDirectoryState } from "./FolderBrowserState"
import type { FolderThumbnailStore } from "./FolderThumbnailStore"

const FolderDetailsView = lazy(() => import("./FolderDetailsView"))
const FolderGridWorkspace = lazy(() => import("./FolderGridWorkspace"))
const FolderMosaicWorkspace = lazy(() => import("./FolderMosaicWorkspace"))
const EMPTY_PENETRATION_FILES: ReadonlyMap<string, readonly FolderPenetrationFileName[]> = new Map()

export interface FolderEntryViewportProps {
  catalog: DirectoryCatalog
  viewSpec: FolderEntryViewSpec
  virtualKey: string
  disabled: boolean
  selectedPaths: ReadonlySet<string>
  focusedIndex?: number
  itemIdPrefix?: string
  thumbnailStore?: FolderThumbnailStore
  penetrationFiles?: ReadonlyMap<string, readonly FolderPenetrationFileName[]>
  listRef: RefObject<VirtuosoHandle | null>
  listScrollerRef?: RefObject<HTMLElement | null>
  gridRef: RefObject<VirtuosoGridHandle | null>
  mosaicRef: RefObject<VirtuosoHandle | null>
  restoreState?: SavedDirectoryState
  restoreIndex?: number
  shouldLocateRestore?: boolean
  inlineBranchPath?: string
  inlineBranch?: ReactNode
  showReturnFooter: boolean
  returnFooterContext: FolderReturnFooterContext
  onRangeChange(range: ListRange): void
  onDetailsScrollTopChange?(scrollTop: number): void
  onDetailsLayoutChange(details: Partial<ReaderFolderDetailsConfig>): void
  onGridStateChange?(snapshot: GridStateSnapshot): void
  onGridScrollTopChange?(scrollTop: number): void
  onMosaicScrollTopChange?(scrollTop: number): void
  onSelect(entry: ReaderDirectoryEntryDto, index: number, event: ReactMouseEvent): void
}

export default function FolderEntryViewport({
  catalog,
  viewSpec,
  virtualKey,
  disabled,
  selectedPaths,
  focusedIndex,
  itemIdPrefix,
  thumbnailStore,
  penetrationFiles = EMPTY_PENETRATION_FILES,
  listRef,
  listScrollerRef,
  gridRef,
  mosaicRef,
  restoreState,
  restoreIndex,
  shouldLocateRestore = false,
  inlineBranchPath,
  inlineBranch,
  showReturnFooter,
  returnFooterContext,
  onRangeChange,
  onDetailsScrollTopChange,
  onDetailsLayoutChange,
  onGridStateChange,
  onGridScrollTopChange,
  onMosaicScrollTopChange,
  onSelect,
}: FolderEntryViewportProps) {
  const { config, deletion } = viewSpec
  const { viewMode } = config
  return (
    <>
      {catalog.total > 0 && viewUsesVirtuosoList(viewMode) ? (
        <Virtuoso
          key={virtualKey}
          ref={listRef}
          scrollerRef={(element) => {
            if (listScrollerRef) listScrollerRef.current = element instanceof HTMLElement ? element : null
          }}
          style={{ height: "100%" }}
          totalCount={catalog.total}
          components={showReturnFooter ? FOLDER_LIST_COMPONENTS : EMPTY_VIRTUOSO_COMPONENTS}
          context={showReturnFooter ? returnFooterContext : undefined}
          fixedItemHeight={viewSpec.wrapTitle ? undefined : viewMode === "compact" ? 34 : 76}
          increaseViewportBy={{
            top: viewMode === "compact" ? 68 : 152,
            bottom: viewMode === "compact" ? 136 : 304,
          }}
          computeItemKey={(index) => directoryEntryAt(catalog, index)?.path ?? `${catalog.generation}:${index}`}
          rangeChanged={onRangeChange}
          restoreStateFrom={restoreState?.viewMode === viewMode ? restoreState.listSnapshot : undefined}
          initialTopMostItemIndex={
            shouldLocateRestore && restoreState?.viewMode === viewMode && !restoreState.listSnapshot && restoreIndex !== undefined
              ? { index: restoreIndex, align: "center" }
              : undefined
          }
          itemContent={(index) => {
            const entry = directoryEntryAt(catalog, index)
            return (
              <DirectoryListItem
                itemId={`${itemIdPrefix}-item-${index}`}
                entry={entry}
                index={index}
                disabled={disabled}
                selected={Boolean(entry && selectedPaths.has(entry.path))}
                focused={index === focusedIndex}
                showRating={catalog.metadataFields.includes("rating")}
                showCollectTagCount={catalog.metadataFields.includes("collectTagCount")}
                visualMode={viewMode}
                wrapTitle={viewSpec.wrapTitle}
                thumbnailStore={thumbnailStore}
                thumbnailProbeEnabled={viewSpec.thumbnailProbeEnabled}
                contentWidthPercent={config.contentWidthPercent}
                hoverPreviewEnabled={config.hoverPreviewEnabled}
                hoverPreviewDelayMs={config.hoverPreviewDelayMs}
                penetrationFiles={entry ? penetrationFiles.get(entry.path) : undefined}
                deleteMode={deletion.enabled}
                deleteStrategy={deletion.strategy}
                confirmDelete={deletion.confirm}
                onSelect={onSelect}
              />
            )
          }}
        />
      ) : null}
      {viewMode === "details" ? (
        <Suspense fallback={<div className="h-72 animate-pulse bg-muted/30" aria-label="正在加载详细信息视图" />}>
          <FolderDetailsView
            key={virtualKey}
            catalog={catalog}
            disabled={disabled}
            selectedPaths={selectedPaths}
            initialIndex={focusedIndex ?? (restoreState?.viewMode === "details" ? (restoreState.focusedIndex ?? restoreState.anchorIndex) : undefined)}
            initialScrollTop={restoreState?.viewMode === "details" ? restoreState.detailsScrollTop : undefined}
            layout={config.details}
            wrapTitle={viewSpec.wrapTitle}
            deleteMode={deletion.enabled}
            deleteStrategy={deletion.strategy}
            confirmDelete={deletion.confirm}
            onRangeChange={onRangeChange}
            onScrollTopChange={onDetailsScrollTopChange}
            onSelect={onSelect}
            onLayoutChange={onDetailsLayoutChange}
            showReturnFooter={showReturnFooter}
            returnFooterContext={returnFooterContext}
          />
        </Suspense>
      ) : null}
      {catalog.total > 0 && viewUsesFixedGrid(viewMode) ? (
        <Suspense fallback={<div className="h-72 animate-pulse bg-muted/30" aria-label="正在加载网格视图" />}>
          <FolderGridWorkspace
            virtualKey={virtualKey}
            gridRef={gridRef}
            catalog={catalog}
            viewMode={viewMode}
            wrapTitle={viewSpec.wrapTitle}
            disabled={disabled}
            selectedPaths={selectedPaths}
            focusedIndex={focusedIndex}
            itemIdPrefix={itemIdPrefix}
            thumbnailStore={thumbnailStore}
            thumbnailProbeEnabled={viewSpec.thumbnailProbeEnabled}
            hoverPreviewEnabled={config.hoverPreviewEnabled}
            hoverPreviewDelayMs={config.hoverPreviewDelayMs}
            penetrationFiles={penetrationFiles}
            deleteMode={deletion.enabled}
            deleteStrategy={deletion.strategy}
            confirmDelete={deletion.confirm}
            showReturnFooter={showReturnFooter}
            returnFooterContext={returnFooterContext}
            restoreSnapshot={restoreState?.viewMode === viewMode ? restoreState.gridSnapshot : undefined}
            initialScrollTop={restoreState?.viewMode === viewMode ? restoreState.gridScrollTop : undefined}
            initialIndex={shouldLocateRestore && restoreState?.viewMode === viewMode && !restoreState.gridSnapshot ? restoreIndex : undefined}
            inlineBranchPath={inlineBranchPath}
            inlineBranch={inlineBranch}
            onRangeChange={onRangeChange}
            onStateChange={(snapshot) => onGridStateChange?.(snapshot)}
            onScrollTopChange={(scrollTop) => onGridScrollTopChange?.(scrollTop)}
            onSelect={onSelect}
          />
        </Suspense>
      ) : null}
      {catalog.total > 0 && viewUsesMosaicGrid(viewMode) ? (
        <Suspense fallback={<div className="h-72 animate-pulse bg-muted/30" aria-label="正在加载自由缩略图视图" />}>
          <FolderMosaicWorkspace
            key={virtualKey}
            virtualKey={virtualKey}
            mosaicRef={mosaicRef}
            catalog={catalog}
            disabled={disabled}
            selectedPaths={selectedPaths}
            focusedIndex={focusedIndex}
            itemIdPrefix={itemIdPrefix}
            thumbnailStore={thumbnailStore}
            thumbnailProbeEnabled={viewSpec.thumbnailProbeEnabled}
            tileSize={thumbnailPixelSize(config.thumbnailWidthPercent)}
            wrapTitle={viewSpec.wrapTitle}
            hoverPreviewEnabled={config.hoverPreviewEnabled}
            hoverPreviewDelayMs={config.hoverPreviewDelayMs}
            penetrationFiles={penetrationFiles}
            deleteMode={deletion.enabled}
            deleteStrategy={deletion.strategy}
            confirmDelete={deletion.confirm}
            showReturnFooter={showReturnFooter}
            returnFooterContext={returnFooterContext}
            restoreSnapshot={restoreState?.viewMode === viewMode ? restoreState.mosaicSnapshot : undefined}
            initialScrollTop={restoreState?.viewMode === viewMode ? restoreState.mosaicScrollTop : undefined}
            initialIndex={shouldLocateRestore && restoreState?.viewMode === viewMode && !restoreState.mosaicSnapshot ? restoreIndex : undefined}
            inlineBranchPath={inlineBranchPath}
            inlineBranch={inlineBranch}
            onRangeChange={onRangeChange}
            onScrollTopChange={(scrollTop) => onMosaicScrollTopChange?.(scrollTop)}
            onSelect={onSelect}
          />
        </Suspense>
      ) : null}
    </>
  )
}

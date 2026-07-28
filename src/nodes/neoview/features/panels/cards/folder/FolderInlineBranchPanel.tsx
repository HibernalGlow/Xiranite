import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { ChevronDown, FolderInput, SlidersHorizontal, X } from "lucide-react"
import { type ListRange, type VirtuosoGridHandle, type VirtuosoHandle } from "react-virtuoso"

import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import type { ReaderDirectoryEntryDto, ReaderDirectoryFilterDto, ReaderDirectorySortDto, ReaderFolderPenetrationConfig, ReaderFolderViewMode, ReaderFolderViewPatch, ReaderHttpClient } from "../../../../adapters/reader-http-client"
import {
  createDirectoryCatalog,
  FOLDER_MOSAIC_GROUP_SIZE,
  folderErrorMessage,
  mergeDirectoryPage,
  trimDirectoryPages,
  type DirectoryCatalog,
} from "./DirectoryCatalog"
import { createDirectorySelection, selectedLoadedDirectoryPaths } from "./DirectorySelection"
import { folderEntryName } from "./FolderDirectoryListItem"
import FolderEntryViewport from "./FolderEntryViewport"
import { folderEntryGridWidthPercent, type FolderEntryViewSpec } from "./FolderEntryViewSpec"
import { FolderInlineBranchLimitInputs } from "./FolderInlineBranchLimitFields"
import { useFolderSelectionController } from "./useFolderSelectionController"
import { useFolderThumbnailPipeline } from "./useFolderThumbnailPipeline"

const PAGE_SIZE = 128
const MAX_CACHED_PAGES = 6
const EMPTY_SELECTED_PATHS: ReadonlySet<string> = new Set()
const INLINE_BRANCH_HEADER_HEIGHT = 40
const INLINE_BRANCH_STATE_HEIGHT = 76
const INLINE_RETURN_FOOTER_CONTEXT = { disabled: true, onReturn: () => undefined }

export function inlineBranchViewportHeight(total: number, viewMode: ReaderFolderViewMode): number {
  const usesGrid = viewMode === "mosaic-list" || viewMode.endsWith("grid")
  const rowHeight = viewMode === "compact" ? 34 : viewMode === "details" ? 42 : viewMode === "mosaic-list" ? 96 : viewMode.endsWith("grid") ? 152 : 76
  const rows = usesGrid ? Math.ceil(Math.max(total, 1) / 3) : Math.max(total, 1)
  return INLINE_BRANCH_HEADER_HEIGHT + rows * rowHeight
}

function useInlineBranchAvailableHeight(path: string) {
  const panelRef = useRef<HTMLElement | null>(null)
  const [availableHeight, setAvailableHeight] = useState<number>()

  useLayoutEffect(() => {
    const panel = panelRef.current
    const host = panel?.closest<HTMLElement>("[data-neoview-folder-list]")
    if (!host) return

    const measure = () => {
      const height = Math.floor(host.getBoundingClientRect().height)
      if (height > 0) setAvailableHeight((current) => current === height ? current : height)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(host)
    measure()
    return () => observer.disconnect()
  }, [path])

  return { panelRef, availableHeight }
}

function useInlineBranchContentHeight(
  path: string,
  catalog: DirectoryCatalog | undefined,
  viewMode: ReaderFolderViewMode,
) {
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [contentHeight, setContentHeight] = useState<number>()

  useLayoutEffect(() => {
    const content = contentRef.current
    setContentHeight(undefined)
    if (!content || !catalog || catalog.total <= 0) return

    let frame = 0
    let observedList: HTMLElement | undefined
    const observer = new ResizeObserver(() => scheduleMeasure())
    const measure = () => {
      const itemList = content.querySelector<HTMLElement>('[data-testid="virtuoso-item-list"]')
      if (!itemList) return
      if (observedList !== itemList) {
        if (observedList) observer.unobserve(observedList)
        observedList = itemList
        observer.observe(itemList)
      }
      const items = Array.from(itemList.children).filter((item): item is HTMLElement => item instanceof HTMLElement)
      const expectedItems = viewMode === "mosaic-grid"
        ? Math.ceil(catalog.total / FOLDER_MOSAIC_GROUP_SIZE)
        : catalog.total
      const contentTop = content.getBoundingClientRect().top
      const renderedHeight = items.reduce(
        (maximum, item) => Math.max(maximum, item.getBoundingClientRect().bottom - contentTop),
        0,
      )
      const height = Math.ceil(items.length >= expectedItems && renderedHeight > 0
        ? renderedHeight
        : Math.max(itemList.scrollHeight, itemList.getBoundingClientRect().height))
      if (height > 0) setContentHeight((current) => current === height ? current : height)
    }
    const scheduleMeasure = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    const mutations = new MutationObserver(scheduleMeasure)
    observer.observe(content)
    mutations.observe(content, { childList: true, subtree: true })
    scheduleMeasure()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      mutations.disconnect()
    }
  }, [catalog?.generation, catalog?.sessionId, catalog?.total, path, viewMode])

  return { contentRef, contentHeight }
}

export default function FolderInlineBranchPanel({
  client,
  path,
  filter,
  sort,
  showHiddenFolders,
  hideMissingEfuEntries,
  penetration,
  viewSpec,
  disabled,
  onActivate,
  onEnterDirectory,
  onUpdateView,
  onClose,
}: {
  client: ReaderHttpClient
  path: string
  filter: ReaderDirectoryFilterDto
  sort: ReaderDirectorySortDto
  showHiddenFolders: boolean
  hideMissingEfuEntries: boolean
  penetration: ReaderFolderPenetrationConfig
  viewSpec: FolderEntryViewSpec
  disabled: boolean
  onActivate(
    entry: Pick<ReaderDirectoryEntryDto, "kind" | "name" | "path" | "readerSupported">,
    rawDirectory?: boolean,
  ): void
  onEnterDirectory(entry: Pick<ReaderDirectoryEntryDto, "path">): void
  onUpdateView(patch: ReaderFolderViewPatch["folderView"]): void
  onClose(): void
}) {
  const { config, selection: interaction } = viewSpec
  const { viewMode } = config
  const { panelRef, availableHeight } = useInlineBranchAvailableHeight(path)
  const catalogRef = useRef<DirectoryCatalog>()
  const listRef = useRef<VirtuosoHandle>(null)
  const gridRef = useRef<VirtuosoGridHandle>(null)
  const mosaicRef = useRef<VirtuosoHandle>(null)
  const pendingCursorsRef = useRef(new Set<number>())
  const listingRequestRef = useRef<AbortController>()
  const visibleRangeRef = useRef<ListRange>({ startIndex: 0, endIndex: PAGE_SIZE - 1 })
  const [catalog, setCatalog] = useState<DirectoryCatalog>()
  const [error, setError] = useState<string>()
  const { contentRef, contentHeight } = useInlineBranchContentHeight(path, catalog, viewMode)
  const selectionController = useFolderSelectionController({
    catalog,
    catalogRef,
    viewMode,
    penetrationEnabled: penetration.enabled,
    listRef,
    gridRef,
    mosaicRef,
    interaction,
    activate: onActivate,
  })
  const {
    selection: branchSelection,
    setSelection: setBranchSelection,
    focusedIndex: branchFocusedIndex,
    selectEntry: selectBranchEntry,
    chainAnchorIndexRef: branchChainAnchorIndexRef,
  } = selectionController
  const selectedPaths = useMemo(
    () => catalog ? selectedLoadedDirectoryPaths(branchSelection, catalog.pages) : EMPTY_SELECTED_PATHS,
    [branchSelection, catalog],
  )
  const thumbnailPipeline = useFolderThumbnailPipeline({
    client,
    catalog,
    catalogRef,
    thumbnailsVisible: viewSpec.thumbnailProbeEnabled,
    viewMode,
    previewGridEnabled: config.previewGridEnabled ?? false,
    previewCount: config.previewCount,
    visibleRangeRef,
    selectedPaths,
  })
  const thumbnailPipelineRef = useRef(thumbnailPipeline)
  thumbnailPipelineRef.current = thumbnailPipeline

  useEffect(() => {
    if (interaction.multiSelectMode) return
    branchChainAnchorIndexRef.current = undefined
    setBranchSelection(createDirectorySelection(catalog?.generation ?? 0))
  }, [branchChainAnchorIndexRef, catalog?.generation, interaction.multiSelectMode, setBranchSelection])

  useEffect(() => {
    const controller = new AbortController()
    let sessionId: string | undefined
    listingRequestRef.current = controller
    pendingCursorsRef.current.clear()
    catalogRef.current = undefined
    setCatalog(undefined)
    setBranchSelection(createDirectorySelection(0))
    setError(undefined)
    if (!client.openDirectoryBrowser) {
      setError("当前后端不支持展开文件夹")
      return () => controller.abort()
    }
    void client.openDirectoryBrowser(path, controller.signal, `folder-inline-branch:${path}`).then(async (initial) => {
      if (!initial) return
      sessionId = initial.sessionId
      if (controller.signal.aborted) {
        void client.closeDirectoryBrowser?.(sessionId).catch(() => undefined)
        return
      }
      let page = initial
      if (client.filterDirectoryBrowser) {
        page = await client.filterDirectoryBrowser(page.sessionId, filter, undefined, controller.signal, showHiddenFolders, hideMissingEfuEntries)
      }
      if (client.sortDirectoryBrowser) page = await client.sortDirectoryBrowser(page.sessionId, sort, undefined, controller.signal)
      if (controller.signal.aborted) return
      const next = createDirectoryCatalog(page)
      catalogRef.current = next
      setCatalog(next)
    }).catch((cause) => {
      if (!controller.signal.aborted) setError(`无法展开文件夹：${folderErrorMessage(cause)}`)
    })
    return () => {
      controller.abort()
      if (listingRequestRef.current === controller) listingRequestRef.current = undefined
      catalogRef.current = undefined
      thumbnailPipelineRef.current.releaseContext()
      if (sessionId) void client.closeDirectoryBrowser?.(sessionId).catch(() => undefined)
    }
  }, [client, filter, hideMissingEfuEntries, path, setBranchSelection, showHiddenFolders, sort])

  function requestRange(range: ListRange): void {
    const current = catalogRef.current
    if (!current || !client.listDirectoryBrowser) return
    visibleRangeRef.current = range
    const requestController = listingRequestRef.current
    const start = Math.floor(range.startIndex / PAGE_SIZE) * PAGE_SIZE
    const end = Math.min(current.total - 1, range.endIndex)
    for (let cursor = start; cursor <= end; cursor += PAGE_SIZE) {
      if (current.pages.has(cursor) || pendingCursorsRef.current.has(cursor)) continue
      pendingCursorsRef.current.add(cursor)
      void client.listDirectoryBrowser(current.sessionId, cursor, PAGE_SIZE, requestController?.signal).then((page) => {
        const previous = catalogRef.current
        if (requestController?.signal.aborted || !previous) return
        const next = trimDirectoryPages(mergeDirectoryPage(previous, page), range.startIndex, MAX_CACHED_PAGES)
        catalogRef.current = next
        setCatalog(next)
        queueMicrotask(thumbnailPipeline.registerVisible)
      }).catch((cause) => {
        if (!requestController?.signal.aborted) setError(`无法读取展开内容：${folderErrorMessage(cause)}`)
      }).finally(() => pendingCursorsRef.current.delete(cursor))
    }
  }

  const naturalHeight = catalog?.total && catalog.total > 0
    ? contentHeight === undefined
      ? inlineBranchViewportHeight(catalog.total, viewMode)
      : INLINE_BRANCH_HEADER_HEIGHT + contentHeight
    : INLINE_BRANCH_HEADER_HEIGHT + INLINE_BRANCH_STATE_HEIGHT
  const height = availableHeight === undefined
    ? naturalHeight
    : Math.max(INLINE_BRANCH_HEADER_HEIGHT, Math.min(naturalHeight, availableHeight))
  return (
    <section
      ref={panelRef}
      className="flex shrink-0 flex-col border-t bg-muted/20"
      style={{
        height: `${height}px`,
        "--folder-grid-width": `${folderEntryGridWidthPercent(viewSpec)}%`,
      } as CSSProperties}
      data-folder-inline-branch="true"
      data-folder-inline-branch-path={path}
      data-folder-inline-view-mode={viewMode}
      data-folder-inline-content-width={config.contentWidthPercent}
      data-folder-inline-thumbnail-width={config.thumbnailWidthPercent}
      data-folder-inline-banner-width={config.bannerWidthPercent}
    >
      <header className="flex h-10 shrink-0 items-center gap-2 border-b bg-background/80 px-2">
        <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium" title={path}>展开：{folderEntryName(path)}</span>
        <FolderInlineBranchQuickLimits disabled={disabled} penetration={penetration} onUpdate={(patch) => onUpdateView({ penetration: patch })} />
        <Button type="button" variant="ghost" size="icon-sm" aria-label="进入此文件夹" title="进入此文件夹" disabled={disabled} onClick={() => onEnterDirectory({ path })}>
          <FolderInput className="size-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="收起文件夹" title="收起文件夹" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </header>
      <div ref={contentRef} className="min-h-0 flex-1" data-folder-inline-branch-content="true">
        {error ? <div className="grid h-full min-h-0 place-items-center px-3 text-xs text-destructive" role="status">{error}</div> : null}
        {!error && !catalog ? <div className="grid h-full min-h-0 place-items-center text-xs text-muted-foreground" role="status">正在展开文件夹...</div> : null}
        {!error && catalog?.total === 0 ? <div className="grid h-full min-h-0 place-items-center text-xs text-muted-foreground" role="status">此文件夹为空</div> : null}
        {!error && catalog && catalog.total > 0 ? (
          <FolderEntryViewport
            catalog={catalog} viewSpec={viewSpec}
            virtualKey={`inline:${catalog.sessionId}:${catalog.generation}:${viewMode}`}
            disabled={disabled} selectedPaths={selectedPaths} focusedIndex={branchFocusedIndex}
            itemIdPrefix={`folder-inline-${catalog.sessionId}`}
            thumbnailStore={thumbnailPipeline.thumbnailStore}
            listRef={listRef} gridRef={gridRef} mosaicRef={mosaicRef}
            showReturnFooter={false} returnFooterContext={INLINE_RETURN_FOOTER_CONTEXT}
            onRangeChange={requestRange}
            onDetailsLayoutChange={(details) => onUpdateView({ details })}
            onSelect={selectBranchEntry}
          />
        ) : null}
      </div>
    </section>
  )
}

function FolderInlineBranchQuickLimits({
  disabled,
  penetration,
  onUpdate,
}: {
  disabled: boolean
  penetration: ReaderFolderPenetrationConfig
  onUpdate(patch: Partial<ReaderFolderPenetrationConfig>): void
}) {
  const toggleDisabled = disabled || !penetration.enabled || !penetration.expandBranchesInline
  const inputsDisabled = toggleDisabled || !penetration.inlineBranchLimitsEnabled
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Switch
        size="sm"
        aria-label="启用就地展开上限"
        title="启用就地展开上限"
        checked={penetration.inlineBranchLimitsEnabled}
        disabled={toggleDisabled}
        onCheckedChange={(inlineBranchLimitsEnabled) => onUpdate({ inlineBranchLimitsEnabled })}
      />
      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="设置就地展开上限" title="设置就地展开上限" disabled={inputsDisabled}>
            <SlidersHorizontal className="size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-3">
          <div className="mb-2 text-xs font-medium">就地展开上限</div>
          <FolderInlineBranchLimitInputs
            idPrefix="folder-inline-drawer"
            penetration={penetration}
            disabled={inputsDisabled}
            onUpdate={onUpdate}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}

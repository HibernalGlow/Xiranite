import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react"
import { ChevronDown, FolderInput, SlidersHorizontal, X } from "lucide-react"
import { Virtuoso, VirtuosoGrid, type ListRange } from "react-virtuoso"

import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import type { ReaderDirectoryEntryDto, ReaderDirectoryFilterDto, ReaderDirectorySortDto, ReaderFolderPenetrationConfig, ReaderFolderViewMode, ReaderHttpClient } from "../../../../adapters/reader-http-client"
import {
  createDirectoryCatalog,
  directoryEntryAt,
  folderErrorMessage,
  mergeDirectoryPage,
  trimDirectoryPages,
  type DirectoryCatalog,
} from "./DirectoryCatalog"
import { DirectoryBannerItem, DirectoryGridItem } from "./FolderGridWorkspace"
import { DirectoryListItem, folderEntryName } from "./FolderDirectoryListItem"
import { FolderInlineBranchLimitInputs } from "./FolderInlineBranchLimitFields"
import type { FolderPreviewCount } from "./FolderBrowserState"
import { useFolderThumbnailPipeline } from "./useFolderThumbnailPipeline"

const PAGE_SIZE = 128
const MAX_CACHED_PAGES = 6
const EMPTY_SELECTED_PATHS: ReadonlySet<string> = new Set()
const INLINE_BRANCH_HEADER_HEIGHT = 40
const INLINE_BRANCH_STATE_HEIGHT = 76

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

export default function FolderInlineBranchPanel({
  client,
  path,
  viewMode,
  filter,
  sort,
  showHiddenFolders,
  hideMissingEfuEntries,
  previewGridEnabled,
  previewCount,
  penetration,
  disabled,
  onActivate,
  onEnterDirectory,
  onUpdatePenetration,
  onClose,
}: {
  client: ReaderHttpClient
  path: string
  viewMode: ReaderFolderViewMode
  filter: ReaderDirectoryFilterDto
  sort: ReaderDirectorySortDto
  showHiddenFolders: boolean
  hideMissingEfuEntries: boolean
  previewGridEnabled: boolean
  previewCount: FolderPreviewCount
  penetration: ReaderFolderPenetrationConfig
  disabled: boolean
  onActivate(entry: Pick<ReaderDirectoryEntryDto, "kind" | "name" | "path" | "readerSupported">): void
  onEnterDirectory(entry: Pick<ReaderDirectoryEntryDto, "path">): void
  onUpdatePenetration(patch: Partial<ReaderFolderPenetrationConfig>): void
  onClose(): void
}) {
  const { panelRef, availableHeight } = useInlineBranchAvailableHeight(path)
  const catalogRef = useRef<DirectoryCatalog>()
  const pendingCursorsRef = useRef(new Set<number>())
  const listingRequestRef = useRef<AbortController>()
  const visibleRangeRef = useRef<ListRange>({ startIndex: 0, endIndex: PAGE_SIZE - 1 })
  const [catalog, setCatalog] = useState<DirectoryCatalog>()
  const [selectedPath, setSelectedPath] = useState<string>()
  const [error, setError] = useState<string>()
  const thumbnailPipeline = useFolderThumbnailPipeline({
    client,
    catalog,
    catalogRef,
    thumbnailsVisible: true,
    viewMode,
    previewGridEnabled,
    previewCount,
    visibleRangeRef,
    selectedPaths: EMPTY_SELECTED_PATHS,
  })
  const thumbnailPipelineRef = useRef(thumbnailPipeline)
  thumbnailPipelineRef.current = thumbnailPipeline

  useEffect(() => {
    const controller = new AbortController()
    let sessionId: string | undefined
    listingRequestRef.current = controller
    pendingCursorsRef.current.clear()
    catalogRef.current = undefined
    setCatalog(undefined)
    setSelectedPath(undefined)
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
  }, [client, filter, hideMissingEfuEntries, path, showHiddenFolders, sort])

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

  function selectEntry(entry: ReaderDirectoryEntryDto, _index: number, _event: ReactMouseEvent): void {
    setSelectedPath(entry.path)
    if (entry.kind === "directory") onEnterDirectory(entry)
    else onActivate(entry)
  }

  const naturalHeight = catalog?.total && catalog.total > 0
    ? inlineBranchViewportHeight(catalog.total, viewMode)
    : INLINE_BRANCH_HEADER_HEIGHT + INLINE_BRANCH_STATE_HEIGHT
  const height = availableHeight === undefined
    ? naturalHeight
    : Math.max(INLINE_BRANCH_HEADER_HEIGHT, Math.min(naturalHeight, availableHeight))
  return (
    <section
      ref={panelRef}
      className="flex shrink-0 flex-col border-t bg-muted/20"
      style={{ height: `${height}px` }}
      data-folder-inline-branch="true"
      data-folder-inline-branch-path={path}
      data-folder-inline-view-mode={viewMode}
    >
      <header className="flex h-10 shrink-0 items-center gap-2 border-b bg-background/80 px-2">
        <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium" title={path}>展开：{folderEntryName(path)}</span>
        <FolderInlineBranchQuickLimits disabled={disabled} penetration={penetration} onUpdate={onUpdatePenetration} />
        <Button type="button" variant="ghost" size="icon-sm" aria-label="进入此文件夹" title="进入此文件夹" disabled={disabled} onClick={() => onEnterDirectory({ path })}>
          <FolderInput className="size-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="收起文件夹" title="收起文件夹" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </header>
      {error ? <div className="grid min-h-0 flex-1 place-items-center px-3 text-xs text-destructive" role="status">{error}</div> : null}
      {!error && !catalog ? <div className="grid min-h-0 flex-1 place-items-center text-xs text-muted-foreground" role="status">正在展开文件夹...</div> : null}
      {!error && catalog?.total === 0 ? <div className="grid min-h-0 flex-1 place-items-center text-xs text-muted-foreground" role="status">此文件夹为空</div> : null}
      {!error && catalog && catalog.total > 0 && viewMode === "details" ? (
        <InlineDetailsList catalog={catalog} disabled={disabled} selectedPath={selectedPath} onRangeChange={requestRange} onSelect={selectEntry} />
      ) : null}
      {!error && catalog && catalog.total > 0 && viewMode === "mosaic-list" ? (
        <VirtuosoGrid
          style={{ height: "100%" }}
          totalCount={catalog.total}
          listClassName="grid gap-1 overflow-hidden p-1 [grid-template-columns:repeat(auto-fill,minmax(max(var(--folder-grid-width),10rem),1fr))]"
          itemClassName="min-w-0"
          computeItemKey={(index) => directoryEntryAt(catalog, index)?.path ?? `${catalog.generation}:${index}`}
          rangeChanged={requestRange}
          itemContent={(index) => {
            const entry = directoryEntryAt(catalog, index)
            return <DirectoryBannerItem itemId={`folder-inline-${catalog.sessionId}-${index}`} entry={entry} index={index} disabled={disabled} selected={entry?.path === selectedPath} focused={false} showRating={false} showCollectTagCount={false} visualMode={viewMode} thumbnailStore={thumbnailPipeline.thumbnailStore} hoverPreviewEnabled={false} hoverPreviewDelayMs={500} onSelect={selectEntry} />
          }}
        />
      ) : null}
      {!error && catalog && catalog.total > 0 && viewMode.endsWith("grid") ? (
        <VirtuosoGrid
          style={{ height: "100%" }}
          totalCount={catalog.total}
          listClassName="grid gap-1 overflow-hidden p-1 [grid-template-columns:repeat(auto-fill,minmax(7rem,1fr))]"
          itemClassName="min-w-0"
          computeItemKey={(index) => directoryEntryAt(catalog, index)?.path ?? `${catalog.generation}:${index}`}
          rangeChanged={requestRange}
          itemContent={(index) => {
            const entry = directoryEntryAt(catalog, index)
            return <DirectoryGridItem itemId={`folder-inline-${catalog.sessionId}-${index}`} entry={entry} index={index} disabled={disabled} selected={entry?.path === selectedPath} focused={false} showRating={false} showCollectTagCount={false} visualMode={viewMode} thumbnailStore={thumbnailPipeline.thumbnailStore} hoverPreviewEnabled={false} hoverPreviewDelayMs={500} onSelect={selectEntry} />
          }}
        />
      ) : null}
      {!error && catalog && catalog.total > 0 && viewMode !== "details" && !viewMode.endsWith("grid") ? (
        <Virtuoso
          style={{ height: "100%" }}
          totalCount={catalog.total}
          fixedItemHeight={viewMode === "compact" ? 34 : 76}
          computeItemKey={(index) => directoryEntryAt(catalog, index)?.path ?? `${catalog.generation}:${index}`}
          rangeChanged={requestRange}
          itemContent={(index) => {
            const entry = directoryEntryAt(catalog, index)
            return <DirectoryListItem itemId={`folder-inline-${catalog.sessionId}-${index}`} entry={entry} index={index} disabled={disabled} selected={entry?.path === selectedPath} focused={false} showRating={false} showCollectTagCount={false} visualMode={viewMode} thumbnailStore={thumbnailPipeline.thumbnailStore} contentWidthPercent={35} hoverPreviewEnabled={false} hoverPreviewDelayMs={500} deleteMode={false} deleteStrategy="trash" confirmDelete onSelect={selectEntry} />
          }}
        />
      ) : null}
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

function InlineDetailsList({
  catalog,
  disabled,
  selectedPath,
  onRangeChange,
  onSelect,
}: {
  catalog: DirectoryCatalog
  disabled: boolean
  selectedPath?: string
  onRangeChange(range: ListRange): void
  onSelect(entry: ReaderDirectoryEntryDto, index: number, event: ReactMouseEvent): void
}) {
  return (
    <Virtuoso
      style={{ height: "100%" }}
      totalCount={catalog.total}
      fixedItemHeight={42}
      computeItemKey={(index) => directoryEntryAt(catalog, index)?.path ?? `${catalog.generation}:${index}`}
      rangeChanged={onRangeChange}
      itemContent={(index) => {
        const entry = directoryEntryAt(catalog, index)
        return entry ? <button type="button" className="grid h-[42px] w-full grid-cols-[minmax(8rem,1fr)_minmax(10rem,2fr)_5rem] items-center gap-2 border-b px-2 text-left text-xs hover:bg-muted aria-selected:bg-accent" aria-selected={entry.path === selectedPath} disabled={disabled} onClick={(event) => onSelect(entry, index, event)}><span className="truncate font-medium">{entry.name}</span><span className="truncate text-muted-foreground">{entry.path}</span><span className="truncate text-muted-foreground">{entry.kind === "directory" ? "文件夹" : "文件"}</span></button> : <div className="h-[42px] animate-pulse border-b bg-muted/30" />
      }}
    />
  )
}

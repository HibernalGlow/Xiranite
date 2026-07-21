import { BookmarkPlus, FolderOpen, ListPlus, Pencil, Star, Trash2, X } from "lucide-react"
import { lazy, Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import type { ReaderBookmarkDto, ReaderBookmarkListDto } from "../../../adapters/reader-http-client"
import { publishReaderLibraryMutation, subscribeReaderLibraryMutations } from "../../library/reader-library-mutations"
import { ReaderThumbnailSurface } from "../../thumbnails/ReaderThumbnailSurface"
import { useReaderLibraryThumbnails, type ReaderLibraryThumbnailItem } from "../../thumbnails/useReaderLibraryThumbnails"
import type { ReaderPanelContext } from "../registry"
import { formatLibraryTime, ReaderLibraryList } from "./ReaderLibraryList"
import { ReaderEntrySurface } from "./shared/ReaderEntrySurface"
import { readerEntryClickIntent } from "./shared/ReaderEntryInteraction"
import { readerLibraryListLayout, readerLibraryMediaClassName, readerLibrarySurfaceVariant, type ReaderLibraryViewMode } from "./shared/readerLibraryEntryLayout"
import { libraryItemFolderPath } from "./shared/libraryItemFolderPath"
import { openLibraryEntry } from "./shared/openLibraryEntry"
import { ReaderLibraryViewToolbar, type ReaderLibrarySort } from "./shared/ReaderLibraryViewToolbar"

type ListEditorState = { mode: "create" } | { mode: "edit"; list: ReaderBookmarkListDto }
type BookmarkViewMode = ReaderLibraryViewMode
type VisibleBookmarks = { listId: string; items: readonly ReaderBookmarkDto[] }

const LazyBookmarkContextActions = lazy(() => import("./bookmark/BookmarkContextActions"))

/**
 * @ast-prototype migration/neoview/frontend/tsx-scaffold/src/lib/cards/bookmark/BookmarkListCard.tsx
 */
export default function BookmarkListCard({ client, disabled, panelActive = true, panelVisible, onOpen, onBrowsePath, onActivateInFolderCard, onOpenInNewTab, session, sourcePath, systemActions, bookmarkListPreferences, onBookmarkListPreferences, folderView }: ReaderPanelContext) {
  const residentRef = useRef(panelActive)
  if (panelActive) residentRef.current = true
  const resident = residentRef.current
  const thumbnailsVisible = panelVisible ?? panelActive
  const [lists, setLists] = useState<readonly ReaderBookmarkListDto[]>([])
  const [listsReady, setListsReady] = useState(false)
  const [activeListId, setActiveListId] = useState(() => bookmarkListPreferences?.activeListId ?? "all")
  const [confirmedListId, setConfirmedListId] = useState(() => bookmarkListPreferences?.activeListId ?? "all")
  const [switchingList, setSwitchingList] = useState(false)
  const [revision, setRevision] = useState(0)
  const [actionError, setActionError] = useState<string>()
  const [visibleBookmarks, setVisibleBookmarks] = useState<VisibleBookmarks>(() => ({ listId: "all", items: [] }))
  const [loadedBookmarks, setLoadedBookmarks] = useState<readonly ReaderBookmarkDto[]>([])
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set())
  const [listEditor, setListEditor] = useState<ListEditorState>()
  const [listName, setListName] = useState("")
  const [listFavorite, setListFavorite] = useState(false)
  const [deleteList, setDeleteList] = useState<ReaderBookmarkListDto>()
  const [batchListsOpen, setBatchListsOpen] = useState(false)
  const [batchListIds, setBatchListIds] = useState<ReadonlySet<string>>(() => new Set(["default"]))
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false)
  const [viewMode, setViewMode] = useState<BookmarkViewMode>("compact")
  const [search, setSearch] = useState("")
  const deferredSearch = useDeferredValue(search)
  const [sort, setSort] = useState<ReaderLibrarySort>({ field: "date", order: "desc" })
  const [viewportWidth, setViewportWidth] = useState(320)
  const anchorIndexRef = useRef<number>()
  const listTabRefs = useRef(new Map<string, HTMLButtonElement>())
  const newListButtonRef = useRef<HTMLButtonElement>(null)
  const listLayout = useMemo(() => readerLibraryListLayout(viewMode, viewportWidth), [viewMode, viewportWidth])
  const handleViewportWidthChange = useCallback((width: number) => {
    setViewportWidth((current) => current === width ? current : width)
  }, [])
  function openBookmark(item: ReaderBookmarkDto) {
    return openLibraryEntry({
      client,
      path: item.source.path,
      kind: item.kind === "folder" ? "folder" : "file",
      name: item.name,
      penetration: folderView?.penetration,
      onOpen,
      onBrowsePath,
      onActivateInFolderCard,
      onError: (message) => setActionError(`无法穿透此文件夹：${message}`),
    })
  }
  const selectedBookmarks = useMemo(
    () => loadedBookmarks.filter((item) => selectedIds.has(item.id)),
    [loadedBookmarks, selectedIds],
  )
  const activeList = lists.find((list) => list.id === activeListId)
  const editableLists = lists.filter((list) => list.id !== "all" && list.id !== "favorites")
  const thumbnailItems = useMemo<readonly ReaderLibraryThumbnailItem[]>(() => !thumbnailsVisible || visibleBookmarks.listId !== activeListId ? [] : visibleBookmarks.items.map((item) => ({
    id: item.id,
    path: item.source.path,
    kind: item.kind,
    previewCount: item.kind === "folder" ? 4 : 1,
  })), [activeListId, thumbnailsVisible, visibleBookmarks])
  const thumbnails = useReaderLibraryThumbnails(client, `bookmark:${activeListId}`, thumbnailItems)
  const loadPage = useCallback((offset: number, limit: number, signal: AbortSignal) => {
    if (!resident) return Promise.resolve<readonly ReaderBookmarkDto[]>([])
    if (!client.listBookmarks) return Promise.reject(new Error("当前后端不支持书签"))
    return client.listBookmarks(offset, limit, activeListId, signal, { search: deferredSearch, sort })
  }, [activeListId, client, deferredSearch, resident, sort])

  useEffect(() => {
    if (!resident) return
    return subscribeReaderLibraryMutations(() => setRevision((value) => value + 1))
  }, [resident])

  useEffect(() => {
    if (!resident) {
      setLists([])
      setListsReady(false)
      return
    }
    if (!client.listBookmarkLists) return
    const controller = new AbortController()
    void client.listBookmarkLists(controller.signal).then((value) => {
      if (controller.signal.aborted) return
      const configured = onBookmarkListPreferences ? bookmarkListPreferences?.activeListId ?? "all" : confirmedListId
      const next = value.some((list) => list.id === configured) ? configured : "all"
      setLists(value)
      setActiveListId(next)
      setConfirmedListId(next)
      setVisibleBookmarks((current) => current.listId === next ? current : { listId: next, items: [] })
      setListsReady(true)
      if (next !== configured && onBookmarkListPreferences) {
        void onBookmarkListPreferences({ activeListId: next }).catch((error) => setActionError(errorMessage(error)))
      }
    }).catch((error) => {
      if (!controller.signal.aborted) setActionError(errorMessage(error))
    })
    return () => controller.abort()
  }, [client, resident, revision])

  useEffect(() => {
    if (!resident || !listsReady || !onBookmarkListPreferences) return
    const configured = bookmarkListPreferences?.activeListId ?? "all"
    const next = lists.some((list) => list.id === configured) ? configured : "all"
    setActiveListId(next)
    setConfirmedListId(next)
    setVisibleBookmarks((current) => current.listId === next ? current : { listId: next, items: [] })
    if (next !== configured) {
      void onBookmarkListPreferences({ activeListId: next }).catch((error) => setActionError(errorMessage(error)))
    }
  }, [bookmarkListPreferences?.activeListId, lists, listsReady, onBookmarkListPreferences, resident])

  const handleLoadedItems = useCallback((items: readonly ReaderBookmarkDto[]) => {
    setLoadedBookmarks(items)
    const available = new Set(items.map((item) => item.id))
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => available.has(id)))
      return sameSet(current, next) ? current : next
    })
  }, [])
  const handleVisibleItems = useCallback((items: readonly ReaderBookmarkDto[]) => {
    setVisibleBookmarks({ listId: activeListId, items })
  }, [activeListId])

  async function switchList(listId: string, failureFallback = confirmedListId): Promise<boolean> {
    if (listId === activeListId || switchingList) return true
    setVisibleBookmarks({ listId, items: [] })
    setActiveListId(listId)
    setSelectedIds(new Set())
    anchorIndexRef.current = undefined
    if (!onBookmarkListPreferences) {
      setConfirmedListId(listId)
      return true
    }
    setSwitchingList(true)
    setActionError(undefined)
    try {
      const updated = await onBookmarkListPreferences({ activeListId: listId })
      setActiveListId(updated.activeListId)
      setConfirmedListId(updated.activeListId)
      setVisibleBookmarks({ listId: updated.activeListId, items: [] })
      return true
    } catch (error) {
      setActiveListId(failureFallback)
      setConfirmedListId(failureFallback)
      setVisibleBookmarks({ listId: failureFallback, items: [] })
      setActionError(errorMessage(error))
      return false
    } finally {
      setSwitchingList(false)
    }
  }

  async function addCurrent() {
    if (!client.saveBookmark || !sourcePath) return
    await mutate(async () => {
      await client.saveBookmark!({
        source: { kind: "path", path: sourcePath },
        name: session?.book.displayName ?? fileName(sourcePath),
        starred: activeListId === "favorites",
        listIds: isSystemList(activeListId) ? [] : [activeListId],
      })
    })
  }

  function openCreateList() {
    setListName("")
    setListFavorite(false)
    setListEditor({ mode: "create" })
  }

  function openEditList(list: ReaderBookmarkListDto) {
    setListName(list.name)
    setListFavorite(list.isFavorite)
    setListEditor({ mode: "edit", list })
  }

  async function saveListEditor() {
    if (!client.saveBookmarkList || !listEditor || !listName.trim()) return
    const editing = listEditor.mode === "edit" ? listEditor.list : undefined
    const saved = await mutate(async () => {
      const list = await client.saveBookmarkList!({
        ...(editing ? { id: editing.id, createdAt: editing.createdAt } : {}),
        name: listName.trim(),
        isFavorite: listFavorite,
      })
      await switchList(list.id)
    })
    if (saved) setListEditor(undefined)
  }

  async function confirmDeleteList() {
    if (!client.removeBookmarkList || !deleteList || deleteList.system) return
    const deletedListId = deleteList.id
    const deleted = await mutate(async () => {
      await client.removeBookmarkList!(deletedListId)
      if (activeListId === deletedListId) await switchList("all", "all")
    })
    if (deleted) {
      setDeleteList(undefined)
      focusListAfterDelete()
    }
  }

  function focusListAfterDelete() {
    const focus = () => {
      (listTabRefs.current.get("all") ?? newListButtonRef.current)?.focus()
    }
    if (typeof window === "undefined") return
    if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(focus)
    else focus()
  }

  async function toggleStar(item: ReaderBookmarkDto) {
    if (!client.updateBookmark) return setActionError("当前后端不支持更新书签")
    await mutate(() => client.updateBookmark!(item.id, { starred: !item.starred }).then(() => undefined))
  }

  async function remove(item: ReaderBookmarkDto) {
    if (!client.removeBookmark) return
    await mutate(() => client.removeBookmark!(item.id))
  }

  function selectBookmark(item: ReaderBookmarkDto, index: number, event: Pick<MouseEvent, "ctrlKey" | "metaKey" | "shiftKey">) {
    setSelectedIds((current) => {
      if (event.shiftKey && anchorIndexRef.current !== undefined) {
        const start = Math.min(anchorIndexRef.current, index)
        const end = Math.max(anchorIndexRef.current, index)
        const next = event.ctrlKey || event.metaKey ? new Set(current) : new Set<string>()
        for (let cursor = start; cursor <= end; cursor += 1) {
          const candidate = loadedBookmarks[cursor]
          if (candidate) next.add(candidate.id)
        }
        return next
      }
      if (event.ctrlKey || event.metaKey) {
        const next = new Set(current)
        if (next.has(item.id)) next.delete(item.id)
        else next.add(item.id)
        return next
      }
      return new Set([item.id])
    })
    anchorIndexRef.current = index
  }

  function openBatchLists() {
    const defaultList = !isSystemList(activeListId) ? activeListId : "default"
    setBatchListIds(new Set([defaultList]))
    setBatchListsOpen(true)
  }

  async function addSelectionToLists() {
    if (!client.updateBookmarks || !selectedBookmarks.length || !batchListIds.size) return
    const updated = await mutate(async () => {
      await client.updateBookmarks!(selectedBookmarks.map((item) => ({
        id: item.id,
        listIds: [...new Set([...item.listIds, ...batchListIds])],
      })))
      setSelectedIds(new Set())
    })
    if (updated) setBatchListsOpen(false)
  }

  async function deleteSelection() {
    if (!client.removeBookmarks || !selectedIds.size) return
    const deleted = await mutate(async () => {
      await client.removeBookmarks!([...selectedIds])
      setSelectedIds(new Set())
    })
    if (deleted) setBatchDeleteOpen(false)
  }

  async function mutate(operation: () => Promise<void>): Promise<boolean> {
    try {
      setActionError(undefined)
      await operation()
      publishReaderLibraryMutation()
      return true
    } catch (error) {
      setActionError(errorMessage(error))
      return false
    }
  }

  if (!resident) {
    return (
      <div className="flex h-full min-h-0 w-full flex-1 flex-col gap-2" data-neoview-bookmark-card="true" data-bookmark-state="inactive" data-testid="bookmark-card">
        <div className="grid min-h-24 flex-1 place-items-center rounded border bg-background/60 px-3 py-4 text-center text-xs text-muted-foreground" data-bookmark-empty-shell="true">
          暂无书签
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col gap-2" data-neoview-bookmark-card="true" data-testid="bookmark-card" data-bookmark-state="ready" data-selection-count={selectedIds.size} data-bookmark-view-mode={viewMode} data-visible-bookmarks={visibleBookmarks.items.length} data-thumbnail-items={thumbnailItems.length}>
      <Suspense fallback={null}>
        <LazyBookmarkContextActions
          client={client}
          disabled={disabled}
          items={loadedBookmarks}
          copyText={systemActions?.copyText}
          onOpen={onOpen ? openBookmark : undefined}
          onBrowseFolder={onBrowsePath ? (item) => onBrowsePath(libraryItemFolderPath(item.source.path, item.kind === "folder")) : undefined}
          onOpenInNewTab={onOpenInNewTab ? (item) => onOpenInNewTab(libraryItemFolderPath(item.source.path, item.kind === "folder")) : undefined}
          onToggleStar={toggleStar}
          onReloadThumbnail={(item) => thumbnails.refresh(item.id)}
          onRemove={remove}
        />
      </Suspense>
      <div className="flex items-center gap-1">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-0.5" aria-label="书签列表">
          {lists.map((list) => (
            <button
              key={list.id}
              type="button"
              ref={(node) => {
                if (node) listTabRefs.current.set(list.id, node)
                else listTabRefs.current.delete(list.id)
              }}
              className={list.id === activeListId
                ? "h-7 shrink-0 rounded-full border border-primary/60 bg-primary/15 px-3 text-xs text-primary"
                : "h-7 shrink-0 rounded-full border border-border bg-background/80 px-3 text-xs hover:bg-accent"}
              aria-pressed={list.id === activeListId}
              disabled={disabled || switchingList}
              onClick={() => void switchList(list.id)}
            >
              {list.name}{list.isFavorite && !list.system ? <Star className="ml-1 inline size-3 fill-current" aria-label="收藏夹列表" /> : null}
            </button>
          ))}
        </div>
        <Button ref={newListButtonRef} type="button" size="icon-sm" variant="ghost" aria-label="新建书签列表" title="新建书签列表" disabled={disabled} onClick={openCreateList}><ListPlus /></Button>
        {activeList && !activeList.system ? <Button type="button" size="icon-sm" variant="ghost" aria-label="编辑当前书签列表" title="编辑当前书签列表" disabled={disabled} onClick={() => openEditList(activeList)}><Pencil /></Button> : null}
        <Button type="button" size="icon-sm" variant="ghost" aria-label="收藏当前书籍" title="收藏当前书籍" disabled={disabled || !sourcePath} onClick={() => void addCurrent()}><BookmarkPlus /></Button>
      </div>

      {selectedIds.size ? (
        <div className="flex min-w-0 items-center gap-1 rounded border bg-muted/30 px-2 py-1" aria-label="书签选择操作">
          <span className="mr-auto text-xs tabular-nums">已选 {selectedIds.size} 项</span>
          <Button type="button" size="icon-sm" variant="ghost" aria-label="添加所选书签到列表" title="添加到列表" disabled={disabled || !client.updateBookmarks} onClick={openBatchLists}><ListPlus /></Button>
          <Button type="button" size="icon-sm" variant="ghost" aria-label="删除所选书签" title="删除所选" disabled={disabled || !client.removeBookmarks} onClick={() => setBatchDeleteOpen(true)}><Trash2 /></Button>
          <Button type="button" size="icon-sm" variant="ghost" aria-label="取消书签选择" title="取消选择" onClick={() => setSelectedIds(new Set())}><X /></Button>
        </div>
      ) : null}

      {actionError ? <div role="alert" className="rounded bg-destructive/10 px-2 py-1 text-xs text-destructive">{actionError}</div> : null}
      {listsReady ? <ReaderLibraryList
        queryKey={`bookmarks:${activeListId}:${deferredSearch}:${sort.field}:${sort.order}`}
        revision={revision}
        loadPage={loadPage}
        emptyLabel="当前列表没有书签"
        refreshLabel="刷新书签"
        {...listLayout}
        toolbar={(
          <ReaderLibraryViewToolbar
            label="书签视图"
            value={viewMode}
            disabled={disabled}
            onValueChange={setViewMode}
            search={search}
            onSearchChange={setSearch}
            sort={sort}
            onSortChange={setSort}
          />
        )}
        onViewportWidthChange={handleViewportWidthChange}
        getItemKey={(item) => item.id}
        onVisibleItemsChange={handleVisibleItems}
        onItemsChange={handleLoadedItems}
        renderRow={(item, index) => (
          <BookmarkRow
            item={item}
            index={index}
            viewMode={viewMode}
            selected={selectedIds.has(item.id)}
            disabled={disabled}
            canOpen={Boolean(onOpen)}
            thumbnailUrl={thumbnails.urls.get(item.id)}
            thumbnailUrls={thumbnails.urlSets.get(item.id)}
            thumbnailLoading={thumbnails.loading}
            onSelect={selectBookmark}
            onOpen={() => void openBookmark(item)}
            onToggleStar={() => void toggleStar(item)}
            onRemove={() => void remove(item)}
          />
        )}
      /> : <div className="h-24 animate-pulse rounded bg-muted/35" aria-label="正在加载书签列表" />}

      <ListEditorDialog
        state={listEditor}
        name={listName}
        favorite={listFavorite}
        pending={disabled}
        onNameChange={setListName}
        onFavoriteChange={setListFavorite}
        onOpenChange={(open) => { if (!open) setListEditor(undefined) }}
        onSave={() => void saveListEditor()}
        onDelete={listEditor?.mode === "edit" ? () => { setDeleteList(listEditor.list); setListEditor(undefined) } : undefined}
      />

      <ConfirmDialog
        open={Boolean(deleteList)}
        title="删除书签列表"
        description={deleteList ? `删除“${deleteList.name}”并移除其成员关系？书签本身会保留。` : ""}
        confirmLabel="删除列表"
        onOpenChange={(open) => { if (!open) setDeleteList(undefined) }}
        onConfirm={() => void confirmDeleteList()}
      />

      <Dialog open={batchListsOpen} onOpenChange={setBatchListsOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>添加到书签列表</DialogTitle><DialogDescription>将 {selectedIds.size} 个所选项目加入一个或多个列表。</DialogDescription></DialogHeader>
          <div className="grid max-h-64 gap-2 overflow-auto" aria-label="目标书签列表">
            {editableLists.map((list) => (
              <label key={list.id} className="flex items-center gap-2 rounded border px-3 py-2 text-sm">
                <Checkbox checked={batchListIds.has(list.id)} onCheckedChange={(checked) => setBatchListIds((current) => toggleSet(current, list.id, checked === true))} />
                <span>{list.name}</span>
                {list.isFavorite ? <Star className="ml-auto size-3 fill-current text-amber-500" aria-label="收藏夹列表" /> : null}
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setBatchListsOpen(false)}>取消</Button>
            <Button type="button" disabled={!batchListIds.size || disabled} onClick={() => void addSelectionToLists()}>添加</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={batchDeleteOpen}
        title="删除所选书签"
        description={`从书签库删除 ${selectedIds.size} 个项目？此操作不会删除源文件。`}
        confirmLabel="删除书签"
        onOpenChange={setBatchDeleteOpen}
        onConfirm={() => void deleteSelection()}
      />
    </div>
  )
}

function BookmarkRow({
  item,
  index,
  viewMode,
  selected,
  disabled,
  canOpen,
  thumbnailUrl,
  thumbnailUrls,
  thumbnailLoading,
  onSelect,
  onOpen,
  onToggleStar,
  onRemove,
}: {
  item: ReaderBookmarkDto
  index: number
  viewMode: BookmarkViewMode
  selected: boolean
  disabled: boolean
  canOpen: boolean
  thumbnailUrl?: string
  thumbnailUrls?: readonly string[]
  thumbnailLoading: boolean
  onSelect(item: ReaderBookmarkDto, index: number, event: Pick<MouseEvent, "ctrlKey" | "metaKey" | "shiftKey">): void
  onOpen(): void
  onToggleStar(): void
  onRemove(): void
}) {
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Enter" && canOpen) {
      event.preventDefault()
      onOpen()
      return
    }
    if (event.key === " ") {
      event.preventDefault()
      onSelect(item, index, event)
      return
    }
    const targetIndex = event.key === "ArrowDown" ? index + 1
      : event.key === "ArrowUp" ? index - 1
        : event.key === "Home" ? 0
          : event.key === "End" ? Number.MAX_SAFE_INTEGER
            : undefined
    if (targetIndex === undefined) return
    event.preventDefault()
    const root = event.currentTarget.closest("[data-neoview-bookmark-card]")
    const rows = root?.querySelectorAll<HTMLButtonElement>("[data-bookmark-row-button]")
    if (!rows?.length) return
    rows[Math.min(Math.max(targetIndex, 0), rows.length - 1)]?.focus()
  }

  return (
    <ReaderEntrySurface
      variant={readerLibrarySurfaceVariant(viewMode)}
      selected={selected}
      data-context-menu="neoview-bookmark-entry"
      data-bookmark-context-id={item.id}
      data-bookmark-id={item.id}
      leading={viewMode === "compact" || viewMode === "cover-list" ? <Checkbox checked={selected} aria-label={`选择书签：${item.name}`} onCheckedChange={() => onSelect(item, index, { ctrlKey: true, metaKey: false, shiftKey: false })} /> : undefined}
      media={(
        <ReaderThumbnailSurface
          url={thumbnailUrl}
          urls={thumbnailUrls}
          kind={item.kind}
          fit="cover"
          loading={thumbnailLoading}
          className={readerLibraryMediaClassName(viewMode)}
        />
      )}
      primary={(
        <span className="flex min-w-0 items-center gap-1">
          <span className="min-w-0 flex-1 truncate">{item.name}</span>
          {item.starred ? <Star className="size-3 shrink-0 fill-current text-amber-500" aria-label="已收藏" /> : null}
        </span>
      )}
      secondary={viewMode === "cover-grid" ? undefined : <span title={item.source.path}>{item.source.path}</span>}
      tertiary={viewMode === "cover-list" || viewMode === "mosaic-list" ? `${item.kind === "folder" ? "文件夹" : "文件"} · ${formatLibraryTime(item.createdAt)}` : undefined}
      buttonProps={{
        title: item.source.path,
        "aria-pressed": selected,
        disabled,
        "data-bookmark-row-button": index,
        onClick: (event) => {
          if (readerEntryClickIntent(event) === "select") onSelect(item, index, event)
          else if (canOpen) onOpen()
        },
        onKeyDown: handleKeyDown,
      }}
      trailing={viewMode === "compact" || viewMode === "cover-list" ? (
        <span className="flex shrink-0 items-center">
          <Button type="button" size="icon-sm" variant="ghost" aria-label={`打开书签：${item.name}`} title="打开" disabled={disabled || !canOpen} onClick={onOpen}><FolderOpen /></Button>
          <Button type="button" size="icon-sm" variant="ghost" aria-label={`${item.starred ? "取消收藏" : "收藏"}：${item.name}`} title={item.starred ? "取消收藏" : "收藏"} disabled={disabled} onClick={onToggleStar}>
            <Star className={item.starred ? "fill-current text-amber-500" : undefined} />
          </Button>
          <Button type="button" size="icon-sm" variant="ghost" aria-label={`删除书签：${item.name}`} title="删除书签" disabled={disabled} onClick={onRemove}><Trash2 /></Button>
        </span>
      ) : undefined}
    />
  )
}

function ListEditorDialog({ state, name, favorite, pending, onNameChange, onFavoriteChange, onOpenChange, onSave, onDelete }: {
  state?: ListEditorState
  name: string
  favorite: boolean
  pending: boolean
  onNameChange(value: string): void
  onFavoriteChange(value: boolean): void
  onOpenChange(open: boolean): void
  onSave(): void
  onDelete?: () => void
}) {
  const editing = state?.mode === "edit"
  return (
    <Dialog open={Boolean(state)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{editing ? "编辑书签列表" : "新建书签列表"}</DialogTitle><DialogDescription>名称和收藏夹标记会在所有 Reader 界面中共享。</DialogDescription></DialogHeader>
        <label className="grid gap-1 text-sm"><span>列表名称</span><Input value={name} autoFocus onChange={(event) => onNameChange(event.target.value)} /></label>
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={favorite} onCheckedChange={(checked) => onFavoriteChange(checked === true)} /><span>收藏夹列表</span></label>
        <DialogFooter>
          {onDelete ? <Button type="button" variant="destructive" className="mr-auto" onClick={onDelete}>删除</Button> : null}
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button type="button" disabled={!name.trim() || pending} onClick={onSave}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ConfirmDialog({ open, title, description, confirmLabel, onOpenChange, onConfirm }: {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  onOpenChange(open: boolean): void
  onConfirm(): void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
        <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button type="button" variant="destructive" onClick={onConfirm}>{confirmLabel}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function toggleSet(current: ReadonlySet<string>, value: string, enabled: boolean): ReadonlySet<string> {
  const next = new Set(current)
  if (enabled) next.add(value)
  else next.delete(value)
  return next
}

function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value))
}

function isSystemList(id: string): boolean {
  return id === "all" || id === "default" || id === "favorites"
}

function fileName(path: string): string {
  return path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1) || path
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

import { BookmarkPlus, FolderOpen, ListPlus, Star, Trash2 } from "lucide-react"
import { useCallback, useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { ReaderBookmarkDto, ReaderBookmarkListDto } from "../../../adapters/reader-http-client"
import type { ReaderPanelContext } from "../registry"
import { formatLibraryTime, ReaderLibraryList } from "./ReaderLibraryList"

export default function BookmarkListCard({ client, disabled, onOpen, session, sourcePath }: ReaderPanelContext) {
  const [lists, setLists] = useState<readonly ReaderBookmarkListDto[]>([])
  const [activeListId, setActiveListId] = useState("all")
  const [revision, setRevision] = useState(0)
  const [actionError, setActionError] = useState<string | undefined>(undefined)
  const loadPage = useCallback((offset: number, limit: number, signal: AbortSignal) => {
    if (!client.listBookmarks) return Promise.reject(new Error("当前后端不支持书签"))
    return client.listBookmarks(offset, limit, activeListId, signal)
  }, [activeListId, client])

  useEffect(() => {
    if (!client.listBookmarkLists) return
    const controller = new AbortController()
    void client.listBookmarkLists(controller.signal).then(setLists).catch((error) => {
      if (!controller.signal.aborted) setActionError(error instanceof Error ? error.message : String(error))
    })
    return () => controller.abort()
  }, [client, revision])

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

  async function createList() {
    if (!client.saveBookmarkList) return
    const name = globalThis.prompt?.("书签列表名称")?.trim()
    if (!name) return
    await mutate(async () => {
      const list = await client.saveBookmarkList!({ name })
      setActiveListId(list.id)
    })
  }

  async function removeActiveList() {
    if (!client.removeBookmarkList || isSystemList(activeListId)) return
    await mutate(async () => {
      await client.removeBookmarkList!(activeListId)
      setActiveListId("all")
    })
  }

  async function toggleStar(item: ReaderBookmarkDto) {
    if (!client.saveBookmark) return
    await mutate(() => client.saveBookmark!({ ...item, starred: !item.starred }).then(() => undefined))
  }

  async function remove(item: ReaderBookmarkDto) {
    if (!client.removeBookmark) return
    await mutate(() => client.removeBookmark!(item.id))
  }

  async function mutate(operation: () => Promise<void>) {
    try {
      setActionError(undefined)
      await operation()
      setRevision((value) => value + 1)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div className="grid min-h-0 gap-2" data-neoview-bookmark-card="true">
      <div className="flex items-center gap-1">
        <Select value={activeListId} onValueChange={setActiveListId}>
          <SelectTrigger size="sm" className="min-w-0 flex-1" aria-label="书签列表"><SelectValue /></SelectTrigger>
          <SelectContent>
            {lists.map((list) => <SelectItem key={list.id} value={list.id}>{list.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button type="button" size="icon-sm" variant="ghost" aria-label="新建书签列表" title="新建书签列表" disabled={disabled} onClick={() => void createList()}><ListPlus /></Button>
        {!isSystemList(activeListId) ? <Button type="button" size="icon-sm" variant="ghost" aria-label="删除当前书签列表" title="删除当前书签列表" disabled={disabled} onClick={() => void removeActiveList()}><Trash2 /></Button> : null}
        <Button type="button" size="icon-sm" variant="ghost" aria-label="收藏当前书籍" title="收藏当前书籍" disabled={disabled || !sourcePath} onClick={() => void addCurrent()}><BookmarkPlus /></Button>
      </div>
      {actionError ? <div role="alert" className="rounded bg-destructive/10 px-2 py-1 text-xs text-destructive">{actionError}</div> : null}
      <ReaderLibraryList
        queryKey={`bookmarks:${activeListId}`}
        revision={revision}
        loadPage={loadPage}
        emptyLabel="当前列表没有书签"
        refreshLabel="刷新书签"
        renderRow={(item) => (
          <div className="flex h-full min-w-0 items-center gap-1 px-1">
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1 text-left hover:bg-muted disabled:opacity-50"
              title={item.source.path}
              disabled={disabled || !onOpen}
              onClick={() => void onOpen?.(item.source.path)}
            >
              <FolderOpen className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs">{item.name}</span>
                <span className="block truncate text-[10px] text-muted-foreground">{item.kind === "folder" ? "文件夹" : "文件"} · {formatLibraryTime(item.updatedAt)}</span>
              </span>
            </button>
            <Button type="button" size="icon-sm" variant="ghost" aria-label={`${item.starred ? "取消收藏" : "收藏"}：${item.name}`} title={item.starred ? "取消收藏" : "收藏"} disabled={disabled} onClick={() => void toggleStar(item)}>
              <Star className={item.starred ? "fill-current text-amber-500" : undefined} />
            </Button>
            <Button type="button" size="icon-sm" variant="ghost" aria-label={`删除书签：${item.name}`} title="删除书签" disabled={disabled} onClick={() => void remove(item)}><Trash2 /></Button>
          </div>
        )}
      />
    </div>
  )
}

function isSystemList(id: string): boolean {
  return id === "all" || id === "default" || id === "favorites"
}

function fileName(path: string): string {
  return path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1) || path
}

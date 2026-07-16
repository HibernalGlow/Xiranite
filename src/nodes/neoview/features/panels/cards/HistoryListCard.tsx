import { BookOpen, Trash2, X } from "lucide-react"
import { useCallback, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import type { ReaderRecentDto } from "../../../adapters/reader-http-client"
import { ReaderThumbnailSurface } from "../../thumbnails/ReaderThumbnailSurface"
import { useReaderLibraryThumbnails, type ReaderLibraryThumbnailItem } from "../../thumbnails/useReaderLibraryThumbnails"
import type { ReaderPanelContext } from "../registry"
import { formatLibraryTime, ReaderLibraryList } from "./ReaderLibraryList"

interface PendingDelete {
  ids: readonly string[]
  batch: boolean
}

export default function HistoryListCard({ client, disabled, onOpen }: ReaderPanelContext) {
  const [revision, setRevision] = useState(0)
  const [actionError, setActionError] = useState<string>()
  const [loadedRecents, setLoadedRecents] = useState<readonly ReaderRecentDto[]>([])
  const [visibleRecents, setVisibleRecents] = useState<readonly ReaderRecentDto[]>([])
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set())
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>()
  const anchorIndexRef = useRef<number>()
  const thumbnailItems = useMemo<readonly ReaderLibraryThumbnailItem[]>(() => visibleRecents.map((item) => ({
    id: item.bookId,
    path: item.source.path,
    kind: item.source.kind === "directory" ? "folder" : "file",
    previewCount: item.source.kind === "directory" ? 4 : 1,
  })), [visibleRecents])
  const thumbnails = useReaderLibraryThumbnails(client, "history", thumbnailItems)

  const loadPage = useCallback((offset: number, limit: number, signal: AbortSignal) => {
    if (!client.listRecent) return Promise.reject(new Error("当前后端不支持历史记录"))
    return client.listRecent(offset, limit, signal)
  }, [client])

  const handleLoadedItems = useCallback((items: readonly ReaderRecentDto[]) => {
    setLoadedRecents(items)
    const available = new Set(items.map((item) => item.bookId))
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => available.has(id)))
      return sameSet(current, next) ? current : next
    })
  }, [])

  function selectRecent(item: ReaderRecentDto, index: number, event: Pick<MouseEvent, "ctrlKey" | "metaKey" | "shiftKey">) {
    setSelectedIds((current) => {
      if (event.shiftKey && anchorIndexRef.current !== undefined) {
        const start = Math.min(anchorIndexRef.current, index)
        const end = Math.max(anchorIndexRef.current, index)
        const next = event.ctrlKey || event.metaKey ? new Set(current) : new Set<string>()
        for (let cursor = start; cursor <= end; cursor += 1) {
          const candidate = loadedRecents[cursor]
          if (candidate) next.add(candidate.bookId)
        }
        return next
      }
      if (event.ctrlKey || event.metaKey) {
        const next = new Set(current)
        if (next.has(item.bookId)) next.delete(item.bookId)
        else next.add(item.bookId)
        return next
      }
      return new Set([item.bookId])
    })
    anchorIndexRef.current = index
  }

  async function confirmDelete() {
    if (!pendingDelete?.ids.length) return
    const removed = await mutate(async () => {
      if (pendingDelete.batch) {
        if (!client.removeRecents) throw new Error("当前后端不支持批量删除历史记录")
        await client.removeRecents(pendingDelete.ids)
      } else {
        if (!client.removeRecent) throw new Error("当前后端不支持删除历史记录")
        await client.removeRecent(pendingDelete.ids[0]!)
      }
      setSelectedIds((current) => new Set([...current].filter((id) => !pendingDelete.ids.includes(id))))
    })
    if (removed) setPendingDelete(undefined)
  }

  async function mutate(operation: () => Promise<void>): Promise<boolean> {
    try {
      setActionError(undefined)
      await operation()
      setRevision((value) => value + 1)
      return true
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
      return false
    }
  }

  return (
    <div className="grid min-h-0 gap-2" data-neoview-history-card="true" data-selection-count={selectedIds.size}>
      {selectedIds.size ? (
        <div className="flex min-w-0 items-center gap-1 rounded border bg-muted/30 px-2 py-1" aria-label="历史记录选择操作">
          <span className="mr-auto text-xs tabular-nums">已选 {selectedIds.size} 项</span>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="删除所选历史记录"
            title="删除所选"
            disabled={disabled || !client.removeRecents}
            onClick={() => setPendingDelete({ ids: [...selectedIds], batch: true })}
          >
            <Trash2 />
          </Button>
          <Button type="button" size="icon-sm" variant="ghost" aria-label="取消历史记录选择" title="取消选择" onClick={() => setSelectedIds(new Set())}><X /></Button>
        </div>
      ) : null}
      {actionError ? <div role="alert" className="rounded bg-destructive/10 px-2 py-1 text-xs text-destructive">{actionError}</div> : null}
      <ReaderLibraryList
        queryKey="history"
        revision={revision}
        loadPage={loadPage}
        emptyLabel="暂无阅读历史"
        refreshLabel="刷新历史记录"
        itemSize={76}
        getItemKey={(item) => item.bookId}
        onVisibleItemsChange={setVisibleRecents}
        onItemsChange={handleLoadedItems}
        renderRow={(item, index) => (
          <HistoryRow
            item={item}
            index={index}
            selected={selectedIds.has(item.bookId)}
            disabled={disabled}
            canOpen={Boolean(onOpen)}
            thumbnailUrl={thumbnails.urls.get(item.bookId)}
            thumbnailLoading={thumbnails.loading}
            onSelect={selectRecent}
            onOpen={() => void onOpen?.(item.source.path)}
            onRemove={() => setPendingDelete({ ids: [item.bookId], batch: false })}
          />
        )}
      />

      <Dialog open={Boolean(pendingDelete)} onOpenChange={(open) => { if (!open) setPendingDelete(undefined) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{pendingDelete?.batch ? "删除所选历史记录" : "删除历史记录"}</DialogTitle>
            <DialogDescription>从阅读历史中移除 {pendingDelete?.ids.length ?? 0} 个项目？源文件不会被删除。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPendingDelete(undefined)}>取消</Button>
            <Button type="button" variant="destructive" disabled={disabled} onClick={() => void confirmDelete()}>删除历史</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function HistoryRow({ item, index, selected, disabled, canOpen, thumbnailUrl, thumbnailLoading, onSelect, onOpen, onRemove }: {
  item: ReaderRecentDto
  index: number
  selected: boolean
  disabled: boolean
  canOpen: boolean
  thumbnailUrl?: string
  thumbnailLoading: boolean
  onSelect(item: ReaderRecentDto, index: number, event: Pick<MouseEvent, "ctrlKey" | "metaKey" | "shiftKey">): void
  onOpen(): void
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
    const root = event.currentTarget.closest("[data-neoview-history-card]")
    const rows = root?.querySelectorAll<HTMLButtonElement>("[data-history-row-button]")
    if (!rows?.length) return
    rows[Math.min(Math.max(targetIndex, 0), rows.length - 1)]?.focus()
  }

  const progressPage = Math.min(item.pageIndex + 1, item.pageCount)
  const kind = item.source.kind === "directory" ? "folder" : "file"
  return (
    <div className={cn("flex h-full min-w-0 items-center gap-1 px-1 hover:bg-muted/70", selected && "bg-primary/10")} data-history-id={item.bookId} data-selected={selected}>
      <Checkbox checked={selected} aria-label={`选择历史记录：${item.displayName}`} onCheckedChange={() => onSelect(item, index, { ctrlKey: true, metaKey: false, shiftKey: false })} />
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        title={item.source.path}
        aria-pressed={selected}
        disabled={disabled}
        data-history-row-button={index}
        onClick={(event) => onSelect(item, index, event)}
        onDoubleClick={canOpen ? onOpen : undefined}
        onKeyDown={handleKeyDown}
      >
        <ReaderThumbnailSurface url={thumbnailUrl} kind={kind} fit="cover" loading={thumbnailLoading} className="size-16" />
        <span className="grid min-w-0 flex-1 gap-1">
          <span className="block truncate text-xs">{item.displayName}</span>
          <span className="block truncate text-[10px] text-muted-foreground" title={item.source.path}>{item.source.path}</span>
          <span className="block truncate text-[10px] tabular-nums text-muted-foreground">第 {progressPage} / {item.pageCount} 页 · {formatLibraryTime(item.updatedAt)}</span>
        </span>
      </button>
      <Button type="button" size="icon-sm" variant="ghost" aria-label={`继续阅读：${item.displayName}`} title="继续阅读" disabled={disabled || !canOpen} onClick={onOpen}><BookOpen /></Button>
      <Button type="button" size="icon-sm" variant="ghost" aria-label={`删除历史：${item.displayName}`} title="删除历史" disabled={disabled} onClick={onRemove}><Trash2 /></Button>
    </div>
  )
}

function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value))
}

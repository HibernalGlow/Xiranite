import { BookOpen, Trash2 } from "lucide-react"
import { useCallback, useState } from "react"

import { Button } from "@/components/ui/button"
import type { ReaderRecentDto } from "../../../adapters/reader-http-client"
import type { ReaderPanelContext } from "../registry"
import { formatLibraryTime, ReaderLibraryList } from "./ReaderLibraryList"

export default function HistoryListCard({ client, disabled, onOpen }: ReaderPanelContext) {
  const [revision, setRevision] = useState(0)
  const [actionError, setActionError] = useState<string | undefined>(undefined)
  const loadPage = useCallback((offset: number, limit: number, signal: AbortSignal) => {
    if (!client.listRecent) return Promise.reject(new Error("当前后端不支持历史记录"))
    return client.listRecent(offset, limit, signal)
  }, [client])

  async function remove(item: ReaderRecentDto) {
    if (!client.removeRecent) return
    try {
      setActionError(undefined)
      await client.removeRecent(item.bookId)
      setRevision((value) => value + 1)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div className="grid min-h-0 gap-2">
      {actionError ? <div role="alert" className="rounded bg-destructive/10 px-2 py-1 text-xs text-destructive">{actionError}</div> : null}
      <ReaderLibraryList
        queryKey="history"
        revision={revision}
        loadPage={loadPage}
        emptyLabel="暂无阅读历史"
        refreshLabel="刷新历史记录"
        renderRow={(item) => (
          <div className="flex h-full min-w-0 items-center gap-1 px-1">
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1 text-left hover:bg-muted disabled:opacity-50"
              title={item.source.path}
              disabled={disabled || !onOpen}
              onClick={() => void onOpen?.(item.source.path)}
            >
              <BookOpen className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs">{item.displayName}</span>
                <span className="block truncate text-[10px] tabular-nums text-muted-foreground">
                  第 {Math.min(item.pageIndex + 1, item.pageCount)} / {item.pageCount} 页 · {formatLibraryTime(item.updatedAt)}
                </span>
              </span>
            </button>
            <Button type="button" size="icon-sm" variant="ghost" aria-label={`删除历史：${item.displayName}`} title="删除历史" disabled={disabled} onClick={() => void remove(item)}>
              <Trash2 />
            </Button>
          </div>
        )}
      />
    </div>
  )
}

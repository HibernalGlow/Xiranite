/**
 * @migrated-from src/lib/cards/properties/FolderRatingsCard.svelte
 * @ast-prototype migration/neoview/frontend/tsx-scaffold/src/lib/cards/properties/FolderRatingsCard.tsx
 * @migration-status adapted
 */
import { RefreshCw, Star } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import type { ReaderDirectoryEntryDto } from "../../../adapters/reader-http-client"
import type { ReaderPanelContext } from "../registry"
import { ReaderCardEmptyState } from "./ReaderCardEmptyState"
import { useReaderMetadata } from "./useReaderMetadata"

const MAX_RATING_ENTRIES = 2_048

export default function FolderRatingsCard({ session, client, panelActive = true }: ReaderPanelContext) {
  if (!panelActive) return <ReaderCardEmptyState />
  if (!session) return <ReaderCardEmptyState>打开书籍后统计所在目录评分</ReaderCardEmptyState>
  return <FolderRatingsContent sessionId={session.sessionId} client={client} />
}

function FolderRatingsContent({ sessionId, client }: { sessionId: string; client: ReaderPanelContext["client"] }) {
  const metadata = useReaderMetadata(client, sessionId, 0)
  const sourcePath = metadata.value?.book.sourcePath
  const sourceKind = metadata.value?.book.sourceKind
  const directory = useMemo(() => !sourcePath ? "" : sourceKind === "directory" ? sourcePath : parentPath(sourcePath), [sourceKind, sourcePath])
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<{ loading: boolean; entries: readonly ReaderDirectoryEntryDto[]; truncated: boolean; error?: string }>({ loading: true, entries: [], truncated: false })
  useEffect(() => {
    if (!directory) return
    const controller = new AbortController()
    let browserSession: string | undefined
    setState((current) => ({ loading: true, entries: current.entries, truncated: false }))
    void (async () => {
      if (!directory || !client.openDirectoryBrowser || !client.listDirectoryBrowser) throw new Error("当前后端不支持目录评分统计。")
      const opened = await client.openDirectoryBrowser(directory, controller.signal, "emm-folder-ratings", false)
      browserSession = opened.sessionId
      const entries: ReaderDirectoryEntryDto[] = []
      let cursor = 0
      let next: number | undefined = 0
      while (next !== undefined && entries.length < MAX_RATING_ENTRIES) {
        const page = await client.listDirectoryBrowser(opened.sessionId, cursor, 256, controller.signal, ["rating"])
        entries.push(...page.entries)
        next = page.nextCursor
        cursor = next ?? cursor
      }
      if (!controller.signal.aborted) setState({ loading: false, entries, truncated: next !== undefined })
    })().catch((error) => { if (!controller.signal.aborted) setState({ loading: false, entries: [], truncated: false, error: error instanceof Error ? error.message : String(error) }) }).finally(() => {
      if (browserSession) void client.closeDirectoryBrowser?.(browserSession).catch(() => undefined)
    })
    return () => controller.abort()
  }, [client, directory, revision])
  const ratings = state.entries.flatMap((entry) => Number.isFinite(entry.rating) ? [entry.rating!] : [])
  const average = ratings.length ? ratings.reduce((sum, value) => sum + value, 0) / ratings.length : undefined
  if (metadata.error) return <div role="alert" className="py-4 text-center text-[11px] text-destructive">{metadata.error}</div>
  if (metadata.loading) return <div className="h-20 animate-pulse rounded bg-muted" aria-label="正在读取书籍路径" />
  if (state.loading && !state.entries.length) return <div className="h-20 animate-pulse rounded bg-muted" aria-label="正在统计文件夹评分" />
  if (state.error) return <div role="alert" className="grid min-h-20 justify-items-center gap-2 text-center text-[11px] text-destructive"><span>{state.error}</span><Button size="sm" variant="outline" onClick={() => setRevision((value) => value + 1)}>重试</Button></div>
  return (
    <div className="space-y-3 text-[11px]" data-folder-ratings-card="true">
      <div className="flex items-center gap-2 rounded border bg-muted/30 p-2.5"><Star className="size-4 fill-amber-400 text-amber-500" /><div><p className="font-medium">{average === undefined ? "暂无评分" : average.toFixed(2)}</p><p className="text-[10px] text-muted-foreground">{ratings.length} / {state.entries.length} 个条目有 EMM 评分{state.truncated ? "（已达 2048 项上限）" : ""}</p></div></div>
      <Button type="button" size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => setRevision((value) => value + 1)}><RefreshCw data-icon="inline-start" />重新统计</Button>
    </div>
  )
}

function parentPath(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/, "")
  const separator = normalized.lastIndexOf("/")
  return separator > 0 ? normalized.slice(0, separator) : normalized
}

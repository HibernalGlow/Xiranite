/** @migrated-from src/lib/cards/properties/FavoriteTagsCard.svelte */
import { RefreshCw, Star } from "lucide-react"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import type { ReaderEmmTagSuggestionDto } from "../../../adapters/reader-http-client"
import type { ReaderPanelContext } from "../registry"
import { ReaderCardEmptyState } from "./ReaderCardEmptyState"

export default function FavoriteTagsCard({ client, panelActive = true }: ReaderPanelContext) {
  if (!panelActive) return <ReaderCardEmptyState />
  return <FavoriteTagsContent client={client} />
}

function FavoriteTagsContent({ client }: { client: ReaderPanelContext["client"] }) {
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<{ loading: boolean; tags: readonly ReaderEmmTagSuggestionDto[]; error?: string }>({ loading: true, tags: [] })
  useEffect(() => {
    const controller = new AbortController()
    setState((current) => ({ loading: true, tags: current.tags }))
    const request = client.suggestDirectoryEmmTags
      ? client.suggestDirectoryEmmTags(32, controller.signal)
      : Promise.reject(new Error("当前后端不支持 EMM 标签建议。"))
    void request.then((tags) => { if (!controller.signal.aborted) setState({ loading: false, tags }) }).catch((error) => {
      if (!controller.signal.aborted) setState({ loading: false, tags: [], error: error instanceof Error ? error.message : String(error) })
    })
    return () => controller.abort()
  }, [client, revision])
  if (state.loading && !state.tags.length) return <div className="h-20 animate-pulse rounded bg-muted" aria-label="正在加载收藏标签" />
  if (state.error) return <div role="alert" className="grid min-h-20 justify-items-center gap-2 text-center text-[11px] text-destructive"><span>{state.error}</span><Button size="sm" variant="outline" onClick={() => setRevision((value) => value + 1)}>重试</Button></div>
  if (!state.tags.length) return <ReaderCardEmptyState>暂无收藏或常用标签</ReaderCardEmptyState>
  return (
    <div className="space-y-2 text-[11px]" data-favorite-tags-card="true">
      <div className="flex items-center justify-between"><span className="text-muted-foreground">{state.tags.length} 个标签</span><Button type="button" size="icon-sm" variant="ghost" aria-label="刷新收藏标签" onClick={() => setRevision((value) => value + 1)}><RefreshCw /></Button></div>
      <ul className="flex flex-wrap gap-1" aria-label="收藏标签列表">{state.tags.map((tag) => <li key={`${tag.category}\0${tag.tag}`} className="inline-flex items-center gap-1 rounded border px-1.5 py-1 text-[10px]" title={`${tag.category}:${tag.tag}`}>{tag.favorite ? <Star className="size-3 fill-amber-400 text-amber-500" /> : null}{tag.translatedTag ?? tag.tag}</li>)}</ul>
    </div>
  )
}

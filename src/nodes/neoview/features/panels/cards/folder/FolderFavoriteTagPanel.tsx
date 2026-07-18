/**
 * @migrated-from components/panels/folderPanel/components/FavoriteTagPanel.svelte
 * @migrated-from cards/properties/FavoriteTagsCard.svelte
 */
import { Lock, RefreshCcw, Star, Unlock, X } from "lucide-react"
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"

import { Button } from "@/components/ui/button"
import type { ReaderEmmTagSuggestionDto, ReaderHttpClient } from "../../../../adapters/reader-http-client"

const MIN_HEIGHT = 150
const MAX_HEIGHT = 500

export type FavoriteTagAction = "replace-include" | "toggle-include" | "toggle-exclude"

export default function FolderFavoriteTagPanel({
  client,
  includeTags,
  excludeTags,
  onTag,
  onClose,
}: {
  client: ReaderHttpClient
  includeTags: ReadonlySet<string>
  excludeTags: ReadonlySet<string>
  onTag(tag: ReaderEmmTagSuggestionDto, action: FavoriteTagAction): void
  onClose(): void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const resizeRef = useRef<{ pointerId: number; startY: number; startHeight: number }>()
  const requestRef = useRef<AbortController>()
  const [tags, setTags] = useState<readonly ReaderEmmTagSuggestionDto[]>([])
  const [pinned, setPinned] = useState(false)
  const [height, setHeight] = useState(300)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()

  useEffect(() => {
    void refresh()
    return () => requestRef.current?.abort()
  }, [client])

  useEffect(() => {
    if (pinned) return
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !hostRef.current?.contains(event.target)) onClose()
    }
    document.addEventListener("pointerdown", closeOutside)
    return () => document.removeEventListener("pointerdown", closeOutside)
  }, [onClose, pinned])

  async function refresh() {
    if (!client.suggestDirectoryEmmTags) {
      setLoading(false)
      setError("当前后端不支持 EMM 标签建议。")
      return
    }
    requestRef.current?.abort()
    const request = new AbortController()
    requestRef.current = request
    setLoading(true)
    setError(undefined)
    try {
      const next = await client.suggestDirectoryEmmTags(32, request.signal)
      if (!request.signal.aborted) setTags(next)
    } catch (cause) {
      if (!request.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (!request.signal.aborted) setLoading(false)
    }
  }

  function select(tag: ReaderEmmTagSuggestionDto, event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) {
    onTag(tag, event.shiftKey ? "toggle-exclude" : event.ctrlKey || event.metaKey ? "toggle-include" : "replace-include")
  }

  function beginResize(event: ReactPointerEvent<HTMLDivElement>) {
    resizeRef.current = { pointerId: event.pointerId, startY: event.clientY, startHeight: height }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  function resize(event: ReactPointerEvent<HTMLDivElement>) {
    const current = resizeRef.current
    if (!current || current.pointerId !== event.pointerId) return
    const next = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, current.startHeight + event.clientY - current.startY))
    hostRef.current?.style.setProperty("height", `${next}px`)
  }

  function finishResize(event: ReactPointerEvent<HTMLDivElement>) {
    const current = resizeRef.current
    if (!current || current.pointerId !== event.pointerId) return
    const next = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, current.startHeight + event.clientY - current.startY))
    resizeRef.current = undefined
    setHeight(next)
  }

  const groups = groupTags(tags)
  return (
    <div
      ref={hostRef}
      className="absolute inset-x-1 top-[4.6rem] z-40 grid min-h-[150px] max-h-[500px] grid-rows-[auto_1fr] overflow-hidden rounded-md border bg-popover/95 shadow-lg backdrop-blur-md"
      style={{ height }}
      data-neoview-favorite-tag-panel="true"
      data-pinned={pinned}
    >
      <div className="flex h-10 items-center justify-between gap-2 border-b px-3">
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium"><Star className="size-4 fill-amber-400 text-amber-500" />收藏标签快选</div>
        <div className="flex items-center gap-1">
          <Button type="button" size="icon-sm" variant="ghost" aria-label="刷新收藏标签" disabled={loading} onClick={() => void refresh()}><RefreshCcw className={loading ? "animate-spin" : undefined} /></Button>
          <Button type="button" size="icon-sm" variant={pinned ? "secondary" : "ghost"} aria-label={pinned ? "取消固定" : "固定面板"} aria-pressed={pinned} onClick={() => setPinned((value) => !value)}>{pinned ? <Lock /> : <Unlock />}</Button>
          <Button type="button" size="icon-sm" variant="ghost" aria-label="关闭收藏标签" onClick={onClose}><X /></Button>
        </div>
      </div>
      <div className="min-h-0 overflow-y-auto p-3 text-[11px]">
        {error ? <div role="alert" className="grid min-h-24 place-content-center gap-2 text-center text-destructive"><span>{error}</span><Button type="button" size="sm" variant="outline" onClick={() => void refresh()}>重试</Button></div> : null}
        {!error && !loading && groups.length === 0 ? <div className="grid min-h-24 place-content-center text-center text-muted-foreground"><span>暂无收藏或常用标签</span><span className="text-[10px]">可在 EMM 设置中管理收藏标签</span></div> : null}
        {!error ? groups.map((group) => (
          <section key={group.name} className="mb-3 last:mb-0">
            <div className="mb-1 flex items-center justify-between rounded bg-muted/50 px-1.5 py-1 font-semibold"><span>{group.name}</span><span className="text-[10px] text-muted-foreground">{group.tags.length}</span></div>
            <div className="flex flex-wrap gap-1">
              {group.tags.map((tag) => {
                const key = tagKey(tag)
                const include = includeTags.has(key)
                const exclude = excludeTags.has(key)
                return (
                  <button
                    key={key}
                    type="button"
                    className={`inline-flex h-7 items-center gap-1 rounded border px-2 text-[10px] hover:bg-accent ${include ? "border-primary bg-primary/10 text-primary" : exclude ? "border-destructive bg-destructive/10 text-destructive line-through" : "border-border"}`}
                    aria-pressed={include || exclude}
                    aria-label={`${exclude ? "排除" : include ? "包含" : "选择"}标签 ${key}`}
                    title={`${key}\n单击仅包含，Ctrl/Command 追加，Shift 或右键排除`}
                    onClick={(event) => select(tag, event)}
                    onContextMenu={(event) => { event.preventDefault(); onTag(tag, "toggle-exclude") }}
                  >
                    {tag.favorite ? <Star className="size-3 fill-current" /> : null}
                    <span>{tag.translatedTag ?? tag.tag}</span>
                  </button>
                )
              })}
            </div>
          </section>
        )) : null}
      </div>
      <div
        className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize touch-none hover:bg-primary/20"
        role="separator"
        aria-label="调整收藏标签面板高度"
        aria-orientation="horizontal"
        aria-valuemin={MIN_HEIGHT}
        aria-valuemax={MAX_HEIGHT}
        aria-valuenow={height}
        onPointerDown={beginResize}
        onPointerMove={resize}
        onPointerUp={finishResize}
        onPointerCancel={finishResize}
      />
    </div>
  )
}

function groupTags(tags: readonly ReaderEmmTagSuggestionDto[]) {
  const groups = new Map<string, ReaderEmmTagSuggestionDto[]>()
  for (const tag of tags) {
    const values = groups.get(tag.category) ?? []
    values.push(tag)
    groups.set(tag.category, values)
  }
  return [...groups].map(([name, values]) => ({
    name,
    tags: values.toSorted((left, right) => Number(right.favorite) - Number(left.favorite) || left.tag.localeCompare(right.tag)),
  })).toSorted((left, right) => left.name.localeCompare(right.name))
}

export function tagKey(tag: Pick<ReaderEmmTagSuggestionDto, "category" | "tag">): string {
  return `${tag.category}:${tag.tag}`
}

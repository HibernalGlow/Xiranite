import { useVirtualizer } from "@tanstack/react-virtual"
import { ArrowLeft, ArrowRight, ArrowUp, File, Folder, RefreshCw } from "lucide-react"
import { useEffect, useRef, useState, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { ReaderDirectoryEntryDto, ReaderDirectoryNavigationDto, ReaderDirectoryPageDto } from "../../../adapters/reader-http-client"
import type { ReaderPanelContext } from "../registry"

const PAGE_SIZE = 128

export default function FolderMainCard({ client, disabled, sourcePath, onOpen }: ReaderPanelContext) {
  const parentRef = useRef<HTMLDivElement>(null)
  const sessionIdRef = useRef<string | undefined>(undefined)
  const requestRef = useRef<AbortController | undefined>(undefined)
  const generationRef = useRef(0)
  const [draftPath, setDraftPath] = useState(sourcePath ?? "")
  const [page, setPage] = useState<ReaderDirectoryPageDto | undefined>(undefined)
  const [entries, setEntries] = useState<ReaderDirectoryEntryDto[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 34,
    overscan: 8,
  })

  useEffect(() => {
    if (!sourcePath) return
    setDraftPath(sourcePath)
    void openBrowser(sourcePath)
    return disposeBrowser
  }, [sourcePath])

  const virtualItems = virtualizer.getVirtualItems()
  const lastVirtualIndex = virtualItems.at(-1)?.index
  useEffect(() => {
    if (lastVirtualIndex === undefined || lastVirtualIndex < entries.length - 12 || page?.nextCursor === undefined || loading) return
    void loadNextPage(page)
  }, [lastVirtualIndex, entries.length, page?.nextCursor, page?.generation, loading])

  async function openBrowser(path: string) {
    const normalized = path.trim()
    if (!normalized) return
    const generation = beginRequest()
    setLoading(true)
    setError(undefined)
    try {
      const opened = await client.openDirectoryBrowser!(normalized, requestRef.current?.signal)
      if (generation !== generationRef.current) {
        void client.closeDirectoryBrowser!(opened.sessionId).catch(() => undefined)
        return
      }
      const previous = sessionIdRef.current
      sessionIdRef.current = opened.sessionId
      applyPage(opened)
      if (previous && previous !== opened.sessionId) void client.closeDirectoryBrowser!(previous).catch(() => undefined)
    } catch (cause) {
      if (generation === generationRef.current && !requestRef.current?.signal.aborted) setError(errorMessage(cause))
    } finally {
      if (generation === generationRef.current) setLoading(false)
    }
  }

  async function navigate(navigation: ReaderDirectoryNavigationDto) {
    const sessionId = sessionIdRef.current
    if (!sessionId) {
      if (navigation.action === "path") await openBrowser(navigation.path)
      return
    }
    const generation = beginRequest()
    setLoading(true)
    setError(undefined)
    try {
      const result = await client.navigateDirectoryBrowser!(sessionId, navigation, requestRef.current?.signal)
      if (generation === generationRef.current) applyPage(result)
    } catch (cause) {
      if (generation === generationRef.current && !requestRef.current?.signal.aborted) setError(errorMessage(cause))
    } finally {
      if (generation === generationRef.current) setLoading(false)
    }
  }

  async function loadNextPage(current: ReaderDirectoryPageDto) {
    const cursor = current.nextCursor
    if (cursor === undefined) return
    const generation = generationRef.current
    setLoading(true)
    try {
      const next = await client.listDirectoryBrowser!(current.sessionId, cursor, PAGE_SIZE, requestRef.current?.signal)
      if (generation !== generationRef.current || next.generation !== current.generation) return
      setPage(next)
      setEntries((values) => [...values, ...next.entries])
    } catch (cause) {
      if (generation === generationRef.current) setError(errorMessage(cause))
    } finally {
      if (generation === generationRef.current) setLoading(false)
    }
  }

  function applyPage(next: ReaderDirectoryPageDto) {
    setPage(next)
    setEntries(next.entries)
    setDraftPath(next.path)
    parentRef.current?.scrollTo({ top: 0 })
  }

  function beginRequest(): number {
    requestRef.current?.abort()
    requestRef.current = new AbortController()
    generationRef.current += 1
    return generationRef.current
  }

  function disposeBrowser() {
    generationRef.current += 1
    requestRef.current?.abort()
    requestRef.current = undefined
    const sessionId = sessionIdRef.current
    sessionIdRef.current = undefined
    if (sessionId) void client.closeDirectoryBrowser!(sessionId).catch(() => undefined)
  }

  function activate(entry: ReaderDirectoryEntryDto) {
    if (entry.kind === "directory") void navigate({ action: "path", path: entry.path })
    else if (entry.readerSupported) void onOpen?.(entry.path)
  }

  return (
    <div className="grid min-h-0 gap-2" data-neoview-folder-card="true">
      <form
        className="flex gap-1"
        onSubmit={(event) => {
          event.preventDefault()
          void navigate({ action: "path", path: draftPath })
        }}
      >
        <Input aria-label="浏览路径" value={draftPath} onChange={(event) => setDraftPath(event.currentTarget.value)} />
        <Button type="submit" size="sm" variant="outline" disabled={disabled || loading || !draftPath.trim()}>转到</Button>
      </form>
      <div className="flex items-center gap-1">
        <BrowserButton label="后退" disabled={!page?.canGoBack || loading} onClick={() => void navigate({ action: "back" })}><ArrowLeft /></BrowserButton>
        <BrowserButton label="前进" disabled={!page?.canGoForward || loading} onClick={() => void navigate({ action: "forward" })}><ArrowRight /></BrowserButton>
        <BrowserButton label="上级" disabled={!page?.parentPath || loading} onClick={() => void navigate({ action: "up" })}><ArrowUp /></BrowserButton>
        <BrowserButton label="刷新" disabled={!page || loading} onClick={() => void navigate({ action: "refresh" })}><RefreshCw className={loading ? "animate-spin" : undefined} /></BrowserButton>
        <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">{entries.length} / {page?.total ?? 0}</span>
      </div>
      {error ? <div role="alert" className="rounded bg-destructive/10 px-2 py-1 text-xs text-destructive">{error}</div> : null}
      <div ref={parentRef} className="h-72 min-h-32 overflow-auto rounded border bg-background/60" data-neoview-folder-list="true">
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualItems.map((item) => {
            const entry = entries[item.index]
            if (!entry) return null
            return (
              <button
                key={`${page?.generation ?? 0}:${entry.path}`}
                type="button"
                className="absolute left-0 flex w-full items-center gap-2 border-b px-2 text-left text-xs hover:bg-muted disabled:opacity-55"
                style={{ height: item.size, transform: `translateY(${item.start}px)` }}
                disabled={disabled || (entry.kind !== "directory" && !entry.readerSupported)}
                title={entry.path}
                onDoubleClick={() => activate(entry)}
                onKeyDown={(event) => { if (event.key === "Enter") activate(entry) }}
              >
                {entry.kind === "directory" ? <Folder className="size-4 shrink-0 text-amber-500" /> : <File className="size-4 shrink-0 text-muted-foreground" />}
                <span className="truncate">{entry.name}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function BrowserButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick(): void; children: ReactNode }) {
  return <Button type="button" size="icon-sm" variant="ghost" aria-label={label} title={label} disabled={disabled} onClick={onClick}>{children}</Button>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

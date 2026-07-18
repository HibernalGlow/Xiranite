/**
 * @migrated-from components/ui/SearchBar.svelte
 * @migrated-from cards/folder/cards/ToolbarCard.svelte
 * @migration-status partial
 */
import { Asterisk, CaseSensitive, ChevronDown, File, Folder, ListTree, LoaderCircle, Search, Trash2, X } from "lucide-react"
import { useEffect, useRef, useState, type ReactNode } from "react"
import { Virtuoso } from "react-virtuoso"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type {
  ReaderDirectoryEntryDto,
  ReaderDirectorySearchKindDto,
  ReaderDirectorySearchModeDto,
  ReaderDirectorySearchResultDto,
  ReaderFolderSearchConfig,
  ReaderHttpClient,
  ReaderSearchHistoryDto,
} from "../../../../adapters/reader-http-client"

const SEARCH_RESULT_LIMIT = 512
const SEARCH_HISTORY_LIMIT = 20
const HISTORY_TIME_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
})

export default function FolderSearchPanel({
  client,
  sessionId,
  disabled,
  settings,
  onSettingsChange,
  onActivate,
  onClose,
}: {
  client: ReaderHttpClient
  sessionId: string
  disabled: boolean
  settings: ReaderFolderSearchConfig
  onSettingsChange(patch: Partial<ReaderFolderSearchConfig>): void
  onActivate(entry: ReaderDirectoryEntryDto): void
  onClose(): void
}) {
  const requestRef = useRef<AbortController | undefined>(undefined)
  const historyRequestRef = useRef<AbortController | undefined>(undefined)
  const inputRef = useRef<HTMLInputElement>(null)
  const hostRef = useRef<HTMLElement>(null)
  const [query, setQuery] = useState("")
  const [mode, setMode] = useState<ReaderDirectorySearchModeDto>("text")
  const [kind, setKind] = useState<ReaderDirectorySearchKindDto>("all")
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [history, setHistory] = useState<readonly ReaderSearchHistoryDto[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string>()
  const [result, setResult] = useState<ReaderDirectorySearchResultDto>()
  const [streamedEntries, setStreamedEntries] = useState<readonly ReaderDirectoryEntryDto[]>([])
  const [selectedPath, setSelectedPath] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    inputRef.current?.focus()
    void refreshHistory()
    return () => {
      requestRef.current?.abort()
      requestRef.current = undefined
      historyRequestRef.current?.abort()
      historyRequestRef.current = undefined
    }
  }, [client, sessionId])

  useEffect(() => {
    function closeHistory(event: PointerEvent) {
      if (event.target instanceof Node && !hostRef.current?.contains(event.target)) setShowHistory(false)
    }
    document.addEventListener("pointerdown", closeHistory)
    return () => document.removeEventListener("pointerdown", closeHistory)
  }, [])

  async function search(nextQuery = query) {
    const normalized = nextQuery.trim()
    if (!normalized || !client.searchDirectoryBrowser) return
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    setShowHistory(false)
    setLoading(true)
    setResult(undefined)
    setStreamedEntries([])
    setError(undefined)
    try {
      const next = await client.searchDirectoryBrowser(sessionId, normalized, {
        mode,
        kind,
        caseSensitive,
        searchInPath: settings.searchInPath,
        maximumDepth: settings.includeSubfolders ? undefined : 0,
        maximumResults: SEARCH_RESULT_LIMIT,
        onEntries: (entries) => {
          if (requestRef.current === controller) setStreamedEntries(entries)
        },
      }, controller.signal)
      if (requestRef.current !== controller) return
      setResult(next)
      setStreamedEntries([])
      setSelectedPath(undefined)
      void recordHistory(normalized)
    } catch (cause) {
      if (controller.signal.aborted) return
      setStreamedEntries([])
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = undefined
        setLoading(false)
      }
    }
  }

  async function refreshHistory() {
    if (!client.listSearchHistory) return
    const controller = beginHistoryRequest()
    setHistoryLoading(true)
    setHistoryError(undefined)
    try {
      const entries = await client.listSearchHistory("folder", SEARCH_HISTORY_LIMIT, controller.signal)
      if (historyRequestRef.current === controller) {
        setHistory(entries)
        if (settings.showHistoryOnFocus && entries.length > 0 && document.activeElement === inputRef.current) {
          setShowHistory(true)
        }
      }
    } catch (cause) {
      if (!controller.signal.aborted) setHistoryError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (historyRequestRef.current === controller) {
        historyRequestRef.current = undefined
        setHistoryLoading(false)
      }
    }
  }

  async function recordHistory(normalizedQuery: string) {
    if (!client.recordSearchHistory || !client.listSearchHistory) return
    const controller = beginHistoryRequest()
    try {
      await client.recordSearchHistory("folder", normalizedQuery, controller.signal)
      const entries = await client.listSearchHistory("folder", SEARCH_HISTORY_LIMIT, controller.signal)
      if (historyRequestRef.current === controller) setHistory(entries)
    } catch {
      // History is auxiliary; a temporary SQLite lock must not hide search results.
    } finally {
      if (historyRequestRef.current === controller) historyRequestRef.current = undefined
    }
  }

  async function removeHistory(queryToRemove: string) {
    if (!client.removeSearchHistory) return
    const controller = beginHistoryRequest()
    setHistoryError(undefined)
    try {
      await client.removeSearchHistory("folder", queryToRemove, controller.signal)
      if (historyRequestRef.current === controller) {
        setHistory((current) => current.filter((entry) => entry.query !== queryToRemove))
      }
    } catch (cause) {
      if (!controller.signal.aborted) setHistoryError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (historyRequestRef.current === controller) historyRequestRef.current = undefined
    }
  }

  async function clearHistory() {
    if (!client.clearSearchHistory) return
    const controller = beginHistoryRequest()
    setHistoryError(undefined)
    try {
      await client.clearSearchHistory("folder", controller.signal)
      if (historyRequestRef.current === controller) {
        setHistory([])
        setShowHistory(false)
      }
    } catch (cause) {
      if (!controller.signal.aborted) setHistoryError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (historyRequestRef.current === controller) historyRequestRef.current = undefined
    }
  }

  function beginHistoryRequest() {
    historyRequestRef.current?.abort()
    const controller = new AbortController()
    historyRequestRef.current = controller
    return controller
  }

  function clearSearch() {
    requestRef.current?.abort()
    requestRef.current = undefined
    setQuery("")
    setResult(undefined)
    setStreamedEntries([])
    setSelectedPath(undefined)
    setError(undefined)
    setLoading(false)
    inputRef.current?.focus()
  }

  return (
    <section ref={hostRef} className="relative grid h-72 min-h-0 grid-rows-[auto_auto_1fr]" data-neoview-folder-search="true">
      <form
        className="flex min-w-0 items-center gap-1 border-b p-1"
        onSubmit={(event) => {
          event.preventDefault()
          void search()
        }}
      >
        <Input
          ref={inputRef}
          aria-label="搜索文件"
          className="h-8 min-w-0 flex-1"
          value={query}
          placeholder={mode === "glob" ? "例如 **/*.cbz" : "名称或相对路径"}
          onChange={(event) => setQuery(event.currentTarget.value)}
          onFocus={() => {
            if (settings.showHistoryOnFocus && history.length > 0) setShowHistory(true)
          }}
        />
        {client.listSearchHistory ? (
          <Button
            type="button"
            size="icon-sm"
            variant={showHistory ? "secondary" : "ghost"}
            aria-label="搜索历史"
            aria-expanded={showHistory}
            disabled={historyLoading && history.length === 0}
            onClick={() => setShowHistory((current) => !current)}
          >
            {historyLoading ? <LoaderCircle className="animate-spin" /> : <ChevronDown />}
          </Button>
        ) : null}
        <Button type="submit" size="icon-sm" variant="outline" aria-label="执行搜索" disabled={disabled || loading || !query.trim() || !client.searchDirectoryBrowser}>
          {loading ? <LoaderCircle className="animate-spin" /> : <Search />}
        </Button>
        <Button type="button" size="icon-sm" variant="ghost" aria-label="清除搜索" disabled={!query && !result && !error} onClick={clearSearch}><X /></Button>
        <Button type="button" size="icon-sm" variant="ghost" aria-label="关闭搜索" onClick={onClose}><X /></Button>
      </form>

      <div className="flex min-w-0 flex-wrap items-center gap-1 border-b px-1 py-1">
        <ToggleGroup type="single" size="sm" value={kind} onValueChange={(value) => { if (value) setKind(value as ReaderDirectorySearchKindDto) }}>
          <ToggleGroupItem value="all" aria-label="全部类型"><Search /></ToggleGroupItem>
          <ToggleGroupItem value="file" aria-label="仅文件"><File /></ToggleGroupItem>
          <ToggleGroupItem value="directory" aria-label="仅文件夹"><Folder /></ToggleGroupItem>
        </ToggleGroup>
        <Button type="button" size="sm" variant={settings.includeSubfolders ? "default" : "ghost"} className="h-7 gap-1 px-2 text-xs" aria-pressed={settings.includeSubfolders} onClick={() => onSettingsChange({ includeSubfolders: !settings.includeSubfolders })}><ListTree />子目录</Button>
        <Button type="button" size="icon-sm" variant={mode === "glob" ? "default" : "ghost"} aria-label="Glob 模式" aria-pressed={mode === "glob"} onClick={() => setMode((current) => current === "text" ? "glob" : "text")}><Asterisk /></Button>
        <Button type="button" size="icon-sm" variant={caseSensitive ? "default" : "ghost"} aria-label="区分大小写" aria-pressed={caseSensitive} onClick={() => setCaseSensitive((current) => !current)}><CaseSensitive /></Button>
        <div className="ml-auto flex items-center gap-2 text-[10px] text-muted-foreground">
          <label className="flex items-center gap-1" title="匹配相对路径">
            <input type="checkbox" checked={settings.searchInPath} onChange={(event) => onSettingsChange({ searchInPath: event.currentTarget.checked })} />
            匹配路径
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={settings.showHistoryOnFocus} onChange={(event) => onSettingsChange({ showHistoryOnFocus: event.currentTarget.checked })} />
            聚焦显示历史
          </label>
        </div>
      </div>

      {showHistory ? (
        <div className="absolute inset-x-1 top-10 z-30 max-h-56 overflow-y-auto rounded border bg-popover shadow-md" data-neoview-folder-search-history="true">
          {historyError ? <div className="px-3 py-2 text-xs text-destructive" role="alert">{historyError}</div> : null}
          {!historyError && history.length === 0 ? <div className="px-3 py-3 text-center text-xs text-muted-foreground">暂无搜索历史</div> : null}
          {history.map((entry) => (
            <div key={entry.query} className="flex min-w-0 items-center border-b last:border-b-0">
              <button
                type="button"
                aria-label={`使用搜索历史：${entry.query}`}
                className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] gap-2 px-3 py-2 text-left text-xs hover:bg-accent"
                onClick={() => {
                  setQuery(entry.query)
                  setShowHistory(false)
                  void search(entry.query)
                }}
              >
                <span className="truncate">{entry.query}</span>
                <span className="text-[10px] text-muted-foreground">{HISTORY_TIME_FORMATTER.format(entry.usedAt)}</span>
              </button>
              <Button type="button" size="icon-sm" variant="ghost" aria-label={`删除搜索历史：${entry.query}`} onClick={() => void removeHistory(entry.query)}><X /></Button>
            </div>
          ))}
          {history.length > 0 ? (
            <div className="border-t p-1">
              <Button type="button" size="sm" variant="ghost" className="w-full justify-center text-xs" onClick={() => void clearHistory()}><Trash2 />清空搜索历史</Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="min-h-0" aria-live="polite">
        {loading && streamedEntries.length === 0 ? <SearchState icon={<LoaderCircle className="size-5 animate-spin" />} label="正在搜索..." /> : null}
        {!loading && error ? <SearchState label={error} tone="error" action={<Button type="button" size="sm" variant="outline" onClick={() => void search()}>重试</Button>} /> : null}
        {!loading && !error && result?.entries.length === 0 ? <SearchState label={`未找到“${result.query}”`} /> : null}
        {!error && (result?.entries.length || streamedEntries.length) ? (
          <div className="grid h-full min-h-0 grid-rows-[auto_1fr]">
            <div className="flex items-center justify-between border-b px-2 py-1 text-[10px] text-muted-foreground">
              <span>{loading ? `已找到 ${streamedEntries.length} 项，正在搜索` : `${result!.matched} 个结果 / 扫描 ${result!.scanned} 项`}</span>
              {result?.truncated ? <span className="text-amber-600">已截断至 {SEARCH_RESULT_LIMIT} 项</span> : null}
            </div>
            <Virtuoso
              style={{ height: "100%" }}
              data={result?.entries ?? streamedEntries}
              fixedItemHeight={48}
              computeItemKey={(_, entry) => entry.path}
              itemContent={(_, entry) => (
                <button
                  type="button"
                  className="grid h-12 w-full grid-cols-[1rem_minmax(0,1fr)] items-center gap-x-2 border-b px-2 text-left text-xs hover:bg-muted aria-selected:bg-accent"
                  aria-selected={entry.path === selectedPath}
                  title={entry.path}
                  onClick={() => {
                    setSelectedPath(entry.path)
                    onActivate(entry)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault()
                      onActivate(entry)
                    }
                  }}
                >
                  {entry.kind === "directory" ? <Folder className="row-span-2 size-4 text-amber-500" /> : <File className="row-span-2 size-4 text-muted-foreground" />}
                  <span className="truncate font-medium">{entry.name}</span>
                  <span className="truncate text-[10px] text-muted-foreground">{entry.path}</span>
                </button>
              )}
            />
          </div>
        ) : null}
        {!loading && !error && !result ? <SearchState icon={<Search className="size-5" />} label="输入关键词开始搜索" /> : null}
      </div>
    </section>
  )
}

function SearchState({ icon, label, tone = "muted", action }: { icon?: ReactNode; label: string; tone?: "muted" | "error"; action?: ReactNode }) {
  return (
    <div className={`grid h-full place-content-center justify-items-center gap-2 p-4 text-center text-xs ${tone === "error" ? "text-destructive" : "text-muted-foreground"}`} role={tone === "error" ? "alert" : "status"}>
      {icon}
      <span>{label}</span>
      {action}
    </div>
  )
}

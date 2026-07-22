/**
 * @migrated-from components/ui/SearchBar.svelte
 * @migrated-from cards/folder/cards/ToolbarCard.svelte
 * @migration-status partial
 *
 * Search chrome only. Results are published to the parent as a virtual
 * directory listing so File Card list/grid/details/mosaic views stay in charge.
 */
import {
  Asterisk,
  CaseSensitive,
  ExternalLink,
  File,
  Folder,
  History,
  ListTree,
  LoaderCircle,
  PanelTopClose,
  Search,
  Square,
  Star,
  Trash2,
  X,
} from "lucide-react"
import { lazy, Suspense, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Input } from "@/components/ui/input"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"
import type {
  ReaderDirectoryEntryDto,
  ReaderDirectorySearchKindDto,
  ReaderDirectorySearchModeDto,
  ReaderDirectorySearchResultDto,
  ReaderFolderSearchConfig,
  ReaderHttpClient,
} from "../../../../adapters/reader-http-client"
import {
  applyTagSelection,
  canSaveSearchToTab,
  createDefaultSearchCriteria,
  createSearchTabSnapshot,
  hasSearchCriteria,
  mergeCriteriaSettings,
  restoreResultFromSnapshot,
  SEARCH_RESULT_LIMIT,
  splitTagKey,
  type FolderSearchCriteria,
  type FolderSearchTabSnapshot,
} from "./search/folderSearchModel"
import { useFolderDirectorySearch } from "./search/useFolderDirectorySearch"

const FolderFavoriteTagPanel = lazy(() => import("./FolderFavoriteTagPanel"))
const HISTORY_TIME_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
})

export type FolderSearchListingPhase =
  | "idle"
  | "loading"
  | "streaming"
  | "success"
  | "empty"
  | "error"
  | "cleared"

export type FolderSearchListingUpdate = {
  criteria: FolderSearchCriteria
  result?: ReaderDirectorySearchResultDto
  streamedEntries: readonly ReaderDirectoryEntryDto[]
  loading: boolean
  error?: string
  phase: FolderSearchListingPhase
}

export default function FolderSearchPanel({
  client,
  sessionId,
  disabled,
  settings,
  rootPath,
  tabCount = 1,
  maxTabs = 8,
  initialSnapshot,
  onSettingsChange,
  onListingChange,
  onClose,
  onSaveToTab,
}: {
  client: ReaderHttpClient
  sessionId: string
  disabled: boolean
  settings: ReaderFolderSearchConfig
  rootPath?: string
  tabCount?: number
  maxTabs?: number
  initialSnapshot?: FolderSearchTabSnapshot
  onSettingsChange(patch: Partial<ReaderFolderSearchConfig>): void
  /** Publish listing updates so the File Card can render a virtual catalog. */
  onListingChange?(update: FolderSearchListingUpdate): void
  onClose(): void
  onSaveToTab?(snapshot: FolderSearchTabSnapshot): void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const hostRef = useRef<HTMLElement>(null)
  const historyListId = useId()
  const hydratedRef = useRef(false)
  const lastPublishRef = useRef<string>("")
  const [criteria, setCriteria] = useState<FolderSearchCriteria>(() => (
    initialSnapshot?.criteria
      ?? createDefaultSearchCriteria(settings)
  ))
  const [showFavoriteTags, setShowFavoriteTags] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  const searchApi = useFolderDirectorySearch({ client, sessionId })
  const {
    result,
    streamedEntries,
    loading,
    error,
    history,
    historyLoading,
    historyError,
    hasSearched,
    search,
    cancel,
    clear,
    hydrateResult,
    refreshHistory,
    removeHistory,
    clearHistory,
  } = searchApi

  const liveCriteria = mergeCriteriaSettings(criteria, settings)
  const canSubmit = !disabled && !loading && Boolean(client.searchDirectoryBrowser) && hasSearchCriteria(liveCriteria)
  const isDirty = hasSearchCriteria(liveCriteria) || Boolean(result) || Boolean(error) || streamedEntries.length > 0
  const canSave = Boolean(onSaveToTab) && canSaveSearchToTab({
    criteria: liveCriteria,
    hasResult: Boolean(result && result.entries.length > 0),
    loading,
    rootPath: rootPath ?? result?.rootPath,
    tabCount,
    maxTabs,
  })

  function publish(phase: FolderSearchListingPhase, nextCriteria = liveCriteria) {
    if (!onListingChange) return
    const payload: FolderSearchListingUpdate = {
      criteria: nextCriteria,
      result,
      streamedEntries,
      loading,
      error,
      phase,
    }
    const signature = JSON.stringify({
      phase,
      loading,
      error: error ?? "",
      query: nextCriteria.query,
      matched: result?.matched ?? streamedEntries.length,
      paths: (result?.entries ?? streamedEntries).map((entry) => entry.path),
    })
    if (signature === lastPublishRef.current && phase !== "cleared") return
    lastPublishRef.current = signature
    onListingChange(payload)
  }

  useEffect(() => {
    inputRef.current?.focus()
    void refreshHistory().then((entries) => {
      if (settings.showHistoryOnFocus && entries.length > 0 && document.activeElement === inputRef.current) {
        setShowHistory(true)
      }
    })
  }, [client, sessionId])

  useEffect(() => {
    if (hydratedRef.current || !initialSnapshot) return
    hydratedRef.current = true
    setCriteria(initialSnapshot.criteria)
    if (initialSnapshot.result) {
      const restored = restoreResultFromSnapshot(initialSnapshot.result, sessionId)
      hydrateResult(restored)
      hasSearched.current = true
      onListingChange?.({
        criteria: initialSnapshot.criteria,
        result: restored,
        streamedEntries: [],
        loading: false,
        phase: restored.entries.length ? "success" : "empty",
      })
    }
  }, [hasSearched, hydrateResult, initialSnapshot, onListingChange, sessionId])

  useEffect(() => {
    function closeHistory(event: PointerEvent) {
      if (event.target instanceof Node && !hostRef.current?.contains(event.target)) setShowHistory(false)
    }
    document.addEventListener("pointerdown", closeHistory)
    return () => document.removeEventListener("pointerdown", closeHistory)
  }, [])

  const settingsResearchReadyRef = useRef(false)
  useEffect(() => {
    if (!settingsResearchReadyRef.current) {
      settingsResearchReadyRef.current = true
      return
    }
    if (!hasSearched.current) return
    if (!hasSearchCriteria(liveCriteria)) return
    void search(liveCriteria)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.includeSubfolders, settings.searchInPath])

  // Push listing updates to the parent virtual catalog whenever search state changes.
  useEffect(() => {
    if (!hasSearched.current && !result && streamedEntries.length === 0 && !loading && !error) return
    if (loading && streamedEntries.length === 0) {
      publish("loading")
      return
    }
    if (loading && streamedEntries.length > 0) {
      publish("streaming")
      return
    }
    if (error) {
      publish("error")
      return
    }
    if (result) {
      publish(result.entries.length === 0 ? "empty" : "success")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, streamedEntries, loading, error])

  function updateCriteria(patch: Partial<FolderSearchCriteria>, research = false) {
    const next = { ...criteria, ...patch }
    setCriteria(next)
    if (research && hasSearched.current && hasSearchCriteria(mergeCriteriaSettings(next, settings))) {
      void search(mergeCriteriaSettings(next, settings))
    }
  }

  function runSearch(next: FolderSearchCriteria = liveCriteria) {
    setShowHistory(false)
    void search(mergeCriteriaSettings(next, settings))
  }

  function clearSearch() {
    clear()
    lastPublishRef.current = ""
    setCriteria(createDefaultSearchCriteria(settings, {
      mode: criteria.mode,
      kind: criteria.kind,
      caseSensitive: criteria.caseSensitive,
      tagMode: criteria.tagMode,
    }))
    setShowHistory(false)
    onListingChange?.({
      criteria: createDefaultSearchCriteria(settings),
      streamedEntries: [],
      loading: false,
      phase: "cleared",
    })
    inputRef.current?.focus()
  }

  function applyTag(tag: { category: string; tag: string }, action: "replace-include" | "toggle-include" | "toggle-exclude") {
    const tags = applyTagSelection(criteria, tag, action)
    const next = { ...criteria, ...tags }
    setCriteria(next)
    void search(mergeCriteriaSettings(next, settings))
  }

  function toggleTagMode() {
    const nextMode = criteria.tagMode === "all" ? "any" : "all"
    const next = { ...criteria, tagMode: nextMode as FolderSearchCriteria["tagMode"] }
    setCriteria(next)
    if (criteria.includeTags.length || criteria.excludeTags.length) {
      void search(mergeCriteriaSettings(next, settings))
    }
  }

  function handlePanelKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== "Escape") return
    event.preventDefault()
    event.stopPropagation()
    if (showHistory) {
      setShowHistory(false)
      inputRef.current?.focus()
      return
    }
    if (showFavoriteTags) {
      setShowFavoriteTags(false)
      inputRef.current?.focus()
      return
    }
    if (loading) {
      cancel()
      return
    }
    onClose()
  }

  function handleInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    event.stopPropagation()
    if (event.key === "ArrowDown" && showHistory && history.length > 0) {
      event.preventDefault()
      hostRef.current?.querySelector<HTMLElement>("[cmdk-item]")?.focus()
      return
    }
    if (event.key === "Escape") handlePanelKeyDown(event)
  }

  function saveToTab() {
    if (!onSaveToTab || !result) return
    const path = (rootPath ?? result.rootPath).trim()
    if (!path) return
    onSaveToTab(createSearchTabSnapshot({
      criteria: liveCriteria,
      rootPath: path,
      result,
    }))
  }

  const statusText = loading && streamedEntries.length === 0
    ? "正在搜索…"
    : loading
      ? `已找到 ${streamedEntries.length} 项，正在搜索`
      : error
        ? error
        : result
          ? result.entries.length === 0
            ? (result.query ? `未找到“${result.query}”` : "未找到匹配标签的项目")
            : `${result.matched} 个结果 / 扫描 ${result.scanned} 项${result.truncated ? ` · 已截断至 ${SEARCH_RESULT_LIMIT}` : ""}`
          : "结果将显示在下方文件列表中，可切换列表/网格/详情等视图"

  return (
    <section
      ref={hostRef}
      className="relative shrink-0 border-b bg-muted/20"
      data-neoview-folder-search="true"
      data-neoview-folder-search-chrome="true"
      onKeyDown={handlePanelKeyDown}
    >
      <form
        className="flex min-w-0 items-center gap-1.5 p-1.5"
        onSubmit={(event) => {
          event.preventDefault()
          runSearch()
        }}
      >
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            ref={inputRef}
            aria-label="搜索文件"
            aria-autocomplete="list"
            aria-controls={showHistory ? historyListId : undefined}
            aria-expanded={showHistory}
            className={cn("h-8 min-w-0 pl-8 text-sm", isDirty ? "pr-8" : "pr-3")}
            value={criteria.query}
            placeholder={criteria.mode === "glob" ? "例如 **/*.cbz" : "搜索名称或相对路径…"}
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            onChange={(event) => updateCriteria({ query: event.currentTarget.value })}
            onFocus={() => {
              if (settings.showHistoryOnFocus && history.length > 0) setShowHistory(true)
            }}
            onKeyDown={handleInputKeyDown}
          />
          {isDirty ? (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className="absolute right-1 top-1/2 size-6 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="清除搜索"
              onClick={clearSearch}
            >
              <X className="size-3.5" />
            </Button>
          ) : null}
        </div>

        {client.listSearchHistory ? (
          <Button
            type="button"
            size="icon-sm"
            variant={showHistory ? "secondary" : "ghost"}
            aria-label="搜索历史"
            aria-expanded={showHistory}
            aria-controls={historyListId}
            title="搜索历史"
            disabled={historyLoading && history.length === 0}
            onClick={() => setShowHistory((current) => !current)}
          >
            {historyLoading ? <LoaderCircle className="animate-spin" /> : <History />}
          </Button>
        ) : null}

        {loading ? (
          <Button type="button" size="icon-sm" variant="outline" aria-label="取消搜索" title="取消搜索" onClick={cancel}>
            <Square className="size-3 fill-current" />
          </Button>
        ) : (
          <Button type="submit" size="icon-sm" variant="default" aria-label="执行搜索" title="执行搜索 (Enter)" disabled={!canSubmit}>
            <Search />
          </Button>
        )}

        {onSaveToTab ? (
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="保存搜索到新标签页"
            title="保存搜索到新标签页"
            disabled={!canSave || disabled}
            onClick={saveToTab}
          >
            <ExternalLink />
          </Button>
        ) : null}

        <Button type="button" size="icon-sm" variant="ghost" aria-label="关闭搜索" title="关闭搜索 (Esc)" onClick={onClose}>
          <PanelTopClose />
        </Button>
      </form>

      {showHistory ? (
        <Command
          id={historyListId}
          className="absolute inset-x-1.5 top-10 z-30 max-h-56 overflow-hidden rounded-md border bg-popover shadow-lg"
          data-neoview-folder-search-history="true"
          shouldFilter
        >
          <CommandInput value={criteria.query} onValueChange={(value) => updateCriteria({ query: value })} className="hidden" />
          <CommandList className="max-h-56">
            {historyError ? <div className="px-3 py-2 text-xs text-destructive" role="alert">{historyError}</div> : null}
            <CommandEmpty className="py-3 text-center text-xs text-muted-foreground">
              {history.length === 0 ? "暂无搜索历史" : "无匹配历史"}
            </CommandEmpty>
            <CommandGroup>
              {history.map((entry) => (
                <div key={entry.query} className="flex min-w-0 items-center border-b last:border-b-0">
                  <CommandItem
                    value={entry.query}
                    data-search-history-item="true"
                    aria-label={`使用搜索历史：${entry.query}`}
                    className="min-w-0 flex-1 rounded-none"
                    onSelect={() => {
                      const next = { ...criteria, query: entry.query }
                      setCriteria(next)
                      setShowHistory(false)
                      runSearch(next)
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">{entry.query}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                      {HISTORY_TIME_FORMATTER.format(entry.usedAt)}
                    </span>
                  </CommandItem>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    className="mr-1 shrink-0"
                    aria-label={`删除搜索历史：${entry.query}`}
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      void removeHistory(entry.query)
                    }}
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
              ))}
            </CommandGroup>
            {history.length > 0 ? (
              <div className="border-t p-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="w-full justify-center gap-1.5 text-xs text-muted-foreground"
                  onClick={() => void clearHistory().then(() => setShowHistory(false))}
                >
                  <Trash2 className="size-3.5" />
                  清空搜索历史
                </Button>
              </div>
            ) : null}
          </CommandList>
        </Command>
      ) : null}

      <div className="flex min-w-0 flex-wrap items-center gap-1 border-t px-1.5 py-1">
        <ToggleGroup
          type="single"
          size="sm"
          value={criteria.kind}
          onValueChange={(value) => {
            if (!value) return
            updateCriteria({ kind: value as ReaderDirectorySearchKindDto }, true)
          }}
        >
          <ToggleGroupItem value="all" aria-label="全部类型" title="全部类型"><Search /></ToggleGroupItem>
          <ToggleGroupItem value="file" aria-label="仅文件" title="仅文件"><File /></ToggleGroupItem>
          <ToggleGroupItem value="directory" aria-label="仅文件夹" title="仅文件夹"><Folder /></ToggleGroupItem>
        </ToggleGroup>

        <div className="mx-0.5 h-4 w-px shrink-0 bg-border" aria-hidden="true" />

        <Button
          type="button"
          size="sm"
          variant={settings.includeSubfolders ? "default" : "ghost"}
          className="h-7 gap-1 px-2 text-xs"
          aria-pressed={settings.includeSubfolders}
          title={settings.includeSubfolders ? "正在搜索子目录" : "仅搜索当前目录"}
          onClick={() => onSettingsChange({ includeSubfolders: !settings.includeSubfolders })}
        >
          <ListTree className="size-3.5" />
          子目录
        </Button>

        <Button
          type="button"
          size="icon-sm"
          variant={criteria.mode === "glob" ? "default" : "ghost"}
          aria-label="Glob 模式"
          aria-pressed={criteria.mode === "glob"}
          title="Glob 模式"
          onClick={() => updateCriteria({ mode: (criteria.mode === "text" ? "glob" : "text") as ReaderDirectorySearchModeDto }, true)}
        >
          <Asterisk />
        </Button>

        <Button
          type="button"
          size="icon-sm"
          variant={criteria.caseSensitive ? "default" : "ghost"}
          aria-label="区分大小写"
          aria-pressed={criteria.caseSensitive}
          title="区分大小写"
          onClick={() => updateCriteria({ caseSensitive: !criteria.caseSensitive }, true)}
        >
          <CaseSensitive />
        </Button>

        <Button
          type="button"
          size="sm"
          variant={showFavoriteTags ? "default" : "ghost"}
          className="h-7 gap-1 px-2 text-xs"
          aria-label="收藏标签快选"
          aria-expanded={showFavoriteTags}
          title="收藏标签快选"
          disabled={!client.suggestDirectoryEmmTags}
          onClick={() => setShowFavoriteTags((value) => !value)}
        >
          <Star className={cn("size-3.5", showFavoriteTags && "fill-current")} />
          标签
        </Button>

        {(criteria.includeTags.length > 1 || criteria.excludeTags.length > 0) ? (
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[10px]" aria-label="标签匹配方式" onClick={toggleTagMode}>
            {criteria.tagMode === "all" ? "全部标签" : "任一标签"}
          </Button>
        ) : null}

        {criteria.includeTags.map((tag) => (
          <button
            key={`include:${tag}`}
            type="button"
            className="h-6 max-w-28 truncate rounded-full border border-primary/40 bg-primary/10 px-2 text-[10px] text-primary"
            title={`移除包含标签 ${tag}`}
            onClick={() => applyTag(splitTagKey(tag), "toggle-include")}
          >
            + {tag}
          </button>
        ))}
        {criteria.excludeTags.map((tag) => (
          <button
            key={`exclude:${tag}`}
            type="button"
            className="h-6 max-w-28 truncate rounded-full border border-destructive/40 bg-destructive/10 px-2 text-[10px] text-destructive line-through"
            title={`移除排除标签 ${tag}`}
            onClick={() => applyTag(splitTagKey(tag), "toggle-exclude")}
          >
            − {tag}
          </button>
        ))}

        <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] text-muted-foreground">
          <label className="flex cursor-pointer items-center gap-1.5" title="同时匹配相对路径">
            <Checkbox
              checked={settings.searchInPath}
              onCheckedChange={(checked) => onSettingsChange({ searchInPath: checked === true })}
              aria-label="匹配路径"
            />
            <span>匹配路径</span>
          </label>
          <label className="flex cursor-pointer items-center gap-1.5" title="输入框聚焦时显示搜索历史">
            <Checkbox
              checked={settings.showHistoryOnFocus}
              onCheckedChange={(checked) => onSettingsChange({ showHistoryOnFocus: checked === true })}
              aria-label="聚焦显示历史"
            />
            <span>聚焦显示历史</span>
          </label>
        </div>
      </div>

      {showFavoriteTags ? (
        <Suspense fallback={null}>
          <FolderFavoriteTagPanel
            client={client}
            includeTags={new Set(criteria.includeTags)}
            excludeTags={new Set(criteria.excludeTags)}
            onTag={applyTag}
            onClose={() => setShowFavoriteTags(false)}
          />
        </Suspense>
      ) : null}

      <div
        className={cn(
          "flex items-center justify-between gap-2 border-t px-2.5 py-1 text-[10px]",
          error ? "text-destructive" : "text-muted-foreground",
        )}
        role={error ? "alert" : "status"}
        aria-live="polite"
      >
        <span className="min-w-0 truncate">{statusText}</span>
        <span className="flex shrink-0 items-center gap-1">
          {canSave ? (
            <Button type="button" size="sm" variant="ghost" className="h-6 gap-1 px-1.5 text-[10px]" onClick={saveToTab}>
              <ExternalLink className="size-3" />
              保存到标签
            </Button>
          ) : null}
          {loading ? (
            <Button type="button" size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" onClick={cancel}>停止</Button>
          ) : null}
          {error ? (
            <Button type="button" size="sm" variant="outline" className="h-6 px-1.5 text-[10px]" onClick={() => runSearch()}>重试</Button>
          ) : null}
        </span>
      </div>
    </section>
  )
}

export type { FolderSearchTabSnapshot, FolderSearchCriteria }

/**
 * Abortable, stream-aware folder directory search hook.
 * Isolates request lifetime, stale-result guards and history side-effects
 * so the panel stays presentational.
 */
import { useCallback, useEffect, useRef, useState } from "react"

import type {
  ReaderDirectoryEntryDto,
  ReaderDirectorySearchResultDto,
  ReaderHttpClient,
  ReaderSearchHistoryDto,
} from "../../../../../../adapters/reader-http-client"
import { createFolderErrorState } from "../FolderErrorState"
import {
  buildDirectorySearchOptions,
  hasSearchCriteria,
  SEARCH_HISTORY_LIMIT,
  SEARCH_RESULT_LIMIT,
  type FolderSearchCriteria,
} from "./folderSearchModel"

export type FolderDirectorySearchStatus = "idle" | "loading" | "success" | "empty" | "error"

export function useFolderDirectorySearch({
  client,
  sessionId,
  onHistoryChange,
}: {
  client: ReaderHttpClient
  sessionId: string
  onHistoryChange?(entries: readonly ReaderSearchHistoryDto[]): void
}) {
  const requestRef = useRef<AbortController | undefined>(undefined)
  const historyRequestRef = useRef<AbortController | undefined>(undefined)
  const hasSearchedRef = useRef(false)
  const [result, setResult] = useState<ReaderDirectorySearchResultDto>()
  const [streamedEntries, setStreamedEntries] = useState<readonly ReaderDirectoryEntryDto[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [history, setHistory] = useState<readonly ReaderSearchHistoryDto[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string>()

  const cancel = useCallback(() => {
    if (!requestRef.current) return
    requestRef.current.abort()
    requestRef.current = undefined
    setLoading(false)
  }, [])

  const clear = useCallback(() => {
    cancel()
    hasSearchedRef.current = false
    setResult(undefined)
    setStreamedEntries([])
    setError(undefined)
  }, [cancel])

  const dispose = useCallback(() => {
    requestRef.current?.abort()
    requestRef.current = undefined
    historyRequestRef.current?.abort()
    historyRequestRef.current = undefined
  }, [])

  useEffect(() => dispose, [dispose])

  const beginHistoryRequest = useCallback(() => {
    historyRequestRef.current?.abort()
    const controller = new AbortController()
    historyRequestRef.current = controller
    return controller
  }, [])

  const refreshHistory = useCallback(async () => {
    if (!client.listSearchHistory) return [] as readonly ReaderSearchHistoryDto[]
    const controller = beginHistoryRequest()
    setHistoryLoading(true)
    setHistoryError(undefined)
    try {
      const entries = await client.listSearchHistory("folder", SEARCH_HISTORY_LIMIT, controller.signal)
      if (historyRequestRef.current === controller) {
        setHistory(entries)
        onHistoryChange?.(entries)
      }
      return entries
    } catch (cause) {
      if (!controller.signal.aborted) setHistoryError(createFolderErrorState(cause, "search").message)
      return [] as readonly ReaderSearchHistoryDto[]
    } finally {
      if (historyRequestRef.current === controller) {
        historyRequestRef.current = undefined
        setHistoryLoading(false)
      }
    }
  }, [beginHistoryRequest, client, onHistoryChange])

  const recordHistory = useCallback(async (normalizedQuery: string) => {
    if (!client.recordSearchHistory || !client.listSearchHistory) return
    const controller = beginHistoryRequest()
    try {
      await client.recordSearchHistory("folder", normalizedQuery, controller.signal)
      const entries = await client.listSearchHistory("folder", SEARCH_HISTORY_LIMIT, controller.signal)
      if (historyRequestRef.current === controller) {
        setHistory(entries)
        onHistoryChange?.(entries)
      }
    } catch {
      // History is auxiliary; a temporary SQLite lock must not hide search results.
    } finally {
      if (historyRequestRef.current === controller) historyRequestRef.current = undefined
    }
  }, [beginHistoryRequest, client, onHistoryChange])

  const removeHistory = useCallback(async (queryToRemove: string) => {
    if (!client.removeSearchHistory) return
    const controller = beginHistoryRequest()
    setHistoryError(undefined)
    try {
      await client.removeSearchHistory("folder", queryToRemove, controller.signal)
      if (historyRequestRef.current === controller) {
        setHistory((current) => {
          const next = current.filter((entry) => entry.query !== queryToRemove)
          onHistoryChange?.(next)
          return next
        })
      }
    } catch (cause) {
      if (!controller.signal.aborted) setHistoryError(createFolderErrorState(cause, "search").message)
    } finally {
      if (historyRequestRef.current === controller) historyRequestRef.current = undefined
    }
  }, [beginHistoryRequest, client, onHistoryChange])

  const clearHistory = useCallback(async () => {
    if (!client.clearSearchHistory) return
    const controller = beginHistoryRequest()
    setHistoryError(undefined)
    try {
      await client.clearSearchHistory("folder", controller.signal)
      if (historyRequestRef.current === controller) {
        setHistory([])
        onHistoryChange?.([])
      }
    } catch (cause) {
      if (!controller.signal.aborted) setHistoryError(createFolderErrorState(cause, "search").message)
    } finally {
      if (historyRequestRef.current === controller) historyRequestRef.current = undefined
    }
  }, [beginHistoryRequest, client, onHistoryChange])

  const search = useCallback(async (criteria: FolderSearchCriteria) => {
    if (!hasSearchCriteria(criteria) || !client.searchDirectoryBrowser) return
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    hasSearchedRef.current = true
    setLoading(true)
    setResult(undefined)
    setStreamedEntries([])
    setError(undefined)
    try {
      const next = await client.searchDirectoryBrowser(
        sessionId,
        criteria.query.trim(),
        buildDirectorySearchOptions(criteria, {
          maximumResults: SEARCH_RESULT_LIMIT,
          onEntries: (batch) => {
            if (requestRef.current === controller) setStreamedEntries(batch)
          },
        }),
        controller.signal,
      )
      if (requestRef.current !== controller) return
      setResult(next)
      setStreamedEntries([])
      if (criteria.query.trim()) void recordHistory(criteria.query.trim())
    } catch (cause) {
      if (controller.signal.aborted) return
      setStreamedEntries([])
      setError(createFolderErrorState(cause, "search").message)
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = undefined
        setLoading(false)
      }
    }
  }, [client, recordHistory, sessionId])

  const hydrateResult = useCallback((next: ReaderDirectorySearchResultDto | undefined) => {
    hasSearchedRef.current = Boolean(next)
    setResult(next)
    setStreamedEntries([])
    setError(undefined)
    setLoading(false)
  }, [])

  const entries = result?.entries ?? streamedEntries
  const status: FolderDirectorySearchStatus = loading && streamedEntries.length === 0
    ? "loading"
    : error
      ? "error"
      : result && result.entries.length === 0
        ? "empty"
        : entries.length > 0
          ? "success"
          : "idle"

  return {
    result,
    streamedEntries,
    entries,
    loading,
    error,
    status,
    history,
    historyLoading,
    historyError,
    hasSearched: hasSearchedRef,
    search,
    cancel,
    clear,
    hydrateResult,
    refreshHistory,
    removeHistory,
    clearHistory,
    dispose,
  }
}

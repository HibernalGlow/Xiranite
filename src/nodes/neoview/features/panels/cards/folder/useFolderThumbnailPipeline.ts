import { useEffect, useRef, useState, type RefObject } from "react"
import type { ListRange } from "react-virtuoso"

import type { ReaderDirectoryPageDto, ReaderHttpClient } from "../../../../adapters/reader-http-client"
import {
  directoryLoadedEntries,
  viewUsesThumbnails,
  type DirectoryCatalog,
} from "./DirectoryCatalog"
import type { FolderPreviewCount, FolderViewMode } from "./FolderBrowserState"
import {
  emptyFolderThumbnailSnapshot,
  FolderThumbnailStore,
  type FolderThumbnailSnapshot,
} from "./FolderThumbnailStore"
import { isVirtualSearchPath } from "./search/folderSearchModel"
import {
  isThumbnailDemandNeeded,
  mergeThumbnailUrls,
  mergeThumbnailUrlSets,
  thumbnailProfile,
} from "./FolderThumbnailState"

const MAX_THUMBNAILS = 24
const MAX_CACHED_THUMBNAIL_URLS = 256

export function useFolderThumbnailPipeline({
  client,
  catalog,
  catalogRef,
  thumbnailsVisible,
  viewMode,
  previewGridEnabled,
  previewCount,
  visibleRangeRef,
  selectedPaths,
  retainContextWhenHidden = false,
}: {
  client: ReaderHttpClient
  catalog: DirectoryCatalog | undefined
  catalogRef: RefObject<DirectoryCatalog | undefined>
  thumbnailsVisible: boolean
  viewMode: FolderViewMode
  previewGridEnabled: boolean
  previewCount: FolderPreviewCount
  visibleRangeRef: RefObject<ListRange>
  selectedPaths: ReadonlySet<string>
  retainContextWhenHidden?: boolean
}) {
  const requestRef = useRef<AbortController>()
  const generationRef = useRef(0)
  const contextSequenceRef = useRef(0)
  const contextRef = useRef<string>()
  const signatureRef = useRef("")
  const refreshSequenceRef = useRef(0)
  const compileKeysRef = useRef(new Set<string>())
  const initialRangeRef = useRef<{ sessionId: string; generation: number; range: ListRange }>()
  const thumbnailStoreRef = useRef<FolderThumbnailStore>()
  const thumbnailStore = thumbnailStoreRef.current ??= new FolderThumbnailStore()
  const demandRegistrationRef = useRef<(paths: ReadonlySet<string>, force: boolean) => void>()
  const demandHandlerRef = useRef<(paths: ReadonlySet<string>, force: boolean) => void>()
  const pendingDemandPathsRef = useRef(new Set<string>())
  const pendingDemandForceRef = useRef(false)
  const suppressedCancellationTokensRef = useRef(new Set<number>())
  demandHandlerRef.current ??= (paths, force) => demandRegistrationRef.current?.(paths, force)
  demandRegistrationRef.current = (paths, force) => {
    for (const path of paths) pendingDemandPathsRef.current.add(path)
    pendingDemandForceRef.current ||= force
    flushDemandRegistration()
  }
  const [refreshPending, setRefreshPending] = useState(false)

  useEffect(() => {
    const enabled = thumbnailsVisible && viewUsesThumbnails(viewMode) && Boolean(client.registerLibraryThumbnails)
    thumbnailStore.setDemandHandler(enabled ? demandHandlerRef.current : undefined)
    return () => thumbnailStore.setDemandHandler(undefined)
  }, [client.registerLibraryThumbnails, thumbnailStore, thumbnailsVisible, viewMode])

  useEffect(() => {
    if (!thumbnailsVisible || !catalog || !viewUsesThumbnails(viewMode)) return
    void registerVisible()
  }, [thumbnailsVisible, catalog?.sessionId, catalog?.generation, viewMode, previewGridEnabled, previewCount])

  useEffect(() => {
    if (thumbnailsVisible) return
    if (retainContextWhenHidden) resetRegistration()
    else releaseContext()
  }, [retainContextWhenHidden, thumbnailsVisible])

  useEffect(() => {
    if (!thumbnailsVisible || !catalog || !viewUsesThumbnails(viewMode) || !client.listDirectoryBrowser || !client.prewarmLibraryThumbnails) return
    // Virtual results already own their in-memory entries; compiling the origin directory
    // would warm unrelated files. Their visible thumbnails still use registerVisible().
    if (isVirtualSearchPath(catalog.path)) return
    const compilePreviewCount = previewGridEnabled ? previewCount : 1
    const compileKey = `${catalog.sessionId}:${catalog.generation}:${compilePreviewCount}`
    if (compileKeysRef.current.has(compileKey)) return
    const controller = new AbortController()
    let completed = false
    const timer = setTimeout(() => {
      compileKeysRef.current.add(compileKey)
      while (compileKeysRef.current.size > 50) {
        compileKeysRef.current.delete(compileKeysRef.current.keys().next().value as string)
      }
      void import("./compileFolderThumbnails")
        .then(({ compileFolderThumbnails }) =>
          compileFolderThumbnails(client, catalog.sessionId, catalog.total, { previewCount: compilePreviewCount }, controller.signal),
        )
        .then(() => {
          completed = true
        })
        .catch(() => {
          compileKeysRef.current.delete(compileKey)
        })
    }, 1_000)
    return () => {
      clearTimeout(timer)
      controller.abort(new DOMException("Folder thumbnail compilation superseded.", "AbortError"))
      if (!completed) compileKeysRef.current.delete(compileKey)
    }
  }, [thumbnailsVisible, catalog?.sessionId, catalog?.generation, catalog?.total, viewMode, previewGridEnabled, previewCount])

  async function registerVisible(refresh = false, targetPaths?: ReadonlySet<string>, force = false): Promise<void> {
    const current = catalogRef.current
    if (!thumbnailsVisible || !current || !viewUsesThumbnails(viewMode) || !client.registerLibraryThumbnails) return
    const currentThumbnails = thumbnailStore.snapshot()
    const range = visibleRangeRef.current
    const candidates = targetPaths
      ? [...current.pages].flatMap(([cursor, entries]) => entries.map((entry, offset) => ({ index: cursor + offset, entry })))
      : directoryLoadedEntries(current, range.startIndex, range.endIndex, MAX_THUMBNAILS)
    const visible = candidates
      .filter(({ entry }) => entry.kind === "directory" || (entry.kind === "file" && entry.readerSupported))
      .filter(({ entry }) => !targetPaths || targetPaths.has(entry.path))
      .filter(({ entry }) => refresh || force || (
        thumbnailStore.entry(entry.path).availability !== "unavailable" && isThumbnailDemandNeeded(
          entry,
          viewMode,
          previewCount,
          currentThumbnails.thumbnailProfiles,
          currentThumbnails.thumbnailUrls,
          previewGridEnabled,
          currentThumbnails.thumbnailUrlSets,
        )
      ))
      .slice(0, MAX_THUMBNAILS)
    if (!visible.length) {
      clearInitialRange(current)
      return
    }
    const signature = `${refresh ? `refresh:${++refreshSequenceRef.current}` : force ? "forced" : "normal"}:${targetPaths ? "selected" : "visible"}:${current.sessionId}:${current.generation}:${viewMode}:${previewGridEnabled}:${previewCount}:${visible.map(({ index, entry }) => `${index}:${entry.path}`).join("|")}`
    if (signatureRef.current === signature) return
    signatureRef.current = signature
    requestRef.current?.abort()
    const request = new AbortController()
    requestRef.current = request
    const generation = ++generationRef.current
    const requestedPaths = new Set(visible.map(({ entry }) => entry.path))
    thumbnailStore.beginRegistration(requestedPaths, generation, refresh)
    const contextId = contextRef.current ?? `folder:${current.sessionId}:${++contextSequenceRef.current}`
    contextRef.current = contextId
    const pathById = new Map(visible.map(({ index, entry }) => [String(index), entry.path]))
    const profileById = new Map(visible.map(({ index, entry }) => [String(index), thumbnailProfile(entry, viewMode, previewCount, previewGridEnabled)]))
    await client.registerLibraryThumbnails(
      contextId,
      generation,
      visible.map(({ index, entry }) => ({
        id: String(index),
        path: entry.path,
        kind: entry.kind === "directory" ? "folder" : "file",
        previewCount: entry.kind === "directory" && previewGridEnabled ? previewCount : 1,
        ...(refresh ? { refresh: true } : {}),
      })),
      request.signal,
    ).then((batch) => {
      if (request.signal.aborted || generation !== generationRef.current) return
      clearInitialRange(current)
      const resolved = batch.items.flatMap((item) => {
        const path = pathById.get(item.id)
        return path ? [[path, item.thumbnailUrl] as const] : []
      })
      const resolvedSets = batch.items.flatMap((item) => {
        const path = pathById.get(item.id)
        if (!path) return []
        return [[path, item.thumbnailUrls?.length ? item.thumbnailUrls : [item.thumbnailUrl]] as const]
      })
      const latest = thumbnailStore.snapshot()
      const nextUrls = mergeThumbnailUrls(latest.thumbnailUrls, resolved, MAX_CACHED_THUMBNAIL_URLS)
      const nextUrlSets = mergeThumbnailUrlSets(latest.thumbnailUrlSets, resolvedSets, MAX_CACHED_THUMBNAIL_URLS)
      const nextProfiles = new Map(latest.thumbnailProfiles)
      for (const item of batch.items) {
        const path = pathById.get(item.id)
        const profile = profileById.get(item.id)
        if (path && profile) nextProfiles.set(path, profile)
      }
      for (const path of nextProfiles.keys()) {
        if (!nextUrls.has(path)) nextProfiles.delete(path)
      }
      // Registration only publishes asset capabilities. Mounted tiles probe those
      // URLs independently and publish readiness to their own path subscribers.
      const returnedPaths = new Set(resolved.map(([path]) => path))
      thumbnailStore.completeRegistration({
        thumbnailUrls: nextUrls,
        thumbnailUrlSets: nextUrlSets,
        thumbnailProfiles: nextProfiles,
      }, requestedPaths, returnedPaths, generation)
    }).catch(() => {
      thumbnailStore.cancelRegistration(
        requestedPaths,
        generation,
        !request.signal.aborted,
        !suppressedCancellationTokensRef.current.has(generation),
      )
      clearInitialRange(current)
    }).finally(() => {
      thumbnailStore.cancelRegistration(
        requestedPaths,
        generation,
        false,
        !suppressedCancellationTokensRef.current.has(generation),
      )
      suppressedCancellationTokensRef.current.delete(generation)
      if (requestRef.current === request) requestRef.current = undefined
      if (generation === generationRef.current) signatureRef.current = ""
      queueMicrotask(flushDemandRegistration)
    })
  }

  function flushDemandRegistration(): void {
    if (requestRef.current || !pendingDemandPathsRef.current.size) return
    const batch = new Set([...pendingDemandPathsRef.current].slice(0, MAX_THUMBNAILS))
    for (const path of batch) pendingDemandPathsRef.current.delete(path)
    const force = pendingDemandForceRef.current
    if (!pendingDemandPathsRef.current.size) pendingDemandForceRef.current = false
    void registerVisible(false, batch, force).finally(() => queueMicrotask(flushDemandRegistration))
  }

  async function refresh(targetPaths?: ReadonlySet<string>): Promise<void> {
    if (refreshPending) return
    setRefreshPending(true)
    try {
      await registerVisible(true, targetPaths)
    } finally {
      setRefreshPending(false)
    }
  }

  function cancelRefresh(): void {
    if (!refreshPending) return
    suppressedCancellationTokensRef.current.add(generationRef.current)
    requestRef.current?.abort(new DOMException("Thumbnail refresh cancelled", "AbortError"))
    requestRef.current = undefined
    generationRef.current += 1
    setRefreshPending(false)
  }

  function primeInitialRange(
    page: Pick<ReaderDirectoryPageDto, "sessionId" | "generation">,
    range: ListRange,
    enabled: boolean,
  ): void {
    initialRangeRef.current = enabled ? { sessionId: page.sessionId, generation: page.generation, range } : undefined
  }

  function protectInitialRange(current: DirectoryCatalog | undefined, range: ListRange): ListRange {
    const initial = initialRangeRef.current
    if (!initial) return range
    if (!current || initial.sessionId !== current.sessionId || initial.generation !== current.generation) {
      initialRangeRef.current = undefined
      return range
    }
    return {
      startIndex: Math.min(initial.range.startIndex, range.startIndex),
      endIndex: Math.max(initial.range.endIndex, range.endIndex),
    }
  }

  function snapshot(): FolderThumbnailSnapshot {
    return thumbnailStore.snapshot()
  }

  function restore(next: Partial<FolderThumbnailSnapshot>, preserve: boolean): FolderThumbnailSnapshot {
    const current = thumbnailStore.snapshot()
    const restoredUrls = preserve
      ? mergeThumbnailUrls(current.thumbnailUrls, next.thumbnailUrls ? [...next.thumbnailUrls] : [], MAX_CACHED_THUMBNAIL_URLS)
      : (next.thumbnailUrls ?? new Map())
    const restoredUrlSets = preserve
      ? mergeThumbnailUrlSets(current.thumbnailUrlSets, next.thumbnailUrlSets ? [...next.thumbnailUrlSets] : [], MAX_CACHED_THUMBNAIL_URLS)
      : (next.thumbnailUrlSets ?? new Map())
    const restoredProfiles = preserve
      ? new Map([...restoredUrls.keys()].flatMap((path) => {
          const profile = next.thumbnailProfiles?.get(path) ?? current.thumbnailProfiles.get(path)
          return profile ? [[path, profile] as const] : []
        }))
      : (next.thumbnailProfiles ?? new Map())
    const restored = {
      thumbnailUrls: restoredUrls,
      thumbnailUrlSets: restoredUrlSets,
      thumbnailProfiles: restoredProfiles,
    }
    thumbnailStore.replace(restored)
    return restored
  }

  function clearCaches(): void {
    resetRegistration()
    thumbnailStore.replace(emptyFolderThumbnailSnapshot())
  }

  function retainFileCaches(): void {
    resetRegistration()
    const current = thumbnailStore.snapshot()
    const urls = new Map<string, string>()
    const urlSets = new Map<string, readonly string[]>()
    const profiles = new Map<string, string>()
    for (const [path, profile] of current.thumbnailProfiles) {
      if (profile.startsWith("folder:")) continue
      const url = current.thumbnailUrls.get(path)
      const set = current.thumbnailUrlSets.get(path)
      if (url) urls.set(path, url)
      if (set) urlSets.set(path, set)
      profiles.set(path, profile)
    }
    thumbnailStore.replace({ thumbnailUrls: urls, thumbnailUrlSets: urlSets, thumbnailProfiles: profiles })
  }

  function invalidateRegistration(): void {
    signatureRef.current = ""
  }

  function resetRegistration(): void {
    if (requestRef.current) suppressedCancellationTokensRef.current.add(generationRef.current)
    requestRef.current?.abort()
    requestRef.current = undefined
    signatureRef.current = ""
    pendingDemandPathsRef.current.clear()
    pendingDemandForceRef.current = false
  }

  function releaseContext(): void {
    resetRegistration()
    thumbnailStore.stop()
    thumbnailStore.invalidateManagedEntries()
    const contextId = contextRef.current
    contextRef.current = undefined
    if (contextId) void client.releaseLibraryThumbnailContext?.(contextId).catch(() => undefined)
  }

  function clearInitialRange(current: Pick<DirectoryCatalog, "sessionId" | "generation">): void {
    const initial = initialRangeRef.current
    if (initial?.sessionId === current.sessionId && initial.generation === current.generation) initialRangeRef.current = undefined
  }

  return {
    thumbnailStore,
    refreshPending,
    registerVisible,
    refreshVisible: () => refresh(),
    refreshSelected: () => refresh(selectedPaths),
    refreshPaths: refresh,
    cancelRefresh,
    primeInitialRange,
    protectInitialRange,
    snapshot,
    restore,
    clearCaches,
    retainFileCaches,
    invalidateRegistration,
    resetRegistration,
    releaseContext,
  }
}

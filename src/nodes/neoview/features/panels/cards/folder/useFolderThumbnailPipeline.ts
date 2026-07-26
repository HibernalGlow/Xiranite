import { useEffect, useRef, useState, type RefObject } from "react"
import type { ListRange } from "react-virtuoso"

import type { ReaderDirectoryPageDto, ReaderHttpClient } from "../../../../adapters/reader-http-client"
import { waitForLibraryThumbnailBatch } from "../../../thumbnails/LibraryThumbnailBatchQuery"
import {
  directoryLoadedEntries,
  isAbortError,
  viewUsesThumbnails,
  type DirectoryCatalog,
} from "./DirectoryCatalog"
import type { FolderPreviewCount, FolderViewMode } from "./FolderBrowserState"
import { isVirtualSearchPath } from "./search/folderSearchModel"
import {
  isThumbnailDemandNeeded,
  mergeThumbnailUrls,
  mergeThumbnailUrlSets,
  thumbnailProfile,
} from "./FolderThumbnailState"

const MAX_THUMBNAILS = 24
const MAX_CACHED_THUMBNAIL_URLS = 256

export interface FolderThumbnailSnapshot {
  thumbnailUrls: ReadonlyMap<string, string>
  thumbnailUrlSets: ReadonlyMap<string, readonly string[]>
  thumbnailProfiles: ReadonlyMap<string, string>
}

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
}) {
  const requestRef = useRef<AbortController>()
  const generationRef = useRef(0)
  const contextSequenceRef = useRef(0)
  const contextRef = useRef<string>()
  const signatureRef = useRef("")
  const refreshSequenceRef = useRef(0)
  const compileKeysRef = useRef(new Set<string>())
  const initialRangeRef = useRef<{ sessionId: string; generation: number; range: ListRange }>()
  const [thumbnailUrls, setThumbnailUrls] = useState<ReadonlyMap<string, string>>(() => new Map())
  const [thumbnailUrlSets, setThumbnailUrlSets] = useState<ReadonlyMap<string, readonly string[]>>(() => new Map())
  const thumbnailUrlsRef = useRef<ReadonlyMap<string, string>>(thumbnailUrls)
  const thumbnailUrlSetsRef = useRef<ReadonlyMap<string, readonly string[]>>(thumbnailUrlSets)
  const thumbnailProfilesRef = useRef<ReadonlyMap<string, string>>(new Map())
  const [refreshPending, setRefreshPending] = useState(false)

  useEffect(() => {
    if (!thumbnailsVisible || !catalog || !viewUsesThumbnails(viewMode)) return
    void registerVisible()
  }, [thumbnailsVisible, catalog?.sessionId, catalog?.generation, viewMode, previewGridEnabled, previewCount])

  useEffect(() => {
    if (thumbnailsVisible) return
    releaseContext()
  }, [thumbnailsVisible])

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

  async function registerVisible(refresh = false, targetPaths?: ReadonlySet<string>): Promise<void> {
    const current = catalogRef.current
    if (!thumbnailsVisible || !current || !viewUsesThumbnails(viewMode) || !client.registerLibraryThumbnails) return
    const range = visibleRangeRef.current
    const candidates = targetPaths
      ? [...current.pages].flatMap(([cursor, entries]) => entries.map((entry, offset) => ({ index: cursor + offset, entry })))
      : directoryLoadedEntries(current, range.startIndex, range.endIndex, MAX_THUMBNAILS)
    const visible = candidates
      .filter(({ entry }) => entry.kind === "directory" || (entry.kind === "file" && entry.readerSupported))
      .filter(({ entry }) => !targetPaths || targetPaths.has(entry.path))
      .filter(({ entry }) => refresh || isThumbnailDemandNeeded(
        entry,
        viewMode,
        previewCount,
        thumbnailProfilesRef.current,
        thumbnailUrlsRef.current,
        previewGridEnabled,
        thumbnailUrlSetsRef.current,
      ))
      .slice(0, MAX_THUMBNAILS)
    if (!visible.length) {
      clearInitialRange(current)
      return
    }
    const signature = `${refresh ? `refresh:${++refreshSequenceRef.current}` : "normal"}:${targetPaths ? "selected" : "visible"}:${current.sessionId}:${current.generation}:${viewMode}:${previewGridEnabled}:${previewCount}:${visible.map(({ index, entry }) => `${index}:${entry.path}`).join("|")}`
    if (signatureRef.current === signature) return
    signatureRef.current = signature
    requestRef.current?.abort()
    const request = new AbortController()
    requestRef.current = request
    const generation = ++generationRef.current
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
    ).then(async (batch) => {
      if (request.signal.aborted || generation !== generationRef.current) return
      try {
        await waitForLibraryThumbnailBatch(batch, request.signal)
      } catch (cause) {
        if (request.signal.aborted || isAbortError(cause)) return
        // Publish after bounded retry so a persistent backend cooldown can still be
        // recovered with the existing manual refresh action.
      }
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
      setThumbnailUrlSets((currentSets) => {
        const next = mergeThumbnailUrlSets(currentSets, resolvedSets, MAX_CACHED_THUMBNAIL_URLS)
        thumbnailUrlSetsRef.current = next
        return next
      })
      setThumbnailUrls((currentUrls) => {
        const next = mergeThumbnailUrls(currentUrls, resolved, MAX_CACHED_THUMBNAIL_URLS)
        const nextProfiles = new Map(thumbnailProfilesRef.current)
        for (const item of batch.items) {
          const path = pathById.get(item.id)
          const profile = profileById.get(item.id)
          if (path && profile) nextProfiles.set(path, profile)
        }
        for (const path of nextProfiles.keys()) {
          if (!next.has(path)) nextProfiles.delete(path)
        }
        thumbnailUrlsRef.current = next
        thumbnailProfilesRef.current = nextProfiles
        return next
      })
    }).catch(() => {
      if (!request.signal.aborted && generation === generationRef.current) signatureRef.current = ""
      clearInitialRange(current)
    })
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
    return {
      thumbnailUrls: thumbnailUrlsRef.current,
      thumbnailUrlSets: thumbnailUrlSetsRef.current,
      thumbnailProfiles: thumbnailProfilesRef.current,
    }
  }

  function restore(next: Partial<FolderThumbnailSnapshot>, preserve: boolean): FolderThumbnailSnapshot {
    const restoredUrls = preserve
      ? mergeThumbnailUrls(thumbnailUrlsRef.current, next.thumbnailUrls ? [...next.thumbnailUrls] : [], MAX_CACHED_THUMBNAIL_URLS)
      : (next.thumbnailUrls ?? new Map())
    const restoredUrlSets = preserve
      ? mergeThumbnailUrlSets(thumbnailUrlSetsRef.current, next.thumbnailUrlSets ? [...next.thumbnailUrlSets] : [], MAX_CACHED_THUMBNAIL_URLS)
      : (next.thumbnailUrlSets ?? new Map())
    const restoredProfiles = preserve
      ? new Map([...restoredUrls.keys()].flatMap((path) => {
          const profile = next.thumbnailProfiles?.get(path) ?? thumbnailProfilesRef.current.get(path)
          return profile ? [[path, profile] as const] : []
        }))
      : (next.thumbnailProfiles ?? new Map())
    thumbnailUrlsRef.current = restoredUrls
    thumbnailUrlSetsRef.current = restoredUrlSets
    thumbnailProfilesRef.current = restoredProfiles
    setThumbnailUrls(restoredUrls)
    setThumbnailUrlSets(restoredUrlSets)
    return {
      thumbnailUrls: restoredUrls,
      thumbnailUrlSets: restoredUrlSets,
      thumbnailProfiles: restoredProfiles,
    }
  }

  function clearCaches(): void {
    resetRegistration()
    const urls = new Map<string, string>()
    const urlSets = new Map<string, readonly string[]>()
    thumbnailUrlsRef.current = urls
    thumbnailUrlSetsRef.current = urlSets
    thumbnailProfilesRef.current = new Map()
    setThumbnailUrls(urls)
    setThumbnailUrlSets(urlSets)
  }

  function retainFileCaches(): void {
    resetRegistration()
    const urls = new Map<string, string>()
    const urlSets = new Map<string, readonly string[]>()
    const profiles = new Map<string, string>()
    for (const [path, profile] of thumbnailProfilesRef.current) {
      if (profile.startsWith("folder:")) continue
      const url = thumbnailUrlsRef.current.get(path)
      const set = thumbnailUrlSetsRef.current.get(path)
      if (url) urls.set(path, url)
      if (set) urlSets.set(path, set)
      profiles.set(path, profile)
    }
    thumbnailUrlsRef.current = urls
    thumbnailUrlSetsRef.current = urlSets
    thumbnailProfilesRef.current = profiles
    setThumbnailUrls(urls)
    setThumbnailUrlSets(urlSets)
  }

  function invalidateRegistration(): void {
    signatureRef.current = ""
  }

  function resetRegistration(): void {
    requestRef.current?.abort()
    requestRef.current = undefined
    signatureRef.current = ""
  }

  function releaseContext(): void {
    resetRegistration()
    const contextId = contextRef.current
    contextRef.current = undefined
    if (contextId) void client.releaseLibraryThumbnailContext?.(contextId).catch(() => undefined)
  }

  function clearInitialRange(current: Pick<DirectoryCatalog, "sessionId" | "generation">): void {
    const initial = initialRangeRef.current
    if (initial?.sessionId === current.sessionId && initial.generation === current.generation) initialRangeRef.current = undefined
  }

  return {
    thumbnailUrls,
    thumbnailUrlSets,
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

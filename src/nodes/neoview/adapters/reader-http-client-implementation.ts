import { resolveLocalBackendConfig, type LocalBackendConfig } from "@/backend/localBackendConfig"
import type * as Contract from "./reader-http-contract"
export class ReaderHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = "ReaderHttpError"
  }
}

export function createReaderHttpClient(resolveConfig: () => LocalBackendConfig = resolveLocalBackendConfig): Contract.ReaderHttpClient {
  const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const config = resolveConfig()
    const url = new URL(path, config.baseUrl)
    const headers = new Headers(init.headers)
    if (config.token) headers.set("x-xiranite-token", config.token)
    const response = await fetch(url, { ...init, headers, cache: "no-store" })
    if (!response.ok) throw new ReaderHttpError(await responseError(response), response.status)
    if (response.status === 204) return undefined as T
    return (await response.json()) as T
  }

  return {
    config: (signal) => request<Contract.ReaderRuntimeConfigDto>("/reader/config", { signal }),
    updateSidebarLayout: (patch, signal) =>
      request<{ shell: Contract.ReaderShellConfigDto }>("/reader/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
        signal,
      }).then((value) => value.shell),
    updateCardLayout: (patch, signal) =>
      request<{ shell: Contract.ReaderShellConfigDto }>("/reader/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
        signal,
      }).then((value) => value.shell),
    updateBoardLayout: (patch, signal) =>
      request<{ shell: Contract.ReaderShellConfigDto }>("/reader/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
        signal,
      }).then((value) => value.shell),
    updateShellControl: (patch, signal) =>
      request<{ shell: Contract.ReaderShellConfigDto }>("/reader/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
        signal,
      }).then((value) => value.shell),
    updateViewDefaults: (patch, signal) =>
      request<Contract.ReaderRuntimeConfigDto>("/reader/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
        signal,
      }).then((value) => value.viewDefaults),
    updateBookDefaults: (patch, signal) =>
      request<Contract.ReaderRuntimeConfigDto>("/reader/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
        signal,
      }).then((value) => value.book),
    updateHistoryList: (patch, signal) =>
      request<Contract.ReaderRuntimeConfigDto>("/reader/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
        signal,
      }).then((value) => value.historyList),
    updateBookmarkList: (patch, signal) =>
      request<Contract.ReaderRuntimeConfigDto>("/reader/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
        signal,
      }).then((value) => value.bookmarkList),
    updatePageList: (patch, signal) =>
      request<Contract.ReaderRuntimeConfigDto>("/reader/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
        signal,
      }).then((value) => value.pageList),
    updateFolderView: (patch, signal) =>
      request<Contract.ReaderRuntimeConfigDto>("/reader/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
        signal,
      }).then((value) => value.folderView),
    updateSlideshow: (patch, signal) =>
      request<Contract.ReaderRuntimeConfigDto>("/reader/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
        signal,
      }).then((value) => value.slideshow),
    updateMedia: (patch, signal) =>
      request<Contract.ReaderRuntimeConfigDto>("/reader/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
        signal,
      }).then((value) => value.media),
    updateImageProcessing: (patch, signal) =>
      request<Contract.ReaderRuntimeConfigDto>("/reader/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
        signal,
      }).then((value) => {
        if (!value.imageProcessing) throw new Error("Reader backend omitted image processing config")
        return value.imageProcessing
      }),
    updateInputBindings: (patch, signal) =>
      request<Contract.ReaderRuntimeConfigDto>("/reader/config", {
        method: "PATCH",
        body: JSON.stringify(patch),
        signal,
      }).then((value) => value.inputBindings),
    updateRadialMenu: (patch, signal) =>
      request<Contract.ReaderRuntimeConfigDto>("/reader/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
        signal,
      }).then((value) => value.radialMenu),
    updateVoiceControl: (patch, signal) =>
      request<Contract.ReaderRuntimeConfigDto>("/reader/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
        signal,
      }).then((value) => {
        if (!value.voiceControl) throw new Error("Reader backend omitted voice control config")
        return value.voiceControl
      }),
    inspectLegacySettings: (content, modules, signal) =>
      request<Contract.ReaderSettingsMigrationInspection>("/reader/settings/migration/inspect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content, ...(modules ? { modules } : {}) }),
        signal,
      }),
    importLegacySettings: (content, strategy = "merge", modules, signal) =>
      request<Contract.ReaderSettingsMigrationImportResult>("/reader/settings/migration/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content,
          strategy,
          confirmed: true,
          ...(modules ? { modules } : {}),
        }),
        signal,
      }),
    updateColorFilter: (patch, signal) =>
      request<Contract.ReaderRuntimeConfigDto>("/reader/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
        signal,
      }).then((value) => value.colorFilter),
    updatePageTransition: (patch, signal) =>
      request<Contract.ReaderRuntimeConfigDto>("/reader/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
        signal,
      }).then((value) => value.pageTransition),
    updateSwitchToast: (patch, signal) =>
      request<Contract.ReaderRuntimeConfigDto>("/reader/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
        signal,
      }).then((value) => value.switchToast),
    updateInfoOverlay: (patch, signal) =>
      request<Contract.ReaderRuntimeConfigDto>("/reader/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
        signal,
      }).then((value) => value.infoOverlay),
    updateSystemMonitor: (patch, signal) =>
      request<Contract.ReaderRuntimeConfigDto>("/reader/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
        signal,
      }).then((value) => value.systemMonitor),
    updateImageTrim: (patch, signal) =>
      request<Contract.ReaderRuntimeConfigDto>("/reader/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
        signal,
      }).then((value) => value.imageTrim),
    updateSuperResolution: (patch, signal) =>
      request<Contract.ReaderRuntimeConfigDto>("/reader/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
        signal,
      }).then((value) => value.superResolution!),
    upscalePage: (sessionId, pageId, trigger = "automatic-current", signal) =>
      request<Contract.ReaderUpscaleArtifactResultDto>(
        `/reader/s/${encodeURIComponent(sessionId)}/pages/${encodeURIComponent(pageId)}/upscale-artifact?${new URLSearchParams({ trigger })}`,
        { method: "POST", signal },
      ),
    probeUpscalePage: (sessionId, pageId, signal) =>
      request<Contract.ReaderUpscaleArtifactProbeResultDto>(
        `/reader/s/${encodeURIComponent(sessionId)}/pages/${encodeURIComponent(pageId)}/upscale-artifact?${new URLSearchParams({ trigger: "automatic-current", probe: "true" })}`,
        { signal },
      ),
    upscaleCapabilities: (sessionId, refresh = false, signal) => {
      const search = refresh ? "?refresh=true" : ""
      const path = sessionId ? `/reader/s/${encodeURIComponent(sessionId)}/upscale-capabilities` : "/reader/upscale-capabilities"
      return request<Contract.ReaderUpscaleCapabilityDto>(`${path}${search}`, {
        signal,
      })
    },
    upscalePreloadSnapshots: (sessionId, signal) =>
      request<{ snapshots: Contract.ReaderUpscalePreloadSnapshotDto[] }>(`/reader/s/${encodeURIComponent(sessionId)}/upscale-preload`, { signal }).then(
        (value) => value.snapshots,
      ),
    startUpscalePreload: (sessionId, mode, signal) =>
      request<{ snapshots: Contract.ReaderUpscalePreloadSnapshotDto[] }>(
        `/reader/s/${encodeURIComponent(sessionId)}/upscale-preload/start?${new URLSearchParams({ mode })}`,
        { method: "POST", signal },
      ).then((value) => value.snapshots),
    upscaleCache: (sessionId, signal) =>
      request<Contract.ReaderUpscaleCacheSnapshotDto>(`/reader/s/${encodeURIComponent(sessionId)}/upscale-artifact-cache`, { signal }),
    cleanupUpscaleCache: (sessionId, kind, signal) =>
      request<Contract.ReaderUpscaleCacheCleanupDto>(
        `/reader/s/${encodeURIComponent(sessionId)}/upscale-artifact-cache?${new URLSearchParams({ kind, confirmed: "true" })}`,
        { method: "POST", signal },
      ),
    open: (path, signal, provenance) =>
      request<Contract.ReaderSessionDto>("/reader/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path, ...(provenance ? { provenance } : {}) }),
        signal,
      }),
    reload: (sessionId, signal) =>
      request<Contract.ReaderSessionDto>(`/reader/s/${encodeURIComponent(sessionId)}/reload`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
        signal,
      }),
    waitForSourceChanges: (sessionId, afterRevision, signal) =>
      request<Contract.ReaderSourceChangeDto | undefined>(
        `/reader/s/${encodeURIComponent(sessionId)}/source-changes?after=${encodeURIComponent(String(afterRevision))}`,
        { signal },
      ),
    openAdjacentBook: (sessionId, direction, signal) =>
      request<Contract.ReaderSessionDto | undefined>(`/reader/s/${encodeURIComponent(sessionId)}/adjacent-book`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ direction }),
        signal,
      }),
    openDirectoryBrowser: (path, signal, scopeId, watch = false) =>
      request<Contract.ReaderDirectoryPageDto>("/reader/browser/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path,
          scopeId,
          ...(watch ? { watch: true } : {}),
        }),
        signal,
      }),
    resolveFolderPenetration: (sessionId, path, policy, signal) =>
      request<Contract.ReaderFolderPenetrationResolutionDto>(`/reader/browser/s/${encodeURIComponent(sessionId)}/penetration/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path, ...(policy ? { policy } : {}) }),
        signal,
      }),
    cloneDirectoryBrowser: (sessionId, signal) =>
      request<Contract.ReaderDirectoryPageDto>(`/reader/browser/s/${encodeURIComponent(sessionId)}/clone`, { method: "POST", signal }),
    reopenDirectoryBrowser: (sessionId, signal) =>
      request<Contract.ReaderDirectoryPageDto>(`/reader/browser/s/${encodeURIComponent(sessionId)}/reopen`, { method: "POST", signal }),
    watchDirectoryBrowser: (sessionId, afterGeneration, focusPath, signal) => {
      const search = new URLSearchParams({ after: String(afterGeneration) })
      if (focusPath) search.set("focus", focusPath)
      return request<Contract.ReaderDirectoryPageDto | undefined>(`/reader/browser/s/${encodeURIComponent(sessionId)}/changes?${search}`, { signal })
    },
    listDirectoryRoots: (signal) => request<{ roots: Contract.ReaderDirectoryRootDto[] }>("/reader/browser/roots", { signal }).then((value) => value.roots),
    listDirectoryBrowser: (sessionId, cursor, limit, signal, metadataFields) => {
      const search = new URLSearchParams({
        cursor: String(cursor),
        limit: String(limit),
      })
      if (metadataFields?.length) search.set("fields", metadataFields.join(","))
      return request<Contract.ReaderDirectoryPageDto>(`/reader/browser/s/${encodeURIComponent(sessionId)}/entries?${search}`, { signal })
    },
    navigateDirectoryBrowser: (sessionId, navigation, signal, focusPath) =>
      request<Contract.ReaderDirectoryPageDto>(`/reader/browser/s/${encodeURIComponent(sessionId)}/navigate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...navigation, focusPath }),
        signal,
      }),
    searchDirectoryBrowser: (sessionId, query, options = {}, signal) => {
      const config = resolveConfig()
      const search = new URLSearchParams({ q: query })
      if (options.mode) search.set("mode", options.mode)
      if (options.kind) search.set("kind", options.kind)
      if (options.caseSensitive !== undefined) search.set("case", options.caseSensitive ? "1" : "0")
      if (options.searchInPath !== undefined) search.set("path", options.searchInPath ? "1" : "0")
      if (options.maximumDepth !== undefined) search.set("depth", String(options.maximumDepth))
      if (options.maximumResults !== undefined) search.set("limit", String(options.maximumResults))
      for (const pattern of options.excludePatterns ?? []) search.append("exclude", pattern)
      for (const tag of options.includeTags ?? []) search.append("tag", tag)
      for (const tag of options.excludeTags ?? []) search.append("excludeTag", tag)
      if (options.tagMode) search.set("tagMode", options.tagMode)
      return requestDirectorySearch(
        new URL(`/reader/browser/s/${encodeURIComponent(sessionId)}/search?${search}`, config.baseUrl),
        config.token,
        options.maximumResults ?? 512,
        options.onEntries,
        signal,
      )
    },
    treeDirectoryBrowser: (sessionId, path, refresh = false, signal) => {
      const search = new URLSearchParams()
      if (path) search.set("path", path)
      if (refresh) search.set("refresh", "1")
      const suffix = search.size ? `?${search}` : ""
      return request<Contract.ReaderDirectoryTreePageDto>(`/reader/browser/s/${encodeURIComponent(sessionId)}/tree${suffix}`, { signal })
    },
    watchDirectoryTreeBrowser: (sessionId, afterRevision, signal) =>
      request<Contract.ReaderDirectoryTreeChangesDto | undefined>(`/reader/browser/s/${encodeURIComponent(sessionId)}/tree/changes?after=${afterRevision}`, {
        signal,
      }),
    directorySizes: (sessionId, generation, paths, signal) =>
      request<Contract.ReaderDirectorySizeBatchDto>(`/reader/browser/s/${encodeURIComponent(sessionId)}/directory-sizes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ generation, paths }),
        signal,
      }),
    resolveDirectorySelection: (sessionId, selection, previewLimit = 64, signal) =>
      request<Contract.ReaderDirectorySelectionResolutionDto>(`/reader/browser/s/${encodeURIComponent(sessionId)}/selection`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ selection, previewLimit }),
        signal,
      }),
    readDirectoryEmm: (sessionId, generation, paths, signal) =>
      request<Contract.ReaderDirectoryEmmReadResultDto>(`/reader/browser/s/${encodeURIComponent(sessionId)}/emm-metadata/read`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ generation, paths }),
        signal,
      }),
    editDirectoryEmm: (sessionId, command, signal) =>
      request<Contract.ReaderDirectoryEmmEditResultDto>(`/reader/browser/s/${encodeURIComponent(sessionId)}/emm-metadata`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(command),
        signal,
      }),
    suggestDirectoryEmmTags: (count = 8, signal) =>
      request<{ tags: Contract.ReaderEmmTagSuggestionDto[] }>(`/reader/browser/emm-tags/suggestions?count=${count}`, { signal }).then((value) => value.tags),
    listSearchHistory: (scope, limit = 20, signal) =>
      request<{ entries: Contract.ReaderSearchHistoryDto[] }>(`/reader/browser/search-history?scope=${encodeURIComponent(scope)}&limit=${limit}`, {
        signal,
      }).then((value) => value.entries),
    recordSearchHistory: (scope, query, signal) =>
      request<Contract.ReaderSearchHistoryDto>("/reader/browser/search-history", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope, query }),
        signal,
      }),
    removeSearchHistory: (scope, query, signal) => {
      const search = new URLSearchParams({ scope, query })
      return request<{ removed: boolean }>(`/reader/browser/search-history?${search}`, { method: "DELETE", signal }).then((value) => value.removed)
    },
    clearSearchHistory: (scope, signal) =>
      request<{ cleared: number }>(`/reader/browser/search-history?scope=${encodeURIComponent(scope)}`, { method: "DELETE", signal }).then(
        (value) => value.cleared,
      ),
    filterDirectoryBrowser: (sessionId, filter, focusPath, signal, showHiddenFolders) =>
      request<Contract.ReaderDirectoryPageDto>(`/reader/browser/s/${encodeURIComponent(sessionId)}/filter`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filter, focusPath, showHiddenFolders }),
        signal,
      }),
    sortDirectoryBrowser: (sessionId, sort, focusPath, signal) =>
      request<Contract.ReaderDirectoryPageDto>(`/reader/browser/s/${encodeURIComponent(sessionId)}/sort`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...sort, focusPath }),
        signal,
      }),
    updateDirectorySortPreference: (sessionId, command, focusPath, signal) =>
      request<Contract.ReaderDirectoryPageDto>(`/reader/browser/s/${encodeURIComponent(sessionId)}/sort/preferences`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...command, focusPath }),
        signal,
      }),
    closeDirectoryBrowser: (sessionId, remember = false) =>
      request<void>(`/reader/browser/s/${encodeURIComponent(sessionId)}${remember ? "?remember=1" : ""}`, {
        method: "DELETE",
        keepalive: true,
      }),
    registerLibraryThumbnails: (contextId, generation, items, signal) =>
      request<Contract.ReaderLibraryThumbnailBatchDto>("/reader/library/thumbnails", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contextId, generation, items }),
        signal,
      }),
    prewarmLibraryThumbnails: (items, options, signal) => requestLibraryThumbnailWarmup(resolveConfig, items, options, signal),
    releaseLibraryThumbnailContext: (contextId) =>
      request<void>(`/reader/library/contexts/${encodeURIComponent(contextId)}`, { method: "DELETE", keepalive: true }),
    listPages: (sessionId, cursor, limit, signal) =>
      request<Contract.ReaderPageListDto>(`/reader/s/${encodeURIComponent(sessionId)}/pages?cursor=${cursor}&limit=${limit}`, { signal }),
    frameWindow: (sessionId, centerPageIndex, radius, signal) =>
      request<Contract.ReaderFrameWindowDto>(`/reader/s/${encodeURIComponent(sessionId)}/frame-window?center=${centerPageIndex}&radius=${radius}`, { signal }),
    mediaProgress: (sessionId, signal) =>
      request<{ progress: Contract.ReaderMediaProgressDto | null }>(`/reader/s/${encodeURIComponent(sessionId)}/media-progress`, { signal }).then(
        (value) => value.progress ?? undefined,
      ),
    updateMediaProgress: (sessionId, progress, flush = false, signal) =>
      request<{ progress: Contract.ReaderMediaProgressDto }>(`/reader/s/${encodeURIComponent(sessionId)}/media-progress`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...progress, flush }),
        signal,
      }).then((value) => value.progress),
    subtitleTracks: (sessionId, pageId, signal) =>
      request<{ tracks: Contract.ReaderSubtitleTrackDto[] }>(`/reader/s/${encodeURIComponent(sessionId)}/subtitles?pageId=${encodeURIComponent(pageId)}`, {
        signal,
      }).then((value) => value.tracks),
    bookSettings: (sessionId, signal) =>
      request<{ settings: Contract.ReaderBookSettingsSnapshotDto }>(`/reader/s/${encodeURIComponent(sessionId)}/book-settings`, { signal }).then(
        (value) => value.settings,
      ),
    updateBookSettings: (sessionId, expectedRevision, patch, signal) =>
      request<Contract.ReaderBookSettingsUpdateDto>(`/reader/s/${encodeURIComponent(sessionId)}/book-settings`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision, patch }),
        signal,
      }),
    listPageCatalog: (sessionId, cursor, limit, options, signal) => {
      const search = new URLSearchParams({
        cursor: String(cursor),
        limit: String(limit),
      })
      if (options.query) search.set("query", options.query)
      if (options.thumbnails === false) search.set("thumbnails", "0")
      return request<Contract.ReaderPageListDto>(`/reader/s/${encodeURIComponent(sessionId)}/pages?${search}`, { signal })
    },
    pageAction: (sessionId, pageId, action, signal) =>
      request<Contract.ReaderPageCopyActionDto | void>(`/reader/s/${encodeURIComponent(sessionId)}/pages/${encodeURIComponent(pageId)}/actions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
        signal,
      }),
    releasePageActionLease: (sessionId, leaseToken) =>
      request<void>(`/reader/s/${encodeURIComponent(sessionId)}/clipboard-materializations/${encodeURIComponent(leaseToken)}`, {
        method: "DELETE",
        keepalive: true,
      }),
    metadata: (sessionId, signal) => request<Contract.ReaderMetadataDto>(`/reader/s/${encodeURIComponent(sessionId)}/metadata`, { signal }),
    pageMediaInformation: (sessionId, signal) =>
      request<Contract.ReaderPageMediaInformationDto>(`/reader/s/${encodeURIComponent(sessionId)}/page-media-information`, { signal }),
    diagnostics: (signal) =>
      request<Contract.ReaderStorageDiagnosticsDto>("/reader/diagnostics", {
        signal,
      }),
    systemMonitorSnapshot: (signal) => request<Contract.ReaderSystemMonitorSnapshotDto>("/reader/diagnostics/system", { signal }),
    preloadDiagnostics: (sessionId, signal) =>
      request<Contract.ReaderStorageDiagnosticsDto>(`/reader/diagnostics?sessionId=${encodeURIComponent(sessionId)}`, { signal }),
    runPreloadAction: (sessionId, action, signal) =>
      request<Contract.ReaderPreloadActionResultDto>(`/reader/s/${encodeURIComponent(sessionId)}/preload-actions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, confirmed: true }),
        signal,
      }),
    updatePreloadContext: (sessionId, context, signal) =>
      request<{ preload: Contract.ReaderPreloadPlanDto }>(`/reader/s/${encodeURIComponent(sessionId)}/preload-context`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(context),
        signal,
      }).then((value) => value.preload),
    reportPreloadEvents: (sessionId, generation, events, signal) =>
      request<Contract.ReaderPreloadReportResultDto>(`/reader/s/${encodeURIComponent(sessionId)}/preload-events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ generation, events }),
        signal,
      }),
    thumbnailMaintenance: (signal) =>
      request<{ snapshot: Contract.ReaderThumbnailMaintenanceSnapshotDto }>("/reader/thumbnails/maintenance", { signal }).then((value) => value.snapshot),
    cleanupThumbnails: async (command, signal) => {
      const response = await request<{
        deleted?: number
        cutoff?: string
        result?: Omit<Extract<Contract.ReaderThumbnailCleanupResultDto, { kind: "invalid" }>, "kind">
      }>("/reader/thumbnails/maintenance/cleanup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(command),
        signal,
      })
      if (command.kind === "invalid") return { kind: command.kind, ...response.result! }
      if (command.kind === "expired")
        return {
          kind: command.kind,
          deleted: response.deleted!,
          cutoff: response.cutoff!,
        }
      if (command.kind === "path-prefix")
        return {
          kind: command.kind,
          prefix: command.prefix.trim(),
          deleted: response.deleted!,
        }
      return { kind: command.kind, deleted: response.deleted! }
    },
    clearThumbnailFolderManifests: (prefix, limit = 500, signal) =>
      request<{ deleted: number }>("/reader/thumbnails/maintenance/folder-manifests/clear", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prefix, limit }),
        signal,
      }).then((value) => value.deleted),
    clearThumbnailFailures: (limit = 500, signal) =>
      request<{ deleted: number }>("/reader/thumbnails/maintenance/failures/clear", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit }),
        signal,
      }).then((value) => value.deleted),
    openSystemPath: (path, signal) =>
      request<void>("/reader/files/open", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path }),
        signal,
      }),
    revealSystemPath: (path, signal) =>
      request<void>("/reader/files/reveal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path }),
        signal,
      }),
    openExternalUrl: (url, signal) =>
      request<void>("/reader/system/open-external-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
        signal,
      }),
    explorerContextMenuPreview: (signal) => request<Contract.ReaderExplorerContextMenuPreviewDto>("/reader/system/explorer-context-menu/preview", { signal }),
    explorerContextMenuStatus: (signal) => request<Contract.ReaderExplorerContextMenuStatusDto>("/reader/system/explorer-context-menu/status", { signal }),
    setExplorerContextMenuEnabled: (enabled, confirmed = false, signal) =>
      request<Contract.ReaderExplorerContextMenuStatusDto>("/reader/system/explorer-context-menu", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          enabled,
          ...(confirmed ? { confirmed: true } : {}),
        }),
        signal,
      }),
    executeFileOperations: (operations, confirmed = false, signal) =>
      request<Contract.ReaderFileOperationBatchResultDto>("/reader/files/operations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operations,
          ...(confirmed ? { confirmed: true } : {}),
        }),
        signal,
      }),
    fileUndoState: (signal) =>
      request<Contract.ReaderFileUndoStateDto>("/reader/files/operations", {
        signal,
      }),
    undoLatestFileOperations: (confirmed = false, signal) =>
      request<Contract.ReaderFileUndoResultDto>("/reader/files/undo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(confirmed ? { confirmed: true } : {}),
        signal,
      }),
    discardFileUndo: (confirmed = false, signal) =>
      request<Contract.ReaderFileUndoDiscardResultDto>("/reader/files/undo/discard", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(confirmed ? { confirmed: true } : {}),
        signal,
      }),
    startDirectorySelectionOperation: (sessionId, selection, kind, signal) =>
      request<Contract.ReaderDirectorySelectionOperationSnapshotDto>("/reader/files/selection-operations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, selection, kind, confirmed: true }),
        signal,
      }),
    directorySelectionOperation: (id, signal) =>
      request<Contract.ReaderDirectorySelectionOperationSnapshotDto>(`/reader/files/selection-operations/${encodeURIComponent(id)}`, { signal }),
    cancelDirectorySelectionOperation: (id, signal) =>
      request<
        Contract.ReaderDirectorySelectionOperationSnapshotDto & {
          cancelRequested: boolean
        }
      >(`/reader/files/selection-operations/${encodeURIComponent(id)}`, {
        method: "DELETE",
        signal,
      }),
    prepareDirectoryClipboard: (sessionId, selection, mode, signal) =>
      request<Contract.ReaderDirectoryClipboardSnapshotDto>("/reader/files/clipboard", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, selection, mode }),
        signal,
      }),
    directoryClipboard: (signal) => request<Contract.ReaderDirectoryClipboardSnapshotDto>("/reader/files/clipboard", { signal }),
    pasteDirectoryClipboard: (destinationPath, signal) =>
      request<Contract.ReaderDirectorySelectionOperationSnapshotDto>("/reader/files/clipboard/paste", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ destinationPath }),
        signal,
      }),
    clearDirectoryClipboard: (signal) => request<Contract.ReaderDirectoryClipboardSnapshotDto>("/reader/files/clipboard", { method: "DELETE", signal }),
    listRecent: (offset, limit, signal, query) => {
      const search = libraryQueryParams(offset, limit, query)
      return request<{ items: Contract.ReaderRecentDto[] }>(`/reader/library/recents?${search}`, { signal }).then((value) => value.items)
    },
    summarizeFolderProgress: (path, signal) =>
      request<Contract.ReaderFolderProgressSummaryDto>(`/reader/library/progress/folder?path=${encodeURIComponent(path)}`, { signal }),
    readOpdsCatalog: (url, signal) => request<Contract.ReaderOpdsCatalogDto>(`/reader/opds/catalog?url=${encodeURIComponent(url)}`, { signal }),
    searchOpdsCatalog: (template, query, signal) =>
      request<Contract.ReaderOpdsCatalogDto>(`/reader/opds/search?template=${encodeURIComponent(template)}&query=${encodeURIComponent(query)}`, { signal }),
    removeRecent: (bookId, signal) =>
      request<void>(`/reader/library/recents/${encodeURIComponent(bookId)}`, {
        method: "DELETE",
        signal,
      }),
    removeRecents: (ids, signal) =>
      request<Contract.ReaderRecentBatchRemoveResultDto>("/reader/library/recents/batch", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids }),
        signal,
      }),
    cleanupRecents: (cleanup, signal) =>
      request<Contract.ReaderRecentCleanupResultDto>("/reader/library/recents/cleanup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          cleanup.kind === "before"
            ? {
                before: cleanup.before,
                ...(cleanup.limit === undefined ? {} : { limit: cleanup.limit }),
              }
            : cleanup,
        ),
        signal,
      }),
    cleanupInvalidLibrary: (kind, signal) =>
      request<Contract.ReaderInvalidLibraryCleanupResultDto>("/reader/library/cleanup-invalid", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind }),
        signal,
      }),
    listBookmarks: (offset, limit, listId, signal, query) => {
      const search = libraryQueryParams(offset, limit, query)
      if (listId) search.set("listId", listId)
      return request<{ items: Contract.ReaderBookmarkDto[] }>(`/reader/library/bookmarks?${search}`, { signal }).then((value) => value.items)
    },
    findBookmarkByPath: (path, signal) =>
      request<{ item: Contract.ReaderBookmarkDto | null }>(`/reader/library/bookmarks/by-path?${new URLSearchParams({ path })}`, { signal }).then(
        (value) => value.item ?? undefined,
      ),
    saveBookmark: (bookmark, signal) =>
      request<Contract.ReaderBookmarkDto>("/reader/library/bookmarks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(bookmark),
        signal,
      }),
    updateBookmark: (id, patch, signal) =>
      request<Contract.ReaderBookmarkDto>(`/reader/library/bookmarks/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
        signal,
      }),
    updateBookmarks: (updates, signal) =>
      request<Contract.ReaderBookmarkBatchResultDto>("/reader/library/bookmarks/batch", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ updates }),
        signal,
      }),
    removeBookmark: (id, signal) =>
      request<void>(`/reader/library/bookmarks/${encodeURIComponent(id)}`, {
        method: "DELETE",
        signal,
      }),
    removeBookmarks: (ids, signal) =>
      request<Contract.ReaderBookmarkBatchRemoveResultDto>("/reader/library/bookmarks/batch", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids }),
        signal,
      }),
    listBookmarkLists: (signal) =>
      request<{ items: Contract.ReaderBookmarkListDto[] }>("/reader/library/bookmark-lists", { signal }).then((value) => value.items),
    libraryStatistics: (signal) => request<Contract.ReaderLibraryStatisticsDto>("/reader/library/statistics", { signal }),
    updateAiTranslation: (patch, signal) =>
      request<Contract.ReaderRuntimeConfigDto>("/reader/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
        signal,
      }).then(
        (config) =>
          config.aiTranslation ?? {
            enabled: false,
            autoTranslate: false,
            service: "disabled",
            ollamaUrl: "http://127.0.0.1:11434",
            ollamaModel: "",
            sourceLanguage: "ja",
            targetLanguage: "zh",
            promptTemplate: "",
            memoryCacheEntries: 1000,
          },
      ),
    updateEmm: (patch, signal) =>
      request<Contract.ReaderRuntimeConfigDto>("/reader/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
        signal,
      }).then(
        (config) =>
          config.emm ?? {
            enabled: true,
            databasePaths: [],
            defaultRating: 4.2,
          },
      ),
    probeEmm: (patch, signal) =>
      request<Contract.ReaderEmmConnectionProbeDto>("/reader/emm/config/probe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
        signal,
      }),
    aiCheck: (signal) => request<Contract.ReaderAiCheckDto>("/reader/ai/check", { signal }),
    aiModels: (signal) =>
      request<{ items: Contract.ReaderOllamaModelDto[] }>("/reader/ai/models", {
        signal,
      }).then((value) => value.items),
    aiTranslate: (body, signal) =>
      request<Contract.ReaderAiTranslationResultDto>("/reader/ai/translate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal,
      }),
    aiCacheStats: (signal) => request<Contract.ReaderAiCacheStatsDto>("/reader/ai/cache", { signal }),
    aiClearCache: (scope = "memory", signal) =>
      request<{ cleared: number; scope: string }>(`/reader/ai/cache?scope=${encodeURIComponent(scope)}`, {
        method: "DELETE",
        signal,
      }),
    saveBookmarkList: (list, signal) =>
      request<Contract.ReaderBookmarkListDto>("/reader/library/bookmark-lists", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(list),
        signal,
      }),
    removeBookmarkList: (id, signal) =>
      request<void>(`/reader/library/bookmark-lists/${encodeURIComponent(id)}`, {
        method: "DELETE",
        signal,
      }),
    listPlaylists: (signal) => request<{ items: Contract.ReaderPlaylistDto[] }>("/reader/library/playlists", { signal }).then((value) => value.items),
    savePlaylist: (playlist, signal) => request<Contract.ReaderPlaylistDto>("/reader/library/playlists", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(playlist), signal,
    }),
    removePlaylist: (id, signal) => request<void>(`/reader/library/playlists/${encodeURIComponent(id)}`, { method: "DELETE", signal }),
    listPlaylistEntries: (playlistId, signal) => request<{ items: Contract.ReaderPlaylistEntryDto[] }>(`/reader/library/playlists/${encodeURIComponent(playlistId)}/items`, { signal }).then((value) => value.items),
    appendPlaylistEntries: (playlistId, entries, signal) => request<{ items: Contract.ReaderPlaylistEntryDto[] }>(`/reader/library/playlists/${encodeURIComponent(playlistId)}/items`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entries }), signal,
    }).then((value) => value.items),
    removePlaylistEntries: (playlistId, ids, signal) => request<{ deleted: number }>(`/reader/library/playlists/${encodeURIComponent(playlistId)}/items`, {
      method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids }), signal,
    }).then((value) => value.deleted),
    reorderPlaylistEntries: (playlistId, ids, signal) => request<void>(`/reader/library/playlists/${encodeURIComponent(playlistId)}/items/order`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids }), signal,
    }),
    navigate: (sessionId, action, signal) =>
      request<Contract.ReaderNavigationDto>(`/reader/s/${encodeURIComponent(sessionId)}/navigate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
        signal,
      }),
    goTo: (sessionId, pageIndex, signal) =>
      request<Contract.ReaderNavigationDto>(`/reader/s/${encodeURIComponent(sessionId)}/navigate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "goTo", pageIndex }),
        signal,
      }),
    updateSessionOptions: (sessionId, patch, signal) =>
      request<Contract.ReaderNavigationDto>(`/reader/s/${encodeURIComponent(sessionId)}/options`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
        signal,
      }),
    updatePageOrder: (sessionId, patch, signal) =>
      request<
        Contract.ReaderNavigationDto & {
          pageOrder: Contract.ReaderPageOrderDto
        }
      >(`/reader/s/${encodeURIComponent(sessionId)}/page-order`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
        signal,
      }),
    close: (sessionId) =>
      request<void>(`/reader/s/${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
        keepalive: true,
      }),
  }
}

type ReaderLibraryThumbnailWarmupEvent =
  | { type: "start"; total: number }
  | {
      type: "item"
      index: number
      id: string
      status: "completed" | "failed"
      error?: string
    }
  | ({ type: "complete" } & Contract.ReaderLibraryThumbnailWarmupSummaryDto)

async function requestLibraryThumbnailWarmup(
  resolveConfig: () => LocalBackendConfig,
  items: readonly Contract.ReaderLibraryThumbnailRegistrationDto[],
  options: { mode?: "ensure" | "refresh"; concurrency?: number } | undefined,
  signal?: AbortSignal,
): Promise<Contract.ReaderLibraryThumbnailWarmupSummaryDto> {
  const config = resolveConfig()
  const headers = new Headers({ "content-type": "application/json" })
  if (config.token) headers.set("x-xiranite-token", config.token)
  const response = await fetch(new URL("/reader/library/thumbnails/prewarm", config.baseUrl), {
    method: "POST",
    headers,
    body: JSON.stringify({
      items: items.map(({ id, path, kind, previewCount }) => ({
        id,
        path,
        kind,
        previewCount,
      })),
      mode: options?.mode ?? "ensure",
      concurrency: options?.concurrency ?? 2,
    }),
    cache: "no-store",
    signal,
  })
  signal?.throwIfAborted()
  if (!response.ok) throw new ReaderHttpError(await responseError(response), response.status)
  if (!response.body) throw new Error("Thumbnail warmup response did not include a body.")
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let summary: Contract.ReaderLibraryThumbnailWarmupSummaryDto | undefined
  try {
    while (true) {
      const chunk = await reader.read()
      buffer += decoder.decode(chunk.value, { stream: !chunk.done })
      let newline = buffer.indexOf("\n")
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (line) summary = consumeLibraryThumbnailWarmupEvent(JSON.parse(line) as ReaderLibraryThumbnailWarmupEvent, summary)
        newline = buffer.indexOf("\n")
      }
      if (chunk.done) break
    }
    const tail = buffer.trim()
    if (tail) summary = consumeLibraryThumbnailWarmupEvent(JSON.parse(tail) as ReaderLibraryThumbnailWarmupEvent, summary)
  } catch (error) {
    await reader.cancel(error).catch(() => undefined)
    throw error
  } finally {
    reader.releaseLock()
  }
  signal?.throwIfAborted()
  if (!summary) throw new Error("Thumbnail warmup stream ended before completion.")
  return summary
}

function consumeLibraryThumbnailWarmupEvent(
  event: ReaderLibraryThumbnailWarmupEvent,
  summary: Contract.ReaderLibraryThumbnailWarmupSummaryDto | undefined,
): Contract.ReaderLibraryThumbnailWarmupSummaryDto | undefined {
  if (summary) throw new Error("Thumbnail warmup stream emitted data after completion.")
  if (event.type !== "complete") return undefined
  if (![event.total, event.completed, event.failed].every((value) => Number.isSafeInteger(value) && value >= 0)) {
    throw new Error("Thumbnail warmup stream returned an invalid summary.")
  }
  return {
    total: event.total,
    completed: event.completed,
    failed: event.failed,
  }
}

type ReaderDirectorySearchEvent =
  | {
      type: "meta"
      sessionId: string
      rootPath: string
      generation: number
      query: string
      mode: Contract.ReaderDirectorySearchModeDto
    }
  | {
      type: "entry"
      index: number
      entry: {
        name: string
        path: string
        kind: "directory" | "file" | "other"
      }
    }
  | { type: "complete"; scanned: number; matched: number; truncated: boolean }
  | { type: "error"; error: string }

async function requestDirectorySearch(
  url: URL,
  token: string | undefined,
  maximumResults: number,
  onEntries: ((entries: readonly Contract.ReaderDirectoryEntryDto[]) => void) | undefined,
  signal?: AbortSignal,
): Promise<Contract.ReaderDirectorySearchResultDto> {
  const headers = new Headers()
  if (token) headers.set("x-xiranite-token", token)
  const response = await fetch(url, { headers, cache: "no-store", signal })
  signal?.throwIfAborted()
  if (!response.ok) throw new ReaderHttpError(await responseError(response), response.status)
  if (!response.body) throw new Error("Reader search response did not include a body.")
  const reader = response.body.getReader()
  const cancelOnAbort = () => {
    void reader.cancel(signal?.reason).catch(() => undefined)
  }
  signal?.addEventListener("abort", cancelOnAbort, { once: true })
  const decoder = new TextDecoder()
  let buffer = ""
  let meta: Extract<ReaderDirectorySearchEvent, { type: "meta" }> | undefined
  let complete: Extract<ReaderDirectorySearchEvent, { type: "complete" }> | undefined
  const entries: Contract.ReaderDirectoryEntryDto[] = []
  let publishedEntries = 0
  try {
    while (true) {
      const chunk = await reader.read()
      buffer += decoder.decode(chunk.value, { stream: !chunk.done })
      let newline = buffer.indexOf("\n")
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (line) consumeDirectorySearchEvent(JSON.parse(line) as ReaderDirectorySearchEvent)
        newline = buffer.indexOf("\n")
      }
      if (chunk.done) break
    }
    const tail = buffer.trim()
    if (tail) consumeDirectorySearchEvent(JSON.parse(tail) as ReaderDirectorySearchEvent)
  } catch (error) {
    await reader.cancel(error).catch(() => undefined)
    throw error
  } finally {
    signal?.removeEventListener("abort", cancelOnAbort)
    reader.releaseLock()
  }
  signal?.throwIfAborted()
  if (!meta || !complete) throw new Error("Reader search stream ended before completion.")
  return {
    sessionId: meta.sessionId,
    rootPath: meta.rootPath,
    generation: meta.generation,
    query: meta.query,
    mode: meta.mode,
    entries,
    scanned: complete.scanned,
    matched: complete.matched,
    truncated: complete.truncated,
  }

  function consumeDirectorySearchEvent(event: ReaderDirectorySearchEvent) {
    if (complete) throw new Error("Reader search stream emitted data after completion.")
    if (event.type === "error") throw new Error(event.error)
    if (event.type === "meta") {
      if (meta) throw new Error("Reader search stream emitted duplicate metadata.")
      meta = event
      return
    }
    if (!meta) throw new Error("Reader search stream emitted data before metadata.")
    if (event.type === "entry") {
      if (event.index !== entries.length) throw new Error("Reader search stream entry indexes are not contiguous.")
      if (entries.length >= maximumResults) throw new Error("Reader search stream exceeded the requested result limit.")
      entries.push({
        name: event.entry.name,
        path: event.entry.path,
        kind: event.entry.kind,
        readerSupported: event.entry.kind !== "other",
      })
      if (entries.length - publishedEntries >= 16) {
        publishedEntries = entries.length
        onEntries?.([...entries])
      }
      return
    }
    if (event.matched !== entries.length) throw new Error("Reader search stream result count does not match its entries.")
    complete = event
  }
}

async function responseError(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type") ?? ""
  if (contentType.includes("application/json")) {
    const body = (await response.json().catch(() => undefined)) as { error?: unknown } | undefined
    if (typeof body?.error === "string" && body.error) return body.error
  }
  return (await response.text().catch(() => "")) || `Reader backend returned ${response.status}.`
}

function libraryQueryParams(offset: number, limit: number, query?: Contract.ReaderLibraryQueryDto): URLSearchParams {
  const search = new URLSearchParams({
    offset: String(offset),
    limit: String(limit),
  })
  if (query?.search) search.set("search", query.search)
  if (query?.sort) {
    search.set("sort", query.sort.field)
    search.set("order", query.sort.order)
  }
  return search
}

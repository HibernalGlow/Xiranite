import type { FrameSnapshot, PageDimensions, PageMediaKind, PageMode, ReaderFitMode, ViewSource } from "@xiranite/node-neoview/core"
import { resolveLocalBackendConfig, type LocalBackendConfig } from "@/backend/localBackendConfig"

export interface ReaderPageDto {
  id: string
  index: number
  name: string
  mediaKind: PageMediaKind
  mimeType?: string
  byteLength?: number
  dimensions?: PageDimensions
  contentVersion: string
  assetUrl: string
  thumbnailUrl?: string
}

export interface ReaderSessionDto {
  sessionId: string
  book: { id: string; displayName: string; pageCount: number }
  frame: FrameSnapshot
  visiblePages: ReaderPageDto[]
}

export interface ReaderNavigationDto {
  frame: FrameSnapshot
  visiblePages: ReaderPageDto[]
}

export interface ReaderPageListDto {
  pages: ReaderPageDto[]
  nextCursor?: number
  total: number
}

export interface ReaderMetadataDto {
  book: {
    displayName: string
    sourceKind: "path" | "directory" | "archive" | "image" | "media" | "document"
    sourcePath: string
    pageCount: number
    currentPage: number
    progressPercent: number
    byteLength?: number
    createdAtMs?: number
    modifiedAtMs?: number
  }
  page?: {
    index: number
    name: string
    displayPath: string
    mediaKind: PageMediaKind
    mimeType?: string
    byteLength?: number
    dimensions?: PageDimensions
    createdAtMs?: number
    modifiedAtMs?: number
  }
}

export interface ReaderRecentDto {
  bookId: string
  source: ViewSource
  displayName: string
  pageIndex: number
  pageCount: number
  updatedAt: number
}

export interface ReaderBookmarkDto {
  id: string
  source: ViewSource
  name: string
  kind: "file" | "folder"
  starred: boolean
  createdAt: number
  updatedAt: number
  listIds: readonly string[]
}

export interface ReaderBookmarkListDto {
  id: string
  name: string
  isFavorite: boolean
  createdAt: number
  updatedAt: number
  system?: boolean
}

export interface SaveReaderBookmarkDto {
  id?: string
  source: ViewSource
  name: string
  kind?: "file" | "folder"
  starred?: boolean
  createdAt?: number
  listIds?: readonly string[]
}

export interface ReaderDirectoryEntryDto {
  name: string
  path: string
  kind: "directory" | "file" | "other"
  readerSupported: boolean
  modifiedAt?: number
  size?: number
  rating?: number
  collectTagCount?: number
}

export type ReaderDirectorySortFieldDto = "name" | "date" | "size" | "type" | "random" | "rating" | "path" | "collectTagCount"
export type ReaderDirectorySortOrderDto = "asc" | "desc"

export interface ReaderDirectorySortDto {
  field: ReaderDirectorySortFieldDto
  order: ReaderDirectorySortOrderDto
  directoriesFirst: boolean
}

export type ReaderDirectorySortSourceDto = "temporary" | "memory" | "tab-default" | "global-default"
export type ReaderDirectorySortPreferenceCommandDto =
  | { action: "temporary"; enabled: boolean }
  | { action: "set-default"; scope: "global" | "tab" }
  | { action: "clear-memory"; scope: "current" | "all" }

export interface ReaderDirectoryPageDto {
  sessionId: string
  path: string
  parentPath?: string
  entries: ReaderDirectoryEntryDto[]
  cursor: number
  nextCursor?: number
  total: number
  canGoBack: boolean
  canGoForward: boolean
  generation: number
  sort: ReaderDirectorySortDto
  sortFields: ReaderDirectorySortFieldDto[]
  sortSource: ReaderDirectorySortSourceDto
  sortTemporary: boolean
  globalDefaultSort: ReaderDirectorySortDto
  tabDefaultSort: ReaderDirectorySortDto
  suggestedSelection?: { path: string; index: number }
}

export interface ReaderLibraryThumbnailDto {
  id: string
  thumbnailUrl: string
  contentVersion: string
}

export interface ReaderLibraryThumbnailBatchDto {
  contextId: string
  generation: number
  items: ReaderLibraryThumbnailDto[]
}

export interface ReaderLibraryThumbnailRegistrationDto {
  id: string
  path: string
  kind: "file" | "folder"
}

export type ReaderDirectoryNavigationDto =
  | { action: "path"; path: string }
  | { action: "back" | "forward" | "up" | "refresh" }

export interface ReaderShellConfigDto {
  revision?: number
  showDelayMs: number
  hideDelayMs: number
  opacity: { top: number; bottom: number; sidebar: number }
  blur: { top: number; bottom: number; sidebar: number }
  edges: Record<"top" | "right" | "bottom" | "left", { enabled: boolean; initialVisible: boolean; pinned: boolean; triggerSize: number }>
  sidebars: Record<"left" | "right", { width: number; height: "full" | "two-thirds" | "half" | "one-third" | "custom"; customHeight: number; verticalAlign: number; horizontalPosition: number }>
  panelLayout: Record<string, { visible: boolean; order: number; position: "left" | "right" | "bottom" | "floating" }>
  cardLayout: Record<string, { panelId: string; visible: boolean; expanded: boolean; order: number; height?: number }>
}

export interface ReaderRuntimeConfigDto {
  shell: ReaderShellConfigDto
  viewDefaults: { fitMode: ReaderFitMode; pageMode: PageMode }
  slideshow: ReaderSlideshowConfig
}

export interface ReaderViewDefaultsPatch {
  viewDefaults: { fitMode?: ReaderFitMode; pageMode?: PageMode }
}

export interface ReaderSlideshowConfig {
  intervalSeconds: number
  loop: boolean
  random: boolean
  fadeTransition: boolean
}

export interface ReaderSlideshowPatch {
  slideshow: Partial<ReaderSlideshowConfig>
}

export interface ReaderSidebarLayoutPatch {
  side: "left" | "right"
  pinned?: boolean
  width?: number
  height?: ReaderShellConfigDto["sidebars"]["left"]["height"]
  customHeight?: number
  verticalAlign?: number
  horizontalPosition?: number
}

export interface ReaderCardLayoutPatch {
  cardId: string
  panelId?: string
  visible?: boolean
  expanded?: boolean
  order?: number
  height?: number | null
}

export interface ReaderBoardLayoutPatch {
  expectedRevision: number
  board: {
    panels: Array<{ id: string; visible: boolean; order: number; position: ReaderShellConfigDto["panelLayout"][string]["position"] }>
    cards: Array<{ cardId: string; panelId: string; visible: boolean; order: number }>
  }
}

export interface ReaderHttpClient {
  config(signal?: AbortSignal): Promise<ReaderRuntimeConfigDto>
  updateSidebarLayout(patch: ReaderSidebarLayoutPatch, signal?: AbortSignal): Promise<ReaderShellConfigDto>
  updateCardLayout(patch: ReaderCardLayoutPatch, signal?: AbortSignal): Promise<ReaderShellConfigDto>
  updateBoardLayout(patch: ReaderBoardLayoutPatch, signal?: AbortSignal): Promise<ReaderShellConfigDto>
  updateViewDefaults(patch: ReaderViewDefaultsPatch, signal?: AbortSignal): Promise<ReaderRuntimeConfigDto["viewDefaults"]>
  updateSlideshow(patch: ReaderSlideshowPatch, signal?: AbortSignal): Promise<ReaderSlideshowConfig>
  open(path: string, signal?: AbortSignal): Promise<ReaderSessionDto>
  openDirectoryBrowser?(path: string, signal?: AbortSignal, scopeId?: string): Promise<ReaderDirectoryPageDto>
  listDirectoryBrowser?(sessionId: string, cursor: number, limit: number, signal?: AbortSignal): Promise<ReaderDirectoryPageDto>
  navigateDirectoryBrowser?(sessionId: string, navigation: ReaderDirectoryNavigationDto, signal?: AbortSignal): Promise<ReaderDirectoryPageDto>
  sortDirectoryBrowser?(sessionId: string, sort: ReaderDirectorySortDto, focusPath?: string, signal?: AbortSignal): Promise<ReaderDirectoryPageDto>
  updateDirectorySortPreference?(
    sessionId: string,
    command: ReaderDirectorySortPreferenceCommandDto,
    focusPath?: string,
    signal?: AbortSignal,
  ): Promise<ReaderDirectoryPageDto>
  closeDirectoryBrowser?(sessionId: string): Promise<void>
  registerLibraryThumbnails?(
    contextId: string,
    generation: number,
    items: readonly ReaderLibraryThumbnailRegistrationDto[],
    signal?: AbortSignal,
  ): Promise<ReaderLibraryThumbnailBatchDto>
  releaseLibraryThumbnailContext?(contextId: string): Promise<void>
  listPages(sessionId: string, cursor: number, limit: number, signal?: AbortSignal): Promise<ReaderPageListDto>
  listPageCatalog?(sessionId: string, cursor: number, limit: number, options: { query?: string; thumbnails?: boolean }, signal?: AbortSignal): Promise<ReaderPageListDto>
  metadata?(sessionId: string, signal?: AbortSignal): Promise<ReaderMetadataDto>
  listRecent?(offset: number, limit: number, signal?: AbortSignal): Promise<readonly ReaderRecentDto[]>
  removeRecent?(bookId: string, signal?: AbortSignal): Promise<void>
  listBookmarks?(offset: number, limit: number, listId?: string, signal?: AbortSignal): Promise<readonly ReaderBookmarkDto[]>
  saveBookmark?(bookmark: SaveReaderBookmarkDto, signal?: AbortSignal): Promise<ReaderBookmarkDto>
  removeBookmark?(id: string, signal?: AbortSignal): Promise<void>
  listBookmarkLists?(signal?: AbortSignal): Promise<readonly ReaderBookmarkListDto[]>
  saveBookmarkList?(list: { id?: string; name: string; isFavorite?: boolean }, signal?: AbortSignal): Promise<ReaderBookmarkListDto>
  removeBookmarkList?(id: string, signal?: AbortSignal): Promise<void>
  navigate(sessionId: string, action: "next" | "previous", signal?: AbortSignal): Promise<ReaderNavigationDto>
  goTo(sessionId: string, pageIndex: number, signal?: AbortSignal): Promise<ReaderNavigationDto>
  updateSessionOptions(sessionId: string, patch: { layout: { pageMode: PageMode } }, signal?: AbortSignal): Promise<ReaderNavigationDto>
  close(sessionId: string): Promise<void>
}

export class ReaderHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = "ReaderHttpError"
  }
}

export function createReaderHttpClient(
  resolveConfig: () => LocalBackendConfig = resolveLocalBackendConfig,
): ReaderHttpClient {
  const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const config = resolveConfig()
    const url = new URL(path, config.baseUrl)
    const headers = new Headers(init.headers)
    if (config.token) headers.set("x-xiranite-token", config.token)
    const response = await fetch(url, { ...init, headers, cache: "no-store" })
    if (!response.ok) throw new ReaderHttpError(await responseError(response), response.status)
    if (response.status === 204) return undefined as T
    return await response.json() as T
  }

  return {
    config: (signal) => request<ReaderRuntimeConfigDto>("/reader/config", { signal }),
    updateSidebarLayout: (patch, signal) => request<{ shell: ReaderShellConfigDto }>("/reader/config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
      signal,
    }).then((value) => value.shell),
    updateCardLayout: (patch, signal) => request<{ shell: ReaderShellConfigDto }>("/reader/config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
      signal,
    }).then((value) => value.shell),
    updateBoardLayout: (patch, signal) => request<{ shell: ReaderShellConfigDto }>("/reader/config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
      signal,
    }).then((value) => value.shell),
    updateViewDefaults: (patch, signal) => request<ReaderRuntimeConfigDto>("/reader/config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
      signal,
    }).then((value) => value.viewDefaults),
    updateSlideshow: (patch, signal) => request<ReaderRuntimeConfigDto>("/reader/config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
      signal,
    }).then((value) => value.slideshow),
    open: (path, signal) => request<ReaderSessionDto>("/reader/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path }),
      signal,
    }),
    openDirectoryBrowser: (path, signal, scopeId) => request<ReaderDirectoryPageDto>("/reader/browser/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path, scopeId }),
      signal,
    }),
    listDirectoryBrowser: (sessionId, cursor, limit, signal) => request<ReaderDirectoryPageDto>(
      `/reader/browser/s/${encodeURIComponent(sessionId)}/entries?cursor=${cursor}&limit=${limit}`,
      { signal },
    ),
    navigateDirectoryBrowser: (sessionId, navigation, signal) => request<ReaderDirectoryPageDto>(
      `/reader/browser/s/${encodeURIComponent(sessionId)}/navigate`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(navigation),
        signal,
      },
    ),
    sortDirectoryBrowser: (sessionId, sort, focusPath, signal) => request<ReaderDirectoryPageDto>(
      `/reader/browser/s/${encodeURIComponent(sessionId)}/sort`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...sort, focusPath }),
        signal,
      },
    ),
    updateDirectorySortPreference: (sessionId, command, focusPath, signal) => request<ReaderDirectoryPageDto>(
      `/reader/browser/s/${encodeURIComponent(sessionId)}/sort/preferences`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...command, focusPath }),
        signal,
      },
    ),
    closeDirectoryBrowser: (sessionId) => request<void>(`/reader/browser/s/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
      keepalive: true,
    }),
    registerLibraryThumbnails: (contextId, generation, items, signal) => request<ReaderLibraryThumbnailBatchDto>(
      "/reader/library/thumbnails",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contextId, generation, items }),
        signal,
      },
    ),
    releaseLibraryThumbnailContext: (contextId) => request<void>(
      `/reader/library/contexts/${encodeURIComponent(contextId)}`,
      { method: "DELETE", keepalive: true },
    ),
    listPages: (sessionId, cursor, limit, signal) => request<ReaderPageListDto>(
      `/reader/s/${encodeURIComponent(sessionId)}/pages?cursor=${cursor}&limit=${limit}`,
      { signal },
    ),
    listPageCatalog: (sessionId, cursor, limit, options, signal) => {
      const search = new URLSearchParams({ cursor: String(cursor), limit: String(limit) })
      if (options.query) search.set("query", options.query)
      if (options.thumbnails === false) search.set("thumbnails", "0")
      return request<ReaderPageListDto>(`/reader/s/${encodeURIComponent(sessionId)}/pages?${search}`, { signal })
    },
    metadata: (sessionId, signal) => request<ReaderMetadataDto>(`/reader/s/${encodeURIComponent(sessionId)}/metadata`, { signal }),
    listRecent: (offset, limit, signal) => request<{ items: ReaderRecentDto[] }>(
      `/reader/library/recents?offset=${offset}&limit=${limit}`,
      { signal },
    ).then((value) => value.items),
    removeRecent: (bookId, signal) => request<void>(`/reader/library/recents/${encodeURIComponent(bookId)}`, {
      method: "DELETE",
      signal,
    }),
    listBookmarks: (offset, limit, listId, signal) => {
      const search = new URLSearchParams({ offset: String(offset), limit: String(limit) })
      if (listId) search.set("listId", listId)
      return request<{ items: ReaderBookmarkDto[] }>(`/reader/library/bookmarks?${search}`, { signal }).then((value) => value.items)
    },
    saveBookmark: (bookmark, signal) => request<ReaderBookmarkDto>("/reader/library/bookmarks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(bookmark),
      signal,
    }),
    removeBookmark: (id, signal) => request<void>(`/reader/library/bookmarks/${encodeURIComponent(id)}`, {
      method: "DELETE",
      signal,
    }),
    listBookmarkLists: (signal) => request<{ items: ReaderBookmarkListDto[] }>(
      "/reader/library/bookmark-lists",
      { signal },
    ).then((value) => value.items),
    saveBookmarkList: (list, signal) => request<ReaderBookmarkListDto>("/reader/library/bookmark-lists", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(list),
      signal,
    }),
    removeBookmarkList: (id, signal) => request<void>(`/reader/library/bookmark-lists/${encodeURIComponent(id)}`, {
      method: "DELETE",
      signal,
    }),
    navigate: (sessionId, action, signal) => request<ReaderNavigationDto>(
      `/reader/s/${encodeURIComponent(sessionId)}/navigate`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
        signal,
      },
    ),
    goTo: (sessionId, pageIndex, signal) => request<ReaderNavigationDto>(
      `/reader/s/${encodeURIComponent(sessionId)}/navigate`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "goTo", pageIndex }),
        signal,
      },
    ),
    updateSessionOptions: (sessionId, patch, signal) => request<ReaderNavigationDto>(
      `/reader/s/${encodeURIComponent(sessionId)}/options`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
        signal,
      },
    ),
    close: (sessionId) => request<void>(`/reader/s/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
      keepalive: true,
    }),
  }
}

async function responseError(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type") ?? ""
  if (contentType.includes("application/json")) {
    const body = await response.json().catch(() => undefined) as { error?: unknown } | undefined
    if (typeof body?.error === "string" && body.error) return body.error
  }
  return await response.text().catch(() => "") || `Reader backend returned ${response.status}.`
}

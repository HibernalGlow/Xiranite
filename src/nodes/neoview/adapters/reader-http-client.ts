import type { FrameSnapshot, PageDimensions, PageMediaKind } from "@xiranite/node-neoview/core"
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

export interface ReaderShellConfigDto {
  showDelayMs: number
  hideDelayMs: number
  opacity: { top: number; bottom: number; sidebar: number }
  blur: { top: number; bottom: number; sidebar: number }
  edges: Record<"top" | "right" | "bottom" | "left", { enabled: boolean; initialVisible: boolean; pinned: boolean; triggerSize: number }>
  sidebars: Record<"left" | "right", { width: number; height: "full" | "two-thirds" | "half" | "one-third" | "custom"; customHeight: number; verticalAlign: number; horizontalPosition: number }>
}

export interface ReaderHttpClient {
  config(signal?: AbortSignal): Promise<ReaderShellConfigDto>
  open(path: string, signal?: AbortSignal): Promise<ReaderSessionDto>
  listPages(sessionId: string, cursor: number, limit: number, signal?: AbortSignal): Promise<ReaderPageListDto>
  navigate(sessionId: string, action: "next" | "previous", signal?: AbortSignal): Promise<ReaderNavigationDto>
  goTo(sessionId: string, pageIndex: number, signal?: AbortSignal): Promise<ReaderNavigationDto>
  close(sessionId: string): Promise<void>
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
    if (!response.ok) throw new Error(await responseError(response))
    if (response.status === 204) return undefined as T
    return await response.json() as T
  }

  return {
    config: (signal) => request<{ shell: ReaderShellConfigDto }>("/reader/config", { signal }).then((value) => value.shell),
    open: (path, signal) => request<ReaderSessionDto>("/reader/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path }),
      signal,
    }),
    listPages: (sessionId, cursor, limit, signal) => request<ReaderPageListDto>(
      `/reader/s/${encodeURIComponent(sessionId)}/pages?cursor=${cursor}&limit=${limit}`,
      { signal },
    ),
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

import type {
  HeadlessPageStream,
  HeadlessReaderPageSnapshot,
  HeadlessReaderSnapshot,
  OpenHeadlessReaderInput,
} from "../../application/headless/ReaderHeadlessController.js"
import type { ReaderPageDto, ReaderSessionDto } from "../asset-route/ReaderHttpController.js"

interface ReaderFrameDto {
  frame: ReaderSessionDto["frame"]
  visiblePages: ReaderPageDto[]
  preload?: ReaderSessionDto["preload"]
}

interface ReaderPageListDto {
  pages: ReaderPageDto[]
  nextCursor?: number
  total: number
}

export interface RemoteReaderHeadlessOptions {
  baseUrl: string
  token: string
  fetch?: typeof fetch
}

/** Headless adapter over the running XR Reader controller. It owns only sessions it creates. */
export class RemoteReaderHeadlessController implements AsyncDisposable {
  readonly #baseUrl: URL
  readonly #headers: Readonly<Record<string, string>>
  readonly #fetch: typeof fetch
  #session: ReaderSessionDto | undefined
  #pageAssets = new Map<number, ReaderPageDto>()
  #closed = false
  #disposing: Promise<void> | undefined

  constructor(options: RemoteReaderHeadlessOptions) {
    this.#baseUrl = normalizeLoopbackBaseUrl(options.baseUrl)
    const token = options.token.trim()
    if (!token) throw new Error("Xiranite backend token must be non-empty.")
    this.#headers = { "x-xiranite-token": token }
    this.#fetch = options.fetch ?? globalThis.fetch
  }

  get isOpen(): boolean {
    return this.#session !== undefined
  }

  async open(input: OpenHeadlessReaderInput): Promise<HeadlessReaderSnapshot> {
    this.#assertOpen()
    const path = input.path.trim()
    if (!path) throw new Error("Reader path must be a non-empty string.")
    input.signal?.throwIfAborted()
    const body: Record<string, unknown> = {
      path,
      initialPage: input.initialPage,
      entryPaths: input.entryPaths,
    }
    if (input.archivePasswords?.length) {
      body.archivePasswords = input.archivePasswords.map((credential) => ({
        entryPaths: credential.entryPaths,
        password: new TextDecoder().decode(credential.rawPassword),
      }))
    }
    const next = await this.#json<ReaderSessionDto>("/reader/sessions", {
      method: "POST",
      body: JSON.stringify(body),
      signal: input.signal,
    })
    try {
      assertSessionDto(next)
      this.#assertAssetUrls(next.visiblePages)
    } catch (error) {
      if (next && typeof next.sessionId === "string") await this.#closeRemoteSession(next.sessionId).catch(() => undefined)
      throw error
    }
    const previous = this.#session
    this.#session = next
    this.#pageAssets.clear()
    this.#replaceVisiblePages(next.visiblePages)
    if (previous) await this.#closeRemoteSession(previous.sessionId)
    return snapshotOf(next)
  }

  inspect(): HeadlessReaderSnapshot {
    this.#assertOpen()
    return snapshotOf(this.#requireSession())
  }

  async listPages(cursor = 0, limit = 100, signal?: AbortSignal): Promise<readonly HeadlessReaderPageSnapshot[]> {
    const session = this.#requireSession()
    const query = new URLSearchParams({ cursor: String(cursor), limit: String(limit), thumbnails: "0" })
    const result = await this.#json<ReaderPageListDto>(
      `/reader/s/${encodeURIComponent(session.sessionId)}/pages?${query}`,
      { signal },
    )
    if (!result || !Array.isArray(result.pages) || !Number.isSafeInteger(result.total)) {
      throw new Error("Xiranite Reader returned an invalid page-list response.")
    }
    for (const page of result.pages) {
      assertPageDto(page)
      this.#assertAssetUrl(page)
      this.#pageAssets.set(page.index, page)
    }
    return result.pages.map(pageSnapshot)
  }

  next(signal?: AbortSignal): Promise<HeadlessReaderSnapshot> {
    return this.#navigate({ action: "next" }, signal)
  }

  previous(signal?: AbortSignal): Promise<HeadlessReaderSnapshot> {
    return this.#navigate({ action: "previous" }, signal)
  }

  goTo(pageIndex: number, signal?: AbortSignal): Promise<HeadlessReaderSnapshot> {
    return this.#navigate({ action: "goTo", pageIndex }, signal)
  }

  async openPageStream(pageIndex: number, signal?: AbortSignal): Promise<HeadlessPageStream> {
    this.#requireSession()
    let page = this.#pageAssets.get(pageIndex)
    if (!page) {
      await this.listPages(pageIndex, 1, signal)
      page = this.#pageAssets.get(pageIndex)
    }
    if (!page) throw new RangeError(`Reader page index is out of range: ${pageIndex}`)
    const response = await this.#fetch(page.assetUrl, { headers: this.#headers, signal })
    if (!response.ok || !response.body) throw await responseError(response, "Reader page stream")
    return new RemoteHeadlessPageStream(pageSnapshot(page), response.body, optionalLength(response), response.headers.get("content-type") ?? page.mimeType)
  }

  async closeBook(): Promise<void> {
    const session = this.#session
    this.#session = undefined
    this.#pageAssets.clear()
    if (session) await this.#closeRemoteSession(session.sessionId)
  }

  [Symbol.asyncDispose](): Promise<void> {
    if (this.#disposing) return this.#disposing
    this.#closed = true
    this.#disposing = this.closeBook()
    return this.#disposing
  }

  async #navigate(body: Record<string, unknown>, signal?: AbortSignal): Promise<HeadlessReaderSnapshot> {
    const session = this.#requireSession()
    const result = await this.#json<ReaderFrameDto>(
      `/reader/s/${encodeURIComponent(session.sessionId)}/navigate`,
      { method: "POST", body: JSON.stringify(body), signal },
    )
    if (!result || !result.frame || !Array.isArray(result.visiblePages)) {
      throw new Error("Xiranite Reader returned an invalid navigation response.")
    }
    for (const page of result.visiblePages) {
      assertPageDto(page)
      this.#assertAssetUrl(page)
    }
    session.frame = result.frame
    session.visiblePages = result.visiblePages
    session.preload = result.preload
    this.#replaceVisiblePages(result.visiblePages)
    return snapshotOf(session)
  }

  async #json<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers)
    headers.set("x-xiranite-token", this.#headers["x-xiranite-token"]!)
    if (init.body !== undefined) headers.set("content-type", "application/json")
    const response = await this.#fetch(new URL(path, this.#baseUrl), { ...init, headers })
    if (!response.ok) throw await responseError(response, "Xiranite Reader request")
    return await response.json() as T
  }

  async #closeRemoteSession(sessionId: string): Promise<void> {
    const response = await this.#fetch(new URL(`/reader/s/${encodeURIComponent(sessionId)}`, this.#baseUrl), {
      method: "DELETE",
      headers: this.#headers,
      keepalive: true,
    })
    if (!response.ok && response.status !== 404) throw await responseError(response, "Reader session close")
  }

  #replaceVisiblePages(pages: readonly ReaderPageDto[]): void {
    for (const page of pages) this.#pageAssets.set(page.index, page)
  }

  #assertAssetUrls(pages: readonly ReaderPageDto[]): void {
    for (const page of pages) this.#assertAssetUrl(page)
  }

  #assertAssetUrl(page: ReaderPageDto): void {
    let asset: URL
    try { asset = new URL(page.assetUrl) } catch { throw new Error("Xiranite Reader returned an invalid page asset URL.") }
    if (asset.origin !== this.#baseUrl.origin || !asset.pathname.startsWith("/reader/s/")) {
      throw new Error("Xiranite Reader returned a page asset URL outside the connected backend.")
    }
  }

  #requireSession(): ReaderSessionDto {
    this.#assertOpen()
    if (!this.#session) throw new Error("No reader book is open.")
    return this.#session
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("Remote headless reader is closed.")
  }
}

class RemoteHeadlessPageStream implements HeadlessPageStream {
  #closing: Promise<void> | undefined

  constructor(
    readonly page: HeadlessReaderPageSnapshot,
    readonly stream: ReadableStream<Uint8Array>,
    readonly byteLength?: number,
    readonly contentType?: string,
  ) {}

  close(): Promise<void> {
    this.#closing ??= this.stream.cancel("remote headless page stream closed").then(() => undefined, () => undefined)
    return this.#closing
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.close()
  }
}

function snapshotOf(session: ReaderSessionDto): HeadlessReaderSnapshot {
  return {
    book: { displayName: session.book.displayName, pageCount: session.book.pageCount },
    frame: session.frame,
    visiblePages: session.visiblePages.map(pageSnapshot),
    preload: session.preload,
  }
}

function pageSnapshot(page: ReaderPageDto): HeadlessReaderPageSnapshot {
  return {
    id: page.id,
    index: page.index,
    name: page.name,
    mediaKind: page.mediaKind,
    mimeType: page.mimeType,
    byteLength: page.byteLength,
    dimensions: page.dimensions ? { ...page.dimensions } : undefined,
    contentVersion: page.contentVersion,
  }
}

function normalizeLoopbackBaseUrl(value: string): URL {
  let url: URL
  try { url = new URL(value) } catch { throw new Error(`Invalid Xiranite backend URL: ${value}`) }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Xiranite backend URL must use HTTP or HTTPS.")
  if (!isLoopback(url.hostname)) throw new Error("Remote Reader currently accepts loopback backend URLs only.")
  if (url.username || url.password || url.search || url.hash) throw new Error("Xiranite backend URL cannot contain credentials, query or fragment.")
  url.pathname = url.pathname.replace(/\/*$/u, "/")
  return url
}

function isLoopback(hostname: string): boolean {
  const host = hostname.toLocaleLowerCase().replace(/^\[|\]$/gu, "")
  if (host === "localhost" || host === "::1") return true
  const octets = host.split(".")
  return octets.length === 4
    && octets[0] === "127"
    && octets.every((octet) => /^\d{1,3}$/u.test(octet) && Number(octet) <= 255)
}

function assertSessionDto(value: ReaderSessionDto): void {
  if (!value || typeof value.sessionId !== "string" || !value.sessionId || !value.book || !value.frame || !Array.isArray(value.visiblePages)) {
    throw new Error("Xiranite Reader returned an invalid session response.")
  }
  if (typeof value.book.displayName !== "string" || !Number.isSafeInteger(value.book.pageCount) || value.book.pageCount < 0) {
    throw new Error("Xiranite Reader returned invalid book metadata.")
  }
  for (const page of value.visiblePages) assertPageDto(page)
}

function assertPageDto(page: ReaderPageDto): void {
  if (
    !page
    || typeof page.id !== "string"
    || typeof page.name !== "string"
    || !Number.isSafeInteger(page.index)
    || page.index < 0
    || typeof page.assetUrl !== "string"
    || typeof page.contentVersion !== "string"
    || (page.mediaKind !== "image" && page.mediaKind !== "animated-image" && page.mediaKind !== "video")
  ) {
    throw new Error("Xiranite Reader returned invalid page metadata.")
  }
}

async function responseError(response: Response, operation: string): Promise<Error> {
  let detail = ""
  try {
    const body = await response.json() as { error?: unknown }
    if (typeof body.error === "string") detail = `: ${body.error}`
  } catch {}
  return new Error(`${operation} failed (${response.status})${detail}`)
}

function optionalLength(response: Response): number | undefined {
  const value = Number(response.headers.get("content-length"))
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

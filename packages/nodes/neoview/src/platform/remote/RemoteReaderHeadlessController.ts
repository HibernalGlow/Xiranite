import type {
  HeadlessReaderEmmMetadataUpdate,
  HeadlessPageStream,
  HeadlessReaderBookSettingsUpdate,
  HeadlessReaderPageSnapshot,
  HeadlessReaderSnapshot,
  OpenHeadlessReaderInput,
} from "../../application/headless/ReaderHeadlessController.js"
import {
  ReaderEmmMetadataSnapshotSchema,
  type ReaderEmmMetadataPatch,
  type ReaderEmmMetadataSnapshot,
} from "../../application/metadata/ReaderEmmMetadataService.js"
import {
  parseReaderBookSettingsSnapshot,
  type ReaderBookSettingsPatch,
  type ReaderBookSettingsSnapshot,
} from "../../application/reader/ReaderBookSettingsService.js"
import type { ReaderSubtitleTrack } from "../../application/reader/ReaderSubtitleService.js"
import type { ReaderDiagnosticsHistory, ReaderDiagnosticsSnapshot } from "../../application/diagnostics/ReaderDiagnosticsService.js"
import { parseReaderDiagnosticsHistory, parseReaderDiagnosticsSnapshot } from "../../application/diagnostics/ReaderDiagnosticsWireSchema.js"
import type { ReaderThumbnailMaintenanceSnapshot } from "../../ports/ReaderThumbnailStore.js"
import type { ReaderPageDto, ReaderSessionDto } from "../asset-route/ReaderHttpController.js"
import type { ReaderAdjacentBookDirection } from "../../application/reader/ReaderAdjacentBookService.js"
import type { ReaderDirectorySortRule } from "../../application/browser/ReaderDirectorySort.js"
import { z } from "zod"

export type RemoteSuperResolutionPreloadMode = "nearby" | "progressive"

const skippedPolicyDecisionSchema = z.object({
    kind: z.enum(["disabled", "skip"]),
    reason: z.string(),
    conditionId: z.string().optional(),
    conditionName: z.string().optional(),
  }).strict()

const runPolicyDecisionSchema = z.object({
    kind: z.literal("run"),
    reason: z.string(),
    conditionId: z.string().optional(),
    conditionName: z.string().optional(),
    modelId: z.string(),
    scale: z.number().positive(),
    noise: z.number().optional(),
    tileSize: z.number().int().positive().optional(),
    tta: z.boolean().optional(),
    gpuId: z.string().optional(),
    useCache: z.boolean(),
  }).strict()

const artifactExecutionSchema = z.object({
  modelId: z.string(),
  engine: z.enum(["upscayl", "waifu2x", "realcugan"]),
  scale: z.number().positive(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  elapsedMs: z.number().nonnegative(),
}).strict()

const artifactDescriptorFields = {
  artifactUrl: z.string().url(),
  contentType: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  version: z.string().min(1),
}

const remoteSuperResolutionArtifactResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.enum(["hit", "shared"]), ...artifactDescriptorFields }).strict(),
  z.object({ status: z.literal("generated"), ...artifactDescriptorFields, execution: artifactExecutionSchema }).strict(),
  z.object({ status: z.literal("skipped"), decision: skippedPolicyDecisionSchema }).strict(),
  z.object({ status: z.literal("bypassed"), decision: runPolicyDecisionSchema }).strict(),
  z.object({ status: z.literal("rejected"), execution: artifactExecutionSchema.optional() }).strict(),
])

export type RemoteSuperResolutionArtifactResult = z.infer<typeof remoteSuperResolutionArtifactResultSchema>

const preloadSnapshotSchema = z.object({
  contextId: z.string().min(1),
  generation: z.number().int().nonnegative(),
  mode: z.enum(["nearby", "progressive"]),
  state: z.enum(["queued", "countdown", "running", "completed", "disabled", "empty", "paused", "cancelled", "failed"]),
  planned: z.number().int().nonnegative(),
  settled: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  progress: z.number().min(0).max(1),
  startedAt: z.number().nonnegative(),
  updatedAt: z.number().nonnegative(),
  completedAt: z.number().nonnegative().optional(),
}).strict()

const preloadEnvelopeSchema = z.object({ snapshots: z.array(preloadSnapshotSchema).max(256) }).strict()

export type RemoteSuperResolutionPreloadSnapshot = z.infer<typeof preloadSnapshotSchema>

const artifactCacheSnapshotSchema = z.object({
  entries: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  maxBytes: z.number().int().nonnegative(),
  maxEntryBytes: z.number().int().nonnegative(),
  activeLeases: z.number().int().nonnegative(),
  hits: z.number().int().nonnegative(),
  misses: z.number().int().nonnegative(),
  writes: z.number().int().nonnegative(),
  rejectedWrites: z.number().int().nonnegative(),
  evictions: z.number().int().nonnegative(),
  integrityFailures: z.number().int().nonnegative(),
}).strict()

const artifactCacheCleanupSchema = artifactCacheSnapshotSchema.extend({
  reason: z.enum(["age", "budget", "book", "explicit", "low-disk"]),
  removedEntries: z.number().int().nonnegative(),
  removedBytes: z.number().int().nonnegative(),
}).strict()

const artifactCacheCleanupKindSchema = z.enum(["age", "book", "all"])

export type RemoteSuperResolutionArtifactCacheSnapshot = z.infer<typeof artifactCacheSnapshotSchema>
export type RemoteSuperResolutionArtifactCacheCleanupResult = z.infer<typeof artifactCacheCleanupSchema>
export type RemoteSuperResolutionArtifactCacheCleanupKind = z.infer<typeof artifactCacheCleanupKindSchema>

const thumbnailWriterSnapshotSchema = z.object({
  pendingWrites: z.number().int().nonnegative(),
  flushing: z.boolean(),
  committedBatches: z.number().int().nonnegative(),
  committedWrites: z.number().int().nonnegative(),
  busyRetries: z.number().int().nonnegative(),
  failedBatches: z.number().int().nonnegative(),
  lastError: z.string().optional(),
}).strict()

const thumbnailMaintenanceSnapshotSchema = z.object({
  totalRows: z.number().int().nonnegative(),
  fileRows: z.number().int().nonnegative(),
  folderRows: z.number().int().nonnegative(),
  blobBytes: z.number().int().nonnegative(),
  emptyBlobs: z.number().int().nonnegative(),
  failedRows: z.number().int().nonnegative(),
  failuresByReason: z.record(z.string(), z.number().int().nonnegative()),
  databaseBytes: z.number().int().nonnegative().optional(),
  walBytes: z.number().int().nonnegative().optional(),
  shmBytes: z.number().int().nonnegative().optional(),
  writer: thumbnailWriterSnapshotSchema,
}).strict()

const thumbnailMaintenanceEnvelopeSchema = z.object({ snapshot: thumbnailMaintenanceSnapshotSchema }).strict()
const thumbnailDeletedSchema = z.object({ deleted: z.number().int().nonnegative() }).strict()
const thumbnailExpiredDeletedSchema = thumbnailDeletedSchema.extend({ cutoff: z.string().min(1) }).strict()
const thumbnailPathPrefixDeletedSchema = thumbnailDeletedSchema.extend({ prefix: z.string().min(1).max(4_096) }).strict()
const thumbnailInvalidCleanupSchema = z.object({
  result: z.object({
    scanned: z.number().int().nonnegative(),
    deleted: z.number().int().nonnegative(),
    unavailableVolumeRowsPreserved: z.number().int().nonnegative(),
    wrapped: z.boolean(),
  }).strict(),
}).strict()

export type RemoteReaderThumbnailCleanupCommand =
  | { kind: "empty"; limit: number }
  | { kind: "expired"; days: number; limit: number }
  | { kind: "invalid"; scanLimit: number; deleteLimit: number }
  | { kind: "path-prefix"; prefix: string; limit: number }

export type RemoteReaderThumbnailCleanupResult =
  | { kind: "empty"; deleted: number }
  | { kind: "expired"; deleted: number; cutoff: string }
  | { kind: "invalid"; scanned: number; deleted: number; unavailableVolumeRowsPreserved: number; wrapped: boolean }
  | { kind: "path-prefix"; prefix: string; deleted: number }

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

export interface RemoteReaderDiagnosticsHistoryOptions extends RemoteReaderHeadlessOptions {
  sinceMs?: number
  limit?: number
}

export async function fetchRemoteReaderDiagnostics(options: RemoteReaderHeadlessOptions): Promise<ReaderDiagnosticsSnapshot> {
  const baseUrl = normalizeLoopbackBaseUrl(options.baseUrl)
  const token = normalizeToken(options.token)
  const response = await (options.fetch ?? globalThis.fetch)(new URL("/reader/diagnostics", baseUrl), {
    headers: { "x-xiranite-token": token },
  })
  if (!response.ok) throw await responseError(response, "Reader diagnostics")
  return parseReaderDiagnosticsSnapshot(await response.json())
}

/** Reads bounded diagnostics history from the running loopback Reader without opening a session. */
export async function fetchRemoteReaderDiagnosticsHistory(
  options: RemoteReaderDiagnosticsHistoryOptions,
): Promise<ReaderDiagnosticsHistory> {
  const baseUrl = normalizeLoopbackBaseUrl(options.baseUrl)
  const token = normalizeToken(options.token)
  const query = new URLSearchParams()
  if (options.sinceMs !== undefined) query.set("sinceMs", String(diagnosticsHistoryInteger(options.sinceMs, "sinceMs")))
  if (options.limit !== undefined) query.set("limit", String(diagnosticsHistoryLimit(options.limit)))
  const path = query.size ? `/reader/diagnostics/history?${query}` : "/reader/diagnostics/history"
  const response = await (options.fetch ?? globalThis.fetch)(new URL(path, baseUrl), {
    headers: { "x-xiranite-token": token },
  })
  if (!response.ok) throw await responseError(response, "Reader diagnostics history")
  try {
    return parseReaderDiagnosticsHistory(await response.json())
  } catch {
    throw new Error("Xiranite Reader returned an invalid diagnostics history response.")
  }
}

/** Uses the running Reader's single thumbnail writer; it never opens a second SQLite connection. */
export async function fetchRemoteReaderThumbnailMaintenance(
  options: RemoteReaderHeadlessOptions,
): Promise<ReaderThumbnailMaintenanceSnapshot> {
  const result = await remoteJson(options, "/reader/thumbnails/maintenance", {}, "Reader thumbnail maintenance")
  const parsed = thumbnailMaintenanceEnvelopeSchema.safeParse(result)
  if (!parsed.success) throw new Error("Xiranite Reader returned an invalid thumbnail maintenance response.")
  return parsed.data.snapshot
}

export async function cleanupRemoteReaderThumbnails(
  options: RemoteReaderHeadlessOptions,
  command: RemoteReaderThumbnailCleanupCommand,
): Promise<RemoteReaderThumbnailCleanupResult> {
  const body = command.kind === "expired"
    ? { ...command, preserveFolders: true }
    : command.kind === "invalid"
      ? { kind: command.kind, scanLimit: command.scanLimit, limit: command.deleteLimit }
      : command
  const result = await remoteJson(options, "/reader/thumbnails/maintenance/cleanup", {
    method: "POST",
    body: JSON.stringify(body),
  }, "Reader thumbnail cleanup")
  if (command.kind === "invalid") {
    const parsed = thumbnailInvalidCleanupSchema.safeParse(result)
    if (!parsed.success) throw new Error("Xiranite Reader returned an invalid thumbnail cleanup response.")
    return { kind: command.kind, ...parsed.data.result }
  }
  if (command.kind === "path-prefix") {
    const parsed = thumbnailPathPrefixDeletedSchema.safeParse(result)
    if (!parsed.success) throw new Error("Xiranite Reader returned an invalid thumbnail cleanup response.")
    return { kind: command.kind, ...parsed.data }
  }
  if (command.kind === "expired") {
    const parsed = thumbnailExpiredDeletedSchema.safeParse(result)
    if (!parsed.success) throw new Error("Xiranite Reader returned an invalid thumbnail cleanup response.")
    return { kind: command.kind, deleted: parsed.data.deleted, cutoff: parsed.data.cutoff }
  }
  const parsed = thumbnailDeletedSchema.safeParse(result)
  if (!parsed.success) throw new Error("Xiranite Reader returned an invalid thumbnail cleanup response.")
  return { kind: command.kind, deleted: parsed.data.deleted }
}

export async function clearRemoteReaderThumbnailFailures(
  options: RemoteReaderHeadlessOptions,
  request: { reason?: string; limit: number },
): Promise<number> {
  const result = await remoteJson(options, "/reader/thumbnails/maintenance/failures/clear", {
    method: "POST",
    body: JSON.stringify(request),
  }, "Reader thumbnail failure cleanup")
  const parsed = thumbnailDeletedSchema.safeParse(result)
  if (!parsed.success) throw new Error("Xiranite Reader returned an invalid thumbnail failure cleanup response.")
  return parsed.data.deleted
}

/** Headless adapter over the running XR Reader controller. It owns only sessions it creates. */
export class RemoteReaderHeadlessController implements AsyncDisposable {
  readonly #baseUrl: URL
  readonly #headers: Readonly<Record<string, string>>
  readonly #fetch: typeof fetch
  #session: ReaderSessionDto | undefined
  #translatedTitle: string | undefined
  #pageAssets = new Map<number, ReaderPageDto>()
  #closed = false
  #disposing: Promise<void> | undefined

  constructor(options: RemoteReaderHeadlessOptions) {
    this.#baseUrl = normalizeLoopbackBaseUrl(options.baseUrl)
    const token = normalizeToken(options.token)
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
      body.archivePasswords = serializeRemoteArchivePasswords(input.archivePasswords)
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
    this.#translatedTitle = undefined
    this.#pageAssets.clear()
    this.#replaceVisiblePages(next.visiblePages)
    if (previous) await this.#closeRemoteSession(previous.sessionId)
    return snapshotOf(next, this.#translatedTitle)
  }

  inspect(): HeadlessReaderSnapshot {
    this.#assertOpen()
    return snapshotOf(this.#requireSession(), this.#translatedTitle)
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

  async openAdjacent(
    direction: ReaderAdjacentBookDirection,
    sort?: ReaderDirectorySortRule,
    signal?: AbortSignal,
  ): Promise<HeadlessReaderSnapshot | undefined> {
    const current = this.#requireSession()
    const response = await this.#fetch(new URL(
      `/reader/s/${encodeURIComponent(current.sessionId)}/adjacent-book`,
      this.#baseUrl,
    ), {
      method: "POST",
      headers: { ...this.#headers, "content-type": "application/json" },
      body: JSON.stringify({ direction, sort }),
      signal,
    })
    if (response.status === 204) return undefined
    if (!response.ok) throw await responseError(response, "Reader adjacent-book navigation")
    const next = await response.json() as ReaderSessionDto
    try {
      assertSessionDto(next)
      this.#assertAssetUrls(next.visiblePages)
    } catch (error) {
      if (next && typeof next.sessionId === "string") await this.#closeRemoteSession(next.sessionId).catch(() => undefined)
      throw error
    }
    if (this.#session !== current) {
      await this.#closeRemoteSession(next.sessionId).catch(() => undefined)
      throw new Error("Remote reader session changed while opening the adjacent book.")
    }
    this.#session = next
    this.#translatedTitle = undefined
    this.#pageAssets.clear()
    this.#replaceVisiblePages(next.visiblePages)
    return snapshotOf(next, this.#translatedTitle)
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

  async listSubtitles(pageIndex: number, signal?: AbortSignal): Promise<readonly ReaderSubtitleTrack[]> {
    const { session, page } = await this.#subtitlePageAt(pageIndex, signal)
    const query = new URLSearchParams({ pageId: page.id })
    const parsed = await this.#fetchSubtitleTracks(session, page, query, signal)
    return parsed.map(({ assetUrl: _assetUrl, ...track }) => track)
  }

  async renderSubtitle(
    pageIndex: number,
    assetId: string,
    signal?: AbortSignal,
  ): Promise<{ bytes: Uint8Array; contentVersion: string }> {
    assertRemoteSubtitleAssetId(assetId)
    const { session, page } = await this.#subtitlePageAt(pageIndex, signal)
    const query = new URLSearchParams({ pageId: page.id })
    const tracks = await this.#fetchSubtitleTracks(session, page, query, signal)
    const track = tracks.find((candidate) => candidate.id === assetId)
    if (!track) throw new Error("Reader subtitle track was not found for this video page.")
    signal?.throwIfAborted()
    this.#assertCurrentSession(session)
    this.#assertSubtitleAssetUrl(track, session.sessionId, page.id)
    const response = await this.#fetch(new URL(track.assetUrl), {
      headers: this.#headers,
      signal,
    })
    this.#assertCurrentSession(session)
    signal?.throwIfAborted()
    if (!response.ok) throw await responseError(response, "Reader subtitle asset")
    assertSubtitleEtag(response)
    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase()
    if (contentType !== "text/vtt") {
      throw new Error("Xiranite Reader returned an invalid subtitle content type.")
    }
    const bytes = await readRemoteResponseBytes(response, MAX_REMOTE_SUBTITLE_BYTES, signal)
    return { bytes, contentVersion: track.contentVersion }
  }

  async getBookSettings(signal?: AbortSignal): Promise<ReaderBookSettingsSnapshot> {
    const session = this.#requireSession()
    const result = await this.#json<unknown>(
      `/reader/s/${encodeURIComponent(session.sessionId)}/book-settings`,
      { signal },
    )
    return parseReaderBookSettingsEnvelope(result)
  }

  async updateBookSettings(
    expectedRevision: number,
    patch: ReaderBookSettingsPatch,
    signal?: AbortSignal,
  ): Promise<HeadlessReaderBookSettingsUpdate> {
    const session = this.#requireSession()
    const result = await this.#json<unknown>(
      `/reader/s/${encodeURIComponent(session.sessionId)}/book-settings`,
      { method: "PATCH", body: JSON.stringify({ expectedRevision, patch }), signal },
    )
    if (!result || typeof result !== "object") throw invalidBookSettingsResponse()
    const response = result as Partial<ReaderFrameDto> & { settings?: unknown }
    const settings = parseReaderBookSettingsEnvelope(result)
    if (!response.frame || !Array.isArray(response.visiblePages)) throw invalidBookSettingsResponse()
    for (const page of response.visiblePages) {
      assertPageDto(page)
      this.#assertAssetUrl(page)
    }
    session.frame = response.frame
    session.visiblePages = response.visiblePages
    session.preload = response.preload
    this.#replaceVisiblePages(response.visiblePages)
    return { settings, reader: snapshotOf(session, this.#translatedTitle) }
  }

  async getEmmMetadata(signal?: AbortSignal): Promise<ReaderEmmMetadataSnapshot> {
    const session = this.#requireSession()
    const result = await this.#json<unknown>(
      `/reader/s/${encodeURIComponent(session.sessionId)}/emm-metadata`,
      { signal },
    )
    return parseReaderEmmMetadataResponse(result)
  }

  async updateEmmMetadata(
    expectedRevision: number,
    patch: ReaderEmmMetadataPatch,
    signal?: AbortSignal,
  ): Promise<HeadlessReaderEmmMetadataUpdate> {
    const session = this.#requireSession()
    const metadata = parseReaderEmmMetadataResponse(await this.#json<unknown>(
      `/reader/s/${encodeURIComponent(session.sessionId)}/emm-metadata`,
      { method: "PATCH", body: JSON.stringify({ expectedRevision, patch }), signal },
    ))
    if (patch.translatedTitle !== undefined) this.#translatedTitle = await this.#loadTranslatedTitle(session, signal)
    return { metadata, reader: snapshotOf(session, this.#translatedTitle) }
  }

  async generateUpscaleArtifact(
    pageIndex: number,
    options: { trigger?: "manual" | "automatic-current"; signal?: AbortSignal } = {},
  ): Promise<RemoteSuperResolutionArtifactResult> {
    const session = this.#requireSession()
    const page = await this.#pageAt(pageIndex, options.signal)
    const query = new URLSearchParams({ trigger: options.trigger ?? "manual" })
    const result = remoteSuperResolutionArtifactResultSchema.parse(await this.#json<unknown>(
      `/reader/s/${encodeURIComponent(session.sessionId)}/pages/${encodeURIComponent(page.id)}/upscale-artifact?${query}`,
      { method: "POST", signal: options.signal },
    ))
    if ("artifactUrl" in result) {
      this.#assertBackendUrl(
        result.artifactUrl,
        "super-resolution artifact",
        `/reader/s/${encodeURIComponent(session.sessionId)}/upscale-artifact/`,
      )
    }
    return result
  }

  async getUpscalePreload(signal?: AbortSignal): Promise<readonly RemoteSuperResolutionPreloadSnapshot[]> {
    return await this.#upscalePreloadRequest("upscale-preload", undefined, signal)
  }

  async startUpscalePreload(
    mode: RemoteSuperResolutionPreloadMode,
    signal?: AbortSignal,
  ): Promise<readonly RemoteSuperResolutionPreloadSnapshot[]> {
    return await this.#upscalePreloadRequest("upscale-preload/start", mode, signal, "POST")
  }

  async pauseUpscalePreload(signal?: AbortSignal): Promise<readonly RemoteSuperResolutionPreloadSnapshot[]> {
    return await this.#upscalePreloadRequest("upscale-preload/pause", undefined, signal, "POST")
  }

  async retryUpscalePreload(
    mode: RemoteSuperResolutionPreloadMode,
    signal?: AbortSignal,
  ): Promise<readonly RemoteSuperResolutionPreloadSnapshot[]> {
    return await this.#upscalePreloadRequest("upscale-preload/retry", mode, signal, "POST")
  }

  async getUpscaleArtifactCache(signal?: AbortSignal): Promise<RemoteSuperResolutionArtifactCacheSnapshot> {
    const session = this.#requireSession()
    return artifactCacheSnapshotSchema.parse(await this.#json<unknown>(
      `/reader/s/${encodeURIComponent(session.sessionId)}/upscale-artifact-cache`,
      { signal },
    ))
  }

  async cleanupUpscaleArtifactCache(
    kind: RemoteSuperResolutionArtifactCacheCleanupKind,
    signal?: AbortSignal,
  ): Promise<RemoteSuperResolutionArtifactCacheCleanupResult> {
    const session = this.#requireSession()
    const query = new URLSearchParams({ kind: artifactCacheCleanupKindSchema.parse(kind), confirmed: "true" })
    return artifactCacheCleanupSchema.parse(await this.#json<unknown>(
      `/reader/s/${encodeURIComponent(session.sessionId)}/upscale-artifact-cache?${query}`,
      { method: "POST", signal },
    ))
  }

  async closeBook(): Promise<void> {
    const session = this.#session
    this.#session = undefined
    this.#translatedTitle = undefined
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
    return snapshotOf(session, this.#translatedTitle)
  }

  async #pageAt(pageIndex: number, signal?: AbortSignal): Promise<ReaderPageDto> {
    if (!Number.isSafeInteger(pageIndex) || pageIndex < 0) throw new RangeError(`Reader page index is out of range: ${pageIndex}`)
    signal?.throwIfAborted()
    let page = this.#pageAssets.get(pageIndex)
    if (!page) {
      await this.listPages(pageIndex, 1, signal)
      page = this.#pageAssets.get(pageIndex)
    }
    if (!page) throw new RangeError(`Reader page index is out of range: ${pageIndex}`)
    return page
  }

  async #subtitlePageAt(pageIndex: number, signal?: AbortSignal): Promise<{ session: ReaderSessionDto; page: ReaderPageDto }> {
    const session = this.#requireSession()
    const page = await this.#pageAt(pageIndex, signal)
    this.#assertCurrentSession(session)
    if (page.mediaKind !== "video") throw new Error("Reader video page was not found.")
    return { session, page }
  }

  async #fetchSubtitleTracks(
    session: ReaderSessionDto,
    page: ReaderPageDto,
    query: URLSearchParams,
    signal?: AbortSignal,
  ): Promise<readonly RemoteSubtitleTrack[]> {
    const parsed = remoteSubtitleEnvelopeSchema.safeParse(await this.#json<unknown>(
      `/reader/s/${encodeURIComponent(session.sessionId)}/subtitles?${query}`,
      { signal },
    ))
    signal?.throwIfAborted()
    this.#assertCurrentSession(session)
    if (!parsed.success) throw new Error("Xiranite Reader returned an invalid subtitles response.")
    for (const track of parsed.data.tracks) {
      this.#assertSubtitleAssetUrl(track, session.sessionId, page.id)
    }
    return parsed.data.tracks
  }

  async #upscalePreloadRequest(
    path: string,
    mode: RemoteSuperResolutionPreloadMode | undefined,
    signal: AbortSignal | undefined,
    method = "GET",
  ): Promise<readonly RemoteSuperResolutionPreloadSnapshot[]> {
    const session = this.#requireSession()
    const query = mode ? `?${new URLSearchParams({ mode })}` : ""
    const parsed = preloadEnvelopeSchema.parse(await this.#json<unknown>(
      `/reader/s/${encodeURIComponent(session.sessionId)}/${path}${query}`,
      { method, signal },
    ))
    return parsed.snapshots
  }

  async #loadTranslatedTitle(session: ReaderSessionDto, signal?: AbortSignal): Promise<string | undefined> {
    const result = await this.#json<unknown>(`/reader/s/${encodeURIComponent(session.sessionId)}/metadata`, { signal })
    if (!result || typeof result !== "object" || !("book" in result)) {
      throw new Error("Xiranite Reader returned an invalid book metadata response.")
    }
    const book = (result as { book?: unknown }).book
    if (!book || typeof book !== "object") throw new Error("Xiranite Reader returned an invalid book metadata response.")
    const title = (book as { emm?: unknown }).emm
    if (title === undefined) return undefined
    if (!title || typeof title !== "object") throw new Error("Xiranite Reader returned an invalid book metadata response.")
    const translatedTitle = (title as { translatedTitle?: unknown }).translatedTitle
    if (translatedTitle === undefined) return undefined
    if (typeof translatedTitle !== "string" || !translatedTitle.trim()) {
      throw new Error("Xiranite Reader returned an invalid book metadata response.")
    }
    return translatedTitle
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

  #assertBackendUrl(value: string, label: string, pathPrefix: string): void {
    const url = new URL(value)
    if (url.origin !== this.#baseUrl.origin || !url.pathname.startsWith(pathPrefix)) {
      throw new Error(`Xiranite Reader returned a ${label} URL outside the connected backend.`)
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

function snapshotOf(session: ReaderSessionDto, translatedTitle?: string): HeadlessReaderSnapshot {
  return {
    book: { displayName: session.book.displayName, pageCount: session.book.pageCount, translatedTitle },
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

function parseReaderBookSettingsEnvelope(value: unknown): ReaderBookSettingsSnapshot {
  if (!value || typeof value !== "object" || !("settings" in value)) throw invalidBookSettingsResponse()
  try {
    return parseReaderBookSettingsSnapshot((value as { settings: unknown }).settings)
  } catch {
    throw invalidBookSettingsResponse()
  }
}

function parseReaderEmmMetadataResponse(value: unknown): ReaderEmmMetadataSnapshot {
  const parsed = ReaderEmmMetadataSnapshotSchema.safeParse(value)
  if (!parsed.success) throw new Error("Xiranite Reader returned an invalid EMM metadata response.")
  return parsed.data
}

function invalidBookSettingsResponse(): Error {
  return new Error("Xiranite Reader returned an invalid book-settings response.")
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

function normalizeToken(value: string): string {
  const token = value.trim()
  if (!token) throw new Error("Xiranite backend token must be non-empty.")
  return token
}

async function remoteJson(
  options: RemoteReaderHeadlessOptions,
  path: string,
  init: RequestInit,
  operation: string,
): Promise<unknown> {
  const baseUrl = normalizeLoopbackBaseUrl(options.baseUrl)
  const token = normalizeToken(options.token)
  const headers = new Headers(init.headers)
  headers.set("x-xiranite-token", token)
  if (init.body !== undefined) headers.set("content-type", "application/json")
  const response = await (options.fetch ?? globalThis.fetch)(new URL(path, baseUrl), { ...init, headers })
  if (!response.ok) throw await responseError(response, operation)
  return await response.json()
}

function diagnosticsHistoryInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value)) throw new Error(`Reader diagnostics history ${name} must be a safe integer.`)
  return value
}

function diagnosticsHistoryLimit(value: number): number {
  const limit = diagnosticsHistoryInteger(value, "limit")
  if (limit < 1 || limit > 1_000) throw new Error("Reader diagnostics history limit must be between 1 and 1000.")
  return limit
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

function assertRemoteSubtitleAssetId(value: string): void {
  if (typeof value !== "string" || value.length < 1 || value.length > 256) {
    throw new Error("Reader subtitle asset id must be a bounded non-empty string.")
  }
}

function assertSubtitleEtag(response: Response): string {
  const etag = response.headers.get("etag")
  if (!etag || etag.length > 512 || !/^(?:W\/)?"[^"\r\n]{1,480}"$/u.test(etag)) {
    throw new Error("Xiranite Reader returned an invalid subtitle ETag.")
  }
  return etag
}

async function readRemoteResponseBytes(response: Response, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array> {
  const length = optionalLength(response)
  if (length !== undefined && length > maxBytes) {
    throw new Error(`Xiranite Reader subtitle exceeded the ${maxBytes} byte response budget.`)
  }
  if (!response.body) throw new Error("Xiranite Reader returned an empty subtitle response body.")
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      signal?.throwIfAborted()
      const result = await readRemoteChunk(reader, signal)
      if (result.done) break
      total += result.value.byteLength
      if (total > maxBytes) {
        throw new Error(`Xiranite Reader subtitle exceeded the ${maxBytes} byte response budget.`)
      }
      chunks.push(result.value)
    }
  } finally {
    await reader.cancel("Remote subtitle response consumed.").catch(() => undefined)
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

function readRemoteChunk<T>(reader: ReadableStreamDefaultReader<T>, signal?: AbortSignal): ReturnType<ReadableStreamDefaultReader<T>["read"]> {
  if (!signal) return reader.read()
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = () => {
      void reader.cancel(signal.reason).catch(() => undefined)
      reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"))
    }
    signal.addEventListener("abort", abort, { once: true })
    reader.read().then(resolve, reject).finally(() => signal.removeEventListener("abort", abort))
  })
}

const remoteArchivePasswordSchema = z.object({
  entryPaths: z.array(z.string().refine((value) => Boolean(value.trim()), "entry path must be non-empty")).max(16).optional(),
  password: z.string().refine((value) => {
    const bytes = new TextEncoder().encode(value).byteLength
    return bytes > 0 && bytes <= 4096
  }, "password must contain 1 to 4096 UTF-8 bytes").optional(),
  rawPassword: z.instanceof(Uint8Array).refine(
    (value) => value.byteLength > 0 && value.byteLength <= 4096,
    "rawPassword must contain 1 to 4096 bytes",
  ).optional(),
}).strict().refine(
  (value) => (value.password !== undefined) !== (value.rawPassword !== undefined),
  "exactly one password representation is required",
)

function serializeRemoteArchivePasswords(inputs: OpenHeadlessReaderInput["archivePasswords"]): Array<{
  entryPaths?: readonly string[]
  password: string
}> {
  if (!inputs?.length || inputs.length > 16) throw new Error("Remote archive passwords must contain 1 to 16 entries.")
  return inputs.map((input) => {
    const parsed = remoteArchivePasswordSchema.safeParse(input)
    if (!parsed.success) throw new Error("Remote archive password input is invalid.")
    let password = parsed.data.password
    if (password === undefined) {
      try {
        password = new TextDecoder("utf-8", { fatal: true }).decode(parsed.data.rawPassword)
      } catch {
        throw new Error("Remote archive rawPassword must be valid UTF-8.")
      }
    }
    return {
      ...(parsed.data.entryPaths ? { entryPaths: parsed.data.entryPaths } : {}),
      password,
    }
  })
}

import { createHash } from "node:crypto"
import { Readable } from "node:stream"

import type { ReaderService, ReaderSessionId } from "../../application/reader/contracts.js"
import type { SuperResolutionArtifactPageInput, SuperResolutionArtifactRunDecision } from "../../application/super-resolution/SuperResolutionArtifactPageService.js"
import type { SuperResolutionArtifactPagePort } from "../../ports/SuperResolutionArtifactPagePort.js"
import type { SuperResolutionArtifactStore } from "../../ports/SuperResolutionArtifactStore.js"
import type { SuperResolutionPreloadControlPort } from "../../ports/SuperResolutionPreloadControlPort.js"
import { buildSuperResolutionArtifactKey } from "../super-resolution/SuperResolutionArtifactKey.js"

const CONTROL_PATH = /^\/reader\/s\/([^/]+)\/pages\/([^/]+)\/upscale-artifact$/
const ASSET_PATH = /^\/reader\/s\/([^/]+)\/upscale-artifact\/([A-Za-z0-9_-]{43})$/
const PRELOAD_PATH = /^\/reader\/s\/([^/]+)\/upscale-preload$/
const PRELOAD_ACTION_PATH = /^\/reader\/s\/([^/]+)\/upscale-preload\/(start|pause|retry)$/
const CACHE_PATH = /^\/reader\/s\/([^/]+)\/upscale-artifact-cache$/
const CAPABILITIES_PATH = /^\/reader\/s\/([^/]+)\/upscale-capabilities$/
const SYSTEM_CAPABILITIES_PATH = "/reader/upscale-capabilities"
const ARTIFACT_KEY_PREFIX = "neoview:super-resolution:v1:"
export const SUPER_RESOLUTION_ARTIFACT_PRODUCER_VERSION = "opencomic-system-artifact-v1"

export interface SuperResolutionArtifactRouteOptions {
  baseUrl: string
  token: string
}

export class SuperResolutionArtifactRoute {
  readonly #baseUrl: string
  readonly #token: string
  readonly #active = new Map<ReaderSessionId, Set<AbortController>>()
  readonly #preloadSessions = new Set<ReaderSessionId>()
  #closed = false

  constructor(
    private readonly reader: ReaderService,
    private readonly pages: SuperResolutionArtifactPagePort,
    private readonly artifacts: SuperResolutionArtifactStore,
    options: SuperResolutionArtifactRouteOptions,
    private readonly preload?: SuperResolutionPreloadControlPort,
  ) {
    this.#baseUrl = options.baseUrl.replace(/\/$/u, "")
    this.#token = options.token
  }

  async handle(request: Request): Promise<Response | undefined> {
    const url = new URL(request.url)
    const control = CONTROL_PATH.exec(url.pathname)
    if (control) return this.#control(request, url, control[1]!, control[2]!)
    const asset = ASSET_PATH.exec(url.pathname)
    if (asset) return this.#asset(request, url, asset[1]!, asset[2]!)
    const preloadAction = PRELOAD_ACTION_PATH.exec(url.pathname)
    if (preloadAction) return this.#preloadAction(request, url, preloadAction[1]!, preloadAction[2]! as "start" | "pause" | "retry")
    const preload = PRELOAD_PATH.exec(url.pathname)
    if (preload) return this.#preloadSnapshot(request, url, preload[1]!)
    const cache = CACHE_PATH.exec(url.pathname)
    if (cache) return this.#artifactCache(request, url, cache[1]!)
    if (url.pathname === SYSTEM_CAPABILITIES_PATH) return this.#capabilities(request, url)
    const capabilities = CAPABILITIES_PATH.exec(url.pathname)
    if (capabilities) return this.#capabilities(request, url, capabilities[1]!)
    return undefined
  }

  async releaseSession(sessionId: ReaderSessionId): Promise<void> {
    const active = this.#active.get(sessionId)
    this.#active.delete(sessionId)
    this.#preloadSessions.delete(sessionId)
    for (const controller of active ?? []) {
      controller.abort(abortError(`Reader super-resolution session released: ${sessionId}`))
    }
    await this.preload?.releaseContext(preloadContextId(sessionId))
  }

  async advanceGeneration(sessionId: ReaderSessionId, generation: number): Promise<void> {
    const active = this.#active.get(sessionId)
    this.#active.delete(sessionId)
    for (const controller of active ?? []) {
      controller.abort(abortError(`Reader super-resolution page generation advanced: ${sessionId}:${generation}`))
    }
    await this.preload?.advanceGeneration(preloadContextId(sessionId), generation)
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    const sessionIds = new Set([...this.#active.keys(), ...this.#preloadSessions])
    this.#preloadSessions.clear()
    for (const sessionId of sessionIds) void this.releaseSession(sessionId)
  }

  async #control(
    request: Request,
    url: URL,
    encodedSessionId: string,
    encodedPageId: string,
  ): Promise<Response> {
    if (this.#closed) return jsonResponse({ error: "Reader super-resolution route is closed" }, 410)
    if (!this.#isAuthorized(request, url)) return jsonResponse({ error: "Unauthorized" }, 401)
    const probe = url.searchParams.get("probe") === "true"
    if (request.method !== (probe ? "GET" : "POST")) return methodNotAllowed(probe ? "GET" : "POST")
    const sessionId = safeDecode(encodedSessionId)
    const pageId = safeDecode(encodedPageId)
    const session = sessionId ? this.reader.getSession(sessionId) : undefined
    const page = pageId ? session?.getPage(pageId) : undefined
    if (!session || !page) return jsonResponse({ error: "Reader page not found" }, 404)
    const trigger = url.searchParams.get("trigger") ?? "manual"
    if (trigger !== "manual" && trigger !== "automatic-current") {
      return jsonResponse({ error: "trigger must be manual or automatic-current" }, 400)
    }
    const operation = this.#begin(session.id, request.signal)
    try {
      const input = {
        page,
        trigger,
        bookPath: session.book.source.path,
        priority: "interactive",
        artifactFor: (decision) => ({
          key: artifactKey(session.book.source.path, page.contentVersion, page.entryPath ?? page.sourcePath, decision),
          metadata: { bookKey: session.book.id, contentType: "image/png", extension: "png" },
        }),
      } satisfies SuperResolutionArtifactPageInput
      const result = probe
        ? this.pages.acquireExisting
          ? await this.pages.acquireExisting(input, { signal: operation.signal })
          : { status: "miss" as const }
        : await this.pages.acquireOrGenerate(input, { signal: operation.signal })
      if (result.status === "miss") {
        const pageState = this.preload?.pageState?.(preloadContextId(session.id), page.index)
        return jsonResponse(pageState === "pending" ? { status: "pending" } : result)
      }
      if (!("artifact" in result)) {
        return jsonResponse(result, result.status === "rejected" ? 507 : 200)
      }
      try {
        const descriptor = {
          status: result.status,
          artifactUrl: this.#assetUrl(session.id, result.artifact.key, result.artifact.integrity),
          contentType: result.artifact.metadata.contentType,
          bytes: result.artifact.size,
          version: result.artifact.integrity,
          ...(result.status === "generated" ? { execution: result.execution } : {}),
        }
        return jsonResponse(descriptor, result.status === "generated" ? 201 : 200)
      } finally {
        result.artifact.release()
      }
    } catch (error) {
      if (operation.signal.aborted) throw error
      const message = error instanceof Error ? error.message : String(error)
      const unavailable = message.includes("runtime is unavailable") || message.includes("artifact cache is unavailable")
      return jsonResponse({ error: message }, unavailable ? 503 : 500)
    } finally {
      operation.release()
    }
  }

  async #asset(
    request: Request,
    url: URL,
    encodedSessionId: string,
    digest: string,
  ): Promise<Response> {
    if (this.#closed) return jsonResponse({ error: "Reader super-resolution route is closed" }, 410)
    if (!this.#isAuthorized(request, url)) return jsonResponse({ error: "Unauthorized" }, 401)
    if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed("GET, HEAD")
    const sessionId = safeDecode(encodedSessionId)
    if (!sessionId || !this.reader.getSession(sessionId)) return jsonResponse({ error: "Reader session not found" }, 404)
    const key = `${ARTIFACT_KEY_PREFIX}${digest}`
    const lease = await this.artifacts.acquire(key, request.signal)
    if (!lease) return jsonResponse({ error: "Super-resolution artifact not found" }, 404)
    const headers = new Headers({
      "cache-control": "private, max-age=31536000, immutable",
      "content-type": lease.metadata.contentType,
      "content-length": String(lease.size),
      "etag": artifactEtag(lease.integrity),
      "x-content-type-options": "nosniff",
    })
    if (url.searchParams.get("version") !== lease.integrity) {
      lease.release()
      return jsonResponse({ error: "Super-resolution artifact version is stale" }, 410)
    }
    if (matchesEtag(request.headers.get("if-none-match"), headers.get("etag")!)) {
      lease.release()
      headers.delete("content-length")
      return new Response(null, { status: 304, headers })
    }
    if (request.method === "HEAD") {
      lease.release()
      return new Response(null, { status: 200, headers })
    }
    let released = false
    const release = () => {
      if (released) return
      released = true
      lease.release()
    }
    try {
      const source = lease.openStream(request.signal)
      const stream = Readable.from(source as unknown as AsyncIterable<Uint8Array>)
      stream.once("end", release)
      stream.once("close", release)
      stream.once("error", release)
      return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status: 200, headers })
    } catch (error) {
      release()
      throw error
    }
  }

  async #preloadSnapshot(request: Request, url: URL, encodedSessionId: string): Promise<Response> {
    if (this.#closed) return jsonResponse({ error: "Reader super-resolution route is closed" }, 410)
    if (!this.#isAuthorized(request, url)) return jsonResponse({ error: "Unauthorized" }, 401)
    if (request.method !== "GET") return methodNotAllowed("GET")
    const sessionId = safeDecode(encodedSessionId)
    const session = sessionId ? this.reader.getSession(sessionId) : undefined
    if (!session) return jsonResponse({ error: "Reader session not found" }, 404)
    if (!this.preload) return jsonResponse({ error: "Reader super-resolution preload is unavailable" }, 503)
    const snapshots = await this.preload.snapshots(preloadContextId(session.id), request.signal)
    return jsonResponse({ snapshots: await this.#withCachedBookCoverage(session.book.id, session.book.pages.length, snapshots) })
  }

  async #artifactCache(request: Request, url: URL, encodedSessionId: string): Promise<Response> {
    if (this.#closed) return jsonResponse({ error: "Reader super-resolution route is closed" }, 410)
    if (!this.#isAuthorized(request, url)) return jsonResponse({ error: "Unauthorized" }, 401)
    const sessionId = safeDecode(encodedSessionId)
    const session = sessionId ? this.reader.getSession(sessionId) : undefined
    if (!session) return jsonResponse({ error: "Reader session not found" }, 404)
    if (request.method === "GET") {
      if (url.searchParams.size) return jsonResponse({ error: "Artifact cache stats do not accept query parameters" }, 400)
      return jsonResponse(await this.artifacts.snapshot())
    }
    if (request.method !== "POST") return methodNotAllowed("GET, POST")
    const kind = url.searchParams.get("kind")
    const confirmed = url.searchParams.get("confirmed")
    if ((kind !== "age" && kind !== "book" && kind !== "all") || confirmed !== "true"
      || url.searchParams.size !== 2
      || [...url.searchParams.keys()].some((key) => key !== "kind" && key !== "confirmed")) {
      return jsonResponse({ error: "Artifact cache cleanup requires kind=age|book|all and confirmed=true" }, 400)
    }
    if (kind === "age") return jsonResponse(await this.artifacts.cleanup("age"))
    if (kind === "book") return jsonResponse(await this.artifacts.clearBook(session.book.id))
    return jsonResponse(await this.artifacts.clear())
  }

  async #capabilities(request: Request, url: URL, encodedSessionId?: string): Promise<Response> {
    if (this.#closed) return jsonResponse({ error: "Reader super-resolution route is closed" }, 410)
    if (!this.#isAuthorized(request, url)) return jsonResponse({ error: "Unauthorized" }, 401)
    if (request.method !== "GET") return methodNotAllowed("GET")
    if (encodedSessionId !== undefined) {
      const sessionId = safeDecode(encodedSessionId)
      if (!sessionId || !this.reader.getSession(sessionId)) return jsonResponse({ error: "Reader session not found" }, 404)
    }
    if (!this.pages.inspect) return jsonResponse({ error: "Reader super-resolution capabilities are unavailable" }, 503)
    if ([...url.searchParams.keys()].some((key) => key !== "refresh")) {
      return jsonResponse({ error: "Capabilities accept only refresh=true" }, 400)
    }
    const refreshValue = url.searchParams.get("refresh")
    if (refreshValue !== null && refreshValue !== "true") return jsonResponse({ error: "refresh must be true" }, 400)
    return jsonResponse(await this.pages.inspect({ refresh: refreshValue === "true", signal: request.signal }))
  }

  async #preloadAction(
    request: Request,
    url: URL,
    encodedSessionId: string,
    action: "start" | "pause" | "retry",
  ): Promise<Response> {
    if (this.#closed) return jsonResponse({ error: "Reader super-resolution route is closed" }, 410)
    if (!this.#isAuthorized(request, url)) return jsonResponse({ error: "Unauthorized" }, 401)
    if (request.method !== "POST") return methodNotAllowed("POST")
    const sessionId = safeDecode(encodedSessionId)
    const session = sessionId ? this.reader.getSession(sessionId) : undefined
    if (!session) return jsonResponse({ error: "Reader session not found" }, 404)
    if (!this.preload) return jsonResponse({ error: "Reader super-resolution preload is unavailable" }, 503)
    const mode = url.searchParams.get("mode") ?? "nearby"
    if (mode !== "nearby" && mode !== "progressive") return jsonResponse({ error: "mode must be nearby or progressive" }, 400)
    const contextId = preloadContextId(session.id)
    this.#preloadSessions.add(session.id)
    try {
      if (action === "pause") {
        const snapshots = await this.preload.pause(contextId, request.signal)
        return jsonResponse({ snapshots: await this.#withCachedBookCoverage(session.book.id, session.book.pages.length, snapshots) })
      }
      if (action === "retry") {
        const snapshots = await this.preload.retry(contextId, mode, request.signal)
        return jsonResponse({ snapshots: await this.#withCachedBookCoverage(session.book.id, session.book.pages.length, snapshots) }, 202)
      }
      const artifactFor = (
        page: typeof session.book.pages[number],
        context: { decision: SuperResolutionArtifactRunDecision },
      ) => ({
        key: artifactKey(session.book.source.path, page.contentVersion, page.entryPath ?? page.sourcePath, context.decision),
        metadata: { bookKey: session.book.id, contentType: "image/png" as const, extension: "png" as const },
      })
      const plan = session.preloadPlan()
      const snapshots = mode === "nearby"
        ? plan
          ? await this.preload.startPlan({
              contextId,
              plan,
              pages: session.book.pages,
              bookPath: session.book.source.path,
              artifactFor,
            }, request.signal)
          : undefined
        : await this.preload.startProgressive({
            contextId,
            generation: plan?.generation ?? Number(session.generation),
            currentPageIndex: Math.max(
              session.snapshot().anchorPageIndex,
              ...(plan?.currentPageIndexes ?? []),
            ),
            pages: session.book.pages,
            bookPath: session.book.source.path,
            artifactFor,
          }, request.signal)
      if (!snapshots) return jsonResponse({ error: "Reader preload plan is unavailable" }, 409)
      return jsonResponse({ snapshots: await this.#withCachedBookCoverage(session.book.id, session.book.pages.length, snapshots) }, 202)
    } catch (error) {
      if (request.signal.aborted) throw error
      const message = error instanceof Error ? error.message : String(error)
      const unavailable = message.includes("runtime is unavailable") || message.includes("preload is unavailable")
      return jsonResponse({ error: message }, unavailable ? 503 : 409)
    }
  }

  #assetUrl(sessionId: string, key: string, integrity: string): string {
    if (!key.startsWith(ARTIFACT_KEY_PREFIX)) throw new Error("Super-resolution artifact key has an unsupported schema.")
    const digest = key.slice(ARTIFACT_KEY_PREFIX.length)
    if (!/^[A-Za-z0-9_-]{43}$/u.test(digest)) throw new Error("Super-resolution artifact key is invalid.")
    const url = new URL(
      `/reader/s/${encodeURIComponent(sessionId)}/upscale-artifact/${digest}`,
      this.#baseUrl,
    )
    url.searchParams.set("version", integrity)
    url.searchParams.set("token", this.#token)
    return url.href
  }

  async #withCachedBookCoverage<T extends { upscaledPages?: number }>(
    bookKey: string,
    totalPages: number,
    snapshots: readonly T[],
  ): Promise<readonly T[]> {
    const cached = await this.artifacts.countBook?.(bookKey)
    if (cached === undefined) return snapshots
    const actual = Math.min(totalPages, cached)
    return snapshots.map((snapshot) => actual > (snapshot.upscaledPages ?? 0)
      ? { ...snapshot, upscaledPages: actual }
      : snapshot)
  }

  #begin(sessionId: ReaderSessionId, callerSignal: AbortSignal): {
    signal: AbortSignal
    release(): void
  } {
    callerSignal.throwIfAborted()
    const controller = new AbortController()
    const active = this.#active.get(sessionId) ?? new Set<AbortController>()
    active.add(controller)
    this.#active.set(sessionId, active)
    let released = false
    return {
      signal: AbortSignal.any([callerSignal, controller.signal]),
      release: () => {
        if (released) return
        released = true
        active.delete(controller)
        if (!active.size && this.#active.get(sessionId) === active) this.#active.delete(sessionId)
      },
    }
  }

  #isAuthorized(request: Request, url: URL): boolean {
    return request.headers.get("x-xiranite-token") === this.#token || url.searchParams.get("token") === this.#token
  }
}

function artifactKey(
  sourceIdentity: string,
  sourceRevision: string,
  pageIdentity: string,
  decision: SuperResolutionArtifactRunDecision,
): string {
  return buildSuperResolutionArtifactKey({
    sourceIdentity,
    sourceRevision,
    pageIdentity,
    modelId: decision.modelId,
    scale: decision.scale,
    noise: decision.noise,
    tileSize: decision.tileSize,
    tta: decision.tta,
    producerVersion: SUPER_RESOLUTION_ARTIFACT_PRODUCER_VERSION,
  })
}

function artifactEtag(integrity: string): string {
  return `"neoview-upscale-${createHash("sha256").update(integrity).digest("base64url")}"`
}

function matchesEtag(value: string | null, etag: string): boolean {
  return value?.split(",").some((candidate) => candidate.trim() === etag || candidate.trim() === "*") ?? false
}

function safeDecode(value: string): string | undefined {
  try {
    return decodeURIComponent(value)
  } catch {
    return undefined
  }
}

function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
  })
}

function methodNotAllowed(allow: string): Response {
  return new Response("Method not allowed", {
    status: 405,
    headers: { allow, "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
  })
}

function abortError(message: string): DOMException {
  return new DOMException(message, "AbortError")
}

function preloadContextId(sessionId: string): string {
  return `reader:${sessionId}:super-resolution`
}

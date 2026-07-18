import { createHash } from "node:crypto"
import { Readable } from "node:stream"

import type { ReaderService, ReaderSessionId } from "../../application/reader/contracts.js"
import type { SuperResolutionArtifactRunDecision } from "../../application/super-resolution/SuperResolutionArtifactPageService.js"
import type { SuperResolutionArtifactPagePort } from "../../ports/SuperResolutionArtifactPagePort.js"
import type { SuperResolutionArtifactStore } from "../../ports/SuperResolutionArtifactStore.js"
import { buildSuperResolutionArtifactKey } from "../super-resolution/SuperResolutionArtifactKey.js"

const CONTROL_PATH = /^\/reader\/s\/([^/]+)\/pages\/([^/]+)\/upscale-artifact$/
const ASSET_PATH = /^\/reader\/s\/([^/]+)\/upscale-artifact\/([A-Za-z0-9_-]{43})$/
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
  #closed = false

  constructor(
    private readonly reader: ReaderService,
    private readonly pages: SuperResolutionArtifactPagePort,
    private readonly artifacts: SuperResolutionArtifactStore,
    options: SuperResolutionArtifactRouteOptions,
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
    return undefined
  }

  releaseSession(sessionId: ReaderSessionId): void {
    const active = this.#active.get(sessionId)
    this.#active.delete(sessionId)
    for (const controller of active ?? []) {
      controller.abort(abortError(`Reader super-resolution session released: ${sessionId}`))
    }
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    for (const sessionId of this.#active.keys()) this.releaseSession(sessionId)
  }

  async #control(
    request: Request,
    url: URL,
    encodedSessionId: string,
    encodedPageId: string,
  ): Promise<Response> {
    if (this.#closed) return jsonResponse({ error: "Reader super-resolution route is closed" }, 410)
    if (!this.#isAuthorized(request, url)) return jsonResponse({ error: "Unauthorized" }, 401)
    if (request.method !== "POST") return methodNotAllowed("POST")
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
      const result = await this.pages.acquireOrGenerate({
        page,
        trigger,
        bookPath: session.book.source.path,
        priority: trigger === "manual" ? "interactive" : "view",
        artifactFor: (decision) => ({
          key: artifactKey(session.book.source.path, page.contentVersion, page.entryPath ?? page.sourcePath, decision),
          metadata: { bookKey: session.book.id, contentType: "image/png", extension: "png" },
        }),
      }, { signal: operation.signal })
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

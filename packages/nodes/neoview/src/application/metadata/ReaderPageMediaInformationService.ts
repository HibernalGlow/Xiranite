import type { ReaderPage } from "../../domain/page/page.js"
import type {
  ReaderPageMediaDetails,
  ReaderPageMediaMetadataProviderLoader,
} from "../../ports/ReaderPageMediaMetadataProvider.js"

export interface ReaderPageMediaInformation extends ReaderPageMediaDetails {
  pageId: string
  contentVersion: string
  mediaKind: ReaderPage["mediaKind"]
}

interface MediaInformationLoad {
  sessionId: string
  controller: AbortController
  promise: Promise<ReaderPageMediaInformation>
  waiters: number
  settled: boolean
}

const MAX_SETTLED_LOADS_PER_SESSION = 64

export class ReaderPageMediaInformationService implements AsyncDisposable {
  readonly #loads = new Map<string, MediaInformationLoad>()
  #provider?: Promise<Awaited<ReturnType<ReaderPageMediaMetadataProviderLoader>>>
  #closed = false

  constructor(private readonly loadProvider: ReaderPageMediaMetadataProviderLoader) {}

  async inspect(
    sessionId: string,
    page: ReaderPage,
    signal?: AbortSignal,
  ): Promise<ReaderPageMediaInformation> {
    this.#assertOpen()
    signal?.throwIfAborted()
    const identity = pageIdentity(page)
    if (page.mediaKind !== "video") return identity

    const key = `${sessionId}\0${page.id}\0${page.contentVersion}`
    let load = this.#loads.get(key)
    if (load?.settled) {
      this.#loads.delete(key)
      this.#loads.set(key, load)
    }
    if (!load) {
      const controller = new AbortController()
      load = {
        sessionId,
        controller,
        promise: Promise.resolve(identity),
        waiters: 0,
        settled: false,
      }
      const current = load
      current.promise = this.#inspectVideo(page, identity, controller.signal)
        .then((result) => {
          current.settled = true
          this.#trimSettledLoads(sessionId)
          return result
        })
        .catch((error) => {
          current.settled = true
          if (this.#loads.get(key) === current) this.#loads.delete(key)
          throw error
        })
      this.#loads.set(key, current)
      load = current
    }

    load.waiters += 1
    try {
      return await waitForSignal(load.promise, signal)
    } finally {
      load.waiters -= 1
      if (!load.settled && load.waiters === 0) {
        load.controller.abort(new DOMException("Page media information is no longer requested.", "AbortError"))
        if (this.#loads.get(key) === load) this.#loads.delete(key)
      }
    }
  }

  async releaseSession(sessionId: string): Promise<void> {
    const pending: Promise<unknown>[] = []
    for (const [key, load] of this.#loads) {
      if (load.sessionId !== sessionId) continue
      this.#loads.delete(key)
      load.controller.abort(new DOMException("Reader session closed.", "AbortError"))
      pending.push(load.promise.catch(() => undefined))
    }
    await Promise.all(pending)
  }

  async [Symbol.asyncDispose](): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    const pending: Promise<unknown>[] = []
    for (const load of this.#loads.values()) {
      load.controller.abort(new DOMException("Page media information service disposed.", "AbortError"))
      pending.push(load.promise.catch(() => undefined))
    }
    this.#loads.clear()
    await Promise.all(pending)
  }

  async #inspectVideo(
    page: ReaderPage,
    identity: ReaderPageMediaInformation,
    signal: AbortSignal,
  ): Promise<ReaderPageMediaInformation> {
    const provider = await waitForSignal(this.#getProvider(), signal)
    if (!page.entryPath) {
      const details = await provider.inspect({
        sourcePath: page.sourcePath,
        priority: "view",
        ownerId: `reader:media-information:${page.id}`,
      }, signal)
      return { ...identity, ...normalizeDetails(details) }
    }

    const source = await page.content.load(signal)
    let stream: ReadableStream<Uint8Array> | undefined
    try {
      stream = await source.open(signal)
      const details = await provider.inspect({
        sourceStream: stream,
        priority: "view",
        ownerId: `reader:media-information:${page.id}`,
      }, signal)
      return { ...identity, ...normalizeDetails(details) }
    } finally {
      await stream?.cancel("page media information finished").catch(() => undefined)
      await source.close().catch(() => undefined)
    }
  }

  #getProvider(): Promise<Awaited<ReturnType<ReaderPageMediaMetadataProviderLoader>>> {
    if (!this.#provider) {
      const pending = this.loadProvider().catch((error) => {
        if (this.#provider === pending) this.#provider = undefined
        throw error
      })
      this.#provider = pending
    }
    return this.#provider
  }

  #trimSettledLoads(sessionId: string): void {
    let settled = 0
    for (const load of this.#loads.values()) {
      if (load.sessionId === sessionId && load.settled) settled += 1
    }
    if (settled <= MAX_SETTLED_LOADS_PER_SESSION) return
    for (const [key, load] of this.#loads) {
      if (load.sessionId !== sessionId || !load.settled) continue
      this.#loads.delete(key)
      settled -= 1
      if (settled <= MAX_SETTLED_LOADS_PER_SESSION) return
    }
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("Page media information service is closed.")
  }
}

function pageIdentity(page: ReaderPage): ReaderPageMediaInformation {
  return {
    pageId: page.id,
    contentVersion: page.contentVersion,
    mediaKind: page.mediaKind,
  }
}

function normalizeDetails(details: ReaderPageMediaDetails): ReaderPageMediaDetails {
  const durationSeconds = positiveFinite(details.durationSeconds)
  const frameRate = positiveFinite(details.frameRate)
  const bitRateBps = positiveInteger(details.bitRateBps)
  const videoCodec = normalizedCodec(details.videoCodec)
  const audioCodec = normalizedCodec(details.audioCodec)
  return {
    ...(durationSeconds === undefined ? {} : { durationSeconds }),
    ...(frameRate === undefined ? {} : { frameRate }),
    ...(bitRateBps === undefined ? {} : { bitRateBps }),
    ...(videoCodec === undefined ? {} : { videoCodec }),
    ...(audioCodec === undefined ? {} : { audioCodec }),
  }
}

function positiveFinite(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined
}

function positiveInteger(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

function normalizedCodec(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined
  const normalized = value.trim()
  return normalized && normalized.length <= 128 ? normalized : undefined
}

function waitForSignal<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort)
      reject(signal.reason)
    }
    signal.addEventListener("abort", abort, { once: true })
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort))
  })
}

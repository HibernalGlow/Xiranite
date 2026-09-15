import type { ReaderRuntimeResourceSnapshot, ViewSource } from "../../domain/book/book.js"
import type {
  OpenViewSourceOptions,
  ReaderService,
  ReaderSession,
  ReaderSessionId,
  ReaderSessionOptions,
} from "../../application/reader/contracts.js"
import type { ReaderPageOrderPatch } from "../../application/reader/ReaderPageOrder.js"
import { aggregateReaderPreloadTelemetry, type ReaderPreloadDiagnostics } from "../../application/preloading/PreloadTelemetry.js"
import type { NeoxideNativeBinding } from "./neoxideNativeBinding.js"
import { NeoxideNativeReaderSession } from "./NeoxideNativeReaderSession.js"

export class NeoxideNativeReaderService implements ReaderService {
  readonly #sessions = new Map<ReaderSessionId, NeoxideNativeReaderSession>()

  constructor(private readonly binding: NeoxideNativeBinding) {}

  get sessionCount(): number {
    return this.#sessions.size
  }

  preloadDiagnostics(): ReaderPreloadDiagnostics {
    return aggregateReaderPreloadTelemetry([...this.#sessions.values()].map((session) => session.preloadTelemetry()))
  }

  runtimeResourceDiagnostics(): ReaderRuntimeResourceSnapshot {
    return {
      archiveProviders: 0,
      archiveIndexEntries: 0,
      archiveIndexPayloadBytes: 0,
      archiveActiveExtractions: 0,
    }
  }

  updatePageOrderDefaults(_order: ReaderPageOrderPatch | undefined): void {}

  updateSessionDefaults(_options: Partial<ReaderSessionOptions>): void {}

  async openViewSource(source: ViewSource, options?: OpenViewSourceOptions): Promise<ReaderSession> {
    const raw = this.binding.readerOpen(source.path)
    const session = new NeoxideNativeReaderSession(this.binding, raw, source, options)
    this.#sessions.set(session.id, session)
    return session
  }

  getSession(sessionId: ReaderSessionId): ReaderSession | undefined {
    return this.#sessions.get(sessionId)
  }

  async closeSession(sessionId: ReaderSessionId): Promise<void> {
    const session = this.#sessions.get(sessionId)
    if (session) {
      await session.close()
      this.#sessions.delete(sessionId)
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    for (const id of [...this.#sessions.keys()]) {
      await this.closeSession(id)
    }
  }
}

import { stat } from "node:fs/promises"

import type { ReaderPathStatus, ReaderPathStatusProvider } from "../../ports/ReaderPathStatusProvider.js"
import type { ResourceScheduler } from "../../ports/ResourceScheduler.js"

export class PlatformReaderPathStatusProvider implements ReaderPathStatusProvider {
  constructor(
    private readonly scheduler?: ResourceScheduler,
    private readonly ownerId = "neoview:library-cleanup",
  ) {}

  async check(path: string, signal?: AbortSignal): Promise<ReaderPathStatus> {
    signal?.throwIfAborted()
    const lease = await this.scheduler?.acquire({
      resource: "io",
      kind: "reader.library.path-status",
      priority: "background",
      ownerId: this.ownerId,
    }, signal)
    try {
      await stat(path)
      signal?.throwIfAborted()
      return "present"
    } catch (error) {
      if (signal?.aborted) throw signal.reason
      const code = errorCode(error)
      return code === "ENOENT" || code === "ENOTDIR" ? "missing" : "unknown"
    } finally {
      lease?.release()
    }
  }
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined
}

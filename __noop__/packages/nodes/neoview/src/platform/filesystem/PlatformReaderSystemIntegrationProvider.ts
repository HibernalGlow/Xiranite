import { stat } from "node:fs/promises"

import type { ReaderSystemIntegrationProvider } from "../../ports/ReaderSystemIntegrationProvider.js"
import type { ResourceScheduler } from "../../ports/ResourceScheduler.js"

export interface PlatformReaderSystemIntegrationProviderOptions {
  scheduler?: ResourceScheduler
  ownerId?: string
  openPath?: (path: string) => Promise<unknown>
  revealPath?: (path: string) => Promise<unknown>
}

export class PlatformReaderSystemIntegrationProvider implements ReaderSystemIntegrationProvider {
  readonly #scheduler?: ResourceScheduler
  readonly #ownerId: string
  readonly #openPath: (path: string) => Promise<unknown>
  readonly #revealPath: (path: string) => Promise<unknown>

  constructor(options: PlatformReaderSystemIntegrationProviderOptions = {}) {
    this.#scheduler = options.scheduler
    this.#ownerId = options.ownerId ?? "neoview:system-integration"
    this.#openPath = options.openPath ?? (async (path) => (await import("open")).default(path, { wait: false }))
    this.#revealPath = options.revealPath ?? (async (path) => (await import("reveal-file")).default(path))
  }

  open(path: string, signal?: AbortSignal): Promise<void> {
    return this.#run("open", path, this.#openPath, signal)
  }

  reveal(path: string, signal?: AbortSignal): Promise<void> {
    return this.#run("reveal", path, this.#revealPath, signal)
  }

  async #run(kind: "open" | "reveal", path: string, operation: (path: string) => Promise<unknown>, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    const lease = await this.#scheduler?.acquire({
      resource: "io",
      kind: `reader.system.${kind}`,
      priority: "interactive",
      ownerId: this.#ownerId,
    }, signal)
    try {
      await stat(path)
      signal?.throwIfAborted()
      await operation(path)
    } finally {
      lease?.release()
    }
  }
}

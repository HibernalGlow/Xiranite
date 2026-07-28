import type { Stats } from "node:fs"
import { stat } from "node:fs/promises"
import { platform } from "node:process"

import type { ReaderExplorerContextMenuProvider } from "../../ports/ReaderExplorerContextMenuProvider.js"
import type { ReaderSystemIntegrationProvider } from "../../ports/ReaderSystemIntegrationProvider.js"
import type { ResourceScheduler } from "../../ports/ResourceScheduler.js"

export interface PlatformReaderSystemIntegrationProviderOptions {
  scheduler?: ResourceScheduler
  ownerId?: string
  platform?: NodeJS.Platform
  openPath?: (path: string) => Promise<unknown>
  revealPath?: (path: string) => Promise<unknown>
  openDirectoryInExplorer?: (path: string) => Promise<unknown>
  openExternalUrl?: (url: string) => Promise<unknown>
  explorerContextMenu?: ReaderExplorerContextMenuProvider
}

export class PlatformReaderSystemIntegrationProvider implements ReaderSystemIntegrationProvider {
  readonly #scheduler?: ResourceScheduler
  readonly #ownerId: string
  readonly #platform: NodeJS.Platform
  readonly #openPath: (path: string) => Promise<unknown>
  readonly #revealPath: (path: string) => Promise<unknown>
  readonly #openDirectoryInExplorer: (path: string) => Promise<unknown>
  readonly #openExternalUrl: (url: string) => Promise<unknown>
  readonly explorerContextMenu?: ReaderExplorerContextMenuProvider

  constructor(options: PlatformReaderSystemIntegrationProviderOptions = {}) {
    this.#scheduler = options.scheduler
    this.#ownerId = options.ownerId ?? "neoview:system-integration"
    this.#platform = options.platform ?? platform
    this.#openPath = options.openPath ?? (async (path) => (await import("open")).default(path, { wait: false }))
    this.#revealPath = options.revealPath ?? (async (path) => (await import("reveal-file")).default(path))
    this.#openDirectoryInExplorer = options.openDirectoryInExplorer
      ?? (async (path) => (await import("open")).default(path, { app: { name: "explorer.exe" }, wait: false }))
    this.#openExternalUrl = options.openExternalUrl ?? (async (url) => (await import("open")).default(url, { wait: false }))
    this.explorerContextMenu = options.explorerContextMenu
  }

  open(path: string, signal?: AbortSignal): Promise<void> {
    return this.#run("open", path, async (target) => this.#openPath(target), signal)
  }

  reveal(path: string, signal?: AbortSignal): Promise<void> {
    return this.#run("reveal", path, async (target, info) => {
      if (this.#platform === "win32" && info.isDirectory()) await this.#openDirectoryInExplorer(target)
      else await this.#revealPath(target)
    }, signal)
  }

  openExternalUrl(url: string, signal?: AbortSignal): Promise<void> {
    return this.#runOperation("open-external-url", () => this.#openExternalUrl(url), signal)
  }

  async #run(kind: "open" | "reveal", path: string, operation: (path: string, info: Stats) => Promise<unknown>, signal?: AbortSignal): Promise<void> {
    return this.#runOperation(kind, async () => {
      const info = await stat(path)
      signal?.throwIfAborted()
      await operation(path, info)
    }, signal)
  }

  async #runOperation(kind: "open" | "reveal" | "open-external-url", operation: () => Promise<unknown>, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    const lease = await this.#scheduler?.acquire({
      resource: "io",
      kind: `reader.system.${kind}`,
      priority: "interactive",
      ownerId: this.#ownerId,
    }, signal)
    try {
      await operation()
    } finally {
      lease?.release()
    }
  }
}

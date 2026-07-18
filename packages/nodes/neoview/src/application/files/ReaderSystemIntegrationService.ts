import { isAbsolute } from "node:path"

import type {
  ReaderExplorerContextMenuPreview,
  ReaderExplorerContextMenuStatus,
} from "../../ports/ReaderExplorerContextMenuProvider.js"
import type { ReaderSystemIntegrationProvider } from "../../ports/ReaderSystemIntegrationProvider.js"

export class ReaderSystemIntegrationService {
  constructor(private readonly provider: ReaderSystemIntegrationProvider) {}

  async open(path: string, signal?: AbortSignal): Promise<void> {
    await this.provider.open(validPath(path), signal)
  }

  async reveal(path: string, signal?: AbortSignal): Promise<void> {
    await this.provider.reveal(validPath(path), signal)
  }

  explorerContextMenuPreview(signal?: AbortSignal): Promise<ReaderExplorerContextMenuPreview> {
    return this.provider.explorerContextMenu?.preview(signal)
      ?? Promise.resolve({ available: false, plan: [], registryFile: "", reason: "Explorer context-menu registration is unavailable." })
  }

  explorerContextMenuStatus(signal?: AbortSignal): Promise<ReaderExplorerContextMenuStatus> {
    return this.provider.explorerContextMenu?.status(signal)
      ?? Promise.resolve({ available: false, enabled: false, reason: "Explorer context-menu registration is unavailable." })
  }

  explorerContextMenuSetEnabled(enabled: boolean, signal?: AbortSignal): Promise<ReaderExplorerContextMenuStatus> {
    return this.provider.explorerContextMenu?.setEnabled(enabled, signal)
      ?? Promise.resolve({ available: false, enabled: false, reason: "Explorer context-menu registration is unavailable." })
  }
}

function validPath(path: string): string {
  if (typeof path !== "string" || !path || path.includes("\0") || !isAbsolute(path)) {
    throw new Error("Reader system integration path must be absolute.")
  }
  return path
}

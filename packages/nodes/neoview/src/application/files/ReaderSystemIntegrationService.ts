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

  async openExternalUrl(value: string, signal?: AbortSignal): Promise<void> {
    if (!this.provider.openExternalUrl) throw new Error("Reader external URL integration is unavailable.")
    await this.provider.openExternalUrl(validExternalUrl(value), signal)
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

function validExternalUrl(value: string): string {
  if (typeof value !== "string" || !value || value.length > 4_096 || value.includes("\0")) {
    throw new Error("Reader external URL must be a bounded HTTP or HTTPS URL.")
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error("Reader external URL must be a bounded HTTP or HTTPS URL.")
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new Error("Reader external URL must be a bounded HTTP or HTTPS URL without credentials.")
  }
  return url.href
}

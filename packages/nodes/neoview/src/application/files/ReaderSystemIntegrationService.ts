import { isAbsolute } from "node:path"

import type { ReaderSystemIntegrationProvider } from "../../ports/ReaderSystemIntegrationProvider.js"

export class ReaderSystemIntegrationService {
  constructor(private readonly provider: ReaderSystemIntegrationProvider) {}

  async open(path: string, signal?: AbortSignal): Promise<void> {
    await this.provider.open(validPath(path), signal)
  }

  async reveal(path: string, signal?: AbortSignal): Promise<void> {
    await this.provider.reveal(validPath(path), signal)
  }
}

function validPath(path: string): string {
  if (typeof path !== "string" || !path || path.includes("\0") || !isAbsolute(path)) {
    throw new Error("Reader system integration path must be absolute.")
  }
  return path
}

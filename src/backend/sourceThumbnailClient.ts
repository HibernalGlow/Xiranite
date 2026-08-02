import { createSourceThumbnailClient, type SourceThumbnailClient } from "@xiranite/api/client"

import { resolveLocalBackendConfig } from "./localBackendConfig"

export const localSourceThumbnailClient: SourceThumbnailClient = {
  async register(contextId, generation, items, signal) {
    return await currentClient().register(contextId, generation, items, signal)
  },
  async releaseContext(contextId) {
    await currentClient().releaseContext(contextId)
  },
}

function currentClient(): SourceThumbnailClient {
  const config = resolveLocalBackendConfig()
  return createSourceThumbnailClient(config.baseUrl, { token: config.token })
}

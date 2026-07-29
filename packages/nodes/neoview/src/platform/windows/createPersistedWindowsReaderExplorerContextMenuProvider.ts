import type { ResolveConfigPathOptions } from "@xiranite/config"

import type { NeoviewMediaConfig } from "../../application/config/ReaderRuntimeConfig.js"
import type { ResourceScheduler } from "../../ports/ResourceScheduler.js"
import { readerExplorerFileExtensions } from "./ReaderExplorerExtensions.js"
import {
  createNeoviewExplorerIntegrationSettingsStore,
  PersistedReaderExplorerContextMenuProvider,
} from "./PersistedReaderExplorerContextMenuProvider.js"
import { createWindowsReaderExplorerContextMenuProvider } from "./createWindowsReaderExplorerContextMenuProvider.js"

export function createPersistedWindowsReaderExplorerContextMenuProvider(options: ResolveConfigPathOptions & {
  resourceScheduler?: ResourceScheduler
  media: () => Pick<NeoviewMediaConfig, "supportedImageFormats" | "videoFormats">
}): PersistedReaderExplorerContextMenuProvider {
  return new PersistedReaderExplorerContextMenuProvider({
    extensions: () => readerExplorerFileExtensions(options.media()),
    settings: createNeoviewExplorerIntegrationSettingsStore(options),
    createProvider: (extensions, scopes) => createWindowsReaderExplorerContextMenuProvider({
      resourceScheduler: options.resourceScheduler,
      extensions: () => extensions,
      registration: scopes ? { scopes } : undefined,
    }),
  })
}

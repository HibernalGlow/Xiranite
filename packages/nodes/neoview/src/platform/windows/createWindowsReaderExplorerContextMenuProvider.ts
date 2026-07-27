import type { NeoviewMediaConfig } from "../../application/config/ReaderRuntimeConfig.js"
import type { ResourceScheduler } from "../../ports/ResourceScheduler.js"
import { readerExplorerFileExtensions } from "./ReaderExplorerExtensions.js"
import { WindowsReaderExplorerContextMenuProvider } from "./WindowsReaderExplorerContextMenuProvider.js"

export function createWindowsReaderExplorerContextMenuProvider(options: {
  resourceScheduler?: ResourceScheduler
  media?: () => Pick<NeoviewMediaConfig, "supportedImageFormats" | "videoFormats">
  extensions?: () => readonly string[]
} = {}): WindowsReaderExplorerContextMenuProvider {
  return new WindowsReaderExplorerContextMenuProvider({
    resourceScheduler: options.resourceScheduler,
    extensions: options.extensions ?? (() => readerExplorerFileExtensions(options.media?.())),
  })
}

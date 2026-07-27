import type { ReaderSystemIntegrationService } from "../../application/files/ReaderSystemIntegrationService.js"
import type { ResourceScheduler } from "../../ports/ResourceScheduler.js"

export async function createReaderSystemIntegrationService(
  resourceScheduler?: ResourceScheduler,
): Promise<ReaderSystemIntegrationService> {
  const { ReaderSystemIntegrationService } = await import("../../application/files/ReaderSystemIntegrationService.js")
  const { PlatformReaderSystemIntegrationProvider } = await import("./PlatformReaderSystemIntegrationProvider.js")
  const { createWindowsReaderExplorerContextMenuProvider } = await import("../windows/createWindowsReaderExplorerContextMenuProvider.js")
  return new ReaderSystemIntegrationService(new PlatformReaderSystemIntegrationProvider({
    scheduler: resourceScheduler,
    explorerContextMenu: createWindowsReaderExplorerContextMenuProvider({ resourceScheduler }),
  }))
}

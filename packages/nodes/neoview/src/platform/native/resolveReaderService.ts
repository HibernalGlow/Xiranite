import type { ReaderService } from "../../application/reader/contracts.js"
import { getNeoxideNativeBinding, isNeoxideNativeAvailable } from "./neoxideNativeBinding.js"
import { NeoxideNativeReaderService } from "./NeoxideNativeReaderService.js"

export interface ReaderServiceConfigOptions {
  readerCore?: "original" | "node"
  readerService?: ReaderService
}

export function resolveConfiguredReaderService<T extends ReaderService = ReaderService>(
  options: ReaderServiceConfigOptions,
  configuredCore: "original" | "node" | undefined,
  fallback: () => T,
): T {
  if (options.readerService) {
    return options.readerService as unknown as T
  }

  const selectedCore = options.readerCore
    ?? configuredCore
    ?? (process.env.XIRANITE_NEOVIEW_READER_CORE === "node" ? "node" : undefined)

  if (selectedCore === "node" && isNeoxideNativeAvailable()) {
    const binding = getNeoxideNativeBinding()
    if (binding) {
      return new NeoxideNativeReaderService(binding) as unknown as T
    }
  }

  return fallback()
}

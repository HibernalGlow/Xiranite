import type { ResolveConfigPathOptions } from "@xiranite/config"
import { parseNeoviewRuntimeConfig } from "../../application/config/ReaderRuntimeConfig.js"
import type { ReaderSessionOptions } from "../../application/reader/contracts.js"

export interface NeoviewRuntimeLoadOptions extends ResolveConfigPathOptions {
  sessionOptions?: Partial<ReaderSessionOptions>
}

export async function loadNeoviewSessionOptions(
  options: NeoviewRuntimeLoadOptions = {},
): Promise<Partial<ReaderSessionOptions>> {
  const { loadNodeConfigWithHints } = await import("@xiranite/config")
  const { config } = await loadNodeConfigWithHints("neoview", options)
  const configured = parseNeoviewRuntimeConfig(config).sessionOptions
  return mergeSessionOptions(configured, options.sessionOptions)
}

function mergeSessionOptions(
  configured: Partial<ReaderSessionOptions>,
  explicit: Partial<ReaderSessionOptions> | undefined,
): Partial<ReaderSessionOptions> {
  if (!explicit) return configured
  return {
    direction: explicit.direction ?? configured.direction,
    layout: explicit.layout ?? configured.layout,
    tailOverflow: explicit.tailOverflow ?? configured.tailOverflow,
  }
}

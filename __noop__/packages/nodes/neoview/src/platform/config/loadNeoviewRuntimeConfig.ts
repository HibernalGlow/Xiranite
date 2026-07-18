import type { ResolveConfigPathOptions } from "@xiranite/config"
import { parseNeoviewRuntimeConfig, type NeoviewRuntimeConfig } from "../../application/config/ReaderRuntimeConfig.js"
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

export async function loadNeoviewRuntimeConfig(
  options: NeoviewRuntimeLoadOptions = {},
): Promise<NeoviewRuntimeConfig> {
  const { loadNodeConfigWithHints } = await import("@xiranite/config")
  const { config } = await loadNodeConfigWithHints("neoview", options)
  const parsed = parseNeoviewRuntimeConfig(config)
  const sessionOptions = mergeSessionOptions(parsed.sessionOptions, options.sessionOptions)
  return {
    ...parsed,
    sessionOptions,
    viewDefaults: {
      ...parsed.viewDefaults,
      pageMode: sessionOptions.layout?.pageMode ?? parsed.viewDefaults.pageMode,
    },
  }
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

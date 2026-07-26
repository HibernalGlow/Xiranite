import type { CzkawkaTool } from "./core.js"

export const CZKAWKA_CACHE_SOURCE_VERSION = "12.0.0"

export interface CzkawkaCacheRegenerationState {
  sourceVersion?: string
  noticeSourceVersion?: string
}

const AFFECTED_TOOLS: readonly CzkawkaTool[] = [
  "duplicate-files",
  "similar-images",
  "similar-videos",
  "broken-files",
]

export function nextCzkawkaCacheRegenerationState(
  current: CzkawkaCacheRegenerationState,
  tool: CzkawkaTool,
): CzkawkaCacheRegenerationState | undefined {
  if (!AFFECTED_TOOLS.includes(tool)) return undefined
  if (
    current.sourceVersion === CZKAWKA_CACHE_SOURCE_VERSION
    && current.noticeSourceVersion === CZKAWKA_CACHE_SOURCE_VERSION
  ) return undefined
  return {
    sourceVersion: CZKAWKA_CACHE_SOURCE_VERSION,
    noticeSourceVersion: CZKAWKA_CACHE_SOURCE_VERSION,
  }
}

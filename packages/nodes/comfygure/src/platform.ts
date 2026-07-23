import type { ComfygureRuntime } from "./core.js"

export function createNodeComfygureRuntime(): ComfygureRuntime {
  return { fetch: (url, init) => globalThis.fetch(url, init) }
}

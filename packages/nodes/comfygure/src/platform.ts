import { readFile } from "node:fs/promises"
import { relative, resolve, sep } from "node:path"

import type { ComfygureRuntime } from "./core.js"

export function createNodeComfygureRuntime(): ComfygureRuntime {
  return {
    fetch: (url, init) => globalThis.fetch(url, init),
    readLoraTrigger: async (libraryPath, loraName) => {
      const loraRoot = resolve(libraryPath, "models", "loras")
      const normalizedName = loraName.replace(/\\/g, "/").replace(/^\/+/, "")
      const extension = normalizedName.lastIndexOf(".")
      const triggerName = `${extension > 0 ? normalizedName.slice(0, extension) : normalizedName}.trigger.txt`
      const candidate = resolve(loraRoot, triggerName)
      const relativeCandidate = relative(loraRoot, candidate)
      if (!relativeCandidate || relativeCandidate === ".." || relativeCandidate.startsWith(`..${sep}`)) return undefined
      try {
        const text = await readFile(candidate, "utf8")
        const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"))
        return lines.join("\n") || undefined
      } catch {
        return undefined
      }
    },
  }
}

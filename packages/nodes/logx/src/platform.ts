import { readLogDirectory, resolveLogDirectory } from "@xiranite/logging/node"
import { runLogx, type LogxInput, type LogxRuntime } from "./core.js"

export function createNodeLogxRuntime(): LogxRuntime {
  return {
    async read(input) {
      const directory = resolveLogDirectory(input.directory)
      const result = await readLogDirectory(directory)
      return { directory, events: result.events, files: result.files, issues: result.issues.map(({ raw: _raw, ...issue }) => issue) }
    },
  }
}

export async function runLogxNode(input: LogxInput) {
  return runLogx(input, createNodeLogxRuntime())
}

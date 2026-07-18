import { readdir, rename, stat, utimes } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import type { NameuRuntime } from "./core.js"

export function createNodeNameuRuntime(): NameuRuntime {
  return {
    pathInfo: async (path) => {
      try {
        const info = await stat(path)
        return {
          path,
          exists: true,
          isFile: info.isFile(),
          isDirectory: info.isDirectory(),
          atimeMs: info.atimeMs,
          mtimeMs: info.mtimeMs,
        }
      } catch {
        return { path, exists: false, isFile: false, isDirectory: false, atimeMs: 0, mtimeMs: 0 }
      }
    },
    listDir: async (path) => {
      const entries = await readdir(path, { withFileTypes: true })
      return entries.map((entry) => ({
        name: entry.name,
        path: join(path, entry.name),
        isFile: entry.isFile(),
        isDirectory: entry.isDirectory(),
      }))
    },
    rename,
    setTimes: async (path, atimeMs, mtimeMs) => {
      await utimes(path, new Date(atimeMs), new Date(mtimeMs))
    },
    join,
    dirname,
    basename,
  }
}

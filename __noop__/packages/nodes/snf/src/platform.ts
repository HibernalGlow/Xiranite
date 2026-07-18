import { readdir, rename, stat, utimes } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import type { SnfRuntime } from "./core.js"

export function createNodeSnfRuntime(): SnfRuntime {
  return {
    pathInfo: async (path) => {
      try {
        const info = await stat(path)
        return { path, exists: true, isDirectory: info.isDirectory(), atimeMs: info.atimeMs, mtimeMs: info.mtimeMs }
      } catch {
        return { path, exists: false, isDirectory: false, atimeMs: 0, mtimeMs: 0 }
      }
    },
    listDir: async (path) => {
      const entries = await readdir(path, { withFileTypes: true })
      return entries.map((entry) => ({ name: entry.name, path: join(path, entry.name), isDirectory: entry.isDirectory() }))
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

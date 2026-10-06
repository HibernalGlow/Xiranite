import { mkdir, readdir, rename, stat } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import type { SameaRuntime } from "./core.js"

export function createNodeSameaRuntime(): SameaRuntime {
  return {
    pathInfo: async (path) => {
      try { const info = await stat(path); return { path, exists: true, isFile: info.isFile(), isDirectory: info.isDirectory() } }
      catch { return { path, exists: false, isFile: false, isDirectory: false } }
    },
    listDir: async (path) => (await readdir(path, { withFileTypes: true })).map((entry) => ({ name: entry.name, path: join(path, entry.name), isFile: entry.isFile(), isDirectory: entry.isDirectory() })),
    ensureDir: async (path) => { await mkdir(path, { recursive: true }) },
    movePath: async (source, target) => { await mkdir(dirname(target), { recursive: true }); await rename(source, target) },
    join, dirname, basename,
  }
}

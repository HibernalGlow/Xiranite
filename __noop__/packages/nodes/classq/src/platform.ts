import { cp, mkdir, readdir, rename, stat } from "node:fs/promises"
import { basename, dirname, join, relative } from "node:path"
import type { ClassqRuntime, ClassqTransferMode } from "./core.js"

export function createNodeClassqRuntime(): ClassqRuntime {
  return {
    pathInfo: async (path) => {
      try {
        const info = await stat(path)
        return { path, exists: true, isFile: info.isFile(), isDirectory: info.isDirectory() }
      } catch {
        return { path, exists: false, isFile: false, isDirectory: false }
      }
    },
    listDir: async (path) => {
      const entries = await readdir(path, { withFileTypes: true })
      return entries.map((entry) => ({ name: entry.name, path: join(path, entry.name), isFile: entry.isFile(), isDirectory: entry.isDirectory() }))
    },
    ensureDir: async (path) => {
      await mkdir(path, { recursive: true })
    },
    transfer: async (source, target, mode: ClassqTransferMode) => {
      if (mode === "copy") {
        await cp(source, target, { recursive: true, errorOnExist: true, force: false })
        return
      }
      await rename(source, target)
    },
    join,
    dirname,
    basename,
    relative,
  }
}

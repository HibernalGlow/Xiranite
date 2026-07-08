import { copyFile, link, mkdir, readdir, rename, stat } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import type { SimiuRuntime } from "./core.js"

export function createNodeSimiuRuntime(): SimiuRuntime {
  return {
    pathInfo,
    listDir,
    makeDir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
    moveFile: rename,
    copyFile,
    linkFile: link,
    join,
    dirname,
    basename,
  }
}

async function pathInfo(path: string) {
  try {
    const info = await stat(path)
    return { path: resolve(path), exists: true, isFile: info.isFile(), isDirectory: info.isDirectory(), size: info.size }
  } catch {
    return { path, exists: false, isFile: false, isDirectory: false, size: 0 }
  }
}

async function listDir(path: string) {
  const entries = await readdir(path, { withFileTypes: true })
  return Promise.all(entries.map(async (entry) => {
    const entryPath = join(path, entry.name)
    const info = await stat(entryPath).catch(() => undefined)
    return {
      name: entry.name,
      path: entryPath,
      isFile: entry.isFile(),
      isDirectory: entry.isDirectory(),
      size: info?.size ?? 0,
    }
  }))
}

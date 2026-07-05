import { mkdir, readdir, rename, stat, writeFile } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import type { FormatvDirEntry, FormatvPathInfo, FormatvRuntime } from "./core.js"

export function createNodeFormatvRuntime(): FormatvRuntime {
  return {
    pathInfo,
    listDir,
    renamePath,
    writeText,
    join,
    dirname,
    basename,
  }
}

async function pathInfo(path: string): Promise<FormatvPathInfo> {
  const resolved = resolve(path)
  try {
    const info = await stat(resolved)
    return { path: resolved, exists: true, isFile: info.isFile(), isDirectory: info.isDirectory(), size: info.size }
  } catch {
    return { path: resolved, exists: false, isFile: false, isDirectory: false, size: 0 }
  }
}

async function listDir(path: string): Promise<FormatvDirEntry[]> {
  const entries = await readdir(path, { withFileTypes: true })
  return entries.map((entry) => ({
    name: entry.name,
    path: join(path, entry.name),
    isFile: entry.isFile(),
    isDirectory: entry.isDirectory(),
  }))
}

async function renamePath(source: string, target: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true })
  await rename(source, target)
}

async function writeText(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, "utf8")
}

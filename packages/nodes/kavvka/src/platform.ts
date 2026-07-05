import { cp, lstat, mkdir, readdir, rename, rm } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import type { KavvkaDirEntry, KavvkaPathInfo, KavvkaRuntime } from "./core.js"

export function createNodeKavvkaRuntime(): KavvkaRuntime {
  return {
    pathInfo,
    listDir,
    ensureDir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
    movePath,
    join,
    dirname,
    basename,
    normalize: (path) => resolve(path),
    now: () => new Date(),
  }
}

async function pathInfo(path: string): Promise<KavvkaPathInfo> {
  const resolved = resolve(path)
  try {
    const stat = await lstat(resolved)
    return { path: resolved, exists: true, isFile: stat.isFile(), isDirectory: stat.isDirectory() }
  } catch {
    return { path: resolved, exists: false, isFile: false, isDirectory: false }
  }
}

async function listDir(path: string): Promise<KavvkaDirEntry[]> {
  const entries = await readdir(resolve(path), { withFileTypes: true })
  return entries.map((entry) => ({
    name: entry.name,
    path: join(resolve(path), entry.name),
    isDirectory: entry.isDirectory(),
    isFile: entry.isFile(),
  }))
}

async function movePath(source: string, target: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true })
  try {
    await rename(source, target)
  } catch {
    await cp(source, target, { recursive: true, force: false, errorOnExist: true })
    await rm(source, { recursive: true, force: true })
  }
}

import { access, mkdir, readdir, rename, cp, rm, readFile } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import type { SeriexDirEntry, SeriexRuntime } from "./core.js"

export function createNodeSeriexRuntime(): SeriexRuntime {
  return {
    exists,
    listDir,
    ensureDir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
    movePath,
    readText,
    join,
    dirname,
    basename,
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function listDir(path: string): Promise<SeriexDirEntry[]> {
  const entries = await readdir(path, { withFileTypes: true })
  return entries.map((entry) => ({
    name: entry.name,
    path: join(path, entry.name),
    isDirectory: entry.isDirectory(),
    isFile: entry.isFile(),
  }))
}

async function movePath(source: string, target: string): Promise<void> {
  const sourcePath = resolve(source)
  const targetPath = resolve(target)
  await mkdir(dirname(targetPath), { recursive: true })
  try {
    await rename(sourcePath, targetPath)
  } catch {
    await cp(sourcePath, targetPath, { recursive: true, force: false, errorOnExist: true })
    await rm(sourcePath, { recursive: true, force: true })
  }
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8")
  } catch {
    return null
  }
}

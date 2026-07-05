import { access, mkdir, readdir, rename, cp, rm } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import type { MoveaDirEntry, MoveaRuntime } from "./core.js"

export function createNodeMoveaRuntime(): MoveaRuntime {
  return {
    exists,
    listDir,
    ensureDir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
    movePath,
    join,
    dirname,
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

async function listDir(path: string): Promise<MoveaDirEntry[]> {
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

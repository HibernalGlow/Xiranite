import { cp, lstat, mkdir, readdir, readFile, rename, rm, rmdir, writeFile } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import { homedir } from "node:os"
import type { DissolvefDirEntry, DissolvefPathInfo, DissolvefRuntime } from "./core.js"

export function createNodeDissolvefRuntime(): DissolvefRuntime {
  return {
    pathInfo,
    listDir,
    ensureDir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
    movePath,
    deletePath,
    readText,
    writeText,
    join,
    dirname,
    basename,
    now: () => new Date(),
    randomId: () => crypto.randomUUID().slice(0, 8),
    defaultHistoryPath: () => join(homedir(), ".dissolvef", "undo.json"),
  }
}

async function pathInfo(path: string): Promise<DissolvefPathInfo> {
  const resolved = resolve(path)
  try {
    const stat = await lstat(resolved)
    return { path: resolved, exists: true, isFile: stat.isFile(), isDirectory: stat.isDirectory() }
  } catch {
    return { path: resolved, exists: false, isFile: false, isDirectory: false }
  }
}

async function listDir(path: string): Promise<DissolvefDirEntry[]> {
  const entries = await readdir(path, { withFileTypes: true })
  return entries.map((entry) => ({
    name: entry.name,
    path: join(path, entry.name),
    isFile: entry.isFile(),
    isDirectory: entry.isDirectory(),
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

async function deletePath(path: string, recursive = false): Promise<void> {
  if (recursive) {
    await rm(path, { recursive: true, force: false })
    return
  }
  const info = await pathInfo(path)
  if (info.isDirectory) await rmdir(path)
  else await rm(path, { force: false })
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8")
  } catch {
    return null
  }
}

async function writeText(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, "utf8")
}

import { cp, mkdir, readdir, rename, rm, stat, symlink, writeFile } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import type { RawfilterDirEntry, RawfilterPathInfo, RawfilterRuntime } from "./core.js"

export function createNodeRawfilterRuntime(): RawfilterRuntime {
  return {
    pathInfo,
    listDir,
    ensureDir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
    moveFile,
    createShortcut,
    join,
    dirname,
    basename,
  }
}

async function pathInfo(path: string): Promise<RawfilterPathInfo> {
  const resolved = resolve(path)
  try {
    const info = await stat(resolved)
    return { path: resolved, exists: true, isFile: info.isFile(), isDirectory: info.isDirectory() }
  } catch {
    return { path: resolved, exists: false, isFile: false, isDirectory: false }
  }
}

async function listDir(path: string): Promise<RawfilterDirEntry[]> {
  const entries = await readdir(path, { withFileTypes: true })
  return entries.map((entry) => ({
    name: entry.name,
    path: join(path, entry.name),
    isFile: entry.isFile(),
    isDirectory: entry.isDirectory(),
  }))
}

async function moveFile(source: string, target: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true })
  try {
    await rename(source, target)
  } catch {
    await cp(source, target, { force: false, errorOnExist: true })
    await rm(source, { force: true })
  }
}

async function createShortcut(source: string, target: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true })
  try {
    await symlink(resolve(source), target)
    return
  } catch {
    const url = pathToFileURL(resolve(source)).href
    await writeFile(target, `[InternetShortcut]\nURL=${url}\n`, "utf8")
  }
}

import { access, cp, lstat, mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import type { LinkPathInfo, LinkuRuntime } from "./core.js"

export function createNodeLinkuRuntime(configPath = join(process.cwd(), "linku.toml")): LinkuRuntime {
  return {
    pathInfo,
    createSymlink,
    movePath,
    readConfig: (path) => readConfig(path || configPath),
    writeConfig: (content, path) => writeConfig(content, path || configPath),
  }
}

async function pathInfo(path: string): Promise<LinkPathInfo> {
  const resolved = resolve(path)
  let stat
  try {
    stat = await lstat(resolved)
  } catch {
    return { path: resolved, exists: false, kind: "missing", isSymlink: false }
  }

  const isSymlink = stat.isSymbolicLink()
  let linkTarget: string | undefined
  let targetExists: boolean | undefined
  if (isSymlink) {
    try {
      const { readlink } = await import("node:fs/promises")
      linkTarget = await readlink(resolved)
      targetExists = await exists(resolve(dirname(resolved), linkTarget))
    } catch {
      targetExists = false
    }
  }

  const kind = stat.isDirectory() ? "dir" : stat.isFile() ? "file" : "other"
  const extra = kind === "dir" ? await directoryStats(resolved) : kind === "file" ? { sizeMb: stat.size / 1024 / 1024 } : {}
  return { path: resolved, exists: true, kind, isSymlink, linkTarget, targetExists, ...extra }
}

async function createSymlink(source: string, link: string): Promise<void> {
  const sourceInfo = await pathInfo(source)
  if (!sourceInfo.exists) throw new Error(`Source path does not exist: ${source}`)
  const linkPath = resolve(link)
  await mkdir(dirname(linkPath), { recursive: true })
  try {
    const existing = await lstat(linkPath)
    if (!existing.isSymbolicLink()) {
      throw new Error(`Link path already exists and is not a symlink: ${linkPath}`)
    }
    await rm(linkPath, { force: true })
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? (error as { code?: string }).code : undefined
    if (code !== "ENOENT") throw error
  }
  const type = process.platform === "win32" && sourceInfo.kind === "dir" ? "junction" : sourceInfo.kind === "dir" ? "dir" : "file"
  await symlink(resolve(source), linkPath, type)
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

async function readConfig(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8")
  } catch {
    return null
  }
}

async function writeConfig(content: string, path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, "utf8")
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function directoryStats(path: string): Promise<{ sizeMb: number; fileCount: number }> {
  const { readdir } = await import("node:fs/promises")
  let size = 0
  let fileCount = 0
  async function walk(current: string) {
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const child = join(current, entry.name)
      if (entry.isDirectory()) await walk(child)
      else if (entry.isFile()) {
        try {
          const stat = await lstat(child)
          size += stat.size
          fileCount += 1
        } catch {
          // ignore unreadable files
        }
      }
    }
  }
  await walk(path)
  return { sizeMb: size / 1024 / 1024, fileCount }
}

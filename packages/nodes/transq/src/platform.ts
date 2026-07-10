import { access, copyFile as copyFileNative, cp, lstat, mkdir, readdir, readFile, rename, rm } from "node:fs/promises"
import type { Dirent } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"

import type { TransqDirectorySnapshot, TransqRuntime } from "./core.js"

export function createNodeTransqRuntime(): TransqRuntime {
  return {
    scanRoots,
    copyFile,
    moveDirectory,
    removePath,
  }
}

async function scanRoots(roots: string[]): Promise<TransqDirectorySnapshot[]> {
  const snapshots: TransqDirectorySnapshot[] = []
  const visited = new Set<string>()
  for (const root of roots) {
    await findQueues(resolve(root), snapshots, visited)
  }
  return snapshots
}

async function findQueues(path: string, snapshots: TransqDirectorySnapshot[], visited: Set<string>): Promise<void> {
  if (visited.has(path)) return
  visited.add(path)

  let stat
  try {
    stat = await lstat(path)
  } catch {
    return
  }
  if (!stat.isDirectory()) return

  if (basename(path).toLowerCase() === "original_images") {
    const snapshot = await inspectOriginalImages(path)
    if (snapshot) snapshots.push(snapshot)
  }

  let entries
  try {
    entries = await readdir(path, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.isDirectory()) await findQueues(join(path, entry.name), snapshots, visited)
  }
}

async function inspectOriginalImages(originalImagesPath: string): Promise<TransqDirectorySnapshot | null> {
  const workPath = join(originalImagesPath, "manga_translator_work")
  const resultPath = join(workPath, "result")
  if (!await existsDirectory(resultPath)) return null

  const originalFiles = await listFiles(originalImagesPath)
  const resultFiles = (await listFiles(resultPath)).filter((name) => name !== "translation_map.json")
  const mappedFiles = await readMappedFiles(join(resultPath, "translation_map.json"))
  const cleanupPaths: string[] = []

  const inpaintedPath = join(workPath, "inpainted")
  if (await exists(inpaintedPath)) cleanupPaths.push(inpaintedPath)
  let workEntries: Dirent[]
  try {
    workEntries = await readdir(workPath, { withFileTypes: true })
  } catch {
    workEntries = []
  }
  for (const entry of workEntries) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) cleanupPaths.push(join(workPath, entry.name))
  }

  const outputPath = join(dirname(originalImagesPath), "result")
  return {
    originalImagesPath,
    resultPath,
    outputPath,
    outputExists: await exists(outputPath),
    originalFiles,
    resultFiles,
    mappedFiles,
    cleanupPaths,
  }
}

async function copyFile(sourcePath: string, destinationPath: string): Promise<void> {
  await mkdir(dirname(destinationPath), { recursive: true })
  await copyFileNative(sourcePath, destinationPath)
}

async function moveDirectory(sourcePath: string, destinationPath: string): Promise<void> {
  await mkdir(dirname(destinationPath), { recursive: true })
  try {
    await rename(sourcePath, destinationPath)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== "EXDEV") throw error
    await cp(sourcePath, destinationPath, { recursive: true, errorOnExist: true, force: false })
    await rm(sourcePath, { recursive: true, force: true })
  }
}

async function removePath(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true })
}

async function listFiles(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true })
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort()
  } catch {
    return []
  }
}

async function readMappedFiles(path: string): Promise<string[]> {
  try {
    const content = await readFile(path, "utf8")
    const parsed: unknown = JSON.parse(content)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? Object.keys(parsed as Record<string, unknown>).sort() : []
  } catch {
    return []
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

async function existsDirectory(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isDirectory()
  } catch {
    return false
  }
}

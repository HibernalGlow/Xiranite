import { copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises"
import { basename, dirname, extname, join, resolve } from "node:path"
import { Uint8ArrayWriter, ZipReader, type Entry, type FileEntry } from "@zip.js/zip.js/index-native.js"
import type { CoveruArchiveEntry, CoveruRuntime } from "./core.js"
import { isSupportedCoveruArchive } from "./core.js"
import { CoveruZipFileReader } from "./zip-file-reader.js"

export function createNodeCoveruRuntime(): CoveruRuntime {
  return {
    pathInfo,
    listDir,
    listArchiveEntries,
    copyFile,
    extractArchiveEntry,
    ensureDir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
    join,
    dirname,
    basename,
    extname,
  }
}

async function pathInfo(path: string) {
  try {
    const info = await stat(path)
    return { path: resolve(path), exists: true, isFile: info.isFile(), isDirectory: info.isDirectory() }
  } catch {
    return { path, exists: false, isFile: false, isDirectory: false }
  }
}

async function listDir(path: string) {
  const entries = await readdir(path, { withFileTypes: true })
  return entries.map((entry) => ({
    name: entry.name,
    path: join(path, entry.name),
    isFile: entry.isFile(),
    isDirectory: entry.isDirectory(),
  }))
}

async function listArchiveEntries(path: string): Promise<CoveruArchiveEntry[]> {
  if (!isSupportedCoveruArchive(path)) return []
  return await withZipEntries(path, async (entries) => entries.flatMap((entry) => {
    if (entry.directory || !entry.filename) return []
    return [{
      name: basename(entry.filename),
      path: entry.filename,
      size: entry.uncompressedSize,
      compressedSize: entry.compressedSize,
      method: entry.compressionMethod,
    }]
  }))
}

async function extractArchiveEntry(archivePath: string, entryPath: string, outputPath: string): Promise<void> {
  const data = await withZipEntries(archivePath, async (entries) => {
    const entry = entries.find((item): item is FileEntry => !item.directory && item.filename === entryPath)
    if (!entry) throw new Error(`Archive entry not found: ${entryPath}`)
    return await entry.getData(new Uint8ArrayWriter(), {
      checkSignature: true,
      useCompressionStream: true,
      useWebWorkers: false,
    })
  })
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, data)
}

async function withZipEntries<T>(path: string, action: (entries: readonly Entry[]) => Promise<T>): Promise<T> {
  const fileReader = new CoveruZipFileReader(path)
  const zipReader = new ZipReader(fileReader, { useCompressionStream: true, useWebWorkers: false })
  try {
    return await action(await zipReader.getEntries())
  } finally {
    await zipReader.close().catch(() => undefined)
    await fileReader.close().catch(() => undefined)
  }
}

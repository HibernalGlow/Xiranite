import { inflateRaw } from "node:zlib"
import { copyFile, mkdir, open, readdir, stat, writeFile } from "node:fs/promises"
import { basename, dirname, extname, join, resolve } from "node:path"
import { promisify } from "node:util"
import type { CoveruArchiveEntry, CoveruRuntime } from "./core.js"
import { isSupportedCoveruArchive } from "./core.js"

const inflateRawAsync = promisify(inflateRaw)

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
  return readZipCentralDirectory(path)
}

async function extractArchiveEntry(archivePath: string, entryPath: string, outputPath: string): Promise<void> {
  const entries = await readZipCentralDirectory(archivePath)
  const entry = entries.find((item) => item.path === entryPath)
  if (!entry) throw new Error(`Archive entry not found: ${entryPath}`)
  const data = await readZipEntryData(archivePath, entry)
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, data)
}

async function readZipCentralDirectory(path: string): Promise<Array<CoveruArchiveEntry & { localHeaderOffset: number }>> {
  const handle = await open(path, "r")
  try {
    const info = await handle.stat()
    const tailLength = Math.min(info.size, 66000)
    const tail = Buffer.alloc(tailLength)
    await handle.read(tail, 0, tailLength, info.size - tailLength)
    const eocd = findLastSignature(tail, 0x06054b50)
    if (eocd < 0) return []
    const centralOffset = tail.readUInt32LE(eocd + 16)
    const centralSize = tail.readUInt32LE(eocd + 12)
    const central = Buffer.alloc(centralSize)
    await handle.read(central, 0, centralSize, centralOffset)
    const entries: Array<CoveruArchiveEntry & { localHeaderOffset: number }> = []
    let offset = 0
    while (offset <= central.length - 46 && central.readUInt32LE(offset) === 0x02014b50) {
      const method = central.readUInt16LE(offset + 10)
      const compressedSize = central.readUInt32LE(offset + 20)
      const size = central.readUInt32LE(offset + 24)
      const nameLength = central.readUInt16LE(offset + 28)
      const extraLength = central.readUInt16LE(offset + 30)
      const commentLength = central.readUInt16LE(offset + 32)
      const localHeaderOffset = central.readUInt32LE(offset + 42)
      const name = central.subarray(offset + 46, offset + 46 + nameLength).toString("utf8")
      if (name && !name.endsWith("/")) {
        entries.push({ name: basename(name), path: name, size, compressedSize, method, localHeaderOffset })
      }
      offset += 46 + nameLength + extraLength + commentLength
    }
    return entries
  } finally {
    await handle.close()
  }
}

async function readZipEntryData(path: string, entry: CoveruArchiveEntry & { localHeaderOffset: number }): Promise<Buffer> {
  const handle = await open(path, "r")
  try {
    const header = Buffer.alloc(30)
    await handle.read(header, 0, 30, entry.localHeaderOffset)
    if (header.readUInt32LE(0) !== 0x04034b50) throw new Error(`Invalid local header for ${entry.path}`)
    const nameLength = header.readUInt16LE(26)
    const extraLength = header.readUInt16LE(28)
    const dataOffset = entry.localHeaderOffset + 30 + nameLength + extraLength
    const compressed = Buffer.alloc(entry.compressedSize)
    await handle.read(compressed, 0, entry.compressedSize, dataOffset)
    if (entry.method === 0) return compressed
    if (entry.method === 8) return await inflateRawAsync(compressed)
    throw new Error(`Unsupported zip compression method ${entry.method} for ${entry.path}`)
  } finally {
    await handle.close()
  }
}

function findLastSignature(buffer: Buffer, signature: number): number {
  for (let index = buffer.length - 4; index >= 0; index -= 1) {
    if (buffer.readUInt32LE(index) === signature) return index
  }
  return -1
}

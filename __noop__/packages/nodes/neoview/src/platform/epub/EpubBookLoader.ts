import { realpath, stat } from "node:fs/promises"
import { basename, posix } from "node:path"
import { XMLParser } from "fast-xml-parser"

import { normalizeArchivePath } from "../../domain/archive/archive-path.js"
import type { ReaderBook, ViewSource } from "../../domain/book/book.js"
import { pageMediaType, type ReaderMediaTypeResolver } from "../../domain/page/media.js"
import type { ReaderPage } from "../../domain/page/page.js"
import type { ArchiveEntry, ArchiveProvider } from "../../ports/ArchiveProvider.js"
import type { ResourceScheduler } from "../../ports/ResourceScheduler.js"
import { ArchivePageContent } from "../content/ArchivePageContent.js"
import { createReaderBook, stableOpaqueId, versionFromFile } from "../books/book-utils.js"

const CONTAINER_PATH = "META-INF/container.xml"
const MAX_CONTAINER_BYTES = 1024 * 1024
const MAX_PACKAGE_BYTES = 4 * 1024 * 1024
const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", trimValues: true })

interface ManifestImage {
  entry: ArchiveEntry
  mediaType: string
}

type EpubViewSource = Extract<ViewSource, { kind: "document" }> & { format: "epub" }

export async function loadEpubBook(
  source: EpubViewSource,
  signal?: AbortSignal,
  mediaFormats?: ReaderMediaTypeResolver,
  resourceScheduler?: ResourceScheduler,
): Promise<ReaderBook> {
  signal?.throwIfAborted()
  const path = await realpath(source.path)
  const stats = await stat(path)
  if (!stats.isFile()) throw new Error(`EPUB source is not a file: ${source.path}`)
  const { ZipArchiveProvider } = await import("../archives/zip/ZipArchiveProvider.js")
  const provider = new ZipArchiveProvider(path, { resourceScheduler })
  try {
    const entries = await provider.list(signal)
    const images = await manifestImages(provider, entries, signal)
    const normalizedSource: EpubViewSource = { kind: "document", path, format: "epub" }
    const bookId = stableOpaqueId("book", "epub", path)
    const sourceVersion = versionFromFile(stats.size, stats.mtimeMs)
    const pages = images.map(({ entry, mediaType }, index): ReaderPage => {
      const media = pageMediaType(entry.path, mediaFormats)
      return {
        id: stableOpaqueId("page", bookId, entry.id),
        index,
        name: basename(entry.path),
        sourcePath: path,
        entryPath: entry.path,
        thumbnailSource: entry.sourceIndex === undefined ? undefined : {
          key: `${path}::${entry.path}#${entry.sourceIndex}`,
          category: "file",
        },
        mediaKind: media?.kind ?? "image",
        mimeType: mediaType,
        byteLength: entry.uncompressedSize,
        contentVersion: `${sourceVersion}-${entry.crc32?.toString(16) ?? entry.id}`,
        content: new ArchivePageContent(provider, entry.id, entry.uncompressedSize, mediaType),
      }
    })
    return createReaderBook({
      id: bookId,
      source: normalizedSource,
      displayName: basename(path),
      pages,
      dispose: () => provider.close(),
    })
  } catch (error) {
    await provider.close().catch(() => undefined)
    throw error
  }
}

async function manifestImages(
  provider: ArchiveProvider,
  entries: readonly ArchiveEntry[],
  signal?: AbortSignal,
): Promise<ManifestImage[]> {
  const files = new Map(entries.filter((entry) => entry.kind === "file").map((entry) => [entry.path, entry]))
  const containerEntry = files.get(CONTAINER_PATH)
  if (!containerEntry) throw new Error("EPUB is missing META-INF/container.xml.")
  const container = parseXml(await readXmlEntry(provider, containerEntry, MAX_CONTAINER_BYTES, signal), "EPUB container")
  const rootfile = asArray(record(record(container, "container"), "rootfiles")?.rootfile)
    .find((value) => isRecord(value) && typeof value["full-path"] === "string")
  if (!isRecord(rootfile) || typeof rootfile["full-path"] !== "string") throw new Error("EPUB container has no rootfile.")
  const packagePath = normalizeArchivePath(rootfile["full-path"])
  const packageEntry = files.get(packagePath)
  if (!packageEntry) throw new Error(`EPUB package document was not found: ${packagePath}`)
  const packageDocument = parseXml(await readXmlEntry(provider, packageEntry, MAX_PACKAGE_BYTES, signal), "EPUB package")
  const items = asArray(record(record(packageDocument, "package"), "manifest")?.item)
  const output: ManifestImage[] = []
  const seen = new Set<string>()
  for (const value of items) {
    if (!isRecord(value) || typeof value.href !== "string" || typeof value["media-type"] !== "string") continue
    const mediaType = value["media-type"].trim().toLocaleLowerCase()
    if (!mediaType.startsWith("image/")) continue
    const entryPath = resolveManifestPath(packagePath, value.href)
    if (seen.has(entryPath)) continue
    const entry = files.get(entryPath)
    if (!entry) continue
    seen.add(entryPath)
    output.push({ entry, mediaType })
  }
  return output.sort((left, right) => comparePath(left.entry.path, right.entry.path))
}

async function readXmlEntry(
  provider: ArchiveProvider,
  entry: ArchiveEntry,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<string> {
  if (entry.uncompressedSize > maxBytes) throw new Error(`EPUB XML entry exceeds ${maxBytes} bytes: ${entry.path}`)
  const stream = await provider.openEntry(entry.id, { signal })
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      signal?.throwIfAborted()
      const result = await reader.read()
      if (result.done) break
      total += result.value.byteLength
      if (total > maxBytes) throw new Error(`EPUB XML entry exceeds ${maxBytes} bytes: ${entry.path}`)
      chunks.push(result.value)
    }
  } finally {
    await reader.cancel("EPUB XML read finished").catch(() => undefined)
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return decodeXml(bytes)
}

function decodeXml(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le", { fatal: true }).decode(bytes.subarray(2))
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be", { fatal: true }).decode(bytes.subarray(2))
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes)
}

function parseXml(value: string, label: string): Record<string, unknown> {
  try {
    const parsed = xml.parse(value) as unknown
    if (!isRecord(parsed)) throw new Error("root is not an object")
    return parsed
  } catch (error) {
    throw new Error(`${label} XML is invalid: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function resolveManifestPath(packagePath: string, href: string): string {
  const resource = href.split(/[?#]/u, 1)[0]!
  let decoded: string
  try { decoded = decodeURIComponent(resource) } catch { decoded = resource }
  return normalizeArchivePath(posix.join(posix.dirname(packagePath), decoded))
}

function record(value: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  const child = value?.[key]
  return isRecord(child) ? child : undefined
}

function asArray(value: unknown): unknown[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function comparePath(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

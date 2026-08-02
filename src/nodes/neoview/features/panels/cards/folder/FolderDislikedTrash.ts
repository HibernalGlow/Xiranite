import { parseClipmFilenameScore } from "@xiranite/node-clipm/filename"

import type {
  ReaderDirectoryEntryDto,
  ReaderDirectoryPageDto,
  ReaderDirectorySelectionDescriptorDto,
} from "../../../../adapters/reader-http-client"
import type { DirectoryCatalog } from "./DirectoryCatalog"

export interface FolderDislikedTrashTargets {
  selection: ReaderDirectorySelectionDescriptorDto
  total: number
  fileCount: number
  directoryCount: number
}

export interface FolderDirectoryScore {
  directoryPath: string
  work: { label: "P" | "N" } | null
}

export async function collectFolderDislikedTrashTargets(options: {
  catalog: DirectoryCatalog
  pageSize: number
  loadPage(cursor: number, limit: number): Promise<ReaderDirectoryPageDto>
  getDirectoryScores(paths: readonly string[]): Promise<readonly FolderDirectoryScore[]>
  directoryScoreBatchSize?: number
}): Promise<FolderDislikedTrashTargets> {
  const { catalog, pageSize } = options
  const entries = await loadCompleteCatalogEntries(catalog, pageSize, options.loadPage)
  const labels = new Map<string, "P" | "N">()
  const unresolvedDirectories: string[] = []

  for (const { entry } of entries) {
    if (entry.kind === "directory") {
      if (entry.clipmScore) labels.set(entry.path, entry.clipmScore.label)
      else unresolvedDirectories.push(entry.path)
      continue
    }
    if (entry.kind !== "file") continue
    const score = entry.clipmScore ?? parseClipmFilenameScore(entry.name)
    if (score) labels.set(entry.path, score.label)
  }

  const batchSize = Math.min(500, Math.max(1, options.directoryScoreBatchSize ?? 500))
  for (let offset = 0; offset < unresolvedDirectories.length; offset += batchSize) {
    const batch = unresolvedDirectories.slice(offset, offset + batchSize)
    for (const result of await options.getDirectoryScores(batch)) {
      if (result.work) labels.set(result.directoryPath, result.work.label)
    }
  }

  const disliked = entries.filter(({ entry }) => labels.get(entry.path) === "N")
  const fileCount = disliked.filter(({ entry }) => entry.kind === "file").length
  const directoryCount = disliked.filter(({ entry }) => entry.kind === "directory").length
  return {
    selection: {
      generation: catalog.generation,
      allSelected: false,
      ranges: [],
      explicit: disliked.map(({ entry, index }) => ({ path: entry.path, index })),
    },
    total: disliked.length,
    fileCount,
    directoryCount,
  }
}

async function loadCompleteCatalogEntries(
  catalog: DirectoryCatalog,
  pageSize: number,
  loadPage: (cursor: number, limit: number) => Promise<ReaderDirectoryPageDto>,
): Promise<readonly { entry: ReaderDirectoryEntryDto; index: number }[]> {
  const pages = new Map(catalog.pages)
  const missing: number[] = []
  for (let cursor = 0; cursor < catalog.total; cursor += pageSize) {
    if (!pages.has(cursor)) missing.push(cursor)
  }

  for (let offset = 0; offset < missing.length; offset += 4) {
    const batch = missing.slice(offset, offset + 4)
    const loaded = await Promise.all(batch.map((cursor) => loadPage(cursor, pageSize)))
    for (const page of loaded) {
      if (page.sessionId !== catalog.sessionId || page.path !== catalog.path || page.generation !== catalog.generation) {
        throw new Error("目录内容已变化，请重试。")
      }
      pages.set(page.cursor, page.entries)
    }
  }

  const entries: { entry: ReaderDirectoryEntryDto; index: number }[] = []
  for (let cursor = 0; cursor < catalog.total; cursor += pageSize) {
    const page = pages.get(cursor)
    if (!page) throw new Error("无法读取完整目录，请重试。")
    for (let offset = 0; offset < page.length; offset += 1) {
      entries.push({ entry: page[offset]!, index: cursor + offset })
    }
  }
  return entries.slice(0, catalog.total)
}

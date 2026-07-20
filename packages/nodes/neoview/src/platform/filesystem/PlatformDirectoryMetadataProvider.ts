import { stat } from "node:fs/promises"
import { Readable } from "node:stream"

import type { ReaderDirectoryEntry } from "../../ports/ReaderDirectoryListingProvider.js"
import type {
  ReaderDirectoryMetadataField,
  ReaderDirectoryMetadataProvider,
} from "../../ports/ReaderDirectoryMetadataProvider.js"
import type {
  ReaderDirectoryEmmRecord,
  ReaderDirectoryEmmRecordStore,
} from "../../ports/ReaderDirectoryEmmRecordStore.js"
import {
  PlatformEmmCollectTagSource,
  type ReaderEmmCollectTagSnapshot,
} from "../emm/PlatformEmmCollectTagSource.js"

const STAT_CONCURRENCY = 16
const DEFAULT_EMM_RATING = 4.2

export class PlatformDirectoryMetadataProvider implements ReaderDirectoryMetadataProvider {
  readonly supportedFields: ReadonlySet<ReaderDirectoryMetadataField>

  constructor(
    private readonly emmStore?: ReaderDirectoryEmmRecordStore,
    private readonly collectTagSource = new PlatformEmmCollectTagSource(),
    private readonly defaultRating = DEFAULT_EMM_RATING,
    private readonly mediaMetadataProvider?: ReaderDirectoryMetadataProvider,
  ) {
    this.supportedFields = new Set<ReaderDirectoryMetadataField>([
      "date",
      "size",
      ...(emmStore?.directoryEmmAvailable ? ["rating", "collectTagCount", "tags", "pageCount"] as const : []),
      ...(mediaMetadataProvider?.supportedFields ?? []),
    ])
  }

  async hydrate(
    entries: readonly ReaderDirectoryEntry[],
    fields: ReadonlySet<ReaderDirectoryMetadataField>,
    signal?: AbortSignal,
  ): Promise<readonly ReaderDirectoryEntry[]> {
    signal?.throwIfAborted()
    const wantsStat = fields.has("date") || fields.has("size")
    const wantsEmm = fields.has("rating") || fields.has("collectTagCount") || fields.has("tags") || fields.has("pageCount")
    const [statEntries, emmRecords, collectTags] = await Promise.all([
      wantsStat ? hydrateStats(entries, fields, signal) : entries,
      wantsEmm && this.emmStore
        ? this.emmStore.readDirectoryEmmRecords(entries.map((entry) => entry.path), signal)
        : Promise.resolve(new Map<string, ReaderDirectoryEmmRecord>()),
      fields.has("collectTagCount") || fields.has("tags")
        ? this.collectTagSource.load(signal).catch(() => ({ tags: [], mixedGender: false }))
        : Promise.resolve({ tags: [], mixedGender: false } satisfies ReaderEmmCollectTagSnapshot),
    ])
    signal?.throwIfAborted()
    if (!wantsEmm && !wantsMedia(fields)) return statEntries
    const records = new Map([...emmRecords].map(([path, record]) => [normalizePath(path), record]))
    const merged = statEntries.map((entry) => {
      const record = records.get(normalizePath(entry.path))
      const emm = parseJsonRecord(record?.emmJson)
      const tagSets = directoryTagSets(emm, record?.manualTags, collectTags)
      return {
        ...entry,
        rating: fields.has("rating") ? effectiveRating(record, this.defaultRating) : entry.rating,
        collectTagCount: fields.has("collectTagCount") ? tagSets.collect.length : entry.collectTagCount,
        pageCount: fields.has("pageCount") ? jsonPositiveInteger(emm, "page_count", "pageCount") ?? entry.pageCount : entry.pageCount,
        tags: fields.has("tags") ? tagSets.all : entry.tags,
        collectTags: fields.has("tags") ? tagSets.collect : entry.collectTags,
        manualTags: fields.has("tags") ? tagSets.manual : entry.manualTags,
      }
    })
    if (!this.mediaMetadataProvider || !wantsMedia(fields)) return merged
    return this.mediaMetadataProvider.hydrate(merged, fields, signal)
  }
}

async function hydrateStats(
  entries: readonly ReaderDirectoryEntry[],
  fields: ReadonlySet<ReaderDirectoryMetadataField>,
  signal?: AbortSignal,
): Promise<readonly ReaderDirectoryEntry[]> {
  return Readable.from(entries).map(async (entry) => {
    signal?.throwIfAborted()
    try {
      const metadata = await stat(entry.path)
      signal?.throwIfAborted()
      return {
        ...entry,
        modifiedAt: fields.has("date") ? metadata.mtimeMs : entry.modifiedAt,
        size: fields.has("size") && metadata.isFile() ? metadata.size : entry.size,
      }
    } catch (error) {
      if (signal?.aborted) throw error
      return entry
    }
  }, { concurrency: STAT_CONCURRENCY }).toArray()
}

function effectiveRating(record: ReaderDirectoryEmmRecord | undefined, fallback: number): number {
  return jsonNumber(record?.ratingData, "value") ?? jsonNumber(record?.emmJson, "rating") ?? fallback
}

function jsonNumber(json: string | undefined, field: string): number | undefined {
  const value = parseJsonRecord(json)?.[field]
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined
}

function jsonPositiveInteger(value: Record<string, unknown> | undefined, ...fields: string[]): number | undefined {
  for (const field of fields) {
    const candidate = value?.[field]
    if (Number.isSafeInteger(candidate) && (candidate as number) >= 0) return candidate as number
  }
  return undefined
}

function directoryTagSets(
  emm: Record<string, unknown> | undefined,
  manualTagsJson: string | undefined,
  snapshot: ReaderEmmCollectTagSnapshot,
): { all: string[]; collect: string[]; manual: string[] } {
  const emmTags = tagsFromArray(emm?.tags)
  const manual = tagsFromArray(parseJsonArray(manualTagsJson))
  const collect = emmTags.filter((value) => isCollectedTag(value, snapshot))
  return {
    all: [...new Set([...emmTags, ...manual])].slice(0, 256),
    collect: [...new Set(collect)].slice(0, 256),
    manual: [...new Set(manual)].slice(0, 256),
  }
}

function tagsFromArray(value: unknown): string[] {
  const output = new Set<string>()
  appendTagArray(output, value)
  return [...output]
}

function isCollectedTag(value: string, snapshot: ReaderEmmCollectTagSnapshot): boolean {
  const separator = value.indexOf(":")
  if (separator <= 0) return false
  const category = value.slice(0, separator)
  const tag = value.slice(separator + 1)
  const exact = snapshot.tags.some((favorite) => tagKey(favorite.category, favorite.tag) === tagKey(category, tag))
  if (exact) return true
  if (!snapshot.mixedGender || !["female", "male", "mixed"].includes(category.toLocaleLowerCase())) return false
  return snapshot.tags.some((favorite) => ["female", "male", "mixed"].includes(favorite.category.toLocaleLowerCase())
    && favorite.tag.toLocaleLowerCase() === tag.toLocaleLowerCase())
}

function appendTagArray(output: Set<string>, value: unknown): void {
  if (!Array.isArray(value)) return
  for (const item of value) {
    if (!isRecord(item) || typeof item.namespace !== "string" || typeof item.tag !== "string") continue
    const namespace = item.namespace.trim()
    const tag = item.tag.trim()
    if (!namespace || !tag || namespace.length > 128 || tag.length > 256) continue
    output.add(`${namespace}:${tag}`)
    if (output.size >= 256) return
  }
}

function parseJsonArray(json: string | undefined): unknown[] | undefined {
  if (!json) return undefined
  try {
    const value = JSON.parse(json) as unknown
    return Array.isArray(value) ? value : undefined
  } catch {
    return undefined
  }
}

function parseJsonRecord(json: string | undefined): Record<string, unknown> | undefined {
  if (!json) return undefined
  try {
    const value = JSON.parse(json) as unknown
    return isRecord(value) ? value : undefined
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").toLocaleLowerCase()
}

function tagKey(category: string, tag: string): string {
  return `${category.toLocaleLowerCase()}\0${tag.toLocaleLowerCase()}`
}

function wantsMedia(fields: ReadonlySet<ReaderDirectoryMetadataField>): boolean {
  return fields.has("dimensions") || fields.has("pageCount")
}

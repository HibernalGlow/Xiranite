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
  ) {
    this.supportedFields = new Set<ReaderDirectoryMetadataField>([
      "date",
      "size",
      ...(emmStore?.directoryEmmAvailable ? ["rating", "collectTagCount"] as const : []),
    ])
  }

  async hydrate(
    entries: readonly ReaderDirectoryEntry[],
    fields: ReadonlySet<ReaderDirectoryMetadataField>,
    signal?: AbortSignal,
  ): Promise<readonly ReaderDirectoryEntry[]> {
    signal?.throwIfAborted()
    const wantsStat = fields.has("date") || fields.has("size")
    const wantsEmm = fields.has("rating") || fields.has("collectTagCount")
    const [statEntries, emmRecords, collectTags] = await Promise.all([
      wantsStat ? hydrateStats(entries, fields, signal) : entries,
      wantsEmm && this.emmStore
        ? this.emmStore.readDirectoryEmmRecords(entries.map((entry) => entry.path), signal)
        : Promise.resolve(new Map<string, ReaderDirectoryEmmRecord>()),
      fields.has("collectTagCount")
        ? this.collectTagSource.load(signal).catch(() => ({ tags: [], mixedGender: false }))
        : Promise.resolve({ tags: [], mixedGender: false } satisfies ReaderEmmCollectTagSnapshot),
    ])
    signal?.throwIfAborted()
    if (!wantsEmm) return statEntries
    const records = new Map([...emmRecords].map(([path, record]) => [normalizePath(path), record]))
    return statEntries.map((entry) => {
      const record = records.get(normalizePath(entry.path))
      return {
        ...entry,
        rating: fields.has("rating") ? effectiveRating(record, this.defaultRating) : entry.rating,
        collectTagCount: fields.has("collectTagCount") ? countCollectTags(record?.emmJson, collectTags) : entry.collectTagCount,
      }
    })
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
  }, { concurrency: STAT_CONCURRENCY, signal }).toArray()
}

function effectiveRating(record: ReaderDirectoryEmmRecord | undefined, fallback: number): number {
  return jsonNumber(record?.ratingData, "value") ?? jsonNumber(record?.emmJson, "rating") ?? fallback
}

function countCollectTags(emmJson: string | undefined, snapshot: ReaderEmmCollectTagSnapshot): number {
  if (!emmJson || !snapshot.tags.length) return 0
  const value = parseJsonRecord(emmJson)
  if (!value || !Array.isArray(value.tags)) return 0
  const bookTags = new Set<string>()
  for (const item of value.tags) {
    if (!isRecord(item) || typeof item.namespace !== "string" || typeof item.tag !== "string") continue
    bookTags.add(tagKey(item.namespace, item.tag))
  }
  const genderCategories = ["female", "male", "mixed"]
  let count = 0
  for (const favorite of snapshot.tags) {
    if (bookTags.has(tagKey(favorite.category, favorite.tag))) {
      count += 1
      continue
    }
    if (snapshot.mixedGender && genderCategories.includes(favorite.category.toLocaleLowerCase())) {
      if (genderCategories.some((category) => bookTags.has(tagKey(category, favorite.tag)))) count += 1
    }
  }
  return count
}

function jsonNumber(json: string | undefined, field: string): number | undefined {
  const value = parseJsonRecord(json)?.[field]
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined
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

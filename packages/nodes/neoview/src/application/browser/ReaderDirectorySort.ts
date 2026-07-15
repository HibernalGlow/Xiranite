import { createHash, randomBytes } from "node:crypto"
import { extname } from "node:path"

import { compareNaturalPath } from "../../domain/sorting/natural-sort.js"
import type { ReaderDirectoryEntry } from "../../ports/ReaderDirectoryListingProvider.js"
import type { ReaderDirectoryMetadataField } from "../../ports/ReaderDirectoryMetadataProvider.js"

export const READER_DIRECTORY_SORT_FIELDS = [
  "name",
  "date",
  "size",
  "type",
  "random",
  "rating",
  "path",
  "collectTagCount",
] as const

export type ReaderDirectorySortField = typeof READER_DIRECTORY_SORT_FIELDS[number]
export type ReaderDirectorySortOrder = "asc" | "desc"

export interface ReaderDirectorySortRule {
  field: ReaderDirectorySortField
  order: ReaderDirectorySortOrder
  directoriesFirst: boolean
}

export const DEFAULT_READER_DIRECTORY_SORT: ReaderDirectorySortRule = {
  field: "name",
  order: "asc",
  directoriesFirst: true,
}

export function readerDirectoryMetadataFields(field: ReaderDirectorySortField): ReadonlySet<ReaderDirectoryMetadataField> {
  return field === "date" || field === "size" || field === "rating" || field === "collectTagCount"
    ? new Set([field])
    : new Set()
}

export function sortReaderDirectoryEntries(
  entries: readonly ReaderDirectoryEntry[],
  rule: ReaderDirectorySortRule,
  randomSeed = randomBytes(16).toString("hex"),
  defaultRating = 0,
): ReaderDirectoryEntry[] {
  const direction = rule.order === "desc" ? -1 : 1
  const randomRanks = rule.field === "random"
    ? new Map(entries.map((entry) => [entry.path, randomRank(randomSeed, entry.path)]))
    : undefined

  return entries.slice().sort((left, right) => {
    if (rule.directoriesFirst && left.kind !== right.kind) {
      return entryKindRank(left) - entryKindRank(right)
    }
    const comparison = compareField(left, right, rule.field, randomRanks, defaultRating)
    return comparison ? comparison * direction : compareNaturalPath(left.name, right.name) || compareNaturalPath(left.path, right.path)
  })
}

export function isReaderDirectorySortField(value: unknown): value is ReaderDirectorySortField {
  return typeof value === "string" && (READER_DIRECTORY_SORT_FIELDS as readonly string[]).includes(value)
}

function compareField(
  left: ReaderDirectoryEntry,
  right: ReaderDirectoryEntry,
  field: ReaderDirectorySortField,
  randomRanks: ReadonlyMap<string, bigint> | undefined,
  defaultRating: number,
): number {
  switch (field) {
    case "name": return compareNaturalPath(left.name, right.name)
    case "date": return numberValue(left.modifiedAt) - numberValue(right.modifiedAt)
    case "size": return numberValue(left.size) - numberValue(right.size)
    case "type": return compareNaturalPath(extname(left.name).slice(1), extname(right.name).slice(1))
    case "random": return compareBigInt(randomRanks?.get(left.path) ?? 0n, randomRanks?.get(right.path) ?? 0n)
    case "rating": return numberValue(left.rating, defaultRating) - numberValue(right.rating, defaultRating)
    case "path": return compareNaturalPath(left.path, right.path)
    case "collectTagCount": return numberValue(left.collectTagCount) - numberValue(right.collectTagCount)
  }
}

function entryKindRank(entry: ReaderDirectoryEntry): number {
  return entry.kind === "directory" ? 0 : entry.kind === "file" ? 1 : 2
}

function numberValue(value: number | undefined, fallback = 0): number {
  return Number.isFinite(value) ? value! : fallback
}

function randomRank(seed: string, path: string): bigint {
  const digest = createHash("sha256").update(seed).update("\0").update(path).digest()
  return digest.readBigUInt64BE(0)
}

function compareBigInt(left: bigint, right: bigint): number {
  return left === right ? 0 : left < right ? -1 : 1
}

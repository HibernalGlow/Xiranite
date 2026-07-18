import { createHash } from "node:crypto"
import { basename, extname } from "node:path"
import { z } from "zod"

import type { ViewSource } from "../domain/book/book.js"

export interface LegacyReaderPathRef {
  path: string
  innerPath?: string
}

export interface LegacyReaderVideoProgress {
  position: number
  duration: number
  completed: boolean
}

export interface DecodedLegacyHistoryRecord {
  legacyId?: string
  source: ViewSource
  pathStack: readonly LegacyReaderPathRef[]
  displayName: string
  pageIndex: number
  pageCount: number
  updatedAt: number
  videoProgress?: LegacyReaderVideoProgress
}

export interface DecodedLegacyBookmarkRecord {
  id: string
  source: ViewSource
  name: string
  kind: "file" | "folder"
  starred: boolean
  createdAt: number
  listIds: readonly string[]
}

export interface DecodedLegacyBookmarkListRecord {
  id: string
  name: string
  isFavorite: boolean
  createdAt: number
}

export type LegacyReaderDataSourceKind = "full-export" | "backup" | "local-storage"
export type LegacyReaderDataDisposition = "imported" | "deduplicated" | "normalized" | "skipped-invalid" | "synthesized"

export interface LegacyReaderDataReportEntry {
  area: "history" | "bookmark" | "bookmark-list"
  disposition: LegacyReaderDataDisposition
  message: string
}

export interface DecodedLegacyReaderData {
  sourceKind: LegacyReaderDataSourceKind
  history: readonly DecodedLegacyHistoryRecord[]
  bookmarks: readonly DecodedLegacyBookmarkRecord[]
  bookmarkLists: readonly DecodedLegacyBookmarkListRecord[]
  activeBookmarkListId?: string
  historySettings?: {
    syncFileTreeOnHistorySelect?: boolean
    syncFileTreeOnBookmarkSelect?: boolean
    maxHistorySize?: number
    maxBookmarkSize?: number
  }
  report: {
    entries: readonly LegacyReaderDataReportEntry[]
    summary: Record<LegacyReaderDataDisposition, number>
    fullyRecognized: boolean
  }
}

interface Candidate<T> {
  value: T
  priority: number
}

const STORAGE_KEYS = {
  history: "neoview-history",
  unifiedHistory: "neoview-unified-history",
  bookmarks: "neoview-bookmarks",
  bookmarkLists: "neoview-bookmark-lists-v2",
  activeBookmarkList: "neoview-bookmark-active-list-v2",
  historySettings: "neoview-history-settings",
} as const

const objectSchema = z.record(z.string(), z.unknown())
const pathRefSchema = z.object({ path: z.string().trim().min(1), innerPath: z.string().trim().min(1).optional() }).passthrough()
const historyRowSchema = z.object({
  id: z.string().trim().min(1).optional(),
  path: z.string().trim().min(1).optional(),
  pathStack: z.array(pathRefSchema).optional(),
  displayName: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).optional(),
  currentIndex: z.number().int().nonnegative().optional(),
  currentPage: z.number().int().nonnegative().optional(),
  totalItems: z.number().int().nonnegative().optional(),
  totalPages: z.number().int().nonnegative().optional(),
  timestamp: z.union([z.number().nonnegative(), z.string().min(1)]).optional(),
  contentType: z.string().optional(),
  videoProgress: z.unknown().optional(),
  videoPosition: z.number().finite().optional(),
  videoDuration: z.number().finite().optional(),
  videoCompleted: z.boolean().optional(),
}).passthrough().refine((row) => Boolean(row.path?.trim() || row.pathStack?.length), { message: "history path is required" })
const bookmarkRowSchema = z.object({
  id: z.string().trim().min(1).optional(),
  path: z.string().trim().min(1),
  name: z.string().trim().min(1).optional(),
  type: z.enum(["file", "folder"]).optional(),
  createdAt: z.union([z.number().nonnegative(), z.string().min(1), z.date()]).optional(),
  listIds: z.array(z.string().trim().min(1)).optional(),
  starred: z.boolean().optional(),
}).passthrough()
const bookmarkListRowSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1).optional(),
  isFavorite: z.boolean().optional(),
  createdAt: z.union([z.number().nonnegative(), z.string().min(1), z.date()]).optional(),
}).passthrough()
const historySettingsSchema = z.object({
  syncFileTreeOnHistorySelect: z.boolean().optional(),
  syncFileTreeOnBookmarkSelect: z.boolean().optional(),
  maxHistorySize: z.number().int().nonnegative().optional(),
  maxBookmarkSize: z.number().int().nonnegative().optional(),
}).passthrough()
const videoProgressSchema = z.object({
  position: z.number().finite().nonnegative(),
  duration: z.number().finite().nonnegative(),
  completed: z.boolean().optional().default(false),
}).passthrough()

export class LegacyReaderDataCodec {
  decode(input: string | unknown): DecodedLegacyReaderData {
    const root = asRecord(typeof input === "string" ? JSON.parse(input) : input, "Legacy reader data must be a JSON object.")
    const entries: LegacyReaderDataReportEntry[] = []
    const raw = optionalRecord(root.rawLocalStorage) ?? directStorage(root)
    const extended = optionalRecord(root.extended) ?? optionalRecord(root.extendedData)
    const sourceKind: LegacyReaderDataSourceKind = root.rawLocalStorage ? "backup" : extended ? "full-export" : "local-storage"

    const historyCandidates: Array<Candidate<DecodedLegacyHistoryRecord>> = []
    const unifiedHistory = decodeStored(raw[STORAGE_KEYS.unifiedHistory], entries, "history")
    collectHistory(historyCandidates, unifiedHistory, 30, entries)
    collectHistory(historyCandidates, extended?.history, 20, entries)
    if (!Array.isArray(unifiedHistory)) {
      collectHistory(historyCandidates, decodeStored(raw[STORAGE_KEYS.history], entries, "history"), 10, entries)
    }
    const history = dedupe(
      historyCandidates,
      (record) => sourceKey(record.source),
      (left, right) => left.updatedAt - right.updatedAt,
      "history",
      entries,
    )

    const bookmarkListCandidates = [
      ...arrayValue(decodeStored(raw[STORAGE_KEYS.bookmarkLists], entries, "bookmark-list")),
      ...arrayValue(extended?.bookmarkLists),
    ]
    const bookmarkLists = parseBookmarkLists(bookmarkListCandidates, entries)
    const knownLists = new Map(bookmarkLists.map((list) => [list.id, list]))

    const bookmarkCandidates: Array<Candidate<DecodedLegacyBookmarkRecord>> = []
    collectBookmarks(bookmarkCandidates, decodeStored(raw[STORAGE_KEYS.bookmarks], entries, "bookmark"), 20, entries)
    collectBookmarks(bookmarkCandidates, extended?.bookmarks, 10, entries)
    const bookmarks = dedupe(
      bookmarkCandidates,
      (bookmark) => sourceKey(bookmark.source),
      (left, right) => left.createdAt - right.createdAt,
      "bookmark",
      entries,
    )
    for (const bookmark of bookmarks) {
      for (const listId of bookmark.listIds) {
        if (isSystemListId(listId) || knownLists.has(listId)) continue
        const list = { id: listId, name: listId, isFavorite: false, createdAt: bookmark.createdAt }
        knownLists.set(listId, list)
        bookmarkLists.push(list)
        entries.push({ area: "bookmark-list", disposition: "synthesized", message: "Created a placeholder for a referenced list missing from the export." })
      }
    }

    const activeList = raw[STORAGE_KEYS.activeBookmarkList]
    const activeBookmarkListId = typeof activeList === "string" && activeList.trim() ? activeList.trim() : undefined
    const historySettings = parseHistorySettings(
      extended?.historySettings ?? decodeStored(raw[STORAGE_KEYS.historySettings], entries, "history"),
      entries,
    )
    const summary = summarize(entries)
    return {
      sourceKind,
      history,
      bookmarks,
      bookmarkLists: [...knownLists.values()].sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id)),
      activeBookmarkListId,
      historySettings,
      report: {
        entries,
        summary,
        fullyRecognized: summary["skipped-invalid"] === 0,
      },
    }
  }
}

function collectHistory(
  target: Array<Candidate<DecodedLegacyHistoryRecord>>,
  value: unknown,
  priority: number,
  report: LegacyReaderDataReportEntry[],
): void {
  for (const [index, raw] of arrayValue(value).entries()) {
    const record = parseHistory(raw, report)
    if (record) target.push({ value: record, priority })
    else report.push({ area: "history", disposition: "skipped-invalid", message: `Skipped invalid history row ${index}.` })
  }
}

function parseHistory(value: unknown, report: LegacyReaderDataReportEntry[]): DecodedLegacyHistoryRecord | undefined {
  const parsed = historyRowSchema.safeParse(value)
  if (!parsed.success) return undefined
  const raw = parsed.data
  const pathStack = parsePathStack(raw.pathStack, raw.path)
  if (!pathStack.length) return undefined
  const source = sourceFromLegacy(pathStack, raw.contentType)
  const pageCount = nonNegativeInteger(raw.totalItems ?? raw.totalPages) ?? 0
  const requestedPage = nonNegativeInteger(raw.currentIndex ?? raw.currentPage) ?? 0
  const pageIndex = pageCount > 0 ? Math.min(requestedPage, pageCount - 1) : 0
  if (pageIndex !== requestedPage) {
    report.push({ area: "history", disposition: "normalized", message: "Clamped a history position to its valid page range." })
  }
  const timestamp = timestampValue(raw.timestamp) ?? 0
  const displayName = nonEmptyString(raw.displayName) ?? nonEmptyString(raw.name) ?? basename(pathStack.at(-1)?.innerPath ?? pathStack.at(-1)!.path)
  const videoProgress = parseVideoProgress(raw.videoProgress ?? (
    raw.videoPosition !== undefined || raw.videoDuration !== undefined
      ? { position: raw.videoPosition, duration: raw.videoDuration, completed: raw.videoCompleted }
      : undefined
  ))
  report.push({ area: "history", disposition: "imported", message: "Decoded a legacy history row." })
  return {
    legacyId: nonEmptyString(raw.id),
    source,
    pathStack,
    displayName,
    pageIndex,
    pageCount,
    updatedAt: timestamp,
    videoProgress,
  }
}

function collectBookmarks(
  target: Array<Candidate<DecodedLegacyBookmarkRecord>>,
  value: unknown,
  priority: number,
  report: LegacyReaderDataReportEntry[],
): void {
  for (const [index, raw] of arrayValue(value).entries()) {
    const bookmark = parseBookmark(raw)
    if (bookmark) {
      target.push({ value: bookmark, priority })
      report.push({ area: "bookmark", disposition: "imported", message: "Decoded a legacy bookmark row." })
    } else {
      report.push({ area: "bookmark", disposition: "skipped-invalid", message: `Skipped invalid bookmark row ${index}.` })
    }
  }
}

function parseBookmark(value: unknown): DecodedLegacyBookmarkRecord | undefined {
  const parsed = bookmarkRowSchema.safeParse(value)
  if (!parsed.success) return undefined
  const raw = parsed.data
  const path = raw.path
  const kind = raw.type === "folder" ? "folder" : "file"
  const createdAt = timestampValue(raw.createdAt) ?? 0
  const rawListIds = Array.isArray(raw.listIds) ? raw.listIds.flatMap((id) => nonEmptyString(id) ?? []) : []
  const listIds = [...new Set(rawListIds.length ? rawListIds : ["default"])].sort()
  return {
    id: nonEmptyString(raw.id) ?? legacyStableId("bookmark", normalizePath(path)),
    source: kind === "folder" ? { kind: "directory", path } : { kind: "path", path },
    name: nonEmptyString(raw.name) ?? basename(path),
    kind,
    starred: Boolean(raw.starred) || listIds.includes("favorites"),
    createdAt,
    listIds,
  }
}

function parseBookmarkLists(values: readonly unknown[], report: LegacyReaderDataReportEntry[]): DecodedLegacyBookmarkListRecord[] {
  const lists = new Map<string, DecodedLegacyBookmarkListRecord>()
  for (const [index, value] of values.entries()) {
    const parsed = bookmarkListRowSchema.safeParse(value)
    if (!parsed.success) {
      report.push({ area: "bookmark-list", disposition: "skipped-invalid", message: `Skipped invalid bookmark list row ${index}.` })
      continue
    }
    const raw = parsed.data
    const id = raw.id
    if (isSystemListId(id)) continue
    lists.set(id, {
      id,
      name: nonEmptyString(raw.name) ?? "未命名列表",
      isFavorite: Boolean(raw.isFavorite),
      createdAt: timestampValue(raw.createdAt) ?? 0,
    })
    report.push({ area: "bookmark-list", disposition: "imported", message: "Decoded a custom bookmark list." })
  }
  return [...lists.values()]
}

function parseHistorySettings(value: unknown, report: LegacyReaderDataReportEntry[]): DecodedLegacyReaderData["historySettings"] {
  const parsed = historySettingsSchema.safeParse(value)
  if (!parsed.success) return undefined
  const raw = parsed.data
  const result = {
    syncFileTreeOnHistorySelect: optionalBoolean(raw.syncFileTreeOnHistorySelect),
    syncFileTreeOnBookmarkSelect: optionalBoolean(raw.syncFileTreeOnBookmarkSelect),
    maxHistorySize: nonNegativeInteger(raw.maxHistorySize),
    maxBookmarkSize: nonNegativeInteger(raw.maxBookmarkSize),
  }
  if (Object.values(result).every((item) => item === undefined)) {
    report.push({ area: "history", disposition: "skipped-invalid", message: "History settings contained no recognized values." })
    return undefined
  }
  return result
}

function parsePathStack(value: unknown, fallbackPath: unknown): LegacyReaderPathRef[] {
  const parsed = z.array(pathRefSchema).safeParse(value)
  if (parsed.success && parsed.data.length) return parsed.data
  const path = nonEmptyString(fallbackPath)
  return path ? [{ path }] : []
}

function sourceFromLegacy(pathStack: readonly LegacyReaderPathRef[], contentType: unknown): ViewSource {
  const path = pathStack[0]!.path
  const entryPaths = pathStack.flatMap((ref) => ref.innerPath ? [ref.innerPath] : [])
  if (entryPaths.length) return { kind: "archive", path, entryPaths }
  if (contentType === "folder") return { kind: "directory", path }
  if (contentType === "archive") return { kind: "archive", path }
  if (contentType === "video") return { kind: "media", path }
  if (contentType === "image" || contentType === "animated") return { kind: "image", path }
  if (contentType === "ebook") {
    const extension = extname(path).slice(1).toLowerCase()
    if (extension === "pdf" || extension === "epub") return { kind: "document", path, format: extension }
  }
  return { kind: "path", path }
}

function parseVideoProgress(value: unknown): LegacyReaderVideoProgress | undefined {
  const parsed = videoProgressSchema.safeParse(value)
  if (!parsed.success) return undefined
  return { position: Math.min(parsed.data.position, parsed.data.duration || parsed.data.position), duration: parsed.data.duration, completed: parsed.data.completed }
}

function dedupe<T>(
  candidates: readonly Candidate<T>[],
  keyOf: (value: T) => string,
  compare: (left: T, right: T) => number,
  area: LegacyReaderDataReportEntry["area"],
  report: LegacyReaderDataReportEntry[],
): T[] {
  const selected = new Map<string, Candidate<T>>()
  for (const candidate of candidates) {
    const key = keyOf(candidate.value)
    const current = selected.get(key)
    if (!current || candidate.priority > current.priority || (candidate.priority === current.priority && compare(candidate.value, current.value) > 0)) {
      if (current) report.push({ area, disposition: "deduplicated", message: "Replaced a duplicate legacy row with the higher-priority or newer record." })
      selected.set(key, candidate)
    } else {
      report.push({ area, disposition: "deduplicated", message: "Ignored a duplicate legacy row." })
    }
  }
  return [...selected.values()].map((candidate) => candidate.value)
}

function directStorage(root: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.values(STORAGE_KEYS).flatMap((key) => Object.hasOwn(root, key) ? [[key, root[key]]] : []))
}

function decodeStored(value: unknown, report: LegacyReaderDataReportEntry[], area: LegacyReaderDataReportEntry["area"]): unknown {
  if (typeof value !== "string") return value
  try { return JSON.parse(value) } catch {
    report.push({ area, disposition: "skipped-invalid", message: "Skipped malformed localStorage JSON." })
    return undefined
  }
}

function sourceKey(source: ViewSource): string {
  const entryPaths = source.kind === "archive" ? source.entryPaths ?? (source.entryPath ? [source.entryPath] : []) : []
  return `${normalizePath(source.path)}\0${entryPaths.map(normalizePath).join("\0")}`
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").toLocaleLowerCase()
}

function legacyStableId(prefix: string, input: string): string {
  return `${prefix}-legacy-${createHash("sha256").update(input).digest("hex").slice(0, 16)}`
}

function summarize(entries: readonly LegacyReaderDataReportEntry[]): Record<LegacyReaderDataDisposition, number> {
  const result: Record<LegacyReaderDataDisposition, number> = {
    imported: 0,
    deduplicated: 0,
    normalized: 0,
    "skipped-invalid": 0,
    synthesized: 0,
  }
  for (const entry of entries) result[entry.disposition] += 1
  return result
}

function arrayValue(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  const parsed = objectSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  const parsed = objectSchema.safeParse(value)
  if (!parsed.success) throw new Error(message)
  return parsed.data
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function timestampValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.trunc(value)
  if (typeof value === "string" && value) {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed) && parsed >= 0) return Math.trunc(parsed)
  }
  return undefined
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function isSystemListId(id: string): boolean {
  return id === "all" || id === "default" || id === "favorites"
}

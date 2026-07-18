import type { CzkawkaEntry, CzkawkaGroup } from "./core.js"

export type CzkawkaSelectionApplyMode = "replace" | "add" | "remove" | "intersect"
export type CzkawkaGroupSelectionMode = "all-except-one" | "select-one" | "all-except-one-per-folder" | "all-except-one-matching-set"
export type CzkawkaSelectionSortField = "folderPath" | "fileName" | "fileSize" | "creationDate" | "modifiedDate" | "resolution" | "disk" | "fileType" | "hash" | "hardLinks"
export type CzkawkaSelectionMatchCondition = "none" | "contains" | "not-contains" | "starts-with" | "ends-with" | "equals"
export type CzkawkaSelectionTextColumn = "folderPath" | "fileName" | "fullPath"
export type CzkawkaDirectorySelectionMode = "keep-one-per-directory" | "select-all-in-directory" | "exclude-directory"

export interface CzkawkaSelectionSortCriterion {
  id: string
  field: CzkawkaSelectionSortField
  direction: "asc" | "desc"
  preferEmpty: boolean
  enabled: boolean
  filterCondition: CzkawkaSelectionMatchCondition
  filterValue: string
}

export interface CzkawkaGroupSelectionConfig {
  mode: CzkawkaGroupSelectionMode
  sortCriteria: CzkawkaSelectionSortCriterion[]
}

export interface CzkawkaTextSelectionConfig {
  column: CzkawkaSelectionTextColumn
  condition: Exclude<CzkawkaSelectionMatchCondition, "none">
  pattern: string
  useRegex: boolean
  caseSensitive: boolean
  matchWholeColumn: boolean
}

export interface CzkawkaDirectorySelectionConfig {
  mode: CzkawkaDirectorySelectionMode
  directories: string[]
}

export interface CzkawkaSelectionAssistantConfig {
  applyMode: CzkawkaSelectionApplyMode
  group: CzkawkaGroupSelectionConfig
  text: CzkawkaTextSelectionConfig
  directory: CzkawkaDirectorySelectionConfig
}

export interface CzkawkaSelectionResult {
  paths: string[]
  matchedPaths: string[]
  affectedCount: number
  error?: string
  errorCode?: "directory-required"
}

export interface CzkawkaSelectionStats {
  selectedCount: number
  selectedBytes: number
  reclaimableBytes: number
}

export interface CzkawkaSelectionHistory {
  past: string[][]
  present: string[]
  future: string[][]
  limit: number
}

export function createDefaultCzkawkaSelectionAssistantConfig(): CzkawkaSelectionAssistantConfig {
  return {
    applyMode: "replace",
    group: { mode: "all-except-one", sortCriteria: [{ id: "modified", field: "modifiedDate", direction: "desc", preferEmpty: false, enabled: true, filterCondition: "none", filterValue: "" }] },
    text: { column: "fullPath", condition: "contains", pattern: "", useRegex: false, caseSensitive: false, matchWholeColumn: false },
    directory: { mode: "keep-one-per-directory", directories: [] },
  }
}

export function applyCzkawkaGroupSelection(groups: CzkawkaGroup[], current: Iterable<string>, config: CzkawkaGroupSelectionConfig, mode: CzkawkaSelectionApplyMode): CzkawkaSelectionResult {
  const matched = new Set<string>()
  for (const group of groups) for (const path of groupCandidates(group, config)) matched.add(path)
  return selectionResult(current, matched, mode)
}

export function applyCzkawkaTextSelection(groups: CzkawkaGroup[], current: Iterable<string>, config: CzkawkaTextSelectionConfig, mode: CzkawkaSelectionApplyMode): CzkawkaSelectionResult {
  const matcher = createMatcher(config.pattern, config.caseSensitive, config.useRegex, config.matchWholeColumn ? "equals" : config.condition)
  if (matcher.error) return { paths: [...current], matchedPaths: [], affectedCount: 0, error: matcher.error }
  const matched = new Set<string>()
  for (const entry of selectableEntries(groups)) if (matcher.match(textColumn(entry.path, config.column))) matched.add(entry.path)
  return selectionResult(current, matched, mode)
}

export function applyCzkawkaDirectorySelection(groups: CzkawkaGroup[], current: Iterable<string>, config: CzkawkaDirectorySelectionConfig, mode: CzkawkaSelectionApplyMode): CzkawkaSelectionResult {
  if (config.mode !== "keep-one-per-directory" && config.directories.length === 0) return { paths: [...current], matchedPaths: [], affectedCount: 0, error: "At least one directory is required.", errorCode: "directory-required" }
  const matched = new Set<string>()
  if (config.mode === "keep-one-per-directory") {
    for (const group of groups) {
      const byDirectory = new Map<string, CzkawkaEntry[]>()
      for (const entry of group.entries) { if (entry.isReference) continue; const directory = dirname(entry.path); const items = byDirectory.get(directory) ?? []; items.push(entry); byDirectory.set(directory, items) }
      for (const entries of byDirectory.values()) for (const entry of entries.slice(1)) matched.add(entry.path)
    }
  } else {
    for (const entry of selectableEntries(groups)) if (config.directories.some((directory) => isInDirectory(entry.path, directory))) matched.add(entry.path)
  }
  return selectionResult(current, matched, mode)
}

export function applyCzkawkaSelectionMode(current: Iterable<string>, matched: Iterable<string>, mode: CzkawkaSelectionApplyMode): string[] {
  const before = new Set(current)
  const candidates = new Set(matched)
  if (mode === "replace") return [...candidates]
  if (mode === "add") return [...new Set([...before, ...candidates])]
  if (mode === "remove") return [...before].filter((path) => !candidates.has(path))
  return [...before].filter((path) => candidates.has(path))
}

export function invertCzkawkaSelection(groups: CzkawkaGroup[], current: Iterable<string>): string[] { const selected = new Set(current); return selectableEntries(groups).filter((entry) => !selected.has(entry.path)).map((entry) => entry.path) }
export function selectAllCzkawkaEntries(groups: CzkawkaGroup[]): string[] { return selectableEntries(groups).map((entry) => entry.path) }

export function calculateCzkawkaSelectionStats(groups: CzkawkaGroup[], selectedPaths: Iterable<string>): CzkawkaSelectionStats {
  const selected = new Set(selectedPaths)
  let selectedCount = 0, selectedBytes = 0, reclaimableBytes = 0
  for (const group of groups) {
    const selectedEntries = group.entries.filter((entry) => !entry.isReference && selected.has(entry.path))
    selectedCount += selectedEntries.length
    selectedBytes += selectedEntries.reduce((sum, entry) => sum + entry.size, 0)
    reclaimableBytes += Math.min(group.reclaimableBytes, selectedEntries.reduce((sum, entry) => sum + entry.size, 0))
  }
  return { selectedCount, selectedBytes, reclaimableBytes }
}

export function createCzkawkaSelectionHistory(initial: Iterable<string> = [], limit = 50): CzkawkaSelectionHistory { return { past: [], present: unique(initial), future: [], limit } }
export function pushCzkawkaSelectionHistory(history: CzkawkaSelectionHistory, paths: Iterable<string>): CzkawkaSelectionHistory { const next = unique(paths); if (samePaths(history.present, next)) return history; return { ...history, past: [...history.past, history.present].slice(-history.limit), present: next, future: [] } }
export function undoCzkawkaSelectionHistory(history: CzkawkaSelectionHistory): CzkawkaSelectionHistory { const previous = history.past.at(-1); return previous ? { ...history, past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future].slice(0, history.limit) } : history }
export function redoCzkawkaSelectionHistory(history: CzkawkaSelectionHistory): CzkawkaSelectionHistory { const next = history.future[0]; return next ? { ...history, past: [...history.past, history.present].slice(-history.limit), present: next, future: history.future.slice(1) } : history }

export function serializeCzkawkaSelectionAssistantConfig(config: CzkawkaSelectionAssistantConfig): string { return JSON.stringify({ version: 1, config }, null, 2) }
export function parseCzkawkaSelectionAssistantConfig(text: string): CzkawkaSelectionAssistantConfig {
  const parsed = JSON.parse(text) as { version?: unknown; config?: unknown }
  if (parsed.version !== 1 || !parsed.config || typeof parsed.config !== "object") throw new Error("Unsupported Czkawka selection assistant document.")
  const value = parsed.config as Partial<CzkawkaSelectionAssistantConfig>
  const defaults = createDefaultCzkawkaSelectionAssistantConfig()
  return { ...defaults, ...value, group: { ...defaults.group, ...value.group, sortCriteria: value.group?.sortCriteria?.map(normalizeCriterion) ?? defaults.group.sortCriteria }, text: { ...defaults.text, ...value.text }, directory: { ...defaults.directory, ...value.directory, directories: unique(value.directory?.directories ?? []) } }
}

function groupCandidates(group: CzkawkaGroup, config: CzkawkaGroupSelectionConfig): string[] {
  const entries = sortEntries(group.entries.filter((entry) => !entry.isReference), config.sortCriteria)
  if (config.mode === "select-one") return entries[0] ? [entries[0].path] : []
  if (config.mode === "all-except-one") return entries.slice(1).map((entry) => entry.path)
  if (config.mode === "all-except-one-per-folder") {
    const byFolder = new Map<string, CzkawkaEntry[]>()
    for (const entry of entries) { const folder = dirname(entry.path); const items = byFolder.get(folder) ?? []; items.push(entry); byFolder.set(folder, items) }
    return [...byFolder.values()].flatMap((items) => items.slice(1).map((entry) => entry.path))
  }
  const criterion = config.sortCriteria.find((item) => item.enabled)
  if (!criterion) return entries.slice(1).map((entry) => entry.path)
  const sets = new Map<string, CzkawkaEntry[]>()
  for (const entry of entries) { const key = String(fieldValue(entry, criterion.field) ?? "__empty__"); const items = sets.get(key) ?? []; items.push(entry); sets.set(key, items) }
  return [...sets.values()].slice(1).flatMap((items) => items.map((entry) => entry.path))
}

function sortEntries(entries: CzkawkaEntry[], criteria: CzkawkaSelectionSortCriterion[]): CzkawkaEntry[] {
  const enabled = criteria.filter((criterion) => criterion.enabled)
  let filtered = [...entries]
  for (const criterion of enabled) if (criterion.filterCondition !== "none" && criterion.filterValue) filtered = filtered.filter((entry) => createMatcher(criterion.filterValue, false, false, criterion.filterCondition).match(String(fieldValue(entry, criterion.field) ?? "")))
  return filtered.sort((left, right) => { for (const criterion of enabled) { const compared = compareValues(fieldValue(left, criterion.field), fieldValue(right, criterion.field), criterion); if (compared !== 0) return compared } return left.path.localeCompare(right.path, undefined, { numeric: true }) })
}

function fieldValue(entry: CzkawkaEntry, field: CzkawkaSelectionSortField): string | number | undefined {
  if (field === "folderPath") return dirname(entry.path)
  if (field === "fileName") return entry.name
  if (field === "fileSize") return entry.size
  if (field === "creationDate" || field === "modifiedDate") return entry.modifiedDate
  if (field === "resolution") return entry.width && entry.height ? entry.width * entry.height : undefined
  if (field === "disk") return /^[A-Za-z]:/.test(entry.path) ? entry.path.slice(0, 2).toUpperCase() : `/${entry.path.replace(/\\/g, "/").split("/").filter(Boolean)[0] ?? ""}`
  if (field === "fileType") return extension(entry.name)
  if (field === "hash") return entry.hash
  return undefined
}

function compareValues(left: string | number | undefined, right: string | number | undefined, criterion: CzkawkaSelectionSortCriterion): number {
  const leftEmpty = left === undefined || left === "", rightEmpty = right === undefined || right === ""
  if (leftEmpty !== rightEmpty) return (criterion.preferEmpty ? leftEmpty : !leftEmpty) ? -1 : 1
  const compared = typeof left === "number" && typeof right === "number" ? left - right : String(left ?? "").localeCompare(String(right ?? ""), undefined, { numeric: true })
  return criterion.direction === "desc" ? -compared : compared
}

function selectionResult(current: Iterable<string>, matched: Set<string>, mode: CzkawkaSelectionApplyMode): CzkawkaSelectionResult { const before = unique(current), paths = applyCzkawkaSelectionMode(before, matched, mode); return { paths, matchedPaths: [...matched], affectedCount: symmetricDifference(before, paths) } }
function createMatcher(pattern: string, caseSensitive: boolean, regex: boolean, condition: CzkawkaSelectionMatchCondition): { match: (value: string) => boolean; error?: string } { if (!pattern) return { match: () => false }; if (regex) { try { const expression = new RegExp(pattern, caseSensitive ? "" : "i"); return { match: (value) => expression.test(value) } } catch (error) { return { match: () => false, error: error instanceof Error ? error.message : String(error) } } } const needle = caseSensitive ? pattern : pattern.toLocaleLowerCase(); return { match: (value) => { const candidate = caseSensitive ? value : value.toLocaleLowerCase(); if (condition === "contains") return candidate.includes(needle); if (condition === "not-contains") return !candidate.includes(needle); if (condition === "starts-with") return candidate.startsWith(needle); if (condition === "ends-with") return candidate.endsWith(needle); if (condition === "equals") return candidate === needle; return true } } }
function normalizeCriterion(value: Partial<CzkawkaSelectionSortCriterion>, index: number): CzkawkaSelectionSortCriterion { return { id: value.id ?? `criterion-${index}`, field: value.field ?? "modifiedDate", direction: value.direction ?? "desc", preferEmpty: value.preferEmpty ?? false, enabled: value.enabled ?? true, filterCondition: value.filterCondition ?? "none", filterValue: value.filterValue ?? "" } }
function selectableEntries(groups: CzkawkaGroup[]): CzkawkaEntry[] { return groups.flatMap((group) => group.entries.filter((entry) => !entry.isReference)) }
function textColumn(path: string, column: CzkawkaSelectionTextColumn): string { if (column === "fullPath") return path; if (column === "fileName") return path.replace(/\\/g, "/").split("/").at(-1) ?? path; return dirname(path) }
function dirname(path: string): string { const normalized = path.replace(/\\/g, "/"); const index = normalized.lastIndexOf("/"); return index > 0 ? normalized.slice(0, index) : "" }
function isInDirectory(path: string, directory: string): boolean { const normalizedPath = path.replace(/\\/g, "/").toLocaleLowerCase(); const normalizedDirectory = directory.replace(/\\/g, "/").replace(/\/$/, "").toLocaleLowerCase(); return normalizedPath === normalizedDirectory || normalizedPath.startsWith(`${normalizedDirectory}/`) }
function extension(name: string): string { const index = name.lastIndexOf("."); return index > 0 ? name.slice(index + 1).toLocaleLowerCase() : "" }
function unique(values: Iterable<string>): string[] { return [...new Set(values)] }
function symmetricDifference(left: string[], right: string[]): number { const a = new Set(left), b = new Set(right); return left.filter((path) => !b.has(path)).length + right.filter((path) => !a.has(path)).length }
function samePaths(left: string[], right: string[]): boolean { return left.length === right.length && left.every((path, index) => path === right[index]) }

import type { CzkawkaEntry, CzkawkaGroup, CzkawkaTool } from "./core.js"

export type CzkawkaSizeUnit = "B" | "KB" | "MB" | "GB" | "TB"
export type CzkawkaMarkFilter = "all" | "selected" | "unselected" | "group-some-selected" | "group-all-selected" | "group-none-selected" | "reference"
export type CzkawkaPathMatchMode = "contains" | "not-contains" | "starts-with" | "ends-with" | "regex"
export type CzkawkaDatePreset = "today" | "last-7-days" | "last-30-days" | "last-year" | "custom"
export type CzkawkaAspectRatio = "any" | "16:9" | "4:3" | "1:1"

export interface CzkawkaRangeFilter {
  enabled: boolean
  min?: number
  max?: number
  unit?: CzkawkaSizeUnit
}

export interface CzkawkaFilterState {
  text: { enabled: boolean; pattern: string; regex: boolean; caseSensitive: boolean }
  mark: CzkawkaMarkFilter
  groupCount: CzkawkaRangeFilter
  groupSize: CzkawkaRangeFilter
  fileSize: CzkawkaRangeFilter
  extension: { enabled: boolean; mode: "include" | "exclude"; extensions: string[] }
  modifiedDate: { enabled: boolean; preset: CzkawkaDatePreset; start?: number; end?: number }
  path: { enabled: boolean; mode: CzkawkaPathMatchMode; pattern: string; caseSensitive: boolean }
  similarity: CzkawkaRangeFilter
  resolution: { enabled: boolean; minWidth?: number; minHeight?: number; maxWidth?: number; maxHeight?: number; aspectRatio: CzkawkaAspectRatio }
  showAllInFilteredGroups: boolean
}

export interface CzkawkaExtensionStat {
  extension: string
  totalCount: number
  filteredCount: number
  totalBytes: number
  filteredBytes: number
}

export interface CzkawkaFilterStats {
  totalItems: number
  filteredItems: number
  totalGroups: number
  filteredGroups: number
  totalBytes: number
  filteredBytes: number
  selectedItems: number
  activeFilterCount: number
  extensions: CzkawkaExtensionStat[]
}

export interface CzkawkaFilterResult {
  groups: CzkawkaGroup[]
  stats: CzkawkaFilterStats
  pathPatternError?: string
  textPatternError?: string
}

export function createDefaultCzkawkaFilterState(): CzkawkaFilterState {
  return {
    text: { enabled: false, pattern: "", regex: false, caseSensitive: false },
    mark: "all",
    groupCount: { enabled: false, min: 2, max: 100 },
    groupSize: { enabled: false, min: 0, max: 100, unit: "GB" },
    fileSize: { enabled: false, min: 0, max: 100, unit: "GB" },
    extension: { enabled: false, mode: "include", extensions: [] },
    modifiedDate: { enabled: false, preset: "custom" },
    path: { enabled: false, mode: "contains", pattern: "", caseSensitive: false },
    similarity: { enabled: false, min: 0, max: 100 },
    resolution: { enabled: false, aspectRatio: "any" },
    showAllInFilteredGroups: true,
  }
}

export function applyCzkawkaFilters(groups: CzkawkaGroup[], selectedPaths: Iterable<string>, state: CzkawkaFilterState, now = Date.now()): CzkawkaFilterResult {
  const selected = new Set(selectedPaths)
  const textMatcher = createTextMatcher(state.text.pattern, state.text.caseSensitive, state.text.regex)
  const pathMatcher = createPathMatcher(state.path.pattern, state.path.caseSensitive, state.path.mode)
  const filteredGroups: CzkawkaGroup[] = []

  for (const group of groups) {
    if (!matchesGroupRanges(group, state) || !matchesGroupMark(group, selected, state.mark)) continue
    const matchedEntries = group.entries.filter((entry) => matchesEntry(entry, selected, state, now, textMatcher.match, pathMatcher.match))
    if (matchedEntries.length === 0) continue
    filteredGroups.push({ ...group, entries: state.showAllInFilteredGroups && hasEntryFilter(state) ? group.entries : matchedEntries })
  }

  return {
    groups: filteredGroups,
    stats: calculateCzkawkaFilterStats(groups, filteredGroups, selected, state),
    ...(pathMatcher.error ? { pathPatternError: pathMatcher.error } : {}),
    ...(textMatcher.error ? { textPatternError: textMatcher.error } : {}),
  }
}

export function countActiveCzkawkaFilters(state: CzkawkaFilterState): number {
  return Number(state.text.enabled && Boolean(state.text.pattern))
    + Number(state.mark !== "all")
    + Number(state.groupCount.enabled)
    + Number(state.groupSize.enabled)
    + Number(state.fileSize.enabled)
    + Number(state.extension.enabled && state.extension.extensions.length > 0)
    + Number(state.modifiedDate.enabled)
    + Number(state.path.enabled && Boolean(state.path.pattern))
    + Number(state.similarity.enabled)
    + Number(state.resolution.enabled)
}

export function supportsSimilarityFilter(tool: CzkawkaTool): boolean { return tool === "similar-images" || tool === "similar-videos" }
export function supportsResolutionFilter(tool: CzkawkaTool): boolean { return tool === "similar-images" || tool === "similar-videos" }

function matchesGroupRanges(group: CzkawkaGroup, state: CzkawkaFilterState): boolean {
  if (state.groupCount.enabled && !inRange(group.entries.length, state.groupCount.min, state.groupCount.max)) return false
  if (state.groupSize.enabled && !inRange(group.totalBytes, sizeBoundary(state.groupSize.min, state.groupSize.unit), sizeBoundary(state.groupSize.max, state.groupSize.unit))) return false
  return true
}

function matchesGroupMark(group: CzkawkaGroup, selected: Set<string>, mark: CzkawkaMarkFilter): boolean {
  if (mark === "all" || mark === "selected" || mark === "unselected" || mark === "reference") return true
  const selectable = group.entries.filter((entry) => !entry.isReference)
  const selectedCount = selectable.filter((entry) => selected.has(entry.path)).length
  if (mark === "group-some-selected") return selectedCount > 0 && selectedCount < selectable.length
  if (mark === "group-all-selected") return selectable.length > 0 && selectedCount === selectable.length
  return selectedCount === 0
}

function matchesEntry(entry: CzkawkaEntry, selected: Set<string>, state: CzkawkaFilterState, now: number, textMatch: (value: string) => boolean, pathMatch: (value: string) => boolean): boolean {
  if (state.mark === "selected" && !selected.has(entry.path)) return false
  if (state.mark === "unselected" && (entry.isReference || selected.has(entry.path))) return false
  if (state.mark === "reference" && !entry.isReference) return false
  if (state.text.enabled && state.text.pattern && !textMatch(entrySearchText(entry))) return false
  if (state.fileSize.enabled && !inRange(entry.size, sizeBoundary(state.fileSize.min, state.fileSize.unit), sizeBoundary(state.fileSize.max, state.fileSize.unit))) return false
  if (state.extension.enabled && state.extension.extensions.length > 0) {
    const extensions = new Set(state.extension.extensions.map(normalizeExtension))
    const included = extensions.has(extensionOf(entry.path))
    if (state.extension.mode === "include" ? !included : included) return false
  }
  if (state.modifiedDate.enabled && !matchesDate(entry.modifiedDate, state.modifiedDate, now)) return false
  if (state.path.enabled && state.path.pattern && !pathMatch(entry.path)) return false
  if (state.similarity.enabled && !inRange(parseNumeric(entry.similarity), state.similarity.min, state.similarity.max)) return false
  if (state.resolution.enabled && !matchesResolution(entry, state.resolution)) return false
  return true
}

function hasEntryFilter(state: CzkawkaFilterState): boolean {
  return state.text.enabled || state.mark === "selected" || state.mark === "unselected" || state.mark === "reference" || state.fileSize.enabled || state.extension.enabled || state.modifiedDate.enabled || state.path.enabled || state.similarity.enabled || state.resolution.enabled
}

function calculateCzkawkaFilterStats(original: CzkawkaGroup[], filtered: CzkawkaGroup[], selected: Set<string>, state: CzkawkaFilterState): CzkawkaFilterStats {
  const originalEntries = original.flatMap((group) => group.entries)
  const filteredEntries = filtered.flatMap((group) => group.entries)
  const extensionMap = new Map<string, CzkawkaExtensionStat>()
  for (const entry of originalEntries) {
    const extension = extensionOf(entry.path) || "(无扩展名)"
    const current = extensionMap.get(extension) ?? { extension, totalCount: 0, filteredCount: 0, totalBytes: 0, filteredBytes: 0 }
    current.totalCount += 1
    current.totalBytes += entry.size
    extensionMap.set(extension, current)
  }
  for (const entry of filteredEntries) {
    const extension = extensionOf(entry.path) || "(无扩展名)"
    const current = extensionMap.get(extension) ?? { extension, totalCount: 0, filteredCount: 0, totalBytes: 0, filteredBytes: 0 }
    current.filteredCount += 1
    current.filteredBytes += entry.size
    extensionMap.set(extension, current)
  }
  return {
    totalItems: originalEntries.length,
    filteredItems: filteredEntries.length,
    totalGroups: original.length,
    filteredGroups: filtered.length,
    totalBytes: sumBytes(originalEntries),
    filteredBytes: sumBytes(filteredEntries),
    selectedItems: originalEntries.filter((entry) => selected.has(entry.path)).length,
    activeFilterCount: countActiveCzkawkaFilters(state),
    extensions: [...extensionMap.values()].sort((left, right) => right.filteredCount - left.filteredCount || right.totalCount - left.totalCount || left.extension.localeCompare(right.extension)),
  }
}

function matchesDate(value: number, config: CzkawkaFilterState["modifiedDate"], now: number): boolean {
  const timestamp = value > 0 && value < 10_000_000_000 ? value * 1000 : value
  const day = 24 * 60 * 60 * 1000
  let start = config.start ?? 0
  let end = config.end ?? Number.MAX_SAFE_INTEGER
  if (config.preset === "today") { const date = new Date(now); date.setHours(0, 0, 0, 0); start = date.getTime(); end = now }
  if (config.preset === "last-7-days") { start = now - 7 * day; end = now }
  if (config.preset === "last-30-days") { start = now - 30 * day; end = now }
  if (config.preset === "last-year") { start = now - 365 * day; end = now }
  return timestamp >= start && timestamp <= end
}

function matchesResolution(entry: CzkawkaEntry, config: CzkawkaFilterState["resolution"]): boolean {
  if (!entry.width || !entry.height) return false
  if (!inRange(entry.width, config.minWidth, config.maxWidth) || !inRange(entry.height, config.minHeight, config.maxHeight)) return false
  if (config.aspectRatio === "any") return true
  const [expectedWidth, expectedHeight] = config.aspectRatio.split(":").map(Number)
  return Math.abs(entry.width / entry.height - expectedWidth! / expectedHeight!) <= 0.02
}

function createPathMatcher(pattern: string, caseSensitive: boolean, mode: CzkawkaPathMatchMode): { match: (value: string) => boolean; error?: string } {
  if (mode === "regex") return createRegexMatcher(pattern, caseSensitive)
  const needle = caseSensitive ? pattern : pattern.toLocaleLowerCase()
  return { match: (value) => { const candidate = caseSensitive ? value : value.toLocaleLowerCase(); if (mode === "contains") return candidate.includes(needle); if (mode === "not-contains") return !candidate.includes(needle); if (mode === "starts-with") return candidate.startsWith(needle); return candidate.endsWith(needle) } }
}

function createTextMatcher(pattern: string, caseSensitive: boolean, regex: boolean): { match: (value: string) => boolean; error?: string } {
  if (regex) return createRegexMatcher(pattern, caseSensitive)
  const needle = caseSensitive ? pattern : pattern.toLocaleLowerCase()
  return { match: (value) => (caseSensitive ? value : value.toLocaleLowerCase()).includes(needle) }
}

function createRegexMatcher(pattern: string, caseSensitive: boolean): { match: (value: string) => boolean; error?: string } {
  try { const expression = new RegExp(pattern, caseSensitive ? "" : "i"); return { match: (value) => expression.test(value) } }
  catch (error) { return { match: () => false, error: error instanceof Error ? error.message : String(error) } }
}

function entrySearchText(entry: CzkawkaEntry): string { return [entry.name, entry.path, entry.title, entry.artist, entry.genre, entry.detail, entry.properExtension, entry.secondaryPath].filter(Boolean).join("\n") }
function sizeBoundary(value: number | undefined, unit: CzkawkaSizeUnit | undefined): number | undefined { return value === undefined ? undefined : value * ({ B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 }[unit ?? "B"]) }
function inRange(value: number, min?: number, max?: number): boolean { return (min === undefined || value >= min) && (max === undefined || value <= max) }
function extensionOf(path: string): string { const name = path.replace(/\\/g, "/").split("/").at(-1) ?? ""; const index = name.lastIndexOf("."); return index > 0 ? name.slice(index + 1).toLocaleLowerCase() : "" }
function normalizeExtension(value: string): string { const normalized = value.trim().replace(/^\./, "").toLocaleLowerCase(); return normalized === "(无扩展名)" ? "" : normalized }
function parseNumeric(value: string | undefined): number { const result = Number.parseFloat(value ?? ""); return Number.isFinite(result) ? result : -1 }
function sumBytes(entries: CzkawkaEntry[]): number { return entries.reduce((sum, entry) => sum + entry.size, 0) }

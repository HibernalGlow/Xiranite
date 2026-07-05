import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"

export type EngineVAction = "scan" | "filter" | "rename" | "delete" | "export"
export type EngineVExportFormat = "json" | "paths"
export type EngineVRenameStatus = "planned" | "renamed" | "copied" | "deleted" | "error"
export type EngineVSortField = "none" | "size" | "title" | "createdTime" | "modifiedTime"
export type EngineVSortOrder = "asc" | "desc"

export interface EngineVFilterOptions {
  title?: string
  contentRating?: string
  contentrating?: string
  type?: string
  ratingSex?: string
  ratingsex?: string
  ratingViolence?: string
  ratingviolence?: string
  tags?: string[] | string
}

export interface EngineVInput {
  action?: EngineVAction
  path?: string
  workshopPath?: string
  workshop_path?: string
  maxWorkers?: number
  max_workers?: number
  filters?: EngineVFilterOptions
  wallpapers?: Array<EngineVWallpaper | Record<string, unknown>>
  workshopIds?: string[]
  workshop_ids?: string[]
  ids?: string[] | string
  template?: string
  descMaxLength?: number
  desc_max_length?: number
  nameMaxLength?: number
  name_max_length?: number
  dryRun?: boolean
  dry_run?: boolean
  permanent?: boolean
  copyMode?: boolean
  copy_mode?: boolean
  targetPath?: string
  target_path?: string
  exportFormat?: EngineVExportFormat
  export_format?: EngineVExportFormat
  exportPath?: string
  export_path?: string
  sortField?: EngineVSortField
  sort_field?: EngineVSortField
  sortOrder?: EngineVSortOrder
  sort_order?: EngineVSortOrder
}

export interface EngineVPathInfo {
  path: string
  exists: boolean
  isFile: boolean
  isDirectory: boolean
  size: number
  createdMs: number
  modifiedMs: number
}

export interface EngineVDirEntry {
  name: string
  path: string
  isFile: boolean
  isDirectory: boolean
  size: number
}

export interface EngineVRuntime {
  pathInfo: (path: string) => Promise<EngineVPathInfo>
  listDir: (path: string) => Promise<EngineVDirEntry[]>
  readJson: (path: string) => Promise<unknown>
  writeText: (path: string, content: string) => Promise<void>
  ensureDir: (path: string) => Promise<void>
  movePath: (source: string, target: string) => Promise<void>
  copyDir: (source: string, target: string) => Promise<void>
  removePath: (path: string, options?: { trash?: boolean }) => Promise<void>
  join: (...parts: string[]) => string
  dirname: (path: string) => string
  basename: (path: string) => string
  resolve: (path: string) => string
}

export interface EngineVWallpaper {
  path: string
  folderName: string
  workshopId: string
  title: string
  description: string
  contentRating: string
  ratingSex: string
  ratingViolence: string
  tags: string[]
  fileName: string
  preview: string
  wallpaperType: string
  createdTime: string
  modifiedTime: string
  size: number
  projectData: Record<string, unknown>
}

export interface EngineVRenameResult {
  workshopId: string
  title: string
  oldPath: string
  newPath: string
  oldName: string
  newName: string
  status: EngineVRenameStatus
  error?: string
}

export interface EngineVDeleteResult {
  workshopId: string
  title: string
  path: string
  status: EngineVRenameStatus
  message: string
}

export interface EngineVData {
  wallpapers: EngineVWallpaper[]
  filteredWallpapers: EngineVWallpaper[]
  totalCount: number
  filteredCount: number
  successCount: number
  failedCount: number
  typeStats: Record<string, number>
  ratingStats: Record<string, number>
  renameResults: EngineVRenameResult[]
  deleteResults: EngineVDeleteResult[]
  exportPath: string
  errors: string[]
}

export type EngineVResult = NodeRunResult<EngineVData>

export const DEFAULT_TEMPLATE = "[#{id}]{original_name}+{title}"
export const DEFAULT_WORKSHOP_PATH = "E:\\SteamLibrary\\steamapps\\workshop\\content\\431960"

interface NormalizedEngineVInput {
  action: EngineVAction
  workshopPath: string
  maxWorkers: number
  filters: EngineVFilterOptions
  wallpapers: EngineVWallpaper[]
  workshopIds: string[]
  template: string
  descMaxLength: number
  nameMaxLength: number
  dryRun: boolean
  permanent: boolean
  copyMode: boolean
  targetPath: string
  exportFormat: EngineVExportFormat
  exportPath: string
  sortField: EngineVSortField
  sortOrder: EngineVSortOrder
}

export function normalizeEngineVInput(input: EngineVInput): NormalizedEngineVInput {
  return {
    action: input.action ?? "scan",
    workshopPath: clean(input.workshopPath ?? input.workshop_path ?? input.path),
    maxWorkers: Math.max(1, Math.floor(input.maxWorkers ?? input.max_workers ?? 4)),
    filters: input.filters ?? {},
    wallpapers: normalizeWallpapers(input.wallpapers ?? []),
    workshopIds: normalizeIds(input.workshopIds ?? input.workshop_ids ?? input.ids),
    template: clean(input.template) || DEFAULT_TEMPLATE,
    descMaxLength: Math.max(0, Math.floor(input.descMaxLength ?? input.desc_max_length ?? 18)),
    nameMaxLength: Math.max(0, Math.floor(input.nameMaxLength ?? input.name_max_length ?? 120)),
    dryRun: input.dryRun ?? input.dry_run ?? true,
    permanent: input.permanent ?? false,
    copyMode: input.copyMode ?? input.copy_mode ?? false,
    targetPath: clean(input.targetPath ?? input.target_path),
    exportFormat: input.exportFormat ?? input.export_format ?? "json",
    exportPath: clean(input.exportPath ?? input.export_path),
    sortField: input.sortField ?? input.sort_field ?? "none",
    sortOrder: input.sortOrder ?? input.sort_order ?? "desc",
  }
}

export async function runEngineV(
  input: EngineVInput,
  runtime: EngineVRuntime,
  onEvent: (event: NodeRunEvent) => void = () => {},
): Promise<EngineVResult> {
  const normalized = normalizeEngineVInput(input)
  try {
    if (normalized.action === "scan") return await runScan(normalized, runtime, onEvent)
    if (normalized.action === "filter") return await runFilter(normalized, runtime, onEvent)
    if (normalized.action === "rename") return await runRename(normalized, runtime, onEvent)
    if (normalized.action === "delete") return await runDelete(normalized, runtime, onEvent)
    return await runExport(normalized, runtime, onEvent)
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error))
  }
}

export async function scanWorkshop(
  workshopPath: string,
  runtime: EngineVRuntime,
  onEvent: (event: NodeRunEvent) => void = () => {},
): Promise<EngineVWallpaper[]> {
  const root = runtime.resolve(workshopPath)
  const info = await runtime.pathInfo(root)
  if (!info.exists) throw new Error(`Workshop path does not exist: ${workshopPath}`)
  if (!info.isDirectory) throw new Error(`Workshop path is not a directory: ${workshopPath}`)

  const entries = (await runtime.listDir(root))
    .filter((entry) => entry.isDirectory)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }))
  const results: EngineVWallpaper[] = []

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!
    onEvent({ type: "progress", progress: 10 + Math.round((index / Math.max(entries.length, 1)) * 70), message: `Scanning ${entry.name}` })
    const wallpaper = await readWallpaperFolder(entry.path, runtime)
    if (wallpaper) results.push(wallpaper)
  }

  return sortWallpapers(results, "title", "asc")
}

export async function readWallpaperFolder(folderPath: string, runtime: EngineVRuntime): Promise<EngineVWallpaper | null> {
  const projectPath = runtime.join(folderPath, "project.json")
  const projectInfo = await runtime.pathInfo(projectPath)
  if (!projectInfo.exists || !projectInfo.isFile) return null

  const projectData = asRecord(await runtime.readJson(projectPath))
  const info = await runtime.pathInfo(folderPath)
  const size = await folderSize(folderPath, runtime)
  const folderName = runtime.basename(folderPath)
  return {
    path: runtime.resolve(folderPath),
    folderName,
    workshopId: folderName,
    title: stringValue(projectData.title),
    description: stringValue(projectData.description),
    contentRating: stringValue(projectData.contentrating ?? projectData.contentRating),
    ratingSex: stringValue(projectData.ratingsex ?? projectData.ratingSex),
    ratingViolence: stringValue(projectData.ratingviolence ?? projectData.ratingViolence),
    tags: Array.isArray(projectData.tags) ? projectData.tags.map(String) : [],
    fileName: stringValue(projectData.file),
    preview: stringValue(projectData.preview),
    wallpaperType: stringValue(projectData.type),
    createdTime: new Date(info.createdMs || Date.now()).toISOString(),
    modifiedTime: new Date(info.modifiedMs || Date.now()).toISOString(),
    size,
    projectData,
  }
}

export function filterWallpapers(wallpapers: EngineVWallpaper[], filters: EngineVFilterOptions): EngineVWallpaper[] {
  const title = clean(filters.title).toLowerCase()
  const contentRating = clean(filters.contentRating ?? filters.contentrating)
  const type = clean(filters.type)
  const ratingSex = clean(filters.ratingSex ?? filters.ratingsex)
  const ratingViolence = clean(filters.ratingViolence ?? filters.ratingviolence)
  const tags = normalizeTags(filters.tags)
  return wallpapers.filter((wallpaper) => {
    if (title && !wallpaper.title.toLowerCase().includes(title)) return false
    if (contentRating && wallpaper.contentRating !== contentRating) return false
    if (type && wallpaper.wallpaperType !== type) return false
    if (ratingSex && wallpaper.ratingSex !== ratingSex) return false
    if (ratingViolence && wallpaper.ratingViolence !== ratingViolence) return false
    if (tags.length && !tags.some((tag) => wallpaper.tags.includes(tag))) return false
    return true
  })
}

export function sortWallpapers(wallpapers: EngineVWallpaper[], field: EngineVSortField = "none", order: EngineVSortOrder = "desc"): EngineVWallpaper[] {
  if (field === "none") return [...wallpapers]
  const direction = order === "asc" ? 1 : -1
  return [...wallpapers].sort((a, b) => {
    if (field === "size") return (a.size - b.size) * direction
    if (field === "createdTime") return a.createdTime.localeCompare(b.createdTime) * direction
    if (field === "modifiedTime") return a.modifiedTime.localeCompare(b.modifiedTime) * direction
    return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" }) * direction
  })
}

export function generateNewName(
  wallpaper: EngineVWallpaper,
  template: string,
  options: { descMaxLength?: number; nameMaxLength?: number } = {},
): string {
  const descMaxLength = options.descMaxLength ?? 18
  const nameMaxLength = options.nameMaxLength ?? 120
  let description = wallpaper.description.trim().replace(/[\r\n]+/g, " ")
  if (descMaxLength > 0 && description.length > descMaxLength) description = `${description.slice(0, descMaxLength)}...`

  const values: Record<string, string> = {
    "{id}": wallpaper.workshopId,
    "{title}": wallpaper.title,
    "{original_name}": wallpaper.folderName,
    "{type}": wallpaper.wallpaperType,
    "{rating}": wallpaper.contentRating,
    "{desc}": description,
  }

  let next = template
  for (const [placeholder, value] of Object.entries(values)) next = next.split(placeholder).join(value)
  next = sanitizePathSegment(next)

  if (nameMaxLength > 0 && next.length > nameMaxLength) {
    const idSuffix = `#${wallpaper.workshopId}`
    const suffixIndex = next.lastIndexOf(idSuffix)
    const suffix = suffixIndex >= 0 ? next.slice(suffixIndex) : ""
    const available = suffix ? nameMaxLength - suffix.length - 1 : nameMaxLength
    next = available > 4 ? `${next.slice(0, available - 3)}...${suffix ? ` ${suffix}` : ""}` : next.slice(0, nameMaxLength)
  }
  return next || wallpaper.folderName
}

export function validateTemplate(template: string): string[] {
  const issues: string[] = []
  const valid = new Set(["{id}", "{title}", "{original_name}", "{type}", "{rating}", "{desc}"])
  if (!/[{}]/.test(template) || ![...valid].some((placeholder) => template.includes(placeholder))) issues.push("Template does not include a known placeholder.")
  if (/[<>:"\/\\|?*\x00-\x1f]/.test(template.replace(/\{[^}]+\}/g, ""))) issues.push("Template contains illegal path characters outside placeholders.")
  for (const match of template.match(/\{[^}]+\}/g) ?? []) {
    if (!valid.has(match)) issues.push(`Unknown placeholder: ${match}`)
  }
  return issues
}

export async function buildRenamePlan(
  wallpapers: EngineVWallpaper[],
  input: Pick<NormalizedEngineVInput, "workshopIds" | "template" | "descMaxLength" | "nameMaxLength" | "copyMode" | "targetPath">,
  runtime: Pick<EngineVRuntime, "join" | "dirname" | "pathInfo">,
): Promise<EngineVRenameResult[]> {
  const targets = selectWallpapers(wallpapers, input.workshopIds, false)
  const planned = new Set<string>()
  const results: EngineVRenameResult[] = []
  for (const wallpaper of targets) {
    const newName = generateNewName(wallpaper, input.template, { descMaxLength: input.descMaxLength, nameMaxLength: input.nameMaxLength })
    const baseDir = input.copyMode && input.targetPath ? input.targetPath : runtime.dirname(wallpaper.path)
    const newPath = await uniqueFolderPath(runtime.join(baseDir, newName), planned, runtime)
    planned.add(newPath)
    results.push({
      workshopId: wallpaper.workshopId,
      title: wallpaper.title,
      oldPath: wallpaper.path,
      newPath,
      oldName: wallpaper.folderName,
      newName: pathName(newPath),
      status: "planned",
    })
  }
  return results
}

export function calculateStats(wallpapers: EngineVWallpaper[]): Pick<EngineVData, "typeStats" | "ratingStats"> {
  const typeStats: Record<string, number> = {}
  const ratingStats: Record<string, number> = {}
  for (const wallpaper of wallpapers) {
    if (wallpaper.wallpaperType) typeStats[wallpaper.wallpaperType] = (typeStats[wallpaper.wallpaperType] ?? 0) + 1
    if (wallpaper.contentRating) ratingStats[wallpaper.contentRating] = (ratingStats[wallpaper.contentRating] ?? 0) + 1
  }
  return { typeStats, ratingStats }
}

async function runScan(normalized: NormalizedEngineVInput, runtime: EngineVRuntime, onEvent: (event: NodeRunEvent) => void): Promise<EngineVResult> {
  if (!normalized.workshopPath) return failure("Workshop path is required.")
  const wallpapers = await scanWorkshop(normalized.workshopPath, runtime, onEvent)
  onEvent({ type: "progress", progress: 100, message: "Scan complete." })
  return success(`Scan complete: ${wallpapers.length} wallpaper(s).`, dataWithWallpapers(wallpapers, wallpapers))
}

async function runFilter(normalized: NormalizedEngineVInput, runtime: EngineVRuntime, onEvent: (event: NodeRunEvent) => void): Promise<EngineVResult> {
  const wallpapers = await loadWallpapers(normalized, runtime, onEvent)
  const filtered = sortWallpapers(filterWallpapers(wallpapers, normalized.filters), normalized.sortField, normalized.sortOrder)
  return success(`Filter complete: ${filtered.length}/${wallpapers.length} wallpaper(s).`, dataWithWallpapers(wallpapers, filtered))
}

async function runRename(normalized: NormalizedEngineVInput, runtime: EngineVRuntime, onEvent: (event: NodeRunEvent) => void): Promise<EngineVResult> {
  const issues = validateTemplate(normalized.template)
  if (issues.length) return failure(issues.join(" "))
  const allWallpapers = await loadWallpapers(normalized, runtime, onEvent)
  const wallpapers = filterWallpapers(allWallpapers, normalized.filters)
  const plan = await buildRenamePlan(wallpapers, normalized, runtime)
  const results: EngineVRenameResult[] = []

  for (let index = 0; index < plan.length; index += 1) {
    const item = plan[index]!
    onEvent({ type: "progress", progress: 15 + Math.round((index / Math.max(plan.length, 1)) * 80), message: item.oldName })
    if (normalized.dryRun) {
      results.push(item)
      continue
    }
    try {
      await runtime.ensureDir(runtime.dirname(item.newPath))
      if (normalized.copyMode) {
        await runtime.copyDir(item.oldPath, item.newPath)
        results.push({ ...item, status: "copied" })
      } else {
        await runtime.movePath(item.oldPath, item.newPath)
        results.push({ ...item, status: "renamed" })
      }
    } catch (error) {
      results.push({ ...item, status: "error", error: error instanceof Error ? error.message : String(error) })
    }
  }

  const failed = results.filter((item) => item.status === "error").length
  return {
    success: failed === 0,
    message: normalized.dryRun ? `Rename plan complete: ${results.length} item(s).` : `Rename complete: ${results.length - failed} succeeded, ${failed} failed.`,
    data: { ...dataWithWallpapers(allWallpapers, wallpapers), renameResults: results, successCount: results.length - failed, failedCount: failed, errors: results.filter((item) => item.error).map((item) => item.error!) },
  }
}

async function runDelete(normalized: NormalizedEngineVInput, runtime: EngineVRuntime, onEvent: (event: NodeRunEvent) => void): Promise<EngineVResult> {
  if (!normalized.workshopIds.length) return failure("Delete requires at least one workshop id.")
  const wallpapers = await loadWallpapers(normalized, runtime, onEvent)
  const targets = selectWallpapers(wallpapers, normalized.workshopIds, true)
  const results: EngineVDeleteResult[] = []

  for (let index = 0; index < targets.length; index += 1) {
    const wallpaper = targets[index]!
    onEvent({ type: "progress", progress: 15 + Math.round((index / Math.max(targets.length, 1)) * 80), message: wallpaper.folderName })
    if (normalized.dryRun) {
      results.push({ workshopId: wallpaper.workshopId, title: wallpaper.title, path: wallpaper.path, status: "planned", message: "dry_run" })
      continue
    }
    try {
      await runtime.removePath(wallpaper.path, { trash: !normalized.permanent })
      results.push({ workshopId: wallpaper.workshopId, title: wallpaper.title, path: wallpaper.path, status: "deleted", message: normalized.permanent ? "deleted" : "trashed" })
    } catch (error) {
      results.push({ workshopId: wallpaper.workshopId, title: wallpaper.title, path: wallpaper.path, status: "error", message: error instanceof Error ? error.message : String(error) })
    }
  }

  const failed = results.filter((item) => item.status === "error").length
  return {
    success: failed === 0,
    message: normalized.dryRun ? `Delete plan complete: ${results.length} item(s).` : `Delete complete: ${results.length - failed} succeeded, ${failed} failed.`,
    data: { ...dataWithWallpapers(wallpapers, wallpapers), deleteResults: results, successCount: results.length - failed, failedCount: failed, errors: results.filter((item) => item.status === "error").map((item) => item.message) },
  }
}

async function runExport(normalized: NormalizedEngineVInput, runtime: EngineVRuntime, onEvent: (event: NodeRunEvent) => void): Promise<EngineVResult> {
  if (!normalized.exportPath) return failure("Export path is required.")
  const wallpapers = await loadWallpapers(normalized, runtime, onEvent)
  const filtered = sortWallpapers(filterWallpapers(wallpapers, normalized.filters), normalized.sortField, normalized.sortOrder)
  const content = normalized.exportFormat === "paths"
    ? `${filtered.map((wallpaper) => wallpaper.path).join("\n")}\n`
    : `${JSON.stringify(filtered, null, 2)}\n`
  await runtime.ensureDir(runtime.dirname(normalized.exportPath))
  await runtime.writeText(normalized.exportPath, content)
  return success(`Export complete: ${filtered.length} item(s).`, { ...dataWithWallpapers(wallpapers, filtered), exportPath: normalized.exportPath })
}

async function loadWallpapers(normalized: NormalizedEngineVInput, runtime: EngineVRuntime, onEvent: (event: NodeRunEvent) => void): Promise<EngineVWallpaper[]> {
  if (normalized.wallpapers.length) return normalized.wallpapers
  if (!normalized.workshopPath) throw new Error("Workshop path or wallpapers are required.")
  return scanWorkshop(normalized.workshopPath, runtime, onEvent)
}

async function folderSize(path: string, runtime: EngineVRuntime): Promise<number> {
  let total = 0
  for (const entry of await runtime.listDir(path)) {
    if (entry.isFile) total += entry.size
    else if (entry.isDirectory) total += await folderSize(entry.path, runtime)
  }
  return total
}

function selectWallpapers(wallpapers: EngineVWallpaper[], ids: string[], requireIds: boolean): EngineVWallpaper[] {
  if (!ids.length) return requireIds ? [] : wallpapers
  const selected = new Set(ids)
  return wallpapers.filter((wallpaper) => selected.has(wallpaper.workshopId))
}

async function uniqueFolderPath(path: string, planned: Set<string>, runtime: Pick<EngineVRuntime, "pathInfo" | "dirname" | "join">): Promise<string> {
  let candidate = path
  let suffix = 1
  while (planned.has(candidate) || (await runtime.pathInfo(candidate)).exists) {
    candidate = `${path}_${suffix}`
    suffix += 1
  }
  return candidate
}

function dataWithWallpapers(wallpapers: EngineVWallpaper[], filteredWallpapers: EngineVWallpaper[]): EngineVData {
  return emptyData({
    wallpapers,
    filteredWallpapers,
    totalCount: wallpapers.length,
    filteredCount: filteredWallpapers.length,
    ...calculateStats(wallpapers),
  })
}

function success(message: string, data: EngineVData): EngineVResult {
  return { success: true, message, data }
}

function failure(message: string): EngineVResult {
  return { success: false, message, data: emptyData({ errors: [message], failedCount: 1 }) }
}

function emptyData(partial: Partial<EngineVData> = {}): EngineVData {
  return {
    wallpapers: [],
    filteredWallpapers: [],
    totalCount: 0,
    filteredCount: 0,
    successCount: 0,
    failedCount: 0,
    typeStats: {},
    ratingStats: {},
    renameResults: [],
    deleteResults: [],
    exportPath: "",
    errors: [],
    ...partial,
  }
}

function normalizeWallpapers(value: Array<EngineVWallpaper | Record<string, unknown>>): EngineVWallpaper[] {
  return value.map((item) => {
    const record = item as Record<string, unknown>
    return {
      path: stringValue(record.path),
      folderName: stringValue(record.folderName ?? record.folder_name),
      workshopId: stringValue(record.workshopId ?? record.workshop_id),
      title: stringValue(record.title),
      description: stringValue(record.description),
      contentRating: stringValue(record.contentRating ?? record.content_rating),
      ratingSex: stringValue(record.ratingSex ?? record.rating_sex),
      ratingViolence: stringValue(record.ratingViolence ?? record.rating_violence),
      tags: Array.isArray(record.tags) ? record.tags.map(String) : [],
      fileName: stringValue(record.fileName ?? record.file_name),
      preview: stringValue(record.preview),
      wallpaperType: stringValue(record.wallpaperType ?? record.wallpaper_type),
      createdTime: stringValue(record.createdTime ?? record.created_time),
      modifiedTime: stringValue(record.modifiedTime ?? record.modified_time),
      size: Number(record.size ?? 0),
      projectData: asRecord(record.projectData ?? record.project_data),
    }
  }).filter((item) => item.path && item.workshopId)
}

function normalizeIds(value: string[] | string | undefined): string[] {
  if (Array.isArray(value)) return unique(value.map(clean).filter(Boolean))
  if (typeof value === "string") return unique(value.split(/[,;\s]+/).map(clean).filter(Boolean))
  return []
}

function normalizeTags(value: string[] | string | undefined): string[] {
  if (Array.isArray(value)) return value.map(String).map(clean).filter(Boolean)
  if (typeof value === "string") return value.split(/[,;\s]+/).map(clean).filter(Boolean)
  return []
}

function sanitizePathSegment(value: string): string {
  return value
    .replace(/[<>:"\/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
}

function pathName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value)
}

function clean(value = ""): string {
  return value.trim().replace(/^["']|["']$/g, "")
}

function unique(values: string[]): string[] {
  const seen = new Set<string>()
  return values.filter((value) => {
    if (!value || seen.has(value)) return false
    seen.add(value)
    return true
  })
}

import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"

export type FindzAction = "search" | "nested" | "archives_only" | "refine" | "help"
export type FindzFilterMode = "auto" | "sql" | "json"
export type FindzOutputFormat = "text" | "json" | "csv" | "efu"
export type FindzGroupField = "archive" | "ext" | "dir" | string

export interface FindzInput {
  action?: FindzAction
  path?: string
  paths?: string[]
  pathText?: string
  where?: string
  filterConfig?: unknown
  filterMode?: FindzFilterMode
  followSymlinks?: boolean
  noArchive?: boolean
  longFormat?: boolean
  maxResults?: number
  maxReturnFiles?: number
  continueOnError?: boolean
  withImageMeta?: boolean
  groupBy?: FindzGroupField
  refine?: string
  sortBy?: "name" | "count" | "totalSize" | "avgSize"
  sortDesc?: boolean
  outputFormat?: FindzOutputFormat
  outputPath?: string
  archiveSeparator?: string
  printZero?: boolean
}

export interface FindzFileData {
  name: string
  path: string
  size: number
  sizeFormatted: string
  modTime: string
  date: string
  time: string
  type: "file" | "dir" | "link"
  container: string
  archive: string
  ext: string
  ext2: string
  width?: number
  height?: number
  resolution?: string
  megapixels?: number
  aspectRatio?: number
  hasNested?: boolean
}

export interface FindzGroup {
  key: string
  name: string
  count: number
  totalSize: number
  avgSize: number
  totalSizeFormatted: string
  avgSizeFormatted: string
  files: FindzFileData[]
}

export interface FindzData {
  action: FindzAction
  totalCount: number
  fileCount: number
  dirCount: number
  archiveCount: number
  nestedCount: number
  files: FindzFileData[]
  groups: FindzGroup[]
  byExtension: Record<string, number>
  byArchive: Record<string, number>
  errors: string[]
  paths: string[]
  where: string
  scannedFiles: number
  elapsedMs: number
  truncated: boolean
  returnedCount: number
  outputText?: string
  outputPath?: string
}

export type FindzResult = NodeRunResult<FindzData>

export interface FindzFileStat {
  exists: boolean
  isDirectory: boolean
  isFile: boolean
  isSymbolicLink?: boolean
  size: number
  mtimeMs: number
  ctimeMs?: number
}

export interface FindzDirEntry {
  name: string
  path: string
  isDirectory: boolean
  isFile: boolean
  isSymbolicLink?: boolean
  stat?: FindzFileStat
}

export interface FindzCommandResult {
  code: number
  stdout: string
  stderr: string
  durationMs?: number
}

export interface FindzRuntime {
  cwd: string
  stat: (path: string) => Promise<FindzFileStat | null>
  readDir: (path: string) => Promise<FindzDirEntry[]>
  readFile: (path: string) => Promise<Uint8Array>
  writeText?: (path: string, content: string) => Promise<void>
  find7z?: () => Promise<string | null>
  runCommand?: (command: string, args: string[], options?: { cwd?: string }) => Promise<FindzCommandResult>
  dirname: (path: string) => string
  basename: (path: string) => string
  extname: (path: string) => string
  join: (...parts: string[]) => string
  resolve: (path: string) => string
}

interface SearchContext {
  input: RequiredSearchOptions
  runtime: FindzRuntime
  filter: CompiledFilter
  errors: string[]
  results: FindzFileData[]
  scannedFiles: number
  stopped: boolean
  imageMetaNeeded: boolean
  onEvent?: (event: NodeRunEvent) => void
  startedAt: number
}

interface RequiredSearchOptions {
  action: FindzAction
  where: string
  paths: string[]
  followSymlinks: boolean
  noArchive: boolean
  maxResults: number
  maxReturnFiles: number
  continueOnError: boolean
  withImageMeta: boolean
  archiveSeparator: string
  longFormat: boolean
  outputFormat: FindzOutputFormat
  groupBy?: FindzGroupField
  refine?: string
  sortBy: "name" | "count" | "totalSize" | "avgSize"
  sortDesc: boolean
  printZero: boolean
  outputPath?: string
}

const ARCHIVE_EXTENSIONS = [".tar.gz", ".tar.bz2", ".tar.xz", ".tgz", ".tbz2", ".txz", ".zip", ".tar", ".7z", ".rar", ".gz", ".bz2", ".xz"]
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp"])

export async function runFindz(input: FindzInput, runtime: FindzRuntime, onEvent?: (event: NodeRunEvent) => void): Promise<FindzResult> {
  const startedAt = Date.now()
  const options = normalizeInput(input, runtime)

  if (options.action === "help") {
    const data = emptyData(options, 0)
    data.outputText = FILTER_HELP
    return { success: true, message: "findz filter help", data }
  }

  try {
    if (options.action === "nested") {
      const data = await runNested(options, runtime, onEvent, startedAt)
      await maybeWriteOutput(data, options, runtime)
      return { success: true, message: `Found ${data.nestedCount} archive(s) containing nested archives.`, data }
    }

    const filter = compileFilterFromInput(input, options.where)
    const context: SearchContext = {
      input: options,
      runtime,
      filter,
      errors: [],
      results: [],
      scannedFiles: 0,
      stopped: false,
      imageMetaNeeded: options.withImageMeta || filter.referencesImageMeta,
      onEvent,
      startedAt,
    }

    emit(onEvent, "progress", 5, "Preparing filter.")
    for (const path of options.paths) {
      if (context.stopped) break
      await scanPath(path, context)
    }

    const data = buildData(options, context.results, context.errors, context.scannedFiles, startedAt)
    if (options.groupBy || options.refine) {
      data.groups = processGroups(data.files, options)
    }
    data.outputText = formatFindzOutput(data, options)
    await maybeWriteOutput(data, options, runtime)
    emit(onEvent, "progress", 100, "findz complete.")
    return { success: true, message: `Found ${data.totalCount} item(s).`, data }
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : String(error), data: emptyData(options, Date.now() - startedAt) }
  }
}

export function parseSize(value: string): number {
  const match = value.trim().match(/^([-+]?\d*\.?\d+)\s*([BKMGT])?$/i)
  if (!match) throw new Error(`Invalid size: ${value}`)
  const units: Record<string, number> = { B: 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 }
  return Math.trunc(Number(match[1]) * units[(match[2] ?? "B").toUpperCase()])
}

export function formatSize(size: number): string {
  if (!size) return "0"
  const units = ["", "K", "M", "G", "T", "P"]
  const index = Math.min(units.length - 1, Math.floor(Math.log(Math.abs(size)) / Math.log(1024)))
  const value = size / (1024 ** index)
  return Number.isInteger(value) ? `${value}${units[index]}` : `${value.toFixed(1)}${units[index]}`
}

export function isArchivePath(path: string): boolean {
  const lower = path.toLowerCase()
  return ARCHIVE_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

export function archiveType(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith(".zip")) return "zip"
  if (lower.endsWith(".7z")) return "7z"
  if (lower.endsWith(".rar")) return "rar"
  if (lower.endsWith(".tar") || lower.endsWith(".tar.gz") || lower.endsWith(".tgz") || lower.endsWith(".tar.bz2") || lower.endsWith(".tbz2") || lower.endsWith(".tar.xz") || lower.endsWith(".txz")) return "tar"
  return ""
}

export function formatFindzOutput(data: FindzData, options: Partial<RequiredSearchOptions> = {}): string {
  const format = options.outputFormat ?? "text"
  if (format === "json") return JSON.stringify(data, null, 2)
  if (format === "csv") return toCsv(data.files)
  if (format === "efu") return toEfu(data.files)
  const separator = options.archiveSeparator ?? "//"
  const lineSeparator = options.printZero ? "\0" : "\n"
  const lines = data.files.map((file) => {
    const path = formatFoundPath(file, separator)
    return options.longFormat ? `${file.date} ${file.time} ${file.sizeFormatted.padStart(10, " ")} ${path}` : path
  })
  return lines.join(lineSeparator)
}

export function formatFoundPath(file: Pick<FindzFileData, "container" | "path">, separator = "//"): string {
  return file.container ? `${file.container}${separator}${file.path}` : file.path
}

export function groupFindzFiles(files: FindzFileData[], field: FindzGroupField): FindzGroup[] {
  const groups = new Map<string, FindzGroup>()
  for (const file of files) {
    const key = groupKey(file, field)
    if (!key) continue
    const current = groups.get(key) ?? { key, name: key.split(/[\\/]/).pop() || key, count: 0, totalSize: 0, avgSize: 0, totalSizeFormatted: "0", avgSizeFormatted: "0", files: [] }
    current.count += 1
    current.totalSize += file.size
    current.files.push(file)
    groups.set(key, current)
  }
  return [...groups.values()].map((group) => ({
    ...group,
    avgSize: group.count ? group.totalSize / group.count : 0,
    totalSizeFormatted: formatSize(group.totalSize),
    avgSizeFormatted: formatSize(Math.trunc(group.count ? group.totalSize / group.count : 0)),
  }))
}

export function refineGroups(groups: FindzGroup[], filterExpr?: string): FindzGroup[] {
  if (!filterExpr?.trim()) return groups
  const conditions = parseRefineFilter(filterExpr)
  return groups.filter((group) => conditions.every((condition) => compareRefine(group, condition.field, condition.op, condition.value)))
}

function normalizeInput(input: FindzInput, runtime: FindzRuntime): RequiredSearchOptions {
  const paths = collectPaths(input, runtime)
  return {
    action: input.action ?? "search",
    where: input.where?.trim() || "1",
    paths,
    followSymlinks: input.followSymlinks ?? false,
    noArchive: input.noArchive ?? false,
    maxResults: Math.max(0, input.maxResults ?? 0),
    maxReturnFiles: Math.max(0, input.maxReturnFiles ?? 5000),
    continueOnError: input.continueOnError ?? true,
    withImageMeta: input.withImageMeta ?? false,
    archiveSeparator: input.archiveSeparator || "//",
    longFormat: input.longFormat ?? true,
    outputFormat: input.outputFormat ?? "text",
    groupBy: input.groupBy,
    refine: input.refine,
    sortBy: input.sortBy ?? "avgSize",
    sortDesc: input.sortDesc ?? true,
    printZero: input.printZero ?? false,
    outputPath: input.outputPath,
  }
}

function collectPaths(input: FindzInput, runtime: FindzRuntime): string[] {
  const raw = [
    ...(input.paths ?? []),
    ...(input.pathText ?? "").split(/\r?\n|[;]/),
    ...(input.path ? [input.path] : []),
  ].map((path) => path.trim().replace(/^["']|["']$/g, "")).filter(Boolean)
  return raw.length ? [...new Set(raw)] : [runtime.cwd || "."]
}

async function scanPath(path: string, context: SearchContext): Promise<void> {
  const stat = await context.runtime.stat(path)
  if (!stat) {
    handleError(context, `Path not found: ${path}`)
    return
  }

  if (stat.isDirectory) {
    const dirInfo = await createFileData(path, stat, "", "", context)
    if (context.input.action !== "archives_only") await testAndPush(dirInfo, context)
    await scanDirectory(path, context)
    return
  }

  const fileInfo = await createFileData(path, stat, "", "", context)
  await processFile(fileInfo, context)
}

async function scanDirectory(path: string, context: SearchContext): Promise<void> {
  if (context.stopped) return
  let entries: FindzDirEntry[]
  try {
    entries = await context.runtime.readDir(path)
  } catch (error) {
    handleError(context, `${path}: ${messageOf(error)}`)
    return
  }

  entries.sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of entries) {
    if (context.stopped) break
    const stat = entry.stat ?? await context.runtime.stat(entry.path)
    if (!stat) continue
    const info = await createFileData(entry.path, stat, "", "", context, entry.name)
    if (stat.isDirectory) {
      if (context.input.action !== "archives_only") await testAndPush(info, context)
      await scanDirectory(entry.path, context)
    } else {
      await processFile(info, context)
    }
  }
}

async function processFile(file: FindzFileData, context: SearchContext): Promise<void> {
  context.scannedFiles += 1
  if (context.scannedFiles % 250 === 0) {
    emit(context.onEvent, "progress", progressFromScanned(context.scannedFiles), `Scanned ${context.scannedFiles} item(s), ${context.results.length} match(es).`)
  }

  if (context.input.action === "archives_only") {
    if (isArchivePath(file.path)) await testAndPush(file, context)
    return
  }

  await testAndPush(file, context)
  if (context.stopped || context.input.noArchive || file.type !== "file" || !isArchivePath(file.path)) return

  const archive = archiveType(file.path)
  const entries = await listArchiveEntries(file.path, archive, context.runtime, context.errors)
  for (const entry of entries) {
    if (context.stopped) break
    if (context.imageMetaNeeded && IMAGE_EXTENSIONS.has(entry.ext)) {
      // Archive image dimensions require decompression; ZIP/TAR listing intentionally stays metadata-only.
    }
    await testAndPush(entry, context)
  }
}

async function testAndPush(file: FindzFileData, context: SearchContext): Promise<void> {
  if (context.stopped) return
  const matches = context.filter.test(file)
  if (!matches) return
  context.results.push(file)
  if (context.input.maxResults > 0 && context.results.length >= context.input.maxResults) {
    context.stopped = true
  }
}

async function createFileData(path: string, stat: FindzFileStat, container: string, archive: string, context: SearchContext, forcedName?: string): Promise<FindzFileData> {
  const name = forcedName || context.runtime.basename(path)
  const ext = extensionOf(name)
  const date = new Date(stat.mtimeMs || Date.now())
  const data: FindzFileData = {
    name,
    path,
    size: stat.size,
    sizeFormatted: formatSize(stat.size),
    modTime: date.toISOString(),
    date: isoDate(date),
    time: isoTime(date),
    type: stat.isDirectory ? "dir" : stat.isSymbolicLink ? "link" : "file",
    container,
    archive,
    ext,
    ext2: longExtensionOf(name),
  }

  if (context.imageMetaNeeded && data.type === "file" && !container && IMAGE_EXTENSIONS.has(ext)) {
    try {
      const dims = readImageDimensions(await context.runtime.readFile(path), name)
      if (dims) Object.assign(data, dimsToFileFields(dims))
    } catch {
      // Image metadata is optional.
    }
  }
  return data
}

async function listArchiveEntries(path: string, type: string, runtime: FindzRuntime, errors: string[]): Promise<FindzFileData[]> {
  try {
    const bytes = await runtime.readFile(path)
    if (type === "zip") return parseZipEntries(bytes, path)
    if (type === "tar") return parseTarEntries(bytes, path)
  } catch (error) {
    errors.push(`${path}: ${messageOf(error)}`)
    return []
  }

  if ((type === "7z" || type === "rar") && runtime.find7z && runtime.runCommand) {
    const sevenZip = await runtime.find7z()
    if (!sevenZip) {
      errors.push(`${path}: 7-Zip was not found for ${type} listing.`)
      return []
    }
    const result = await runtime.runCommand(sevenZip, ["l", "-slt", path])
    if (result.code !== 0) {
      errors.push(`${path}: ${result.stderr || result.stdout || `7z exited ${result.code}`}`)
      return []
    }
    return parse7zSlt(result.stdout, path, type)
  }

  return []
}

export function parseZipEntries(bytes: Uint8Array, container: string): FindzFileData[] {
  const view = viewOf(bytes)
  const eocd = findEndOfCentralDirectory(view)
  if (eocd < 0) return []
  const total = view.getUint16(eocd + 10, true)
  const centralOffset = view.getUint32(eocd + 16, true)
  const entries: FindzFileData[] = []
  let offset = centralOffset

  for (let index = 0; index < total && offset + 46 <= bytes.length; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) break
    const flags = view.getUint16(offset + 8, true)
    const dosTime = view.getUint16(offset + 12, true)
    const dosDate = view.getUint16(offset + 14, true)
    const size = view.getUint32(offset + 24, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const nameBytes = bytes.slice(offset + 46, offset + 46 + nameLength)
    const path = decodeArchiveName(nameBytes, Boolean(flags & 0x800))
    const isDir = path.endsWith("/")
    const date = dosDateTimeToDate(dosDate, dosTime)
    entries.push(archiveEntry(container, "zip", path.replace(/\/$/, ""), isDir ? "dir" : "file", size, date))
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

export function parseTarEntries(bytes: Uint8Array, container: string): FindzFileData[] {
  const entries: FindzFileData[] = []
  for (let offset = 0; offset + 512 <= bytes.length; offset += 512) {
    const header = bytes.slice(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    const name = readNullString(header.slice(0, 100))
    if (!name) break
    const prefix = readNullString(header.slice(345, 500))
    const fullPath = prefix ? `${prefix}/${name}` : name
    const size = parseOctal(readNullString(header.slice(124, 136)))
    const mtime = parseOctal(readNullString(header.slice(136, 148)))
    const typeFlag = String.fromCharCode(header[156] ?? 48)
    const isDir = typeFlag === "5" || fullPath.endsWith("/")
    entries.push(archiveEntry(container, "tar", fullPath.replace(/\/$/, ""), isDir ? "dir" : "file", size, new Date(mtime * 1000)))
    offset += Math.ceil(size / 512) * 512
  }
  return entries
}

export function parse7zSlt(text: string, container: string, archive: string): FindzFileData[] {
  const entries: FindzFileData[] = []
  let current: Record<string, string> = {}

  function flush() {
    if (!current.Path || current.Path === container) {
      current = {}
      return
    }
    const path = current.Path
    const isDir = /D/.test(current.Attributes ?? "") || path.endsWith("/")
    const size = Number(current.Size ?? 0) || 0
    const date = current.Modified ? new Date(current.Modified.replace(" ", "T")) : new Date()
    entries.push(archiveEntry(container, archive, path.replace(/\/$/, ""), isDir ? "dir" : "file", size, Number.isNaN(date.getTime()) ? new Date() : date))
    current = {}
  }

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) {
      flush()
      continue
    }
    const match = line.match(/^([^=]+)=\s*(.*)$/)
    if (!match) continue
    current[match[1].trim()] = match[2].trim()
  }
  flush()
  return entries
}

function archiveEntry(container: string, archive: string, path: string, type: "file" | "dir" | "link", size: number, date: Date): FindzFileData {
  const name = archiveBasename(path)
  const ext = extensionOf(name)
  return {
    name,
    path,
    size,
    sizeFormatted: formatSize(size),
    modTime: date.toISOString(),
    date: isoDate(date),
    time: isoTime(date),
    type,
    container,
    archive,
    ext,
    ext2: longExtensionOf(name),
  }
}

async function runNested(options: RequiredSearchOptions, runtime: FindzRuntime, onEvent: ((event: NodeRunEvent) => void) | undefined, startedAt: number): Promise<FindzData> {
  const nested = new Map<string, FindzFileData>()
  const errors: string[] = []
  let scanned = 0
  const filter = compileSqlFilter("1")
  const context: SearchContext = {
    input: { ...options, action: "search", noArchive: false, maxResults: 0 },
    runtime,
    filter,
    errors,
    results: [],
    scannedFiles: 0,
    stopped: false,
    imageMetaNeeded: false,
    onEvent,
    startedAt,
  }

  for (const path of options.paths) {
    await scanPath(path, context)
  }

  for (const file of context.results) {
    scanned += 1
    if (file.container && isArchivePath(file.name) && !nested.has(file.container)) {
      const stat = await runtime.stat(file.container)
      const date = new Date(stat?.mtimeMs ?? Date.now())
      nested.set(file.container, {
        name: runtime.basename(file.container),
        path: file.container,
        size: stat?.size ?? 0,
        sizeFormatted: formatSize(stat?.size ?? 0),
        modTime: date.toISOString(),
        date: isoDate(date),
        time: isoTime(date),
        type: "file",
        container: "",
        archive: archiveType(file.container),
        ext: extensionOf(file.container),
        ext2: longExtensionOf(file.container),
        hasNested: true,
      })
    }
  }

  const data = buildData({ ...options, action: "nested" }, [...nested.values()], errors, scanned, startedAt)
  data.nestedCount = data.files.length
  data.outputText = formatFindzOutput(data, options)
  return data
}

function buildData(options: RequiredSearchOptions, results: FindzFileData[], errors: string[], scannedFiles: number, startedAt: number): FindzData {
  const maxReturn = options.maxReturnFiles
  const files = maxReturn > 0 ? results.slice(0, maxReturn) : results
  const byExtension: Record<string, number> = {}
  const byArchive: Record<string, number> = {}
  let fileCount = 0
  let dirCount = 0
  let archiveCount = 0

  for (const file of results) {
    byExtension[file.ext] = (byExtension[file.ext] ?? 0) + 1
    if (file.container) {
      byArchive[file.container] = (byArchive[file.container] ?? 0) + 1
      archiveCount += 1
    }
    if (file.type === "dir") dirCount += 1
    else fileCount += 1
  }

  return {
    action: options.action,
    totalCount: results.length,
    fileCount,
    dirCount,
    archiveCount,
    nestedCount: options.action === "nested" ? results.length : 0,
    files,
    groups: [],
    byExtension,
    byArchive,
    errors: errors.slice(0, 50),
    paths: options.paths,
    where: options.where,
    scannedFiles,
    elapsedMs: Date.now() - startedAt,
    truncated: files.length < results.length,
    returnedCount: files.length,
  }
}

function emptyData(options: RequiredSearchOptions, elapsedMs: number): FindzData {
  return {
    action: options.action,
    totalCount: 0,
    fileCount: 0,
    dirCount: 0,
    archiveCount: 0,
    nestedCount: 0,
    files: [],
    groups: [],
    byExtension: {},
    byArchive: {},
    errors: [],
    paths: options.paths,
    where: options.where,
    scannedFiles: 0,
    elapsedMs,
    truncated: false,
    returnedCount: 0,
  }
}

function processGroups(files: FindzFileData[], options: RequiredSearchOptions): FindzGroup[] {
  let groups = options.groupBy ? groupFindzFiles(files, options.groupBy) : groupFindzFiles(files, "dir")
  groups = refineGroups(groups, options.refine)
  groups.sort((left, right) => {
    const a = left[options.sortBy]
    const b = right[options.sortBy]
    if (typeof a === "string" || typeof b === "string") return String(a).localeCompare(String(b)) * (options.sortDesc ? -1 : 1)
    return ((b as number) - (a as number)) * (options.sortDesc ? 1 : -1)
  })
  return groups
}

async function maybeWriteOutput(data: FindzData, options: RequiredSearchOptions, runtime: FindzRuntime): Promise<void> {
  if (!options.outputPath || !runtime.writeText) return
  const content = data.outputText ?? formatFindzOutput(data, options)
  await runtime.writeText(options.outputPath, content)
  data.outputPath = options.outputPath
}

function handleError(context: SearchContext, message: string) {
  if (context.input.continueOnError) {
    context.errors.push(message)
    return
  }
  throw new Error(message)
}

function progressFromScanned(scanned: number): number {
  return Math.min(95, 5 + Math.round(90 * (1 - 1 / (1 + scanned / 10_000))))
}

function emit(onEvent: ((event: NodeRunEvent) => void) | undefined, type: NodeRunEvent["type"], progress: number, message: string) {
  onEvent?.({ type, progress, message })
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function groupKey(file: FindzFileData, field: FindzGroupField): string {
  if (field === "archive") return file.container
  if (field === "ext") return file.ext || "(none)"
  if (field === "dir") {
    const full = formatFoundPath(file)
    const index = Math.max(full.lastIndexOf("/"), full.lastIndexOf("\\"))
    return index >= 0 ? full.slice(0, index) : "(root)"
  }
  return String((file as unknown as Record<string, unknown>)[field] ?? "")
}

function extensionOf(name: string): string {
  const base = archiveBasename(name)
  const index = base.lastIndexOf(".")
  return index >= 0 ? base.slice(index + 1).toLowerCase() : ""
}

function longExtensionOf(name: string): string {
  const parts = archiveBasename(name).split(".")
  if (parts.length >= 3) return parts.slice(-2).join(".").toLowerCase()
  return parts.length === 2 ? parts[1].toLowerCase() : ""
}

function archiveBasename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function isoTime(date: Date): string {
  return date.toISOString().slice(11, 19)
}

function toCsv(files: FindzFileData[]): string {
  const fields = ["name", "path", "container", "size", "date", "time", "ext", "ext2", "type", "archive"]
  const rows = [fields.join(",")]
  for (const file of files) {
    const source = file as unknown as Record<string, unknown>
    rows.push(fields.map((field) => csvCell(String(source[field] ?? ""))).join(","))
  }
  return rows.join("\n")
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, "\"\"")}"` : value
}

function toEfu(files: FindzFileData[]): string {
  const rows = ["Filename,Size,Date Modified,Date Created,Attributes"]
  for (const file of files) {
    if (file.container) continue
    rows.push([csvCell(file.path), file.size, 0, 0, 32].join(","))
  }
  return rows.join("\n")
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function findEndOfCentralDirectory(view: DataView): number {
  for (let offset = view.byteLength - 22; offset >= Math.max(0, view.byteLength - 65_557); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset
  }
  return -1
}

function decodeArchiveName(bytes: Uint8Array, utf8: boolean): string {
  const decoder = new TextDecoder(utf8 ? "utf-8" : "latin1")
  return decoder.decode(bytes)
}

function dosDateTimeToDate(dosDate: number, dosTime: number): Date {
  const day = dosDate & 0x1f
  const month = (dosDate >> 5) & 0x0f
  const year = ((dosDate >> 9) & 0x7f) + 1980
  const second = (dosTime & 0x1f) * 2
  const minute = (dosTime >> 5) & 0x3f
  const hour = (dosTime >> 11) & 0x1f
  return new Date(year, month - 1, day || 1, hour, minute, second)
}

function readNullString(bytes: Uint8Array): string {
  const end = bytes.indexOf(0)
  return new TextDecoder().decode(end >= 0 ? bytes.slice(0, end) : bytes).trim()
}

function parseOctal(value: string): number {
  const parsed = Number.parseInt(value.trim() || "0", 8)
  return Number.isFinite(parsed) ? parsed : 0
}

interface ImageDimensions {
  width: number
  height: number
}

export function readImageDimensions(bytes: Uint8Array, name = ""): ImageDimensions | null {
  const view = viewOf(bytes)
  const ext = extensionOf(name)
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { width: view.getUint32(16, false), height: view.getUint32(20, false) }
  }
  if (bytes.length >= 10 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) }
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) return null
      const marker = bytes[offset + 1]
      const length = view.getUint16(offset + 2, false)
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { height: view.getUint16(offset + 5, false), width: view.getUint16(offset + 7, false) }
      }
      offset += 2 + length
    }
  }
  if (ext === "webp" && bytes.length >= 30 && readAscii(bytes, 0, 4) === "RIFF" && readAscii(bytes, 8, 4) === "WEBP") {
    const chunk = readAscii(bytes, 12, 4)
    if (chunk === "VP8X") return { width: 1 + view.getUint32(24, true) % 0x1000000, height: 1 + view.getUint32(27, true) % 0x1000000 }
  }
  return null
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length))
}

function dimsToFileFields(dims: ImageDimensions) {
  const megapixels = Math.round((dims.width * dims.height / 1_000_000) * 100) / 100
  const aspectRatio = Math.round((dims.width / Math.max(dims.height, 1)) * 100) / 100
  return {
    width: dims.width,
    height: dims.height,
    resolution: `${dims.width}x${dims.height}`,
    megapixels,
    aspectRatio,
  }
}

type TokenType = "identifier" | "string" | "number" | "op" | "paren" | "comma" | "eof"
interface Token { type: TokenType; value: string }

type AstNode =
  | { kind: "literal"; value: string | number | boolean }
  | { kind: "symbol"; name: string }
  | { kind: "binary"; op: string; left: AstNode; right: AstNode }
  | { kind: "unary"; op: string; operand: AstNode }
  | { kind: "like"; op: "LIKE" | "ILIKE" | "RLIKE"; left: AstNode; right: AstNode; negated: boolean }
  | { kind: "between"; expr: AstNode; start: AstNode; end: AstNode; negated: boolean }
  | { kind: "in"; expr: AstNode; values: AstNode[]; negated: boolean }

interface EvalValue {
  type: "number" | "text" | "boolean" | "none"
  value: number | string | boolean | null
}

interface CompiledFilter {
  test: (file: FindzFileData) => boolean
  referencesImageMeta: boolean
}

export function compileSqlFilter(where: string): CompiledFilter {
  const parser = new FilterParser(tokenize(where.trim() || "1"))
  const ast = parser.parse()
  const refs = new Set<string>()
  collectSymbols(ast, refs)
  return {
    referencesImageMeta: [...refs].some((item) => ["width", "height", "resolution", "megapixels", "aspect", "aspect_ratio"].includes(item)),
    test(file) {
      return toBool(evalAst(ast, file))
    },
  }
}

function compileFilterFromInput(input: FindzInput, fallbackSql: string): CompiledFilter {
  if (input.filterConfig !== undefined) return compileSqlFilter(jsonToSql(input.filterConfig))
  const mode = input.filterMode ?? "auto"
  const where = fallbackSql || "1"
  if ((mode === "auto" && /^[{\[]/.test(where.trim())) || mode === "json") return compileSqlFilter(jsonToSql(JSON.parse(where)))
  return compileSqlFilter(where === "-" ? "1" : where)
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let index = 0
  while (index < input.length) {
    const char = input[index]
    if (/\s/.test(char)) {
      index += 1
      continue
    }
    if (char === "(" || char === ")") {
      tokens.push({ type: "paren", value: char })
      index += 1
      continue
    }
    if (char === ",") {
      tokens.push({ type: "comma", value: char })
      index += 1
      continue
    }
    if (char === "\"" || char === "'") {
      const quote = char
      let value = ""
      index += 1
      while (index < input.length && input[index] !== quote) {
        if (input[index] === "\\" && index + 1 < input.length) index += 1
        value += input[index]
        index += 1
      }
      index += 1
      tokens.push({ type: "string", value })
      continue
    }
    const two = input.slice(index, index + 2)
    if (["<=", ">=", "!=", "<>"].includes(two)) {
      tokens.push({ type: "op", value: two })
      index += 2
      continue
    }
    if ("=<>".includes(char)) {
      tokens.push({ type: "op", value: char })
      index += 1
      continue
    }
    const rest = input.slice(index)
    const number = rest.match(/^\d+(?:\.\d+)?(?:[BKMGTbkmgt])?/)
    if (number) {
      tokens.push({ type: "number", value: number[0] })
      index += number[0].length
      continue
    }
    const identifier = rest.match(/^[A-Za-z_][A-Za-z0-9_]*/)
    if (identifier) {
      tokens.push({ type: "identifier", value: identifier[0] })
      index += identifier[0].length
      continue
    }
    throw new Error(`Unexpected filter token near: ${rest.slice(0, 20)}`)
  }
  tokens.push({ type: "eof", value: "" })
  return tokens
}

class FilterParser {
  private index = 0
  constructor(private readonly tokens: Token[]) {}

  parse(): AstNode {
    const expr = this.parseOr()
    this.expect("eof")
    return expr
  }

  private parseOr(): AstNode {
    let node = this.parseAnd()
    while (this.matchKeyword("OR")) node = { kind: "binary", op: "OR", left: node, right: this.parseAnd() }
    return node
  }

  private parseAnd(): AstNode {
    let node = this.parseNot()
    while (this.matchKeyword("AND")) node = { kind: "binary", op: "AND", left: node, right: this.parseNot() }
    return node
  }

  private parseNot(): AstNode {
    if (this.matchKeyword("NOT")) return { kind: "unary", op: "NOT", operand: this.parseNot() }
    return this.parsePredicate()
  }

  private parsePredicate(): AstNode {
    const left = this.parsePrimary()
    const negated = this.matchKeyword("NOT")
    if (this.matchKeyword("LIKE") || this.matchKeyword("ILIKE") || this.matchKeyword("RLIKE")) {
      const op = this.previous().value.toUpperCase() as "LIKE" | "ILIKE" | "RLIKE"
      return { kind: "like", op, left, right: this.parsePrimary(), negated }
    }
    if (this.matchKeyword("BETWEEN")) {
      const start = this.parsePrimary()
      this.requireKeyword("AND")
      return { kind: "between", expr: left, start, end: this.parsePrimary(), negated }
    }
    if (this.matchKeyword("IN")) {
      this.expectValue("paren", "(")
      const values: AstNode[] = []
      if (!this.checkValue("paren", ")")) {
        do {
          values.push(this.parsePrimary())
        } while (this.match("comma"))
      }
      this.expectValue("paren", ")")
      return { kind: "in", expr: left, values, negated }
    }
    if (negated) throw new Error("NOT must be followed by LIKE, BETWEEN, or IN")
    if (this.match("op")) return { kind: "binary", op: this.previous().value.toUpperCase(), left, right: this.parsePrimary() }
    return left
  }

  private parsePrimary(): AstNode {
    if (this.match("number")) return { kind: "literal", value: literalNumber(this.previous().value) }
    if (this.match("string")) return { kind: "literal", value: this.previous().value }
    if (this.match("identifier")) {
      const value = this.previous().value
      if (/^true$/i.test(value)) return { kind: "literal", value: true }
      if (/^false$/i.test(value)) return { kind: "literal", value: false }
      return { kind: "symbol", name: value }
    }
    if (this.matchValue("paren", "(")) {
      const expr = this.parseOr()
      this.expectValue("paren", ")")
      return expr
    }
    throw new Error(`Expected expression near ${this.peek().value || "end"}`)
  }

  private match(type: TokenType): boolean {
    if (this.peek().type !== type) return false
    this.index += 1
    return true
  }

  private matchValue(type: TokenType, value: string): boolean {
    if (!this.checkValue(type, value)) return false
    this.index += 1
    return true
  }

  private matchKeyword(value: string): boolean {
    if (this.peek().type !== "identifier" || this.peek().value.toUpperCase() !== value) return false
    this.index += 1
    return true
  }

  private requireKeyword(value: string) {
    if (!this.matchKeyword(value)) throw new Error(`Expected ${value}`)
  }

  private expect(type: TokenType) {
    if (!this.match(type)) throw new Error(`Expected ${type}`)
  }

  private expectValue(type: TokenType, value: string) {
    if (!this.matchValue(type, value)) throw new Error(`Expected ${value}`)
  }

  private checkValue(type: TokenType, value: string): boolean {
    return this.peek().type === type && this.peek().value === value
  }

  private peek(): Token {
    return this.tokens[this.index] ?? { type: "eof", value: "" }
  }

  private previous(): Token {
    return this.tokens[this.index - 1] ?? { type: "eof", value: "" }
  }
}

function literalNumber(value: string): number {
  return /[BKMGT]$/i.test(value) ? parseSize(value) : Math.trunc(Number(value))
}

function evalAst(node: AstNode, file: FindzFileData): EvalValue {
  if (node.kind === "literal") {
    if (typeof node.value === "number") return { type: "number", value: node.value }
    if (typeof node.value === "boolean") return { type: "boolean", value: node.value }
    return { type: "text", value: node.value }
  }
  if (node.kind === "symbol") return symbolValue(node.name, file)
  if (node.kind === "unary") return { type: "boolean", value: !toBool(evalAst(node.operand, file)) }
  if (node.kind === "binary") {
    if (node.op === "AND") return { type: "boolean", value: toBool(evalAst(node.left, file)) && toBool(evalAst(node.right, file)) }
    if (node.op === "OR") return { type: "boolean", value: toBool(evalAst(node.left, file)) || toBool(evalAst(node.right, file)) }
    return { type: "boolean", value: compareValues(evalAst(node.left, file), node.op, evalAst(node.right, file)) }
  }
  if (node.kind === "like") {
    const left = evalAst(node.left, file)
    const right = evalAst(node.right, file)
    const matched = left.type === "text" && right.type === "text" ? matchLike(String(left.value), node.op, String(right.value)) : false
    return { type: "boolean", value: node.negated ? !matched : matched }
  }
  if (node.kind === "between") {
    const expr = evalAst(node.expr, file)
    const start = evalAst(node.start, file)
    const end = evalAst(node.end, file)
    const matched = compareValues(start, "<=", expr) && compareValues(expr, "<=", end)
    return { type: "boolean", value: node.negated ? !matched : matched }
  }
  if (node.kind === "in") {
    const expr = evalAst(node.expr, file)
    const matched = node.values.some((value) => compareValues(expr, "=", evalAst(value, file)))
    return { type: "boolean", value: node.negated ? !matched : matched }
  }
  return none()
}

function symbolValue(name: string, file: FindzFileData): EvalValue {
  const key = name.toLowerCase()
  if (key === "name") return text(file.name)
  if (key === "path") return text(file.path)
  if (key === "size") return number(file.size)
  if (key === "date") return text(file.date)
  if (key === "time") return text(file.time)
  if (key === "ext") return text(file.ext)
  if (key === "ext2") return text(file.ext2)
  if (key === "type") return text(file.type)
  if (key === "container") return text(file.container)
  if (key === "archive") return text(file.archive)
  if (key === "today") return text(isoDate(new Date()))
  if (["mo", "tu", "we", "th", "fr", "sa", "su"].includes(key)) return text(lastWeekday(key))
  if (key === "width") return optionalNumber(file.width)
  if (key === "height") return optionalNumber(file.height)
  if (key === "resolution") return file.resolution ? text(file.resolution) : none()
  if (key === "megapixels") return optionalNumber(file.megapixels)
  if (key === "aspect" || key === "aspect_ratio") return optionalNumber(file.aspectRatio)
  return text(name)
}

function collectSymbols(node: AstNode, refs: Set<string>) {
  if (node.kind === "symbol") refs.add(node.name.toLowerCase())
  else if (node.kind === "binary") {
    collectSymbols(node.left, refs)
    collectSymbols(node.right, refs)
  } else if (node.kind === "unary") collectSymbols(node.operand, refs)
  else if (node.kind === "like") {
    collectSymbols(node.left, refs)
    collectSymbols(node.right, refs)
  } else if (node.kind === "between") {
    collectSymbols(node.expr, refs)
    collectSymbols(node.start, refs)
    collectSymbols(node.end, refs)
  } else if (node.kind === "in") {
    collectSymbols(node.expr, refs)
    node.values.forEach((value) => collectSymbols(value, refs))
  }
}

function compareValues(left: EvalValue, op: string, right: EvalValue): boolean {
  if (left.type === "none" || right.type === "none") return false
  const l = left.value
  const r = right.value
  if (left.type === "number" && right.type === "number") return comparePrimitive(Number(l), op, Number(r))
  if (left.type === "boolean" && right.type === "boolean") return comparePrimitive(Boolean(l) ? 1 : 0, op, Boolean(r) ? 1 : 0)
  return comparePrimitive(String(l), op, String(r))
}

function comparePrimitive<T extends number | string>(left: T, op: string, right: T): boolean {
  if (op === "=") return left === right
  if (op === "!=" || op === "<>") return left !== right
  if (op === "<") return left < right
  if (op === ">") return left > right
  if (op === "<=") return left <= right
  if (op === ">=") return left >= right
  return false
}

function matchLike(value: string, op: "LIKE" | "ILIKE" | "RLIKE", pattern: string): boolean {
  if (op === "RLIKE") return new RegExp(pattern).test(value)
  const regex = `^${escapeRegex(pattern).replace(/%/g, ".*").replace(/_/g, ".")}$`
  return new RegExp(regex, op === "ILIKE" ? "i" : "").test(value)
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function toBool(value: EvalValue): boolean {
  if (value.type === "number") return Number(value.value) !== 0
  if (value.type === "text") return String(value.value) !== ""
  if (value.type === "boolean") return Boolean(value.value)
  return false
}

function number(value: number): EvalValue {
  return { type: "number", value }
}

function optionalNumber(value?: number): EvalValue {
  return typeof value === "number" ? number(value) : none()
}

function text(value: string): EvalValue {
  return { type: "text", value }
}

function none(): EvalValue {
  return { type: "none", value: null }
}

function lastWeekday(day: string): string {
  const indexes: Record<string, number> = { su: 0, mo: 1, tu: 2, we: 3, th: 4, fr: 5, sa: 6 }
  const now = new Date()
  let diff = now.getDay() - indexes[day]
  if (diff <= 0) diff += 7
  const date = new Date(now)
  date.setDate(now.getDate() - diff)
  return isoDate(date)
}

export function jsonToSql(config: unknown): string {
  const data = typeof config === "string" ? JSON.parse(config) as unknown : config
  if (Array.isArray(data)) return jsonToSql({ op: "and", conditions: data })
  if (!isRecord(data)) return "1"
  if (Array.isArray(data.conditions)) {
    const op = String(data.op ?? "and").toUpperCase()
    const parts = data.conditions.map((item) => jsonToSql(item))
    const joined = parts.length ? parts.map((part) => part.includes(" ") ? `(${part})` : part).join(` ${op} `) : "1"
    return data.negated ? `NOT (${joined})` : joined
  }
  const field = String(data.field ?? "")
  const op = String(data.op ?? "=").toLowerCase()
  const value = data.value
  if (!field) return "1"
  if (["=", "!=", "<>", "<", ">", "<=", ">="].includes(op)) return `${field} ${op} ${formatSqlValue(value)}`
  if (["like", "ilike", "rlike"].includes(op)) return `${field} ${op.toUpperCase()} ${formatSqlValue(value)}`
  if (["not_like", "not_ilike", "not_rlike"].includes(op)) return `${field} NOT ${op.replace("not_", "").toUpperCase()} ${formatSqlValue(value)}`
  if (op === "between" || op === "not_between") {
    const values = Array.isArray(value) ? value : [value, data.valueEnd]
    return `${field} ${op === "not_between" ? "NOT " : ""}BETWEEN ${formatSqlValue(values[0])} AND ${formatSqlValue(values[1])}`
  }
  if (op === "in" || op === "not_in") {
    const values = Array.isArray(value) ? value : [value]
    return `${field} ${op === "not_in" ? "NOT " : ""}IN (${values.map(formatSqlValue).join(", ")})`
  }
  return "1"
}

function formatSqlValue(value: unknown): string {
  if (typeof value === "number") return String(value)
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE"
  const textValue = String(value ?? "")
  if (/^(today|mo|tu|we|th|fr|sa|su)$/i.test(textValue)) return textValue.toLowerCase()
  if (/^\d+(?:\.\d+)?[BKMGT]$/i.test(textValue)) return textValue
  return `"${textValue.replace(/"/g, "\\\"")}"`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

interface RefineCondition {
  field: keyof FindzGroup
  op: string
  value: string | number
}

function parseRefineFilter(filter: string): RefineCondition[] {
  return filter.split(/\s+AND\s+/i).map((part) => {
    const match = part.trim().match(/^(\w+)\s*(>=|<=|!=|<>|>|<|=|LIKE|RLIKE)\s*(.+)$/i)
    if (!match) return null
    const field = normalizeRefineField(match[1])
    const op = match[2].toUpperCase()
    const raw = match[3].trim().replace(/^["']|["']$/g, "")
    const value = field === "count" ? Number(raw) : field === "avgSize" || field === "totalSize" ? parseSize(raw) : raw
    return { field, op, value }
  }).filter((item): item is RefineCondition => Boolean(item))
}

function normalizeRefineField(field: string): keyof FindzGroup {
  if (field === "avg_size") return "avgSize"
  if (field === "total_size") return "totalSize"
  return field as keyof FindzGroup
}

function compareRefine(group: FindzGroup, field: keyof FindzGroup, op: string, value: string | number): boolean {
  const current = group[field]
  if (typeof current === "number" && typeof value === "number") return comparePrimitive(current, op, value)
  if (op === "LIKE") return matchLike(String(current), "ILIKE", String(value))
  if (op === "RLIKE") return new RegExp(String(value), "i").test(String(current))
  return comparePrimitive(String(current), op, String(value))
}

const FILTER_HELP = `findz filter syntax

Examples:
  size < 10K
  size BETWEEN 1M AND 1G
  name ILIKE "%cover%"
  name RLIKE "(.*-){2}"
  ext IN ("jpg", "png", "webp")
  archive <> ""
  type = "dir"

Fields:
  name, path, size, date, time, ext, ext2, type, container, archive
  width, height, resolution, megapixels, aspect
`

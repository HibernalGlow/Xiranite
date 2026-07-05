import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"

export type RepackuAction = "analyze" | "compress" | "full" | "single-pack" | "gallery-pack"
export type RepackuCompressMode = "entire" | "selective" | "skip"
export type RepackuOperationStatus = "planned" | "success" | "error" | "skipped"

export interface RepackuInput {
  action?: RepackuAction
  path?: string
  paths?: string[]
  pathText?: string
  configPath?: string
  config_path?: string
  outputPath?: string
  output_path?: string
  types?: string[] | string
  targetFileTypes?: string[] | string
  target_file_types?: string[] | string
  deleteAfter?: boolean
  delete_after?: boolean
  dryRun?: boolean
  dry_run?: boolean
  minCount?: number
  min_count?: number
  galleryMarker?: string
  gallery_marker?: string
}

export interface RepackuPathInfo {
  path: string
  exists: boolean
  isFile: boolean
  isDirectory: boolean
  size: number
}

export interface RepackuDirEntry {
  name: string
  path: string
  isFile: boolean
  isDirectory: boolean
  size: number
}

export interface RepackuCompressionResult {
  success: boolean
  originalSize: number
  compressedSize: number
  error?: string
  command?: string
}

export interface RepackuRuntime {
  pathInfo: (path: string) => Promise<RepackuPathInfo>
  listDir: (path: string) => Promise<RepackuDirEntry[]>
  readText: (path: string) => Promise<string>
  writeText: (path: string, content: string) => Promise<void>
  ensureDir: (path: string) => Promise<void>
  compressWholeFolder: (sourcePath: string, targetPath: string, options: { deleteSource?: boolean }) => Promise<RepackuCompressionResult>
  compressFiles: (sourcePath: string, targetPath: string, extensions: string[], options: { deleteSource?: boolean }) => Promise<RepackuCompressionResult>
  join: (...parts: string[]) => string
  dirname: (path: string) => string
  basename: (path: string) => string
  extname: (path: string) => string
  resolve: (path: string) => string
  now: () => Date
}

export interface RepackuFolderNode {
  path: string
  name: string
  parentPath: string
  depth: number
  weight: number
  totalFiles: number
  totalSize: number
  recursiveSize: number
  sizeMb: number
  compressMode: RepackuCompressMode
  recommendation: string
  fileTypes: Record<string, number>
  fileExtensions: Record<string, number>
  dominantTypes: string[]
  children: RepackuFolderNode[]
}

export interface RepackuConfig {
  folderTree: RepackuFolderNode
  config: {
    timestamp: string
    targetFileTypes: string[]
    minCount: number
  }
}

export interface RepackuOperation {
  mode: Exclude<RepackuCompressMode, "skip">
  sourcePath: string
  targetPath: string
  extensions: string[]
  fileCount: number
  status: RepackuOperationStatus
  originalSize: number
  compressedSize: number
  error?: string
  command?: string
}

export interface RepackuModeStats {
  total: number
  entire: number
  selective: number
  skip: number
}

export interface RepackuData {
  configPath: string
  totalFolders: number
  entireCount: number
  selectiveCount: number
  skipCount: number
  plannedCount: number
  compressedCount: number
  failedCount: number
  skippedCount: number
  totalOperations: number
  galleryCount: number
  folderTree: RepackuFolderNode | null
  operations: RepackuOperation[]
  errors: string[]
}

export type RepackuResult = NodeRunResult<RepackuData>

export const DEFAULT_FILE_TYPES: Record<string, string[]> = {
  text: [".txt", ".md", ".log", ".ini", ".cfg", ".conf", ".json", ".xml", ".yml", ".yaml", ".csv", ".convert", ".sha1"],
  image: [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tiff", ".webp", ".svg", ".ico", ".raw", ".jxl", ".avif", ".psd", ".sha1"],
  video: [".mp4", ".avi", ".mkv", ".mov", ".wmv", ".flv", ".webm", ".m4v", ".mpg", ".mpeg", ".nov"],
  audio: [".mp3", ".wav", ".ogg", ".flac", ".aac", ".wma", ".m4a", ".opus"],
  document: [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".odp"],
  archive: [".zip", ".rar", ".7z", ".tar", ".gz", ".bz2", ".xz", ".iso", ".cbz", ".cbr"],
  code: [".py", ".js", ".html", ".css", ".java", ".c", ".cpp", ".cs", ".php", ".go", ".rs", ".rb", ".ts"],
  font: [".ttf", ".otf", ".woff", ".woff2", ".eot"],
  executable: [".exe", ".dll", ".bat", ".sh", ".msi", ".app", ".apk"],
  model: [".pth", ".h5", ".pb", ".onnx", ".tflite", ".mlmodel", ".pt", ".bin", ".caffemodel"],
}

export const BLACKLIST_KEYWORDS = [
  "node_modules",
  "__pycache__",
  ".git",
  ".svn",
  "tmp",
  "temp",
  "cache",
  "logs",
  ".vscode",
  ".idea",
  ".vs",
  "\u753b\u96c6",
  "\u52a8\u753b",
]

export const DEFAULT_GALLERY_MARKER = ". \u753b\u96c6"
export const IMAGE_EXTENSIONS = DEFAULT_FILE_TYPES.image

interface NormalizedRepackuInput {
  action: RepackuAction
  paths: string[]
  configPath: string
  outputPath: string
  targetFileTypes: string[]
  deleteAfter: boolean
  dryRun: boolean
  minCount: number
  galleryMarker: string
}

interface AnalyzeBundle {
  configPath: string
  config: RepackuConfig
  stats: RepackuModeStats
}

export function normalizeRepackuInput(input: RepackuInput): NormalizedRepackuInput {
  return {
    action: input.action ?? "full",
    paths: normalizePaths(input),
    configPath: clean(input.configPath ?? input.config_path),
    outputPath: clean(input.outputPath ?? input.output_path),
    targetFileTypes: normalizeTypes(input.targetFileTypes ?? input.target_file_types ?? input.types),
    deleteAfter: input.deleteAfter ?? input.delete_after ?? false,
    dryRun: input.dryRun ?? input.dry_run ?? false,
    minCount: Math.max(1, Math.floor(input.minCount ?? input.min_count ?? 2)),
    galleryMarker: clean(input.galleryMarker ?? input.gallery_marker) || DEFAULT_GALLERY_MARKER,
  }
}

export async function runRepacku(
  input: RepackuInput,
  runtime: RepackuRuntime,
  onEvent: (event: NodeRunEvent) => void = () => {},
): Promise<RepackuResult> {
  const normalized = normalizeRepackuInput(input)
  try {
    if (normalized.action === "analyze") return await runAnalyze(normalized, runtime, onEvent)
    if (normalized.action === "compress") return await runCompress(normalized, runtime, onEvent)
    if (normalized.action === "single-pack") return await runSinglePack(normalized, runtime, onEvent)
    if (normalized.action === "gallery-pack") return await runGalleryPack(normalized, runtime, onEvent)
    return await runFull(normalized, runtime, onEvent)
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error))
  }
}

export async function analyzeFolderStructure(
  rootPath: string,
  runtime: RepackuRuntime,
  options: { targetFileTypes?: string[]; minCount?: number } = {},
): Promise<RepackuFolderNode | null> {
  const resolved = runtime.resolve(rootPath)
  const info = await runtime.pathInfo(resolved)
  if (!info.exists || !info.isDirectory) return null
  return analyzeNode(resolved, "", 1, runtime, {
    targetFileTypes: options.targetFileTypes ?? [],
    minCount: Math.max(1, Math.floor(options.minCount ?? 2)),
  })
}

export function createRepackuConfig(
  rootPath: string,
  folderTree: RepackuFolderNode,
  runtime: Pick<RepackuRuntime, "basename" | "join" | "now">,
  options: { targetFileTypes?: string[]; minCount?: number; outputPath?: string } = {},
): { configPath: string; config: RepackuConfig } {
  const configPath = options.outputPath || runtime.join(rootPath, `${runtime.basename(rootPath)}_config.json`)
  return {
    configPath,
    config: {
      folderTree,
      config: {
        timestamp: runtime.now().toISOString(),
        targetFileTypes: options.targetFileTypes ?? [],
        minCount: Math.max(1, Math.floor(options.minCount ?? 2)),
      },
    },
  }
}

export function serializeRepackuConfig(config: RepackuConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`
}

export function parseRepackuConfig(value: string): RepackuConfig {
  const parsed = JSON.parse(value) as unknown
  if (!parsed || typeof parsed !== "object") throw new Error("Invalid repacku config.")
  const record = parsed as Record<string, unknown>
  const folderTree = normalizeFolderNode(record.folderTree ?? record.folder_tree)
  if (!folderTree) throw new Error("Config is missing folderTree.")
  const rawConfig = asRecord(record.config)
  return {
    folderTree,
    config: {
      timestamp: stringValue(rawConfig.timestamp) || new Date(0).toISOString(),
      targetFileTypes: normalizeTypes(rawConfig.targetFileTypes ?? rawConfig.target_file_types),
      minCount: Math.max(1, Math.floor(numberValue(rawConfig.minCount ?? rawConfig.min_count, 2))),
    },
  }
}

export function countCompressionModes(node: RepackuFolderNode | null): RepackuModeStats {
  const stats: RepackuModeStats = { total: 0, entire: 0, selective: 0, skip: 0 }
  if (!node) return stats
  visitFolders(node, (folder) => {
    stats.total += 1
    stats[folder.compressMode] += 1
  })
  return stats
}

export function collectCompressionOperations(config: RepackuConfig, runtime: Pick<RepackuRuntime, "join" | "dirname" | "basename">): RepackuOperation[] {
  const operations: RepackuOperation[] = []
  visitFolders(config.folderTree, (folder) => {
    if (folder.compressMode === "entire") {
      operations.push({
        mode: "entire",
        sourcePath: folder.path,
        targetPath: wholeFolderArchivePath(folder.path, runtime),
        extensions: [],
        fileCount: folder.totalFiles,
        status: "planned",
        originalSize: 0,
        compressedSize: 0,
      })
      return
    }

    if (folder.compressMode === "selective") {
      operations.push({
        mode: "selective",
        sourcePath: folder.path,
        targetPath: runtime.join(folder.path, `${runtime.basename(folder.path)}.zip`),
        extensions: Object.keys(folder.fileExtensions).sort(),
        fileCount: sumCounts(folder.fileExtensions),
        status: "planned",
        originalSize: 0,
        compressedSize: 0,
      })
    }
  })
  return operations
}

export function getFileType(fileName: string): string | null {
  const extension = getExtension(fileName)
  for (const [type, extensions] of Object.entries(DEFAULT_FILE_TYPES)) {
    if (extensions.includes(extension)) return type
  }
  const lower = fileName.toLowerCase()
  if (lower.includes("readme") || lower.includes("license") || lower.includes("changelog")) return "text"
  return null
}

export function isFileInTypes(fileName: string, targetTypes: string[]): boolean {
  if (!targetTypes.length) return true
  const fileType = getFileType(fileName)
  if (fileType) return targetTypes.includes(fileType)
  const extension = getExtension(fileName)
  return targetTypes.some((type) => DEFAULT_FILE_TYPES[type]?.includes(extension))
}

export function isArchiveFile(fileName: string): boolean {
  return isFileInTypes(fileName, ["archive"])
}

export function isBlacklistedPath(path: string): boolean {
  const lower = path.toLowerCase()
  return BLACKLIST_KEYWORDS.some((keyword) => lower.includes(keyword.toLowerCase()))
}

async function runAnalyze(normalized: NormalizedRepackuInput, runtime: RepackuRuntime, onEvent: (event: NodeRunEvent) => void): Promise<RepackuResult> {
  const rootPath = normalized.paths[0]
  if (!rootPath) return failure("Path is required.")
  const bundle = await analyzeToConfig(rootPath, normalized, runtime, onEvent)
  return {
    success: true,
    message: `Analysis complete: ${bundle.stats.total} folder(s).`,
    data: dataFromAnalysis(bundle),
  }
}

async function runFull(normalized: NormalizedRepackuInput, runtime: RepackuRuntime, onEvent: (event: NodeRunEvent) => void): Promise<RepackuResult> {
  const rootPath = normalized.paths[0]
  if (!rootPath) return failure("Path is required.")
  const bundle = await analyzeToConfig(rootPath, normalized, runtime, onEvent)
  const executed = await executeConfig(bundle.config, runtime, normalized, onEvent)
  const merged = mergeData(dataFromAnalysis(bundle), executed)
  return {
    success: executed.failedCount === 0,
    message: normalized.dryRun
      ? `Full plan complete: ${executed.plannedCount} operation(s).`
      : `Full repack complete: ${executed.compressedCount} succeeded, ${executed.failedCount} failed.`,
    data: merged,
  }
}

async function runCompress(normalized: NormalizedRepackuInput, runtime: RepackuRuntime, onEvent: (event: NodeRunEvent) => void): Promise<RepackuResult> {
  let configPath = normalized.configPath
  let config: RepackuConfig

  if (configPath) {
    onEvent({ type: "progress", progress: 10, message: "Reading config." })
    config = parseRepackuConfig(await runtime.readText(configPath))
  } else {
    const rootPath = normalized.paths[0]
    if (!rootPath) return failure("Config path or folder path is required.")
    const bundle = await analyzeToConfig(rootPath, normalized, runtime, onEvent)
    configPath = bundle.configPath
    config = bundle.config
  }

  const executed = await executeConfig(config, runtime, normalized, onEvent)
  return {
    success: executed.failedCount === 0,
    message: normalized.dryRun
      ? `Compression plan complete: ${executed.plannedCount} operation(s).`
      : `Compression complete: ${executed.compressedCount} succeeded, ${executed.failedCount} failed.`,
    data: {
      ...executed,
      configPath,
      folderTree: config.folderTree,
      ...statsToCounts(countCompressionModes(config.folderTree)),
    },
  }
}

async function runSinglePack(normalized: NormalizedRepackuInput, runtime: RepackuRuntime, onEvent: (event: NodeRunEvent) => void): Promise<RepackuResult> {
  const rootPath = normalized.paths[0]
  if (!rootPath) return failure("Path is required.")
  const info = await runtime.pathInfo(rootPath)
  if (!info.exists) return failure(`Path does not exist: ${rootPath}`)
  if (!info.isDirectory) return failure(`Path is not a directory: ${rootPath}`)

  onEvent({ type: "progress", progress: 10, message: "Planning single-pack operations." })
  const operations = await planSinglePackOperations(runtime.resolve(rootPath), runtime)
  const executed = await executeOperations(operations, runtime, normalized, onEvent)
  return {
    success: executed.failedCount === 0,
    message: normalized.dryRun
      ? `Single-pack plan complete: ${executed.plannedCount} operation(s).`
      : `Single-pack complete: ${executed.compressedCount} succeeded, ${executed.failedCount} failed.`,
    data: executed,
  }
}

async function runGalleryPack(normalized: NormalizedRepackuInput, runtime: RepackuRuntime, onEvent: (event: NodeRunEvent) => void): Promise<RepackuResult> {
  const rootPath = normalized.paths[0]
  if (!rootPath) return failure("Path is required.")
  const info = await runtime.pathInfo(rootPath)
  if (!info.exists) return failure(`Path does not exist: ${rootPath}`)
  if (!info.isDirectory) return failure(`Path is not a directory: ${rootPath}`)

  onEvent({ type: "progress", progress: 10, message: "Finding gallery folders." })
  const galleryFolders = await findGalleryFolders(runtime.resolve(rootPath), normalized.galleryMarker, runtime)
  const operations: RepackuOperation[] = []
  for (const folder of galleryFolders) {
    operations.push(...await planSinglePackOperations(folder, runtime))
  }

  const executed = await executeOperations(operations, runtime, normalized, onEvent)
  return {
    success: executed.failedCount === 0,
    message: normalized.dryRun
      ? `Gallery-pack plan complete: ${galleryFolders.length} folder(s), ${executed.plannedCount} operation(s).`
      : `Gallery-pack complete: ${executed.compressedCount} succeeded, ${executed.failedCount} failed.`,
    data: { ...executed, galleryCount: galleryFolders.length },
  }
}

async function analyzeToConfig(
  rootPath: string,
  normalized: NormalizedRepackuInput,
  runtime: RepackuRuntime,
  onEvent: (event: NodeRunEvent) => void,
): Promise<AnalyzeBundle> {
  const resolved = runtime.resolve(rootPath)
  const info = await runtime.pathInfo(resolved)
  if (!info.exists) throw new Error(`Path does not exist: ${rootPath}`)
  if (!info.isDirectory) throw new Error(`Path is not a directory: ${rootPath}`)

  onEvent({ type: "progress", progress: 20, message: "Scanning folder tree." })
  const folderTree = await analyzeFolderStructure(resolved, runtime, {
    targetFileTypes: normalized.targetFileTypes,
    minCount: normalized.minCount,
  })
  if (!folderTree) throw new Error("Folder could not be analyzed.")

  onEvent({ type: "progress", progress: 75, message: "Writing config." })
  const created = createRepackuConfig(resolved, folderTree, runtime, {
    targetFileTypes: normalized.targetFileTypes,
    minCount: normalized.minCount,
    outputPath: normalized.outputPath,
  })
  await runtime.ensureDir(runtime.dirname(created.configPath))
  await runtime.writeText(created.configPath, serializeRepackuConfig(created.config))
  onEvent({ type: "progress", progress: 100, message: "Analysis complete." })
  return {
    configPath: created.configPath,
    config: created.config,
    stats: countCompressionModes(folderTree),
  }
}

async function executeConfig(
  config: RepackuConfig,
  runtime: RepackuRuntime,
  normalized: NormalizedRepackuInput,
  onEvent: (event: NodeRunEvent) => void,
): Promise<RepackuData> {
  const operations = collectCompressionOperations(config, runtime)
  return executeOperations(operations, runtime, normalized, onEvent)
}

async function executeOperations(
  operations: RepackuOperation[],
  runtime: RepackuRuntime,
  normalized: Pick<NormalizedRepackuInput, "deleteAfter" | "dryRun">,
  onEvent: (event: NodeRunEvent) => void,
): Promise<RepackuData> {
  const completed: RepackuOperation[] = []
  if (!operations.length) return emptyData({ operations: [], skippedCount: 0 })

  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index]!
    onEvent({ type: "progress", progress: operationProgress(index, operations.length), message: `${operation.mode}: ${operation.sourcePath}` })

    if (operation.status === "skipped") {
      completed.push(operation)
      continue
    }

    if (normalized.dryRun) {
      completed.push({ ...operation, status: "planned" })
      continue
    }

    try {
      await runtime.ensureDir(runtime.dirname(operation.targetPath))
      const result = operation.mode === "entire"
        ? await runtime.compressWholeFolder(operation.sourcePath, operation.targetPath, { deleteSource: normalized.deleteAfter })
        : await runtime.compressFiles(operation.sourcePath, operation.targetPath, operation.extensions, { deleteSource: normalized.deleteAfter })
      completed.push({
        ...operation,
        status: result.success ? "success" : "error",
        originalSize: result.originalSize,
        compressedSize: result.compressedSize,
        error: result.error,
        command: result.command,
      })
    } catch (error) {
      completed.push({
        ...operation,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  onEvent({ type: "progress", progress: 100, message: "Compression flow complete." })
  return emptyData({
    operations: completed,
    plannedCount: completed.filter((item) => item.status === "planned").length,
    compressedCount: completed.filter((item) => item.status === "success").length,
    failedCount: completed.filter((item) => item.status === "error").length,
    skippedCount: completed.filter((item) => item.status === "skipped").length,
    totalOperations: completed.length,
    errors: completed.filter((item) => item.status === "error").map((item) => `${item.sourcePath}: ${item.error ?? "unknown error"}`),
  })
}

async function analyzeNode(
  folderPath: string,
  parentPath: string,
  depth: number,
  runtime: RepackuRuntime,
  options: { targetFileTypes: string[]; minCount: number },
): Promise<RepackuFolderNode | null> {
  if (isBlacklistedPath(folderPath)) return null

  const entries = await runtime.listDir(folderPath)
  const childEntries = entries.filter((entry) => entry.isDirectory).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }))
  const children: RepackuFolderNode[] = []
  for (const child of childEntries) {
    const childNode = await analyzeNode(child.path, folderPath, depth + 1, runtime, options)
    if (childNode) children.push(childNode)
  }

  const files = entries.filter((entry) => entry.isFile)
  const fileTypes = countFileTypes(files)
  const childBlocksEntire = children.some((child) => child.fileTypes.archive > 0 || child.compressMode === "skip")
  const decision = determineCompressMode(folderPath, files, fileTypes, options.targetFileTypes, childBlocksEntire, options.minCount)
  let compressMode = decision.mode
  if (compressMode === "entire" && children.some((child) => child.compressMode !== "skip")) {
    compressMode = "selective"
  }

  const totalSize = files.reduce((sum, file) => sum + file.size, 0)
  const recursiveSize = totalSize + children.reduce((sum, child) => sum + child.recursiveSize, 0)
  const node: RepackuFolderNode = {
    path: folderPath,
    name: runtime.basename(folderPath),
    parentPath,
    depth,
    weight: depth + (recursiveSize / (1024 ** 3)) * 0.1,
    totalFiles: files.length,
    totalSize,
    recursiveSize,
    sizeMb: totalSize / (1024 ** 2),
    compressMode,
    recommendation: recommendation(fileTypes, compressMode),
    fileTypes,
    fileExtensions: decision.extensions,
    dominantTypes: dominantTypes(fileTypes),
    children: children.sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })),
  }
  return node
}

function determineCompressMode(
  folderPath: string,
  files: RepackuDirEntry[],
  fileTypes: Record<string, number>,
  targetTypes: string[],
  hasChildWithArchive: boolean,
  minCount: number,
): { mode: RepackuCompressMode; extensions: Record<string, number> } {
  if (!files.length || isBlacklistedPath(folderPath)) return { mode: "skip", extensions: {} }

  const hasArchive = (fileTypes.archive ?? 0) > 0
  if (hasArchive || hasChildWithArchive) {
    if (!targetTypes.length) return { mode: "skip", extensions: {} }
    const matching = files.filter((file) => isFileInTypes(file.name, targetTypes))
    if (matching.length >= minCount) return { mode: "selective", extensions: countExtensions(matching) }
    return { mode: "skip", extensions: {} }
  }

  if (!targetTypes.length) {
    return files.length >= minCount ? { mode: "entire", extensions: countExtensions(files) } : { mode: "skip", extensions: {} }
  }

  const matching = files.filter((file) => isFileInTypes(file.name, targetTypes))
  if (matching.length < minCount) return { mode: "skip", extensions: countExtensions(matching) }
  if (matching.length === files.length) return { mode: "entire", extensions: countExtensions(matching) }
  if (targetTypes.includes("image") && allExtendedMedia(files)) return { mode: "entire", extensions: countExtensions(files) }
  return { mode: "selective", extensions: countExtensions(matching) }
}

async function planSinglePackOperations(rootPath: string, runtime: RepackuRuntime): Promise<RepackuOperation[]> {
  const entries = await runtime.listDir(rootPath)
  const operations: RepackuOperation[] = []

  for (const entry of entries.filter((item) => item.isDirectory).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }))) {
    if (await hasInternalArchive(entry.path, runtime)) {
      operations.push({
        mode: "entire",
        sourcePath: entry.path,
        targetPath: runtime.join(rootPath, `${entry.name}.zip`),
        extensions: [],
        fileCount: 0,
        status: "skipped",
        originalSize: 0,
        compressedSize: 0,
        error: "contains_archive",
      })
      continue
    }
    operations.push({
      mode: "entire",
      sourcePath: entry.path,
      targetPath: runtime.join(rootPath, `${entry.name}.zip`),
      extensions: [],
      fileCount: 0,
      status: "planned",
      originalSize: 0,
      compressedSize: 0,
    })
  }

  const looseImages = entries.filter((item) => item.isFile && isFileInTypes(item.name, ["image"]))
  if (looseImages.length) {
    operations.push({
      mode: "selective",
      sourcePath: rootPath,
      targetPath: runtime.join(rootPath, `${runtime.basename(rootPath)}.zip`),
      extensions: [...IMAGE_EXTENSIONS].sort(),
      fileCount: looseImages.length,
      status: "planned",
      originalSize: 0,
      compressedSize: 0,
    })
  }

  return operations
}

async function hasInternalArchive(path: string, runtime: RepackuRuntime): Promise<boolean> {
  for (const entry of await runtime.listDir(path)) {
    if (entry.isFile && isArchiveFile(entry.name)) return true
    if (entry.isDirectory && await hasInternalArchive(entry.path, runtime)) return true
  }
  return false
}

async function findGalleryFolders(rootPath: string, marker: string, runtime: RepackuRuntime): Promise<string[]> {
  const folders: string[] = []
  async function walk(path: string) {
    const entries = await runtime.listDir(path)
    for (const entry of entries) {
      if (!entry.isDirectory) continue
      if (entry.name.includes(marker)) folders.push(entry.path)
      await walk(entry.path)
    }
  }
  await walk(rootPath)
  return folders
}

function countFileTypes(files: RepackuDirEntry[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const file of files) {
    const type = getFileType(file.name)
    if (type) counts[type] = (counts[type] ?? 0) + 1
  }
  return counts
}

function countExtensions(files: RepackuDirEntry[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const file of files) {
    const extension = getExtension(file.name)
    if (extension) counts[extension] = (counts[extension] ?? 0) + 1
  }
  return counts
}

function dominantTypes(fileTypes: Record<string, number>): string[] {
  return Object.entries(fileTypes)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([type]) => type)
}

function recommendation(fileTypes: Record<string, number>, mode: RepackuCompressMode): string {
  const dominant = dominantTypes(fileTypes).join(", ") || "none"
  if (mode === "entire") return `Compress whole folder; dominant types: ${dominant}.`
  if (mode === "selective") return `Compress selected matching files; dominant types: ${dominant}.`
  return `Skip or handle manually; dominant types: ${dominant}.`
}

function allExtendedMedia(files: RepackuDirEntry[]): boolean {
  let hasImage = false
  for (const file of files) {
    const type = getFileType(file.name)
    if (type === "image") hasImage = true
    if (type !== "image" && type !== "document" && type !== "text") return false
  }
  return hasImage
}

function normalizeFolderNode(value: unknown): RepackuFolderNode | null {
  const record = asRecord(value)
  if (!record.path) return null
  const children = Array.isArray(record.children)
    ? record.children.map(normalizeFolderNode).filter((item): item is RepackuFolderNode => Boolean(item))
    : []
  return {
    path: stringValue(record.path),
    name: stringValue(record.name) || stringValue(record.path),
    parentPath: stringValue(record.parentPath ?? record.parent_path),
    depth: numberValue(record.depth, 0),
    weight: numberValue(record.weight, 0),
    totalFiles: numberValue(record.totalFiles ?? record.total_files, 0),
    totalSize: numberValue(record.totalSize ?? record.total_size, 0),
    recursiveSize: numberValue(record.recursiveSize ?? record.recursive_size ?? record.totalSize ?? record.total_size, 0),
    sizeMb: numberValue(record.sizeMb ?? record.size_mb, 0),
    compressMode: normalizeMode(record.compressMode ?? record.compress_mode),
    recommendation: stringValue(record.recommendation),
    fileTypes: numberRecord(record.fileTypes ?? record.file_types),
    fileExtensions: numberRecord(record.fileExtensions ?? record.file_extensions),
    dominantTypes: normalizeTypes(record.dominantTypes ?? record.dominant_types),
    children,
  }
}

function normalizeMode(value: unknown): RepackuCompressMode {
  return value === "entire" || value === "selective" ? value : "skip"
}

function normalizePaths(input: RepackuInput): string[] {
  return unique([
    ...(input.paths ?? []),
    ...(input.path ? [input.path] : []),
    ...(input.pathText ?? "").split(/[\r\n;]/),
  ].map(clean).filter(Boolean))
}

function normalizeTypes(value: unknown): string[] {
  if (Array.isArray(value)) return unique(value.map((item) => clean(String(item))).filter(Boolean))
  if (typeof value === "string") return unique(value.split(/[,;\s]+/).map(clean).filter(Boolean))
  return []
}

function dataFromAnalysis(bundle: AnalyzeBundle): RepackuData {
  return emptyData({
    configPath: bundle.configPath,
    folderTree: bundle.config.folderTree,
    ...statsToCounts(bundle.stats),
  })
}

function statsToCounts(stats: RepackuModeStats): Pick<RepackuData, "totalFolders" | "entireCount" | "selectiveCount" | "skipCount"> {
  return {
    totalFolders: stats.total,
    entireCount: stats.entire,
    selectiveCount: stats.selective,
    skipCount: stats.skip,
  }
}

function mergeData(base: RepackuData, next: RepackuData): RepackuData {
  return {
    ...base,
    plannedCount: next.plannedCount,
    compressedCount: next.compressedCount,
    failedCount: next.failedCount,
    skippedCount: next.skippedCount,
    totalOperations: next.totalOperations,
    galleryCount: next.galleryCount,
    operations: next.operations,
    errors: next.errors,
  }
}

function emptyData(partial: Partial<RepackuData> = {}): RepackuData {
  return {
    configPath: "",
    totalFolders: 0,
    entireCount: 0,
    selectiveCount: 0,
    skipCount: 0,
    plannedCount: 0,
    compressedCount: 0,
    failedCount: 0,
    skippedCount: 0,
    totalOperations: 0,
    galleryCount: 0,
    folderTree: null,
    operations: [],
    errors: [],
    ...partial,
  }
}

function failure(message: string): RepackuResult {
  return { success: false, message, data: emptyData({ errors: [message], failedCount: 1 }) }
}

function visitFolders(node: RepackuFolderNode, visitor: (node: RepackuFolderNode) => void): void {
  visitor(node)
  for (const child of node.children) visitFolders(child, visitor)
}

function wholeFolderArchivePath(folderPath: string, runtime: Pick<RepackuRuntime, "dirname" | "basename" | "join">): string {
  return runtime.join(runtime.dirname(folderPath), `${runtime.basename(folderPath)}.zip`)
}

function operationProgress(index: number, total: number): number {
  return Math.min(99, Math.max(20, 20 + Math.round((index / Math.max(total, 1)) * 75)))
}

function getExtension(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name
  const index = base.lastIndexOf(".")
  return index > 0 ? base.slice(index).toLowerCase() : ""
}

function sumCounts(values: Record<string, number>): number {
  return Object.values(values).reduce((sum, value) => sum + value, 0)
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {}
}

function numberRecord(value: unknown): Record<string, number> {
  const record = asRecord(value)
  const result: Record<string, number> = {}
  for (const [key, raw] of Object.entries(record)) {
    const valueNumber = Number(raw)
    if (Number.isFinite(valueNumber)) result[key] = valueNumber
  }
  return result
}

function numberValue(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : ""
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

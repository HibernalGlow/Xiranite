import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"

export type KavvkaAction = "process" | "plan" | "scan"

export interface KavvkaInput {
  action?: KavvkaAction
  paths?: string[]
  pathText?: string
  scanRoots?: string[]
  scanRootText?: string
  keywords?: string[]
  keywordText?: string
  scanDepth?: number
  force?: boolean
  dryRun?: boolean
  strictArtist?: boolean
}

export interface KavvkaPathInfo {
  path: string
  exists: boolean
  isFile: boolean
  isDirectory: boolean
}

export interface KavvkaDirEntry {
  name: string
  path: string
  isDirectory: boolean
  isFile: boolean
}

export interface KavvkaMoveRecord {
  source: string
  target: string
  success: boolean
  error?: string
}

export interface KavvkaProcessResult {
  path: string
  artistFolder: string
  compareFolder: string
  siblingFolders: string[]
  movedFolders: KavvkaMoveRecord[]
  combinedPath: string
  warnings: string[]
  success: boolean
  error?: string
}

export interface KavvkaScanResult {
  path: string
  name: string
  root: string
}

export interface KavvkaData {
  allCombinedPaths: string[]
  matchedPaths: string[]
  processResults: KavvkaProcessResult[]
  scanResults: KavvkaScanResult[]
  processedCount: number
  movedCount: number
  skippedCount: number
  errorCount: number
  errors: string[]
}

export interface KavvkaRuntime {
  pathInfo: (path: string) => Promise<KavvkaPathInfo>
  listDir: (path: string) => Promise<KavvkaDirEntry[]>
  ensureDir: (path: string) => Promise<void>
  movePath: (source: string, target: string) => Promise<void>
  join: (...parts: string[]) => string
  dirname: (path: string) => string
  basename: (path: string) => string
  normalize: (path: string) => string
  now: () => Date
}

export type KavvkaResult = NodeRunResult<KavvkaData>

export const DEFAULT_KAVVKA_KEYWORDS = [
  ". \u753b\u96c6",
  "\u753b\u96c6",
  "CG",
  "\u56fe\u96c6",
  "\u4f5c\u54c1\u96c6",
  "artbook",
  "gallery",
]

const DOUJIN_KEYWORDS = ["\u540c\u4eba\u5fd7", "doujinshi", "manga", "comic", "(c", "(comic", "(mh", "[dl]"]
const GALLERY_KEYWORDS = ["\u753b\u96c6", "artbook", "illustration", "gallery"]

export function normalizeKavvkaInput(input: KavvkaInput): Required<KavvkaInput> {
  const paths = [...(input.paths ?? []), ...parseKavvkaPaths(input.pathText)]
  const scanRoots = [...(input.scanRoots ?? []), ...parseKavvkaPaths(input.scanRootText)]
  const keywords = [...(input.keywords ?? []), ...parseKavvkaKeywords(input.keywordText)]
  const action = input.action ?? "process"
  return {
    action,
    paths: unique(paths.map(cleanPath).filter(Boolean)),
    pathText: input.pathText ?? "",
    scanRoots: unique(scanRoots.map(cleanPath).filter(Boolean)),
    scanRootText: input.scanRootText ?? "",
    keywords: unique((keywords.length ? keywords : DEFAULT_KAVVKA_KEYWORDS).map((item) => item.trim()).filter(Boolean)),
    keywordText: input.keywordText ?? "",
    scanDepth: Math.max(0, Math.trunc(input.scanDepth ?? 3)),
    force: input.force ?? true,
    dryRun: action === "plan" ? true : input.dryRun ?? false,
    strictArtist: input.strictArtist ?? false,
  }
}

export function parseKavvkaPaths(text?: string): string[] {
  return (text ?? "").split(/\r?\n|[;]/).map(cleanPath).filter(Boolean)
}

export function parseKavvkaKeywords(text?: string): string[] {
  return (text ?? "").split(/[,;\r?\n]/).map((item) => item.trim()).filter(Boolean)
}

export function isKavvkaArtistFolderName(name: string): boolean {
  return name.includes("[") && name.includes("]")
}

export function generateCzkawkaPath(inputFolder: string, compareFolder: string): string {
  return `${toCzkawkaPath(inputFolder)};${toCzkawkaPath(compareFolder)}`
}

export async function runKavvka(
  input: KavvkaInput,
  runtime: KavvkaRuntime,
  onEvent: (event: NodeRunEvent) => void = () => {},
): Promise<KavvkaResult> {
  const normalized = normalizeKavvkaInput(input)
  try {
    if (normalized.action === "scan") return await scanKeywords(normalized, runtime, onEvent)
    return await processPaths(normalized, runtime, onEvent)
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error))
  }
}

export async function scanForKavvkaKeywords(
  root: string,
  keywords: string[],
  maxDepth: number,
  runtime: KavvkaRuntime,
): Promise<KavvkaScanResult[]> {
  const rootInfo = await runtime.pathInfo(root)
  if (!rootInfo.exists || !rootInfo.isDirectory) return []
  const normalizedKeywords = keywords.map((keyword) => keyword.toLowerCase())
  const found: KavvkaScanResult[] = []

  async function walk(current: string, depth: number) {
    if (depth > maxDepth) return
    let entries: KavvkaDirEntry[]
    try {
      entries = await runtime.listDir(current)
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory || entry.name.startsWith(".") || entry.name.startsWith("#")) continue
      const nameLower = entry.name.toLowerCase()
      if (normalizedKeywords.some((keyword) => nameLower.includes(keyword))) {
        found.push({ path: runtime.normalize(entry.path), name: entry.name, root: runtime.normalize(rootInfo.path) })
      }
      if (depth < maxDepth) await walk(entry.path, depth + 1)
    }
  }

  await walk(rootInfo.path, 0)
  return found
}

export async function findKavvkaArtistFolders(path: string, runtime: KavvkaRuntime): Promise<string[]> {
  const info = await runtime.pathInfo(path)
  if (!info.exists) return []
  const basePath = info.isFile && isArchivePath(info.path) ? runtime.dirname(info.path) : info.path
  const candidates: string[] = []

  let current = basePath
  while (true) {
    if (isKavvkaArtistFolderName(runtime.basename(current))) {
      const currentInfo = await runtime.pathInfo(current)
      if (currentInfo.exists && currentInfo.isDirectory) candidates.push(runtime.normalize(currentInfo.path))
    }
    const parent = runtime.dirname(current)
    if (parent === current) break
    current = parent
  }

  const baseInfo = await runtime.pathInfo(basePath)
  if (baseInfo.exists && baseInfo.isDirectory) {
    for (const entry of await safeListDir(baseInfo.path, runtime)) {
      if (entry.isDirectory && isKavvkaArtistFolderName(entry.name)) candidates.push(runtime.normalize(entry.path))
    }
  }

  return unique(candidates)
}

export async function collectKavvkaSiblingFolders(path: string, runtime: KavvkaRuntime): Promise<string[]> {
  const info = await runtime.pathInfo(path)
  if (!info.exists || !info.isDirectory) return []
  const parent = runtime.dirname(info.path)
  const entries = await safeListDir(parent, runtime)
  const own = runtime.normalize(info.path).toLowerCase()
  return entries
    .filter((entry) => entry.isDirectory)
    .filter((entry) => runtime.normalize(entry.path).toLowerCase() !== own)
    .filter((entry) => entry.name !== "#compare")
    .filter((entry) => !isKavvkaArtistFolderName(entry.name))
    .map((entry) => runtime.normalize(entry.path))
}

async function scanKeywords(
  input: Required<KavvkaInput>,
  runtime: KavvkaRuntime,
  onEvent: (event: NodeRunEvent) => void,
): Promise<KavvkaResult> {
  if (!input.scanRoots.length) return failure("At least one scan root is required.")
  const scanResults: KavvkaScanResult[] = []
  const errors: string[] = []

  for (let index = 0; index < input.scanRoots.length; index += 1) {
    const root = input.scanRoots[index]
    onEvent({ type: "progress", progress: Math.round((index / input.scanRoots.length) * 100), message: `Scanning ${runtime.basename(root)}` })
    const info = await runtime.pathInfo(root)
    if (!info.exists || !info.isDirectory) {
      errors.push(`Invalid scan root: ${root}`)
      continue
    }
    scanResults.push(...await scanForKavvkaKeywords(info.path, input.keywords, input.scanDepth, runtime))
  }

  onEvent({ type: "progress", progress: 100, message: "Scan completed." })
  const matchedPaths = unique(scanResults.map((item) => item.path))
  return {
    success: matchedPaths.length > 0,
    message: `Scan completed: ${matchedPaths.length} matching folder(s).`,
    data: data({
      matchedPaths,
      scanResults,
      skippedCount: errors.length,
      errorCount: errors.length,
      errors,
    }),
  }
}

async function processPaths(
  input: Required<KavvkaInput>,
  runtime: KavvkaRuntime,
  onEvent: (event: NodeRunEvent) => void,
): Promise<KavvkaResult> {
  if (!input.paths.length) return failure("At least one source path is required.")
  const processResults: KavvkaProcessResult[] = []
  const errors: string[] = []
  let movedCount = 0
  let processedCount = 0

  for (let index = 0; index < input.paths.length; index += 1) {
    const rawPath = input.paths[index]
    onEvent({ type: "progress", progress: Math.round((index / input.paths.length) * 100), message: `Processing ${runtime.basename(rawPath)}` })
    const result = await buildProcessResult(rawPath, input, runtime)
    if (result.error) errors.push(result.error)
    if (result.success && !input.dryRun) {
      for (const move of result.movedFolders) {
        try {
          await runtime.movePath(move.source, move.target)
          move.success = true
          movedCount += 1
        } catch (error) {
          move.success = false
          move.error = error instanceof Error ? error.message : String(error)
          errors.push(move.error)
        }
      }
    }
    if (result.success) processedCount += 1
    processResults.push(result)
  }

  onEvent({ type: "progress", progress: 100, message: "Process completed." })
  const allCombinedPaths = processResults.filter((item) => item.success).map((item) => item.combinedPath)
  return {
    success: processedCount > 0 && errors.length === 0,
    message: `${input.dryRun ? "Plan" : "Process"} completed: ${processedCount}/${input.paths.length} path(s), ${movedCount} folder(s) moved.`,
    data: data({
      allCombinedPaths,
      processResults,
      processedCount,
      movedCount,
      skippedCount: input.paths.length - processedCount,
      errorCount: errors.length,
      errors,
    }),
  }
}

async function buildProcessResult(path: string, input: Required<KavvkaInput>, runtime: KavvkaRuntime): Promise<KavvkaProcessResult> {
  const info = await runtime.pathInfo(path)
  if (!info.exists || !info.isDirectory) {
    return emptyProcessResult(path, `Source path must be an existing directory: ${path}`)
  }

  const artistFolders = await findKavvkaArtistFolders(info.path, runtime)
  let artistFolder = artistFolders[0] ?? ""
  const warnings: string[] = []
  if (!artistFolder) {
    if (input.strictArtist) return emptyProcessResult(info.path, `No artist folder with [] marker found for: ${info.path}`)
    artistFolder = info.path
    warnings.push("No [] artist folder found; using the input folder as compare base.")
  }

  const compareFolder = runtime.join(artistFolder, "#compare")
  await runtime.ensureDir(compareFolder)
  const siblingFolders = await collectKavvkaSiblingFolders(info.path, runtime)
  warnings.push(...pathMismatchWarnings(info.path, siblingFolders, runtime))
  const movedFolders: KavvkaMoveRecord[] = []

  for (const sibling of siblingFolders) {
    const target = await uniqueTargetPath(runtime.join(compareFolder, runtime.basename(sibling)), runtime)
    movedFolders.push({ source: sibling, target, success: input.dryRun })
  }

  return {
    path: runtime.normalize(info.path),
    artistFolder: runtime.normalize(artistFolder),
    compareFolder: runtime.normalize(compareFolder),
    siblingFolders,
    movedFolders,
    combinedPath: generateCzkawkaPath(info.path, compareFolder),
    warnings,
    success: true,
  }
}

async function uniqueTargetPath(target: string, runtime: KavvkaRuntime): Promise<string> {
  const info = await runtime.pathInfo(target)
  if (!info.exists) return target
  const stamped = `${target}_${timestamp(runtime.now())}`
  if (!(await runtime.pathInfo(stamped)).exists) return stamped
  for (let index = 2; index < 1000; index += 1) {
    const next = `${stamped}_${index}`
    if (!(await runtime.pathInfo(next)).exists) return next
  }
  return `${stamped}_${Math.random().toString(16).slice(2)}`
}

function pathMismatchWarnings(inputPath: string, siblings: string[], runtime: KavvkaRuntime): string[] {
  const inputLower = inputPath.toLowerCase()
  const inputIsDoujin = DOUJIN_KEYWORDS.some((keyword) => inputLower.includes(keyword.toLowerCase()))
  const gallerySiblings = siblings.filter((sibling) => GALLERY_KEYWORDS.some((keyword) => runtime.basename(sibling).toLowerCase().includes(keyword.toLowerCase())))
  if (!inputIsDoujin || !gallerySiblings.length) return []
  return [`Possible doujin/gallery mismatch: ${runtime.basename(inputPath)} would move ${gallerySiblings.length} gallery-like sibling folder(s).`]
}

async function safeListDir(path: string, runtime: KavvkaRuntime): Promise<KavvkaDirEntry[]> {
  try {
    return await runtime.listDir(path)
  } catch {
    return []
  }
}

function emptyProcessResult(path: string, error: string): KavvkaProcessResult {
  return {
    path,
    artistFolder: "",
    compareFolder: "",
    siblingFolders: [],
    movedFolders: [],
    combinedPath: "",
    warnings: [],
    success: false,
    error,
  }
}

function data(partial: Partial<KavvkaData>): KavvkaData {
  return {
    allCombinedPaths: [],
    matchedPaths: [],
    processResults: [],
    scanResults: [],
    processedCount: 0,
    movedCount: 0,
    skippedCount: 0,
    errorCount: 0,
    errors: [],
    ...partial,
  }
}

function success(message: string, partial: Partial<KavvkaData>): KavvkaResult {
  return { success: true, message, data: data(partial) }
}

function failure(message: string): KavvkaResult {
  return { success: false, message, data: data({ errors: [message], errorCount: 1 }) }
}

function cleanPath(path?: string): string {
  return (path ?? "").trim().replace(/^["']|["']$/g, "")
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function isArchivePath(path: string): boolean {
  return /\.(zip|7z|rar)$/i.test(path)
}

function toCzkawkaPath(path: string): string {
  return path.replace(/\\/g, "/")
}

function timestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

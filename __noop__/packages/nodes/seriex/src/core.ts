import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"

export type SeriexAction = "plan" | "execute" | "apply"

export interface SeriexInput {
  action?: SeriexAction
  directoryPath?: string
  configPath?: string
  configText?: string
  threshold?: number
  ratioThreshold?: number
  partialThreshold?: number
  tokenThreshold?: number
  lengthDiffMax?: number
  addPrefix?: boolean
  prefix?: string
  knownSeriesDirs?: string[]
  knownSeriesNames?: string[]
  dryRun?: boolean
}

export interface SeriexDirEntry {
  name: string
  path: string
  isDirectory: boolean
  isFile: boolean
}

export interface SeriexConfig {
  formats: string[]
  archiveFormats: string[]
  prefix: string
  addPrefix: boolean
  checkIntegrity: boolean
  knownSeriesDirs: string[]
  knownSeriesAllowSingle: boolean
}

export interface SimilarityConfig {
  threshold: number
  ratioThreshold: number
  partialThreshold: number
  tokenThreshold: number
  lengthDiffMax: number
}

export interface SeriexPlanItem {
  directory: string
  folder: string
  files: string[]
}

export interface SeriexMoveItem {
  sourcePath: string
  targetPath: string
  folder: string
  filename: string
  success: boolean
  error?: string
}

export interface SeriexData {
  plan: Record<string, Record<string, string[]>>
  summary: Record<string, Record<string, string[]>>
  planItems: SeriexPlanItem[]
  moveItems: SeriexMoveItem[]
  totalSeries: number
  totalFiles: number
  movedCount: number
  failedCount: number
  errors: string[]
}

export interface SeriexRuntime {
  exists: (path: string) => Promise<boolean>
  listDir: (path: string) => Promise<SeriexDirEntry[]>
  ensureDir: (path: string) => Promise<void>
  movePath: (source: string, target: string) => Promise<void>
  readText?: (path: string) => Promise<string | null>
  join: (...parts: string[]) => string
  dirname: (path: string) => string
  basename: (path: string) => string
}

export type SeriexResult = NodeRunResult<SeriexData>

export const SERIEX_PREFIXES = ["[#s]", "#"]

export const DEFAULT_SERIEX_CONFIG: SeriexConfig = {
  formats: [".mp4", ".nov", ".zip", ".rar", ".7z", ".cbz", ".cbr"],
  archiveFormats: [".zip", ".rar", ".7z", ".cbz", ".cbr"],
  prefix: "[#s]",
  addPrefix: true,
  checkIntegrity: false,
  knownSeriesDirs: [],
  knownSeriesAllowSingle: true,
}

export const DEFAULT_SIMILARITY_CONFIG: SimilarityConfig = {
  threshold: 75,
  ratioThreshold: 75,
  partialThreshold: 85,
  tokenThreshold: 80,
  lengthDiffMax: 0.3,
}

export function normalizeSeriexInput(input: SeriexInput): Required<SeriexInput> {
  return {
    action: input.action ?? "plan",
    directoryPath: clean(input.directoryPath),
    configPath: clean(input.configPath),
    configText: input.configText ?? "",
    threshold: finite(input.threshold, DEFAULT_SIMILARITY_CONFIG.threshold),
    ratioThreshold: finite(input.ratioThreshold, DEFAULT_SIMILARITY_CONFIG.ratioThreshold),
    partialThreshold: finite(input.partialThreshold, DEFAULT_SIMILARITY_CONFIG.partialThreshold),
    tokenThreshold: finite(input.tokenThreshold, DEFAULT_SIMILARITY_CONFIG.tokenThreshold),
    lengthDiffMax: finite(input.lengthDiffMax, DEFAULT_SIMILARITY_CONFIG.lengthDiffMax),
    addPrefix: input.addPrefix ?? true,
    prefix: input.prefix ?? "[#s]",
    knownSeriesDirs: (input.knownSeriesDirs ?? []).map((item) => item.trim()).filter(Boolean),
    knownSeriesNames: (input.knownSeriesNames ?? []).map((item) => stripSeriesPrefix(item.trim())).filter(Boolean),
    dryRun: input.dryRun ?? false,
  }
}

export function parseSeriexConfigText(content: string): Partial<SeriexConfig> {
  const result: Partial<SeriexConfig> = {}
  const formats = parseArray(content, "formats")
  const archiveFormats = parseArray(content, "archive_formats")
  const knownSeriesDirs = parseArray(content, "known_series_dirs")
  const prefix = parseString(content, "prefix")
  const addPrefix = parseBoolean(content, "add_prefix")
  const checkIntegrity = parseBoolean(content, "check_integrity")
  const allowSingle = parseBoolean(content, "known_series_allow_single")
  if (formats.length) result.formats = normalizeExtensions(formats)
  if (archiveFormats.length) result.archiveFormats = normalizeExtensions(archiveFormats)
  if (knownSeriesDirs.length) result.knownSeriesDirs = knownSeriesDirs
  if (prefix) result.prefix = prefix
  if (typeof addPrefix === "boolean") result.addPrefix = addPrefix
  if (typeof checkIntegrity === "boolean") result.checkIntegrity = checkIntegrity
  if (typeof allowSingle === "boolean") result.knownSeriesAllowSingle = allowSingle
  return result
}

export function mergeSeriexConfig(base: SeriexConfig, input: Required<SeriexInput>, parsed: Partial<SeriexConfig> = {}): SeriexConfig {
  const config = {
    ...base,
    ...parsed,
    prefix: input.prefix || parsed.prefix || base.prefix,
    addPrefix: input.addPrefix,
    knownSeriesDirs: [...(parsed.knownSeriesDirs ?? base.knownSeriesDirs), ...input.knownSeriesDirs],
  }
  config.formats = normalizeExtensions(config.formats)
  config.archiveFormats = normalizeExtensions(config.archiveFormats).filter((ext) => config.formats.includes(ext))
  config.knownSeriesDirs = [...new Set(config.knownSeriesDirs)]
  return config
}

export function isSeriexSupportedFile(path: string, config: SeriexConfig = DEFAULT_SERIEX_CONFIG): boolean {
  const lower = path.toLowerCase()
  return config.formats.some((ext) => lower.endsWith(ext))
}

export function preprocessSeriesName(filename: string): string {
  let name = stripExtension(baseName(filename))
  name = stripSeriesPrefix(name)
  name = name.replace(/\[.*?\]/g, "")
  name = name.replace(/\(.*?\)/g, "")
  return name.replace(/\s+/g, " ").trim()
}

export function validateSeriesName(name: string): string | null {
  let value = normalizeText(name)
    .replace(/[\s.+_\-~\d]+$/g, "")
    .replace(/\b(vol|volume|part|chapter|ch|ep|episode)\.?\s*\d*$/i, "")
    .trim()
  if (!value || value.length <= 1) return null
  if (/comic/i.test(value)) return null
  const words = value.split(/\s+/)
  if (words.every((word) => word.length <= 1) && words.join("").length <= 3) return null
  if (words.at(-1)?.length === 1 && value.length <= 3) return null
  return value
}

export function findSeriesGroups(
  files: string[],
  options: {
    config?: SeriexConfig
    similarity?: SimilarityConfig
    knownSeries?: string[]
    existingSeries?: string[]
    basename?: (path: string) => string
  } = {},
): Record<string, string[]> {
  const config = options.config ?? DEFAULT_SERIEX_CONFIG
  const similarity = options.similarity ?? DEFAULT_SIMILARITY_CONFIG
  const basename = options.basename ?? baseName
  const groups = new Map<string, Set<string>>()
  const remaining = new Set(files)

  const add = (series: string, file: string) => {
    const valid = validateSeriesName(series)
    if (!valid) return false
    if (!groups.has(valid)) groups.set(valid, new Set())
    groups.get(valid)!.add(file)
    remaining.delete(file)
    return true
  }

  for (const file of [...remaining]) {
    const name = basename(file)
    for (const prefix of SERIEX_PREFIXES) {
      if (name.startsWith(prefix)) {
        add(stripExtension(name.slice(prefix.length)).replace(/\[.*?\]|\(.*?\)/g, "").trim(), file)
        break
      }
    }
  }

  const known = normalizeSeriesList([...(options.knownSeries ?? []), ...(options.existingSeries ?? [])])
  for (const file of [...remaining]) {
    const raw = normalizeText(stripExtension(basename(file))).replace(/\s+/g, "").toLowerCase()
    const hit = known.find((series) => raw.includes(normalizeText(series).replace(/\s+/g, "").toLowerCase()))
    if (hit) add(hit, file)
  }

  while (remaining.size > 1) {
    let bestCommon: string[] = []
    let bestPair: [string, string] | null = null
    for (const fileA of remaining) {
      const keywordsA = keywords(preprocessSeriesName(basename(fileA)))
      for (const fileB of remaining) {
        if (fileA === fileB || sameBase(fileA, fileB, basename)) continue
        const common = longestCommonTokenRun(keywordsA, keywords(preprocessSeriesName(basename(fileB))))
        if (common.length > bestCommon.length && validateSeriesName(common.join(" "))) {
          bestCommon = common
          bestPair = [fileA, fileB]
        }
      }
    }
    if (!bestPair || !bestCommon.length) break
    const series = validateSeriesName(bestCommon.join(" "))
    if (!series) break
    const phrase = bestCommon.join(" ").toLowerCase()
    for (const file of [...remaining]) {
      if (sameBase(file, bestPair[0], basename) && file !== bestPair[0]) continue
      if (preprocessSeriesName(basename(file)).toLowerCase().includes(phrase)) add(series, file)
    }
    add(series, bestPair[0])
    add(series, bestPair[1])
  }

  while (remaining.size > 1) {
    let best: { pair: [string, string]; common: string; score: number; original: string } | null = null
    for (const fileA of remaining) {
      const nameA = normalizeText(preprocessSeriesName(basename(fileA))).toLowerCase()
      for (const fileB of remaining) {
        if (fileA === fileB || sameBase(fileA, fileB, basename)) continue
        const nameB = normalizeText(preprocessSeriesName(basename(fileB))).toLowerCase()
        const common = longestCommonSubstring(nameA, nameB)
        const score = ratioScore(nameA, nameB, common)
        if (common.trim().length > 1 && score > (best?.score ?? 0) && score >= similarity.threshold) {
          best = { pair: [fileA, fileB], common, score, original: common }
        }
      }
    }
    const series = best ? validateSeriesName(best.original) : null
    if (!best || !series) break
    for (const file of [...remaining]) {
      const name = normalizeText(preprocessSeriesName(basename(file))).toLowerCase()
      if (name.includes(best.common)) add(series, file)
    }
    add(series, best.pair[0])
    add(series, best.pair[1])
  }

  const output: Record<string, string[]> = {}
  for (const [series, set] of groups) {
    if (set.size) output[series] = [...set]
  }
  void config
  return output
}

export async function runSeriex(
  input: SeriexInput,
  runtime: SeriexRuntime,
  onEvent: (event: NodeRunEvent) => void = () => {},
): Promise<SeriexResult> {
  const normalized = normalizeSeriexInput(input)
  try {
    if (!normalized.directoryPath) return failure("Directory path is required.")
    if (!await runtime.exists(normalized.directoryPath)) return failure(`Directory path does not exist: ${normalized.directoryPath}`)

    const configText = normalized.configText || (normalized.configPath && runtime.readText ? await runtime.readText(normalized.configPath) ?? "" : "")
    const config = mergeSeriexConfig(DEFAULT_SERIEX_CONFIG, normalized, configText ? parseSeriexConfigText(configText) : {})
    const similarity = {
      threshold: normalized.threshold,
      ratioThreshold: normalized.ratioThreshold,
      partialThreshold: normalized.partialThreshold,
      tokenThreshold: normalized.tokenThreshold,
      lengthDiffMax: normalized.lengthDiffMax,
    }

    onEvent({ type: "progress", progress: 15, message: `Planning ${normalized.directoryPath}` })
    const knownSeries = await loadKnownSeries(config, normalized, runtime)
    const plan = await prepareSeriexPlan(normalized.directoryPath, config, similarity, knownSeries, runtime)
    if (normalized.action === "plan" || normalized.dryRun) {
      return success(`Plan generated: ${countSeries(plan)} series, ${countFiles(plan)} file(s).`, {
        plan,
        planItems: flattenPlan(plan),
        totalSeries: countSeries(plan),
        totalFiles: countFiles(plan),
      })
    }

    onEvent({ type: "progress", progress: 55, message: "Applying plan." })
    const applied = await applySeriexPlan(plan, runtime, onEvent)
    return {
      success: applied.failedCount === 0,
      message: `Applied plan: ${applied.movedCount} moved, ${applied.failedCount} failed.`,
      data: data({
        plan,
        summary: applied.summary,
        planItems: flattenPlan(plan),
        moveItems: applied.moveItems,
        totalSeries: countSeries(applied.summary),
        totalFiles: countFiles(applied.summary),
        movedCount: applied.movedCount,
        failedCount: applied.failedCount,
      }),
    }
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error))
  }
}

export async function prepareSeriexPlan(
  directoryPath: string,
  config: SeriexConfig,
  similarity: SimilarityConfig,
  knownSeries: string[],
  runtime: SeriexRuntime,
): Promise<Record<string, Record<string, string[]>>> {
  const directories = await collectCandidateDirectories(directoryPath, config, runtime)
  const plan: Record<string, Record<string, string[]>> = {}
  for (const directory of directories) {
    const entries = await runtime.listDir(directory)
    const files = entries.filter((entry) => entry.isFile && isSeriexSupportedFile(entry.name, config)).map((entry) => entry.path)
    if (files.length <= 1) continue
    const existingSeries = entries.filter((entry) => entry.isDirectory && isSeriesFolder(entry.name)).map((entry) => stripSeriesPrefix(entry.name))
    const groups = findSeriesGroups(files, { config, similarity, knownSeries, existingSeries, basename: runtime.basename })
    const totalFiles = files.length
    const dirPlan: Record<string, string[]> = {}
    for (const [series, groupedFiles] of Object.entries(groups)) {
      const knownHit = knownSeries.some((item) => normalizeText(item) === normalizeText(series))
      if (groupedFiles.length <= 1 && !(config.knownSeriesAllowSingle && knownHit)) continue
      if (groupedFiles.length === totalFiles) {
        for (const key of Object.keys(dirPlan)) delete dirPlan[key]
        break
      }
      const folder = `${config.addPrefix ? config.prefix : ""}${series.trim()}`
      dirPlan[folder] = [...groupedFiles].sort((a, b) => runtime.basename(a).localeCompare(runtime.basename(b)))
    }
    if (Object.keys(dirPlan).length) plan[directory] = dirPlan
  }
  return plan
}

export async function applySeriexPlan(
  plan: Record<string, Record<string, string[]>>,
  runtime: SeriexRuntime,
  onEvent: (event: NodeRunEvent) => void = () => {},
): Promise<{ summary: Record<string, Record<string, string[]>>; moveItems: SeriexMoveItem[]; movedCount: number; failedCount: number }> {
  const summary: Record<string, Record<string, string[]>> = {}
  const moveItems: SeriexMoveItem[] = []
  const total = countFiles(plan)
  let processed = 0
  let movedCount = 0
  let failedCount = 0

  for (const [directory, groups] of Object.entries(plan)) {
    for (const [folder, files] of Object.entries(groups)) {
      const targetDir = runtime.join(directory, folder)
      await runtime.ensureDir(targetDir)
      for (const sourcePath of files) {
        const filename = runtime.basename(sourcePath)
        let targetPath = runtime.join(targetDir, filename)
        targetPath = await uniqueTarget(targetPath, runtime)
        onEvent({ type: "progress", progress: Math.round((processed / Math.max(total, 1)) * 100), message: filename })
        try {
          await runtime.movePath(sourcePath, targetPath)
          summary[directory] ??= {}
          summary[directory][folder] ??= []
          summary[directory][folder].push(runtime.basename(targetPath))
          moveItems.push({ sourcePath, targetPath, folder, filename, success: true })
          movedCount += 1
        } catch (error) {
          moveItems.push({ sourcePath, targetPath, folder, filename, success: false, error: error instanceof Error ? error.message : String(error) })
          failedCount += 1
        }
        processed += 1
      }
    }
  }
  onEvent({ type: "progress", progress: 100, message: "Apply completed." })
  return { summary, moveItems, movedCount, failedCount }
}

async function collectCandidateDirectories(directoryPath: string, config: SeriexConfig, runtime: SeriexRuntime): Promise<string[]> {
  const directories = [directoryPath]
  for (const entry of await runtime.listDir(directoryPath)) {
    if (!entry.isDirectory) continue
    if (isSeriesFolder(entry.name) || entry.name === "损坏压缩包") continue
    const childEntries = await runtime.listDir(entry.path)
    if (childEntries.some((child) => child.isFile && isSeriexSupportedFile(child.name, config))) directories.push(entry.path)
  }
  return directories
}

async function loadKnownSeries(config: SeriexConfig, input: Required<SeriexInput>, runtime: SeriexRuntime): Promise<string[]> {
  const names = new Set<string>(normalizeSeriesList(input.knownSeriesNames))
  for (const dir of config.knownSeriesDirs) {
    try {
      for (const entry of await runtime.listDir(dir)) {
        if (entry.isDirectory) names.add(stripSeriesPrefix(entry.name))
      }
    } catch {
      // ignore unreadable reference directories
    }
  }
  return normalizeSeriesList([...names])
}

async function uniqueTarget(targetPath: string, runtime: SeriexRuntime): Promise<string> {
  if (!await runtime.exists(targetPath)) return targetPath
  const ext = extension(targetPath)
  const base = ext ? targetPath.slice(0, -ext.length) : targetPath
  let index = 1
  while (await runtime.exists(`${base}_${index}${ext}`)) index += 1
  return `${base}_${index}${ext}`
}

function flattenPlan(plan: Record<string, Record<string, string[]>>): SeriexPlanItem[] {
  return Object.entries(plan).flatMap(([directory, groups]) => (
    Object.entries(groups).map(([folder, files]) => ({ directory, folder, files }))
  ))
}

function countSeries(plan: Record<string, Record<string, string[]>>): number {
  return Object.values(plan).reduce((sum, groups) => sum + Object.keys(groups).length, 0)
}

function countFiles(plan: Record<string, Record<string, string[]>>): number {
  return Object.values(plan).reduce((sum, groups) => sum + Object.values(groups).reduce((inner, files) => inner + files.length, 0), 0)
}

function normalizeExtensions(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean).map((value) => value.startsWith(".") ? value : `.${value}`))].sort()
}

function normalizeSeriesList(values: string[]): string[] {
  return [...new Set(values.map((value) => stripSeriesPrefix(value.trim())).filter(Boolean))].sort((a, b) => b.length - a.length)
}

function parseArray(content: string, key: string): string[] {
  const block = new RegExp(`${key}\\s*=\\s*\\[([\\s\\S]*?)\\]`, "m").exec(content)?.[1]
  if (!block) return []
  return [...block.matchAll(/"([^"]+)"|'([^']+)'|([^,\s]+)/g)].map((match) => (match[1] ?? match[2] ?? match[3] ?? "").trim()).filter(Boolean)
}

function parseString(content: string, key: string): string {
  return new RegExp(`${key}\\s*=\\s*["']([^"']+)["']`, "m").exec(content)?.[1] ?? ""
}

function parseBoolean(content: string, key: string): boolean | undefined {
  const value = new RegExp(`${key}\\s*=\\s*(true|false)`, "im").exec(content)?.[1]
  return value ? value.toLowerCase() === "true" : undefined
}

function isSeriesFolder(name: string): boolean {
  return SERIEX_PREFIXES.some((prefix) => name.startsWith(prefix))
}

function stripSeriesPrefix(name: string): string {
  for (const prefix of SERIEX_PREFIXES) {
    if (name.startsWith(prefix)) return name.slice(prefix.length).trim()
  }
  return name.trim()
}

function sameBase(a: string, b: string, basename: (path: string) => string): boolean {
  return baseWithoutDecorations(basename(a)) === baseWithoutDecorations(basename(b))
}

function baseWithoutDecorations(filename: string): string {
  return normalizeText(stripExtension(filename).replace(/\[[^\]]*]/g, "").replace(/\([^)]*\)/g, "").replace(/[\s!?,~._+\-]/g, ""))
}

function keywords(name: string): string[] {
  return name.split(/[\s._+\-]+/).map((item) => item.trim()).filter(Boolean)
}

function longestCommonTokenRun(a: string[], b: string[]): string[] {
  let best: string[] = []
  for (let startA = 0; startA < a.length; startA += 1) {
    for (let startB = 0; startB < b.length; startB += 1) {
      const current: string[] = []
      let offset = 0
      while (a[startA + offset] && b[startB + offset] && normalizeText(a[startA + offset]).toLowerCase() === normalizeText(b[startB + offset]).toLowerCase()) {
        current.push(a[startA + offset])
        offset += 1
      }
      if (current.length > best.length) best = current
    }
  }
  return best
}

function longestCommonSubstring(a: string, b: string): string {
  let best = ""
  for (let start = 0; start < a.length; start += 1) {
    for (let end = start + 1; end <= a.length; end += 1) {
      const candidate = a.slice(start, end)
      if (candidate.length > best.length && b.includes(candidate)) best = candidate
    }
  }
  return best.trim()
}

function ratioScore(a: string, b: string, common: string): number {
  if (!a || !b || !common) return 0
  return Math.round((2 * common.length / (a.length + b.length)) * 100)
}

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

function stripExtension(path: string): string {
  return path.replace(/\.[^.\\/]+$/, "")
}

function extension(path: string): string {
  return /\.[^.\\/]+$/.exec(path)?.[0] ?? ""
}

function normalizeText(text: string): string {
  return text.normalize("NFKC")
}

function clean(value?: string): string {
  return (value ?? "").trim().replace(/^["']|["']$/g, "")
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function data(partial: Partial<SeriexData>): SeriexData {
  return {
    plan: {},
    summary: {},
    planItems: [],
    moveItems: [],
    totalSeries: 0,
    totalFiles: 0,
    movedCount: 0,
    failedCount: 0,
    errors: [],
    ...partial,
  }
}

function success(message: string, partial: Partial<SeriexData>): SeriexResult {
  return { success: true, message, data: data(partial) }
}

function failure(message: string): SeriexResult {
  return { success: false, message, data: data({ errors: [message], failedCount: 1 }) }
}

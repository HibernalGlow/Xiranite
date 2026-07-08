import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"

export type SimiuAction = "scan" | "plan" | "apply"
export type SimiuApplyMode = "move" | "copy" | "link"
export type SimiuScanOrder = "path" | "smallest-first" | "deepest-first"

export interface SimiuInput {
  action?: SimiuAction
  root?: string
  roots?: string[]
  configPath?: string
  configText?: string
  databasePath?: string
  recordRun?: boolean
  recursive?: boolean
  scanOrder?: SimiuScanOrder
  namePrefix?: string
  minGroupSize?: number
  sizeToleranceBytes?: number
  mode?: SimiuApplyMode
  dryRun?: boolean
}

export interface SimiuPathInfo {
  path: string
  exists: boolean
  isFile: boolean
  isDirectory: boolean
  size: number
}

export interface SimiuDirEntry {
  name: string
  path: string
  isFile: boolean
  isDirectory: boolean
  size: number
}

export interface SimiuImageFeature {
  path: string
  size: number
  signature: string
}

export interface SimiuFolderBatch {
  folder: string
  images: SimiuImageFeature[]
}

export interface SimiuGroup {
  parentDir: string
  name: string
  files: string[]
}

export interface SimiuOperation {
  mode: SimiuApplyMode
  sourcePath: string
  targetPath: string
  status: "planned" | "success" | "skipped" | "error"
  reason?: string
}

export interface SimiuConfigSummary {
  path: string
  keys: string[]
  tables: string[]
}

export interface SimiuDatabase {
  path: string
  enabled: boolean
  mode: "jsonl"
  defaultPath: boolean
}

export interface SimiuData {
  batches: SimiuFolderBatch[]
  groups: SimiuGroup[]
  operations: SimiuOperation[]
  config?: SimiuConfigSummary
  database?: SimiuDatabase
  imageCount: number
  groupCount: number
  movedCount: number
  skippedCount: number
  errorCount: number
  errors: string[]
}

export interface SimiuRuntime {
  readText: (path: string) => Promise<string>
  appendRecord: (path: string, record: unknown) => Promise<void>
  pathInfo: (path: string) => Promise<SimiuPathInfo>
  listDir: (path: string) => Promise<SimiuDirEntry[]>
  makeDir: (path: string) => Promise<void>
  moveFile: (source: string, target: string) => Promise<void>
  copyFile: (source: string, target: string) => Promise<void>
  linkFile: (source: string, target: string) => Promise<void>
  join: (...parts: string[]) => string
  dirname: (path: string) => string
  basename: (path: string) => string
}

export type SimiuResult = NodeRunResult<SimiuData>

export const SIMIU_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".tif", ".tiff", ".avif", ".jxl"]
export const SIMIU_AUTO_GROUP_MARKER = "__set_"

export function normalizeSimiuInput(input: SimiuInput): Required<SimiuInput> {
  return {
    action: input.action ?? "scan",
    root: clean(input.root),
    roots: uniqueClean([input.root, ...(input.roots ?? [])]),
    configPath: clean(input.configPath),
    configText: input.configText ?? "",
    databasePath: clean(input.databasePath),
    recordRun: input.recordRun ?? Boolean(input.databasePath),
    recursive: input.recursive ?? true,
    scanOrder: input.scanOrder ?? "path",
    namePrefix: sanitizePrefix(input.namePrefix ?? "simiu_set"),
    minGroupSize: Math.max(2, input.minGroupSize ?? 2),
    sizeToleranceBytes: Math.max(0, input.sizeToleranceBytes ?? 0),
    mode: input.mode ?? "move",
    dryRun: input.dryRun ?? true,
  }
}

export async function runSimiu(
  input: SimiuInput,
  runtime: SimiuRuntime,
  onEvent: (event: NodeRunEvent) => void = () => {},
): Promise<SimiuResult> {
  const configInput = await loadSimiuConfigInput(input, runtime)
  const normalized = normalizeSimiuInput(mergeSimiuConfigInput(configInput, input))
  try {
    if (!normalized.roots.length) return failure("At least one root path is required.")
    const config = await loadSimiuConfigSummary(normalized, runtime)
    const database = buildSimiuDatabase(normalized, runtime)
    onEvent({ type: "progress", progress: 20, message: "Scanning image folders." })
    const batches = await collectFolderBatches(normalized.roots, normalized, runtime)
    if (normalized.action === "scan") {
      await writeSimiuRecordIfEnabled("scan", normalized, batches, [], [], database, runtime)
      return success(`Scanned ${imageCount(batches)} image(s).`, { batches, config, database })
    }

    onEvent({ type: "progress", progress: 55, message: "Planning groups." })
    const groups = planSimiuGroups(batches, normalized, runtime)
    if (normalized.action === "plan" || normalized.dryRun) {
      const operations = planOperations(groups, normalized.mode, runtime)
      await writeSimiuRecordIfEnabled("plan", normalized, batches, groups, operations, database, runtime)
      return success(`Planned ${groups.length} group(s).`, { batches, groups, operations, config, database })
    }

    onEvent({ type: "progress", progress: 75, message: "Applying groups." })
    const operations = await applyOperations(planOperations(groups, normalized.mode, runtime), runtime)
    await writeSimiuRecordIfEnabled("apply", normalized, batches, groups, operations, database, runtime)
    return {
      success: operations.every((item) => item.status !== "error"),
      message: `Applied ${operations.filter((item) => item.status === "success").length} file operation(s).`,
      data: data({ batches, groups, operations, config, database }),
    }
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error))
  }
}

export async function loadSimiuConfigInput(input: SimiuInput, runtime: Pick<SimiuRuntime, "readText">): Promise<SimiuInput> {
  const text = input.configText || (input.configPath ? await runtime.readText(input.configPath) : "")
  if (!text.trim()) return {}
  return parseSimiuTomlConfig(text)
}

export async function loadSimiuConfigSummary(input: Required<SimiuInput>, runtime: Pick<SimiuRuntime, "readText">): Promise<SimiuConfigSummary | undefined> {
  const text = input.configText || (input.configPath ? await runtime.readText(input.configPath) : "")
  if (!text.trim()) return undefined
  const parsed = parseTomlLikeKeys(text)
  return { path: input.configPath, keys: parsed.keys, tables: parsed.tables }
}

export function mergeSimiuConfigInput(config: SimiuInput, input: SimiuInput): SimiuInput {
  return {
    ...config,
    ...input,
    roots: input.roots ?? config.roots,
  }
}

export function parseSimiuTomlConfig(text: string): SimiuInput {
  const values = parseTomlLikeValues(text)
  return {
    root: stringValue(values.root),
    roots: arrayValue(values.roots),
    recursive: booleanValue(values.recursive),
    scanOrder: enumValue(values.scanOrder, ["path", "smallest-first", "deepest-first"]),
    namePrefix: stringValue(values.namePrefix),
    minGroupSize: numberValue(values.minGroupSize),
    sizeToleranceBytes: numberValue(values.sizeToleranceBytes),
    mode: enumValue(values.mode, ["move", "copy", "link"]),
    dryRun: booleanValue(values.dryRun),
    databasePath: stringValue(values.databasePath),
    recordRun: booleanValue(values.recordRun),
  }
}

export function parseTomlLikeKeys(text: string): { keys: string[]; tables: string[] } {
  const keys = new Set<string>()
  const tables = new Set<string>()
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue
    const table = /^\[+([^\]]+)\]+$/.exec(line)
    if (table) {
      tables.add(table[1]!.trim())
      continue
    }
    const index = line.indexOf("=")
    if (index > 0) keys.add(line.slice(0, index).trim())
  }
  return { keys: [...keys].sort(), tables: [...tables].sort() }
}

export function buildSimiuDatabase(input: Required<SimiuInput>, runtime: Pick<SimiuRuntime, "join">): SimiuDatabase | undefined {
  const path = input.databasePath || defaultSimiuDatabasePath(input, runtime)
  if (!path) return undefined
  return {
    path,
    enabled: input.recordRun,
    mode: "jsonl",
    defaultPath: !input.databasePath,
  }
}

export function defaultSimiuDatabasePath(input: Pick<Required<SimiuInput>, "roots">, runtime: Pick<SimiuRuntime, "join">): string {
  return input.roots[0] ? runtime.join(input.roots[0], ".xiranite", "simiu-runs.jsonl") : ""
}

export function buildSimiuRunRecord(
  action: SimiuAction,
  input: Pick<Required<SimiuInput>, "roots" | "recursive" | "scanOrder" | "namePrefix" | "minGroupSize" | "sizeToleranceBytes" | "mode" | "dryRun">,
  batches: SimiuFolderBatch[],
  groups: SimiuGroup[],
  operations: SimiuOperation[],
): Record<string, unknown> {
  return {
    toolId: "simiu",
    action,
    roots: input.roots,
    options: {
      recursive: input.recursive,
      scanOrder: input.scanOrder,
      namePrefix: input.namePrefix,
      minGroupSize: input.minGroupSize,
      sizeToleranceBytes: input.sizeToleranceBytes,
      mode: input.mode,
      dryRun: input.dryRun,
    },
    folderCount: batches.length,
    imageCount: imageCount(batches),
    groupCount: groups.length,
    operationCount: operations.length,
    successCount: operations.filter((item) => item.status === "success").length,
    errorCount: operations.filter((item) => item.status === "error").length,
    at: new Date().toISOString(),
  }
}

export async function collectFolderBatches(
  roots: string[],
  input: Pick<Required<SimiuInput>, "recursive" | "scanOrder" | "namePrefix">,
  runtime: SimiuRuntime,
): Promise<SimiuFolderBatch[]> {
  const batches: SimiuFolderBatch[] = []
  async function visit(path: string) {
    const info = await runtime.pathInfo(path)
    if (!info.exists) return
    if (info.isFile && isSimiuImage(path)) {
      batches.push({ folder: runtime.dirname(info.path), images: [{ path: info.path, size: info.size, signature: signatureFor(info.path, info.size) }] })
      return
    }
    if (!info.isDirectory || shouldSkipDirectory(info.path, input.namePrefix, runtime)) return
    const entries = await runtime.listDir(info.path)
    const images = entries
      .filter((entry) => entry.isFile && isSimiuImage(entry.path))
      .map((entry) => ({ path: entry.path, size: entry.size, signature: signatureFor(entry.path, entry.size) }))
    if (images.length) batches.push({ folder: info.path, images: sortFeatures(images) })
    if (input.recursive) {
      for (const entry of entries) if (entry.isDirectory) await visit(entry.path)
    }
  }
  for (const root of roots) await visit(root)
  return sortBatches(batches, input.scanOrder, runtime)
}

export function planSimiuGroups(
  batches: SimiuFolderBatch[],
  input: Pick<Required<SimiuInput>, "minGroupSize" | "namePrefix" | "sizeToleranceBytes">,
  runtime: Pick<SimiuRuntime, "join">,
): SimiuGroup[] {
  const groups: SimiuGroup[] = []
  for (const batch of batches) {
    const clusters = clusterBySignature(batch.images, input.sizeToleranceBytes)
    let index = 1
    const used = new Set<string>()
    for (const files of clusters) {
      if (files.length < input.minGroupSize || files.length === batch.images.length) continue
      const rawName = `${input.namePrefix}${SIMIU_AUTO_GROUP_MARKER}${String(index).padStart(3, "0")}`
      index += 1
      const name = dedupeGroupName(rawName, used)
      void runtime
      groups.push({ parentDir: batch.folder, name, files: files.map((item) => item.path) })
    }
  }
  return groups
}

export function planOperations(groups: SimiuGroup[], mode: SimiuApplyMode, runtime: Pick<SimiuRuntime, "join" | "basename">): SimiuOperation[] {
  return groups.flatMap((group) => group.files.map((file) => ({
    mode,
    sourcePath: file,
    targetPath: runtime.join(group.parentDir, group.name, runtime.basename(file)),
    status: "planned" as const,
  })))
}

async function applyOperations(operations: SimiuOperation[], runtime: SimiuRuntime): Promise<SimiuOperation[]> {
  const results: SimiuOperation[] = []
  for (const operation of operations) {
    try {
      await runtime.makeDir(runtime.dirname(operation.targetPath))
      if (operation.mode === "move") await runtime.moveFile(operation.sourcePath, operation.targetPath)
      else if (operation.mode === "copy") await runtime.copyFile(operation.sourcePath, operation.targetPath)
      else await runtime.linkFile(operation.sourcePath, operation.targetPath)
      results.push({ ...operation, status: "success" })
    } catch (error) {
      results.push({ ...operation, status: "error", reason: error instanceof Error ? error.message : String(error) })
    }
  }
  return results
}

async function writeSimiuRecordIfEnabled(
  action: SimiuAction,
  input: Required<SimiuInput>,
  batches: SimiuFolderBatch[],
  groups: SimiuGroup[],
  operations: SimiuOperation[],
  database: SimiuDatabase | undefined,
  runtime: Pick<SimiuRuntime, "appendRecord">,
): Promise<void> {
  if (!database?.enabled) return
  await runtime.appendRecord(database.path, buildSimiuRunRecord(action, input, batches, groups, operations))
}

export function clusterBySignature(images: SimiuImageFeature[], tolerance: number): SimiuImageFeature[][] {
  const sorted = sortFeatures(images)
  const clusters: SimiuImageFeature[][] = []
  for (const image of sorted) {
    const match = clusters.find((cluster) => Math.abs(cluster[0]!.size - image.size) <= tolerance && cluster[0]!.signature === image.signature)
    if (match) match.push(image)
    else clusters.push([image])
  }
  return clusters.sort((a, b) => b.length - a.length || a[0]!.path.localeCompare(b[0]!.path))
}

export function isSimiuImage(path: string): boolean {
  const lower = path.toLowerCase()
  return SIMIU_IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

export function shouldSkipDirectory(path: string, namePrefix: string, runtime: Pick<SimiuRuntime, "basename">): boolean {
  const lower = runtime.basename(path).toLowerCase()
  return lower.startsWith(".simiu-") || lower.includes(SIMIU_AUTO_GROUP_MARKER) || Boolean(namePrefix && lower.startsWith(namePrefix.toLowerCase()))
}

function signatureFor(path: string, size: number): string {
  return `${size}:${path.slice(path.lastIndexOf(".")).toLowerCase()}`
}

function sortFeatures(images: SimiuImageFeature[]): SimiuImageFeature[] {
  return [...images].sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: "base" }))
}

function sortBatches(batches: SimiuFolderBatch[], scanOrder: SimiuScanOrder, runtime: Pick<SimiuRuntime, "basename">): SimiuFolderBatch[] {
  const sorted = [...batches]
  if (scanOrder === "smallest-first") sorted.sort((a, b) => a.images.length - b.images.length || a.folder.localeCompare(b.folder))
  else if (scanOrder === "deepest-first") sorted.sort((a, b) => b.folder.split(/[\\/]/).length - a.folder.split(/[\\/]/).length || a.folder.localeCompare(b.folder))
  else sorted.sort((a, b) => a.folder.localeCompare(b.folder))
  void runtime
  return sorted
}

function dedupeGroupName(name: string, used: Set<string>): string {
  let candidate = name
  let index = 1
  while (used.has(candidate)) {
    candidate = `${name}_${String(index).padStart(2, "0")}`
    index += 1
  }
  used.add(candidate)
  return candidate
}

function sanitizePrefix(value: string): string {
  return clean(value).replace(/[<>:"/\\|?*]/g, "_").replace(/^\.+|\.+$/g, "") || "simiu_set"
}

function imageCount(batches: SimiuFolderBatch[]): number {
  return batches.reduce((sum, batch) => sum + batch.images.length, 0)
}

function parseTomlLikeValues(text: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith("#") || line.startsWith("[")) continue
    const index = line.indexOf("=")
    if (index <= 0) continue
    values[line.slice(0, index).trim()] = line.slice(index + 1).trim()
  }
  return values
}

function stringValue(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  return value.trim().replace(/^["']|["']$/g, "")
}

function arrayValue(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return [stringValue(trimmed) ?? ""].filter(Boolean)
  return trimmed
    .slice(1, -1)
    .split(",")
    .map(stringValue)
    .filter((item): item is string => Boolean(item))
}

function booleanValue(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined
  const normalized = stringValue(value)?.toLowerCase()
  if (normalized === "true" || normalized === "1") return true
  if (normalized === "false" || normalized === "0") return false
  return undefined
}

function numberValue(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(stringValue(value))
  return Number.isFinite(parsed) ? parsed : undefined
}

function enumValue<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  const normalized = stringValue(value)
  return allowed.find((item) => item === normalized)
}

function data(partial: Partial<SimiuData>): SimiuData {
  const batches = partial.batches ?? []
  const groups = partial.groups ?? []
  const operations = partial.operations ?? []
  return {
    batches,
    groups,
    operations,
    imageCount: imageCount(batches),
    groupCount: groups.length,
    movedCount: operations.filter((item) => item.status === "success").length,
    skippedCount: operations.filter((item) => item.status === "skipped").length,
    errorCount: operations.filter((item) => item.status === "error").length,
    errors: operations.filter((item) => item.status === "error").map((item) => `${item.sourcePath}: ${item.reason}`),
    ...partial,
  }
}

function success(message: string, partial: Partial<SimiuData>): SimiuResult {
  return { success: true, message, data: data(partial) }
}

function failure(message: string): SimiuResult {
  return { success: false, message, data: data({ errors: [message], errorCount: 1 }) }
}

function uniqueClean(values: Array<string | undefined>): string[] {
  return [...new Set(values.map(clean).filter(Boolean))]
}

function clean(value?: string): string {
  return (value ?? "").trim().replace(/^["']|["']$/g, "")
}

import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"

export type SimiuAction = "scan" | "plan" | "apply"
export type SimiuApplyMode = "move" | "copy" | "link"
export type SimiuScanOrder = "path" | "smallest-first" | "deepest-first"

export interface SimiuInput {
  action?: SimiuAction
  root?: string
  roots?: string[]
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

export interface SimiuData {
  batches: SimiuFolderBatch[]
  groups: SimiuGroup[]
  operations: SimiuOperation[]
  imageCount: number
  groupCount: number
  movedCount: number
  skippedCount: number
  errorCount: number
  errors: string[]
}

export interface SimiuRuntime {
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
  const normalized = normalizeSimiuInput(input)
  try {
    if (!normalized.roots.length) return failure("At least one root path is required.")
    onEvent({ type: "progress", progress: 20, message: "Scanning image folders." })
    const batches = await collectFolderBatches(normalized.roots, normalized, runtime)
    if (normalized.action === "scan") return success(`Scanned ${imageCount(batches)} image(s).`, { batches })

    onEvent({ type: "progress", progress: 55, message: "Planning groups." })
    const groups = planSimiuGroups(batches, normalized, runtime)
    if (normalized.action === "plan" || normalized.dryRun) return success(`Planned ${groups.length} group(s).`, { batches, groups, operations: planOperations(groups, normalized.mode, runtime) })

    onEvent({ type: "progress", progress: 75, message: "Applying groups." })
    const operations = await applyOperations(planOperations(groups, normalized.mode, runtime), runtime)
    return {
      success: operations.every((item) => item.status !== "error"),
      message: `Applied ${operations.filter((item) => item.status === "success").length} file operation(s).`,
      data: data({ batches, groups, operations }),
    }
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error))
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

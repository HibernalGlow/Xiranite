import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"

export type CrashuAction = "scan" | "plan" | "move" | "execute"
export type CrashuMoveDirection = "to_target" | "to_source"
export type CrashuConflictPolicy = "skip" | "overwrite" | "rename"
export type CrashuPlanStatus = "pending" | "skipped" | "success" | "error"

export interface CrashuInput {
  action?: CrashuAction
  sourcePaths?: string[]
  source_paths?: string[]
  source?: string
  targetPath?: string
  target_path?: string
  targetNames?: string[]
  target_names?: string[]
  destinationPath?: string
  destination_path?: string
  similarityThreshold?: number
  similarity_threshold?: number
  autoMove?: boolean
  auto_move?: boolean
  moveDirection?: CrashuMoveDirection
  move_direction?: CrashuMoveDirection
  conflictPolicy?: CrashuConflictPolicy
  conflict_policy?: CrashuConflictPolicy
  pairsFileName?: string
  pairs_file_name?: string
  dryRun?: boolean
}

export interface CrashuPathInfo {
  path: string
  exists: boolean
  isFile: boolean
  isDirectory: boolean
}

export interface CrashuDirEntry {
  name: string
  path: string
  isFile: boolean
  isDirectory: boolean
}

export interface CrashuSourceFolder {
  name: string
  path: string
  sourceRoot: string
}

export interface CrashuTargetFolder {
  name: string
  path?: string
}

export interface CrashuSimilarFolder {
  name: string
  path: string
  target: string
  similarity: number
  matchDim: string
  matchSrc: string
  matchTgt: string
  targetFullpath?: string
}

export interface CrashuPlanItem {
  sourcePath: string
  targetName: string
  targetPath?: string
  destinationPath: string
  direction: CrashuMoveDirection
  similarity: number
  status: CrashuPlanStatus
  reason: string
}

export interface CrashuData {
  sourceCount: number
  targetCount: number
  totalScanned: number
  similarFound: number
  movedCount: number
  skippedCount: number
  errorCount: number
  pairsFile: string
  similarFolders: CrashuSimilarFolder[]
  plan: CrashuPlanItem[]
  errors: string[]
}

export interface CrashuRuntime {
  pathInfo: (path: string) => Promise<CrashuPathInfo>
  listDir: (path: string) => Promise<CrashuDirEntry[]>
  ensureDir: (path: string) => Promise<void>
  movePath: (source: string, target: string) => Promise<void>
  deletePath: (path: string) => Promise<void>
  writeText: (path: string, content: string) => Promise<void>
  join: (...parts: string[]) => string
  dirname: (path: string) => string
  basename: (path: string) => string
}

export type CrashuResult = NodeRunResult<CrashuData>

export function normalizeCrashuInput(input: CrashuInput): Required<Omit<CrashuInput, "source_paths" | "target_path" | "target_names" | "destination_path" | "similarity_threshold" | "auto_move" | "move_direction" | "conflict_policy" | "pairs_file_name">> {
  const sourcePaths = [...(input.sourcePaths ?? input.source_paths ?? [])]
  if (input.source) sourcePaths.unshift(input.source)
  return {
    action: input.action ?? "scan",
    sourcePaths: uniqueClean(sourcePaths),
    source: clean(input.source),
    targetPath: clean(input.targetPath ?? input.target_path),
    targetNames: uniqueClean(input.targetNames ?? input.target_names ?? []),
    destinationPath: clean(input.destinationPath ?? input.destination_path),
    similarityThreshold: clamp01(input.similarityThreshold ?? input.similarity_threshold ?? 0.6),
    autoMove: input.autoMove ?? input.auto_move ?? false,
    moveDirection: input.moveDirection ?? input.move_direction ?? "to_target",
    conflictPolicy: input.conflictPolicy ?? input.conflict_policy ?? "skip",
    pairsFileName: clean(input.pairsFileName ?? input.pairs_file_name) || "folder_pairs.json",
    dryRun: input.dryRun ?? false,
  }
}

export async function runCrashu(
  input: CrashuInput,
  runtime: CrashuRuntime,
  onEvent: (event: NodeRunEvent) => void = () => {},
): Promise<CrashuResult> {
  const normalized = normalizeCrashuInput(input)
  try {
    if (!normalized.sourcePaths.length) return failure("At least one source directory is required.")

    onEvent({ type: "progress", progress: 10, message: "Validating source directories." })
    const sourceRoots = await validSourceRoots(normalized.sourcePaths, runtime)
    if (!sourceRoots.length) return failure("No valid source directories found.")

    onEvent({ type: "progress", progress: 25, message: "Loading target folder names." })
    const targets = await loadTargets(normalized, runtime)
    if (!targets.length) return failure("Target path or target names are required.")

    onEvent({ type: "progress", progress: 40, message: "Scanning source folders." })
    const sources = await collectSourceFolders(sourceRoots, runtime)
    const similarFolders = matchSimilarFolders(sources, targets, normalized.similarityThreshold)
    const plan = await buildCrashuPlan(similarFolders, normalized, runtime)

    if (normalized.action === "scan" || normalized.action === "plan" || normalized.dryRun || !normalized.autoMove) {
      const message = normalized.action === "scan"
        ? `Scan completed: ${similarFolders.length} similar folder(s).`
        : `Plan generated: ${plan.filter((item) => item.status === "pending").length} move(s).`
      return success(message, summarize({ sources, targets, similarFolders, plan }))
    }

    onEvent({ type: "progress", progress: 70, message: "Moving matched folders." })
    return await executePlan(plan, sources, targets, similarFolders, normalized, runtime, onEvent)
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error))
  }
}

export async function collectSourceFolders(sourceRoots: string[], runtime: CrashuRuntime): Promise<CrashuSourceFolder[]> {
  const folders: CrashuSourceFolder[] = []
  for (const root of sourceRoots) {
    const entries = await runtime.listDir(root)
    for (const entry of entries) {
      if (entry.isDirectory) folders.push({ name: entry.name, path: entry.path, sourceRoot: root })
    }
  }
  return folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }))
}

export async function loadTargets(
  input: Pick<ReturnType<typeof normalizeCrashuInput>, "targetPath" | "targetNames">,
  runtime: CrashuRuntime,
): Promise<CrashuTargetFolder[]> {
  if (input.targetPath) {
    const info = await runtime.pathInfo(input.targetPath)
    if (info.exists && info.isDirectory) {
      const entries = await runtime.listDir(input.targetPath)
      return entries
        .filter((entry) => entry.isDirectory)
        .map((entry) => ({ name: entry.name, path: entry.path }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }))
    }
  }
  return input.targetNames.map((name) => ({ name }))
}

export function matchSimilarFolders(sources: CrashuSourceFolder[], targets: CrashuTargetFolder[], threshold: number): CrashuSimilarFolder[] {
  const matches: CrashuSimilarFolder[] = []
  for (const source of sources) {
    const best = bestTargetMatch(source.name, targets)
    if (!best || best.similarity < threshold) continue
    matches.push({
      name: source.name,
      path: source.path,
      target: best.target.name,
      similarity: best.similarity,
      matchDim: best.matchDim,
      matchSrc: best.matchSrc,
      matchTgt: best.matchTgt,
      targetFullpath: best.target.path,
    })
  }
  return matches.sort((a, b) => b.similarity - a.similarity || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }))
}

export async function buildCrashuPlan(
  similarFolders: CrashuSimilarFolder[],
  input: Pick<ReturnType<typeof normalizeCrashuInput>, "destinationPath" | "moveDirection" | "conflictPolicy">,
  runtime: CrashuRuntime,
): Promise<CrashuPlanItem[]> {
  if (!input.destinationPath) {
    return similarFolders.map((folder) => ({
      sourcePath: folder.path,
      targetName: folder.target,
      targetPath: folder.targetFullpath,
      destinationPath: "",
      direction: input.moveDirection,
      similarity: folder.similarity,
      status: "skipped",
      reason: "missing_destination",
    }))
  }

  const plan: CrashuPlanItem[] = []
  for (const folder of similarFolders) {
    const sourcePath = input.moveDirection === "to_source" && folder.targetFullpath ? folder.targetFullpath : folder.path
    if (input.moveDirection === "to_source" && !folder.targetFullpath) {
      plan.push({
        sourcePath: folder.path,
        targetName: folder.target,
        destinationPath: "",
        direction: input.moveDirection,
        similarity: folder.similarity,
        status: "skipped",
        reason: "target_path_unavailable",
      })
      continue
    }
    const destinationPath = await resolveCrashuTargetPath(folder, sourcePath, input, runtime)
    plan.push({
      sourcePath,
      targetName: folder.target,
      targetPath: folder.targetFullpath,
      destinationPath,
      direction: input.moveDirection,
      similarity: folder.similarity,
      status: destinationPath ? "pending" : "skipped",
      reason: destinationPath ? "matched" : "target_exists",
    })
  }
  return plan
}

export function normalizeFolderName(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}|【[^】]*】|（[^）]*）/g, (part) => ` ${part.slice(1, -1)} `)
    .replace(/[_\-+.~]+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\b(v?\d+(?:\.\d+)?|vol(?:ume)?\s*\d+)\b/g, " $1 ")
    .replace(/\s+/g, " ")
    .trim()
}

export function extractNameAliases(value: string): string[] {
  const normalized = normalizeFolderName(value)
  const aliases = new Set<string>([normalized])
  const bracketParts = value.match(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}|【[^】]*】|（[^）]*）/g) ?? []
  for (const part of bracketParts) {
    for (const piece of part.slice(1, -1).split(/[|,;；、／/&+]/)) {
      const normalizedPiece = normalizeFolderName(piece)
      if (normalizedPiece.length >= 2) aliases.add(normalizedPiece)
    }
  }
  for (const piece of normalized.split(/\s+(?:aka|alias|vs|x)\s+/i)) {
    const normalizedPiece = normalizeFolderName(piece)
    if (normalizedPiece.length >= 2) aliases.add(normalizedPiece)
  }
  return [...aliases].filter(Boolean)
}

export function compareFolderNames(sourceName: string, targetName: string): { similarity: number; matchDim: string; matchSrc: string; matchTgt: string } {
  const sourceAliases = extractNameAliases(sourceName)
  const targetAliases = extractNameAliases(targetName)
  let best = { similarity: 0, matchDim: "none", matchSrc: "", matchTgt: "" }
  for (const source of sourceAliases) {
    for (const target of targetAliases) {
      const exact = source === target ? 1 : 0
      const token = tokenSimilarity(source, target)
      const chars = bigramSimilarity(source, target)
      const score = Math.max(exact, token, chars)
      if (score > best.similarity) {
        best = {
          similarity: score,
          matchDim: exact ? "exact" : token >= chars ? "token" : "name",
          matchSrc: source,
          matchTgt: target,
        }
      }
    }
  }
  return best
}

async function validSourceRoots(paths: string[], runtime: CrashuRuntime): Promise<string[]> {
  const roots: string[] = []
  for (const path of paths) {
    const info = await runtime.pathInfo(path)
    if (info.exists && info.isDirectory) roots.push(info.path)
  }
  return roots
}

async function executePlan(
  plan: CrashuPlanItem[],
  sources: CrashuSourceFolder[],
  targets: CrashuTargetFolder[],
  similarFolders: CrashuSimilarFolder[],
  input: ReturnType<typeof normalizeCrashuInput>,
  runtime: CrashuRuntime,
  onEvent: (event: NodeRunEvent) => void,
): Promise<CrashuResult> {
  const pending = plan.filter((item) => item.status === "pending")
  const completed: CrashuPlanItem[] = []
  for (let index = 0; index < pending.length; index += 1) {
    const item = pending[index]
    onEvent({ type: "progress", progress: 70 + Math.round((index / Math.max(pending.length, 1)) * 25), message: runtime.basename(item.sourcePath) })
    try {
      await runtime.ensureDir(runtime.dirname(item.destinationPath))
      if (input.conflictPolicy === "overwrite" && (await runtime.pathInfo(item.destinationPath)).exists) {
        await runtime.deletePath(item.destinationPath)
      }
      await runtime.movePath(item.sourcePath, item.destinationPath)
      completed.push({ ...item, status: "success" })
    } catch (error) {
      completed.push({ ...item, status: "error", reason: error instanceof Error ? error.message : String(error) })
    }
  }

  const pairsFile = input.destinationPath ? runtime.join(input.destinationPath, input.pairsFileName) : ""
  if (pairsFile) {
    await runtime.writeText(pairsFile, `${JSON.stringify({ generatedAt: new Date().toISOString(), pairs: plan }, null, 2)}\n`)
  }
  onEvent({ type: "progress", progress: 100, message: "Crashu completed." })

  const merged = plan.map((item) => completed.find((done) => done.sourcePath === item.sourcePath && done.destinationPath === item.destinationPath) ?? item)
  const summary = summarize({ sources, targets, similarFolders, plan: merged, pairsFile })
  return {
    success: summary.errorCount === 0,
    message: `Crashu completed: ${summary.similarFound} matched, ${summary.movedCount} moved, ${summary.errorCount} error(s).`,
    data: summary,
  }
}

async function resolveCrashuTargetPath(
  folder: CrashuSimilarFolder,
  sourcePath: string,
  input: Pick<ReturnType<typeof normalizeCrashuInput>, "destinationPath" | "moveDirection" | "conflictPolicy">,
  runtime: CrashuRuntime,
): Promise<string> {
  const baseFolder = input.moveDirection === "to_target" ? sanitizePathSegment(folder.target) : sanitizePathSegment(folder.name)
  const base = runtime.join(input.destinationPath, baseFolder)
  const desired = runtime.join(base, runtime.basename(sourcePath))
  const info = await runtime.pathInfo(desired)
  if (!info.exists) return desired
  if (input.conflictPolicy === "overwrite") return desired
  if (input.conflictPolicy === "skip") return ""
  let suffix = 2
  let next = runtime.join(base, `${runtime.basename(sourcePath)} (${suffix})`)
  while ((await runtime.pathInfo(next)).exists) {
    suffix += 1
    next = runtime.join(base, `${runtime.basename(sourcePath)} (${suffix})`)
  }
  return next
}

function bestTargetMatch(sourceName: string, targets: CrashuTargetFolder[]) {
  let best: { target: CrashuTargetFolder; similarity: number; matchDim: string; matchSrc: string; matchTgt: string } | undefined
  for (const target of targets) {
    const result = compareFolderNames(sourceName, target.name)
    if (!best || result.similarity > best.similarity) {
      best = { target, ...result }
    }
  }
  return best
}

function summarize(input: { sources: CrashuSourceFolder[]; targets: CrashuTargetFolder[]; similarFolders: CrashuSimilarFolder[]; plan: CrashuPlanItem[]; pairsFile?: string }): CrashuData {
  const moved = input.plan.filter((item) => item.status === "success").length
  const skipped = input.plan.filter((item) => item.status === "skipped").length
  const errors = input.plan.filter((item) => item.status === "error")
  return data({
    sourceCount: input.sources.length,
    targetCount: input.targets.length,
    totalScanned: input.sources.length,
    similarFound: input.similarFolders.length,
    movedCount: moved,
    skippedCount: skipped,
    errorCount: errors.length,
    pairsFile: input.pairsFile ?? "",
    similarFolders: input.similarFolders,
    plan: input.plan,
    errors: errors.map((item) => `${item.sourcePath}: ${item.reason}`),
  })
}

function tokenSimilarity(a: string, b: string): number {
  const left = new Set(a.split(/\s+/).filter(Boolean))
  const right = new Set(b.split(/\s+/).filter(Boolean))
  if (!left.size || !right.size) return 0
  let shared = 0
  for (const token of left) if (right.has(token)) shared += 1
  return (2 * shared) / (left.size + right.size)
}

function bigramSimilarity(a: string, b: string): number {
  const left = bigrams(a)
  const right = bigrams(b)
  if (!left.size || !right.size) return 0
  let shared = 0
  for (const token of left) if (right.has(token)) shared += 1
  return (2 * shared) / (left.size + right.size)
}

function bigrams(value: string): Set<string> {
  const compact = value.replace(/\s+/g, "")
  if (compact.length <= 1) return new Set(compact ? [compact] : [])
  const grams = new Set<string>()
  for (let index = 0; index < compact.length - 1; index += 1) grams.add(compact.slice(index, index + 2))
  return grams
}

function data(partial: Partial<CrashuData>): CrashuData {
  return {
    sourceCount: 0,
    targetCount: 0,
    totalScanned: 0,
    similarFound: 0,
    movedCount: 0,
    skippedCount: 0,
    errorCount: 0,
    pairsFile: "",
    similarFolders: [],
    plan: [],
    errors: [],
    ...partial,
  }
}

function success(message: string, partial: Partial<CrashuData>): CrashuResult {
  return { success: true, message, data: data(partial) }
}

function failure(message: string): CrashuResult {
  return { success: false, message, data: data({ errors: [message], errorCount: 1 }) }
}

function sanitizePathSegment(value: string): string {
  const sanitized = value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim()
  return sanitized || "target"
}

function uniqueClean(values: string[]): string[] {
  return [...new Set(values.map(clean).filter(Boolean))]
}

function clean(value?: string): string {
  return (value ?? "").trim().replace(/^["']|["']$/g, "")
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0.6
  return Math.min(1, Math.max(0, value))
}

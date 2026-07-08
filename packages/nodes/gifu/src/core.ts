import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"

export type GifuAction = "inspect" | "plan" | "make"
export type GifuFormat = "auto" | "gif" | "webp" | "apng" | "webm" | "mp4"
export type GifuOutputMode = "same" | "separate"

export interface GifuInput {
  action?: GifuAction
  paths?: string[]
  path?: string
  listText?: string
  recursive?: boolean
  format?: GifuFormat
  outDir?: string
  outMode?: GifuOutputMode
  namePrefix?: string
  nameTemplate?: string
  durationMs?: number
  maxWorkers?: number
  extractSingle?: boolean
  overwrite?: boolean
  dryRun?: boolean
  python?: string
  moduleName?: string
  sourceRoot?: string
}

export interface GifuPathInfo {
  path: string
  exists: boolean
  isFile: boolean
  isDirectory: boolean
}

export interface GifuDirEntry {
  name: string
  path: string
  isFile: boolean
  isDirectory: boolean
}

export interface GifuArchivePlan {
  archivePath: string
  outputPath: string
  imageCount: number
  status: "ready" | "single" | "empty"
}

export interface CommandResult {
  code: number
  stdout: string
  stderr: string
}

export interface GifuCommandPlan {
  command: string
  args: string[]
  cwd?: string
  env?: Record<string, string>
}

export interface GifuData {
  archives: GifuArchivePlan[]
  command?: GifuCommandPlan
  commandResult?: CommandResult
  readyCount: number
  singleCount: number
  emptyCount: number
  errors: string[]
}

export interface GifuRuntime {
  pathInfo: (path: string) => Promise<GifuPathInfo>
  listDir: (path: string) => Promise<GifuDirEntry[]>
  countArchiveImages: (path: string) => Promise<number>
  runCommand: (plan: GifuCommandPlan) => Promise<CommandResult>
  join: (...parts: string[]) => string
  dirname: (path: string) => string
  basename: (path: string) => string
  extname: (path: string) => string
}

export type GifuResult = NodeRunResult<GifuData>

export const GIFU_ARCHIVE_EXTENSIONS = [
  ".zip",
  ".cbz",
  ".tar",
  ".tgz",
  ".tar.gz",
  ".tar.bz2",
  ".tbz2",
  ".tar.xz",
  ".txz",
]

export function normalizeGifuInput(input: GifuInput): Required<GifuInput> {
  const paths = uniqueClean([input.path, ...(input.paths ?? []), ...parsePathList(input.listText ?? "")])
  return {
    action: input.action ?? "inspect",
    path: clean(input.path),
    paths,
    listText: input.listText ?? "",
    recursive: input.recursive ?? true,
    format: input.format ?? "webp",
    outDir: clean(input.outDir),
    outMode: input.outMode ?? "same",
    namePrefix: input.namePrefix ?? "",
    nameTemplate: input.nameTemplate ?? "{prefix}{stem}",
    durationMs: input.durationMs ?? 120,
    maxWorkers: input.maxWorkers ?? 0,
    extractSingle: input.extractSingle ?? true,
    overwrite: input.overwrite ?? false,
    dryRun: input.dryRun ?? false,
    python: clean(input.python) || "python",
    moduleName: clean(input.moduleName) || "gifu",
    sourceRoot: clean(input.sourceRoot),
  }
}

export async function runGifu(
  input: GifuInput,
  runtime: GifuRuntime,
  onEvent: (event: NodeRunEvent) => void = () => {},
): Promise<GifuResult> {
  const normalized = normalizeGifuInput(input)
  try {
    if (!normalized.paths.length) return failure("At least one archive, directory, or list entry is required.")
    onEvent({ type: "progress", progress: 15, message: "Collecting archives." })
    const archivePaths = await collectArchives(normalized.paths, normalized.recursive, runtime)
    onEvent({ type: "progress", progress: 45, message: `Inspecting ${archivePaths.length} archive(s).` })
    const archives: GifuArchivePlan[] = []
    for (const archivePath of archivePaths) {
      const imageCount = await runtime.countArchiveImages(archivePath)
      archives.push({
        archivePath,
        outputPath: buildOutputPath(archivePath, normalized, runtime),
        imageCount,
        status: imageCount >= 2 ? "ready" : imageCount === 1 ? "single" : "empty",
      })
    }
    if (normalized.action !== "make" || normalized.dryRun) {
      return success(`Gifu planned ${archives.length} archive(s).`, { archives, command: buildGifuCommand(normalized) })
    }

    onEvent({ type: "progress", progress: 70, message: "Running gifu Python module." })
    const command = buildGifuCommand(normalized)
    const commandResult = await runtime.runCommand(command)
    return {
      success: commandResult.code === 0,
      message: commandResult.code === 0 ? "Gifu conversion completed." : "Gifu conversion failed.",
      data: data({ archives, command, commandResult, errors: commandResult.code === 0 ? [] : [commandResult.stderr || commandResult.stdout] }),
    }
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error))
  }
}

export async function collectArchives(paths: string[], recursive: boolean, runtime: GifuRuntime): Promise<string[]> {
  const found: string[] = []
  const seen = new Set<string>()
  async function add(path: string) {
    if (seen.has(path)) return
    seen.add(path)
    found.push(path)
  }
  async function visit(path: string) {
    const info = await runtime.pathInfo(path)
    if (!info.exists) return
    if (info.isFile) {
      if (isGifuArchive(info.path)) await add(info.path)
      return
    }
    if (!info.isDirectory) return
    for (const entry of await runtime.listDir(info.path)) {
      if (entry.isFile && isGifuArchive(entry.path)) await add(entry.path)
      else if (recursive && entry.isDirectory) await visit(entry.path)
    }
  }
  for (const path of paths) await visit(path)
  return found.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
}

export function buildGifuCommand(input: Required<GifuInput>): GifuCommandPlan {
  const args = ["-m", input.moduleName, "make", ...input.paths]
  args.push("--format", input.format)
  args.push(input.recursive ? "--recursive" : "--no-recursive")
  args.push("--duration", String(input.durationMs))
  args.push("--max-workers", String(input.maxWorkers))
  args.push("--out-mode", input.outMode)
  if (input.outDir) args.push("--out-dir", input.outDir)
  if (input.namePrefix) args.push("--name-prefix", input.namePrefix)
  if (input.nameTemplate) args.push("--name-template", input.nameTemplate)
  if (input.extractSingle) args.push("--extract-single")
  else args.push("--no-extract-single")
  if (input.overwrite) args.push("--overwrite")
  const env = input.sourceRoot ? { PYTHONPATH: input.sourceRoot } : undefined
  return { command: input.python, args, ...(input.sourceRoot ? { cwd: input.sourceRoot, env } : {}) }
}

export function buildOutputPath(archivePath: string, input: Required<GifuInput>, runtime: Pick<GifuRuntime, "dirname" | "basename" | "join">): string {
  const ext = input.format === "auto" ? ".webp" : `.${input.format}`
  const parent = runtime.dirname(archivePath)
  const archive = runtime.basename(archivePath)
  const stem = stripArchiveExtension(archive)
  const outputName = sanitizeOutputStem(renderTemplate(input.nameTemplate, { prefix: input.namePrefix, stem, archive, parent: runtime.basename(parent) })) + ext
  if (input.outDir) return runtime.join(input.outDir, outputName)
  return runtime.join(parent, outputName)
}

export function parsePathList(text: string): string[] {
  return text
    .split(/\r?\n|;/)
    .map(clean)
    .filter((line) => line && !line.startsWith("#"))
}

export function isGifuArchive(path: string): boolean {
  const lower = path.toLowerCase()
  return GIFU_ARCHIVE_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(prefix|stem|archive|parent)\}/g, (_, key: string) => values[key] ?? "")
}

function stripArchiveExtension(name: string): string {
  const lower = name.toLowerCase()
  const ext = GIFU_ARCHIVE_EXTENSIONS.find((item) => lower.endsWith(item))
  return ext ? name.slice(0, -ext.length) : name.replace(/\.[^.]+$/, "")
}

function sanitizeOutputStem(value: string): string {
  const cleaned = value.replace(/[<>:"/\\|?*]/g, "_").trim().replace(/^\.+|\.+$/g, "")
  return cleaned || "output"
}

function data(partial: Partial<GifuData>): GifuData {
  const archives = partial.archives ?? []
  return {
    archives,
    readyCount: archives.filter((item) => item.status === "ready").length,
    singleCount: archives.filter((item) => item.status === "single").length,
    emptyCount: archives.filter((item) => item.status === "empty").length,
    errors: [],
    ...partial,
  }
}

function success(message: string, partial: Partial<GifuData>): GifuResult {
  return { success: true, message, data: data(partial) }
}

function failure(message: string): GifuResult {
  return { success: false, message, data: data({ errors: [message] }) }
}

function uniqueClean(values: Array<string | undefined>): string[] {
  return [...new Set(values.map(clean).filter(Boolean))]
}

function clean(value?: string): string {
  return (value ?? "").trim().replace(/^["']|["']$/g, "")
}

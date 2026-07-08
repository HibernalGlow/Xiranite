import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"

export type EnvuConfigAction = "scan" | "manifest" | "backup"

export interface EnvuConfigInput {
  action?: EnvuConfigAction
  root?: string
  include?: string[]
  backupDir?: string
  manifestName?: string
  dryRun?: boolean
}

export interface EnvuConfigFile {
  path: string
  relativePath: string
  group: string
  size: number
  modifiedMs: number
}

export interface EnvuBackupOperation {
  sourcePath: string
  targetPath: string
  status: "planned" | "success" | "error"
  reason?: string
}

export interface EnvuConfigData {
  files: EnvuConfigFile[]
  operations: EnvuBackupOperation[]
  manifestPath: string
  fileCount: number
  totalSize: number
  errors: string[]
}

export interface EnvuConfigRuntime {
  listFiles: (root: string) => Promise<Array<{ path: string; relativePath: string; size: number; modifiedMs: number }>>
  copyFile: (source: string, target: string) => Promise<void>
  writeText: (path: string, content: string) => Promise<void>
  makeDir: (path: string) => Promise<void>
  join: (...parts: string[]) => string
  dirname: (path: string) => string
}

export type EnvuConfigResult = NodeRunResult<EnvuConfigData>

export const DEFAULT_ENVU_INCLUDE = [
  "config/",
  "dotfile/",
  "src/scoolp/*.toml",
  "src/linku/*.toml",
  "src/owithu/*.toml",
  "src/reinstallp/*.toml",
  "*.toml",
  "*.md",
  "output_paths.txt",
]

export function normalizeEnvuConfigInput(input: EnvuConfigInput): Required<EnvuConfigInput> {
  return {
    action: input.action ?? "scan",
    root: clean(input.root),
    include: input.include?.length ? input.include : DEFAULT_ENVU_INCLUDE,
    backupDir: clean(input.backupDir),
    manifestName: clean(input.manifestName) || "envu-config-manifest.json",
    dryRun: input.dryRun ?? false,
  }
}

export async function runEnvuConfig(
  input: EnvuConfigInput,
  runtime: EnvuConfigRuntime,
  onEvent: (event: NodeRunEvent) => void = () => {},
): Promise<EnvuConfigResult> {
  const normalized = normalizeEnvuConfigInput(input)
  try {
    if (!normalized.root) return failure("EnvU root is required.")
    onEvent({ type: "progress", progress: 25, message: "Scanning EnvU config files." })
    const files = classifyEnvuFiles(await runtime.listFiles(normalized.root), normalized.include)
    if (normalized.action === "scan") return success(`Found ${files.length} EnvU config file(s).`, { files })

    const manifestPath = normalized.backupDir
      ? runtime.join(normalized.backupDir, normalized.manifestName)
      : runtime.join(normalized.root, normalized.manifestName)
    const manifest = renderManifest(normalized.root, files)
    if (normalized.action === "manifest" || normalized.dryRun) {
      return success(`Manifest planned for ${files.length} file(s).`, { files, manifestPath, operations: buildBackupOperations(files, normalized, runtime) })
    }

    onEvent({ type: "progress", progress: 65, message: "Backing up EnvU config files." })
    if (!normalized.backupDir) return failure("backupDir is required for backup.")
    await runtime.makeDir(normalized.backupDir)
    const operations = await executeBackup(buildBackupOperations(files, normalized, runtime), runtime)
    await runtime.writeText(manifestPath, manifest)
    const failed = operations.filter((item) => item.status === "error")
    return {
      success: failed.length === 0,
      message: `EnvU backup completed: ${operations.length - failed.length} success, ${failed.length} failed.`,
      data: data({ files, operations, manifestPath, errors: failed.map((item) => `${item.sourcePath}: ${item.reason}`) }),
    }
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error))
  }
}

export const runEnvuconfig = runEnvuConfig

export function classifyEnvuFiles(
  files: Array<{ path: string; relativePath: string; size: number; modifiedMs: number }>,
  include: string[],
): EnvuConfigFile[] {
  return files
    .filter((file) => include.some((pattern) => matchesPattern(normalizeSlash(file.relativePath), pattern)))
    .map((file) => ({ ...file, relativePath: normalizeSlash(file.relativePath), group: groupFor(normalizeSlash(file.relativePath)) }))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath, undefined, { numeric: true, sensitivity: "base" }))
}

export function buildBackupOperations(
  files: EnvuConfigFile[],
  input: Pick<Required<EnvuConfigInput>, "backupDir">,
  runtime: Pick<EnvuConfigRuntime, "join">,
): EnvuBackupOperation[] {
  if (!input.backupDir) return []
  return files.map((file) => ({
    sourcePath: file.path,
    targetPath: runtime.join(input.backupDir, ...file.relativePath.split("/")),
    status: "planned",
  }))
}

export function renderManifest(root: string, files: EnvuConfigFile[]): string {
  return `${JSON.stringify({
    root,
    createdAt: new Date(0).toISOString(),
    fileCount: files.length,
    totalSize: files.reduce((sum, file) => sum + file.size, 0),
    files,
  }, null, 2)}\n`
}

async function executeBackup(operations: EnvuBackupOperation[], runtime: EnvuConfigRuntime): Promise<EnvuBackupOperation[]> {
  const results: EnvuBackupOperation[] = []
  for (const operation of operations) {
    try {
      await runtime.makeDir(runtime.dirname(operation.targetPath))
      await runtime.copyFile(operation.sourcePath, operation.targetPath)
      results.push({ ...operation, status: "success" })
    } catch (error) {
      results.push({ ...operation, status: "error", reason: error instanceof Error ? error.message : String(error) })
    }
  }
  return results
}

function matchesPattern(path: string, pattern: string): boolean {
  const normalized = normalizeSlash(pattern)
  if (normalized.endsWith("/")) return path.startsWith(normalized)
  if (normalized.includes("*")) {
    const regex = new RegExp(`^${normalized.split("*").map(escapeRegex).join("[^/]*")}$`, "i")
    return regex.test(path)
  }
  return path === normalized || path.endsWith(`/${normalized}`)
}

function groupFor(relativePath: string): string {
  if (relativePath.startsWith("config/")) return "config"
  if (relativePath.startsWith("dotfile/")) return "dotfile"
  if (relativePath.includes("/")) return relativePath.split("/")[1] ?? "tool"
  return "root"
}

function normalizeSlash(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "")
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function data(partial: Partial<EnvuConfigData>): EnvuConfigData {
  const files = partial.files ?? []
  return {
    files,
    operations: [],
    manifestPath: "",
    fileCount: files.length,
    totalSize: files.reduce((sum, file) => sum + file.size, 0),
    errors: [],
    ...partial,
  }
}

function success(message: string, partial: Partial<EnvuConfigData>): EnvuConfigResult {
  return { success: true, message, data: data(partial) }
}

function failure(message: string): EnvuConfigResult {
  return { success: false, message, data: data({ errors: [message] }) }
}

function clean(value?: string): string {
  return (value ?? "").trim().replace(/^["']|["']$/g, "")
}

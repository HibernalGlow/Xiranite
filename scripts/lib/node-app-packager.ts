import { createHash } from "node:crypto"
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { readNodeAppDeclaration, readNodeDef, type NodeAppLiteral, type NodeDefLiteral } from "./read-node-def.js"

export const NODE_APP_SNAPSHOT_SCHEMA_VERSION = 1
export const NODE_APP_MINIMUM_BUN_VERSION = "1.3.0"
export const NODE_APP_DATA_CONTRACT_VERSION = 1

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const textExtensions = new Set([".css", ".go", ".html", ".ico", ".json", ".manifest", ".svg", ".toml", ".ts", ".tsx", ".txt", ".yaml", ".yml"])

export interface NodeAppSourceFile {
  path: string
  sha256: string
  bytes: number
}

export interface NodeAppSnapshotManifest {
  schemaVersion: typeof NODE_APP_SNAPSHOT_SCHEMA_VERSION
  node: {
    id: string
    name: string
    version: string
    icon: string
    backendFeatures: string[]
    nativeProbe?: NodeAppLiteral["nativeProbe"]
    releaseGate?: NodeAppLiteral["releaseGate"]
  }
  source: {
    commit: string | null
    dirty: boolean
    files: NodeAppSourceFile[]
  }
  target: {
    platform: "windows"
    arch: "amd64"
  }
  toolchain: {
    bun: string
    go: string
  }
  runtime: {
    minimumBunVersion: string
  }
  dataContract: {
    currentVersion: number
    minimumSupportedVersion: number
    maximumSupportedVersion: number
  }
  snapshotId: string
}

export interface NodeAppSnapshot {
  manifest: NodeAppSnapshotManifest
  stageDirectory: string
  manifestPath: string
}

export interface CreateNodeAppSnapshotOptions {
  repoRoot?: string
  nodeId: string
  stagingRoot?: string
  bunVersion?: string
  goVersion?: string
  commit?: string | null
}

export interface NodeAppMetadata {
  def: NodeDefLiteral
  declaration: NodeAppLiteral
}

/**
 * Freeze the current source content needed to build one standalone node. The
 * result intentionally lives below `build/node-apps/.staging`: published EXEs
 * are written elsewhere and are never replaced or removed by this function.
 */
export async function createNodeAppSnapshot(options: CreateNodeAppSnapshotOptions): Promise<NodeAppSnapshot> {
  const root = resolve(options.repoRoot ?? repoRoot)
  const metadata = await readNodeAppMetadata(root, options.nodeId)
  const sourcePaths = await collectNodeAppSourcePaths(root, options.nodeId, metadata.declaration.backendFeatures)
  const files = await hashSourceFiles(root, sourcePaths)
  const commit = options.commit === undefined ? await gitValue(root, ["rev-parse", "HEAD"]) : options.commit
  const dirty = await hasDirtyInput(root, sourcePaths)
  const bun = options.bunVersion ?? await commandVersion(root, [process.execPath, "--version"])
  const go = options.goVersion ?? await commandVersion(root, ["go", "version"])
  const dataContract = resolveNodeAppDataContract(metadata.declaration)
  const snapshotId = computeSnapshotId({
    nodeId: metadata.def.id,
    nodeVersion: metadata.def.version,
    backendFeatures: metadata.declaration.backendFeatures,
    nativeProbe: metadata.declaration.nativeProbe,
    releaseGate: metadata.declaration.releaseGate,
    files,
    bun,
    go,
    dataContract,
  })
  const manifest: NodeAppSnapshotManifest = {
    schemaVersion: NODE_APP_SNAPSHOT_SCHEMA_VERSION,
    node: {
      id: metadata.def.id,
      name: metadata.def.name,
      version: metadata.def.version,
      icon: metadata.def.icon,
      backendFeatures: metadata.declaration.backendFeatures,
      nativeProbe: metadata.declaration.nativeProbe,
      releaseGate: metadata.declaration.releaseGate,
    },
    source: { commit, dirty, files },
    target: { platform: "windows", arch: "amd64" },
    toolchain: { bun, go },
    runtime: { minimumBunVersion: NODE_APP_MINIMUM_BUN_VERSION },
    dataContract,
    snapshotId,
  }

  const stagingRoot = resolve(options.stagingRoot ?? join(root, "build", "node-apps", ".staging"))
  const stageDirectory = join(stagingRoot, `${metadata.def.id}-${snapshotId}`)
  const manifestPath = join(stageDirectory, "node-app-manifest.json")
  await rm(stageDirectory, { force: true, recursive: true })
  await mkdir(stageDirectory, { recursive: true })
  await copySourceFiles(root, stageDirectory, sourcePaths)
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
  return { manifest, stageDirectory, manifestPath }
}

export async function readNodeAppMetadata(root: string, nodeId: string): Promise<NodeAppMetadata> {
  const packageEntry = join(root, "packages", "nodes", nodeId, "src", "index.ts")
  const appEntry = join(root, "src", "nodes", nodeId, "entry.ts")
  const [def, declaration] = await Promise.all([readNodeDef(packageEntry), readNodeAppDeclaration(appEntry)])
  if (def.id !== nodeId) throw new Error(`Node package def.id (${def.id}) must match requested node ID (${nodeId}).`)
  if (!declaration) throw new Error(`Node ${nodeId} has not opted in to standalone packaging (add nodeApp: true to ${relative(root, appEntry)}).`)
  return { def, declaration }
}

/**
 * The host and shared packages form the common runtime closure. Node package
 * directories are deliberately narrow: another node's dirty source must never
 * affect this snapshot's identity or be copied into its staging tree.
 */
export async function collectNodeAppSourcePaths(root: string, nodeId: string, backendFeatures: readonly string[] = []): Promise<string[]> {
  const tracked = [
    ...await gitLines(root, ["ls-files", "--cached", "--others", "--exclude-standard"]),
    ...await collectSubmoduleFiles(root, "vendor/folia-major", "packages/player"),
    ...await collectSubmoduleFiles(root, "vendor/folia-major", "src/i18n"),
    ...await collectSubmoduleExactFiles(root, "vendor/folia-major", ["tsconfig.json"]),
    ...await collectSubmoduleFiles(root, "vendor/ocean-dataview"),
  ]
  const prefixes = [
    "build/windows/",
    "config/",
    "desktop/",
    "internal/",
    "packages/api/",
    "packages/backend/",
    "packages/config/",
    "packages/cli-runtime/",
    "packages/cli/",
    "packages/contract/",
    "packages/czkawka-native/",
    "packages/file-operations/",
    "packages/logging/",
    "packages/native-loader/",
    "packages/repository/",
    "packages/runtime/",
    "packages/services/",
    "packages/slimg-native/",
    "packages/shared/",
    ...(backendFeatures.includes("reader") ? ["packages/arcthumb-native/"] : []),
    "native/prebuilt/win32-x64/",
    `packages/nodes/${nodeId}/`,
    "scripts/",
    `src/nodes/${nodeId}/`,
    "src/nodes/shared/",
    "vendor/folia-major/packages/player/",
    "vendor/folia-major/src/i18n/",
    "vendor/ocean-dataview/",
  ]
  const rootFiles = new Set([
    "bun.lock",
    "go.mod",
    "go.sum",
    "index.html",
    "node-app.html",
    "package.json",
    "tailwind.config.ts",
    "tsconfig.app.json",
    "tsconfig.node.json",
    "tsconfig.json",
    "vite.config.ts",
    "vendor/folia-major/tsconfig.json",
  ])
  const selected = tracked.filter((path) => {
    const normalized = path.replaceAll("\\", "/")
    if (rootFiles.has(normalized) || normalized.endsWith(".go")) return true
    if (normalized.startsWith("native/prebuilt/win32-x64/")) return true
    if (normalized.startsWith("src/") && !normalized.startsWith("src/nodes/")) return isSourceFile(normalized)
    return prefixes.some((prefix) => normalized.startsWith(prefix)) && isSourceFile(normalized)
  })
  if (!selected.includes(`src/nodes/${nodeId}/entry.ts`)) {
    throw new Error(`Node ${nodeId} has no frontend entry at src/nodes/${nodeId}/entry.ts.`)
  }
  if (!selected.includes(`packages/nodes/${nodeId}/src/index.ts`)) {
    throw new Error(`Node ${nodeId} has no package entry at packages/nodes/${nodeId}/src/index.ts.`)
  }
  return [...new Set(selected)].sort()
}

async function collectSubmoduleFiles(root: string, relativeModulePath: string, relativeSourcePath = ""): Promise<string[]> {
  const moduleRoot = join(root, relativeModulePath)
  const output = await run(moduleRoot, ["git", "ls-files", "--cached", "--others", "--exclude-standard"], false)
  if (!output) return []
  const prefix = relativeSourcePath ? `${relativeSourcePath.replaceAll("\\", "/").replace(/\/$/, "")}/` : ""
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((path) => path.startsWith(prefix))
    .map((path) => `${relativeModulePath}/${path}`.replaceAll("\\", "/"))
}

async function collectSubmoduleExactFiles(root: string, relativeModulePath: string, paths: readonly string[]): Promise<string[]> {
  const moduleRoot = join(root, relativeModulePath)
  const output = await run(moduleRoot, ["git", "ls-files", "--cached", "--others", "--exclude-standard"], false)
  if (!output) return []
  const selected = new Set(paths)
  return output
    .split(/\r?\n/)
    .filter((path) => selected.has(path))
    .map((path) => `${relativeModulePath}/${path}`.replaceAll("\\", "/"))
}

export function computeSnapshotId(input: {
  nodeId: string
  nodeVersion: string
  backendFeatures: readonly string[]
  nativeProbe?: NodeAppLiteral["nativeProbe"]
  releaseGate?: NodeAppLiteral["releaseGate"]
  files: readonly NodeAppSourceFile[]
  bun: string
  go: string
  minimumBunVersion?: string
  dataContract?: NodeAppSnapshotManifest["dataContract"]
}): string {
  const normalized = JSON.stringify({
    schemaVersion: NODE_APP_SNAPSHOT_SCHEMA_VERSION,
    nodeId: input.nodeId,
    nodeVersion: input.nodeVersion,
    backendFeatures: [...input.backendFeatures].sort(),
    nativeProbe: input.nativeProbe,
    releaseGate: input.releaseGate,
    files: [...input.files].sort((left, right) => left.path.localeCompare(right.path)),
    bun: input.bun,
    go: input.go,
    minimumBunVersion: input.minimumBunVersion ?? NODE_APP_MINIMUM_BUN_VERSION,
    dataContract: input.dataContract ?? {
      currentVersion: NODE_APP_DATA_CONTRACT_VERSION,
      minimumSupportedVersion: NODE_APP_DATA_CONTRACT_VERSION,
      maximumSupportedVersion: NODE_APP_DATA_CONTRACT_VERSION,
    },
    platform: "windows",
    arch: "amd64",
  })
  return createHash("sha256").update(normalized).digest("hex")
}

function resolveNodeAppDataContract(declaration: NodeAppLiteral): NodeAppSnapshotManifest["dataContract"] {
  const minimumSupportedVersion = declaration.dataContract?.minimumVersion ?? NODE_APP_DATA_CONTRACT_VERSION
  const maximumSupportedVersion = declaration.dataContract?.maximumVersion ?? NODE_APP_DATA_CONTRACT_VERSION
  if (!Number.isSafeInteger(minimumSupportedVersion) || minimumSupportedVersion < 1) {
    throw new Error(`Node app minimum data contract version must be a positive integer, received ${minimumSupportedVersion}.`)
  }
  if (!Number.isSafeInteger(maximumSupportedVersion) || maximumSupportedVersion < minimumSupportedVersion) {
    throw new Error(`Node app maximum data contract version must be an integer no lower than ${minimumSupportedVersion}, received ${maximumSupportedVersion}.`)
  }
  return {
    currentVersion: maximumSupportedVersion,
    minimumSupportedVersion,
    maximumSupportedVersion,
  }
}

async function hashSourceFiles(root: string, paths: readonly string[]): Promise<NodeAppSourceFile[]> {
  return await Promise.all(paths.map(async (path) => {
    const absolute = resolve(root, path)
    const [content, info] = await Promise.all([readFile(absolute), stat(absolute)])
    return {
      path: path.replaceAll("\\", "/"),
      sha256: createHash("sha256").update(content).digest("hex"),
      bytes: info.size,
    }
  }))
}

async function copySourceFiles(root: string, stageDirectory: string, paths: readonly string[]): Promise<void> {
  for (const path of paths) {
    const source = resolve(root, path)
    const destination = resolve(stageDirectory, path)
    if (!destination.startsWith(`${stageDirectory}${sep}`)) throw new Error(`Unsafe source path: ${path}`)
    await mkdir(dirname(destination), { recursive: true })
    await cp(source, destination, { force: false })
  }
}

function isSourceFile(path: string): boolean {
  if (path.includes("/.turbo/") || path.includes("/.tmp/") || path.includes("/__screenshots__/")) return false
  const base = path.slice(path.lastIndexOf("/") + 1)
  if (base.endsWith(".test.ts") || base.endsWith(".test.tsx") || base.endsWith(".browser.test.tsx")) return false
  const extension = base.slice(base.lastIndexOf("."))
  return textExtensions.has(extension) || base === "Dockerfile" || base === "Makefile"
}

async function hasDirtyInput(root: string, paths: readonly string[]): Promise<boolean> {
  const dirty = await gitLines(root, ["status", "--porcelain", "--untracked-files=all"])
  const inputs = new Set(paths)
  return dirty.some((line) => {
    const path = line.slice(3).split(" -> ").at(-1)?.replaceAll("\\", "/")
    return path !== undefined && inputs.has(path)
  })
}

async function gitValue(root: string, args: string[]): Promise<string | null> {
  const output = await run(root, ["git", ...args], false)
  return output === undefined ? null : output.trim() || null
}

async function gitLines(root: string, args: string[]): Promise<string[]> {
  const output = await run(root, ["git", ...args])
  return output.split(/\r?\n/).filter(Boolean)
}

async function commandVersion(root: string, command: string[]): Promise<string> {
  const output = await run(root, command, false)
  return output?.trim() || "unavailable"
}

async function run(root: string, command: string[], required = true): Promise<string | undefined> {
  const child = Bun.spawn(command, { cwd: root, stdout: "pipe", stderr: "pipe" })
  const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  if (exitCode !== 0) {
    if (!required) return undefined
    throw new Error(`${command.join(" ")} failed: ${stderr.trim() || `exit code ${exitCode}`}`)
  }
  return stdout
}

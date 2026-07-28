export interface SourceDiscoveryPathInfo {
  path: string
  exists: boolean
  isFile: boolean
  isDirectory: boolean
}

export interface SourceDiscoveryDirEntry {
  path: string
  isFile: boolean
  isDirectory: boolean
}

export interface SourceDiscoveryRuntime {
  pathInfo: (path: string) => Promise<SourceDiscoveryPathInfo>
  listDir: (path: string) => Promise<SourceDiscoveryDirEntry[]>
  streamDir?: (path: string) => AsyncIterable<SourceDiscoveryDirEntry>
  extname: (path: string) => string
  checkMemory?: () => void
  isCancelled?: () => boolean
}

export interface DirectorySourcePolicy {
  acceptsFile(path: string): boolean
  traversesDirectory(path: string): boolean
  description?: string
}

interface DirectorySourcePolicyOptions {
  action: "plan" | "convert" | "diagnose"
  outputMode: "source" | "directory"
  outputDir?: string
  sourceRoots: string[]
  generatedExtensions: Iterable<string>
  extname: (path: string) => string
  relative: (from: string, to: string) => string
}

const DEFAULT_DIRECTORY_SOURCE_POLICY: DirectorySourcePolicy = {
  acceptsFile: (path) => !isInternalArtifact(path),
  traversesDirectory: () => true,
}

export function createDirectorySourcePolicy(options: DirectorySourcePolicyOptions): DirectorySourcePolicy {
  if (options.action !== "convert") return DEFAULT_DIRECTORY_SOURCE_POLICY
  const generatedExtensions = new Set([...options.generatedExtensions].map(normalizeExtension))
  const outputDir = options.outputMode === "directory" ? options.outputDir : undefined
  const outputInsideSource = Boolean(outputDir && options.sourceRoots.some((root) => isPathInside(root, outputDir, options.relative)))
  const outputMatchesSource = Boolean(outputDir && options.sourceRoots.some((root) => pathsMatch(root, outputDir, options.relative)))
  const excludeGeneratedExtensions = generatedExtensions.size > 0 && (options.outputMode === "source" || outputMatchesSource)
  const excludeOutputSubtree = outputInsideSource && !outputMatchesSource

  return {
    acceptsFile: (path) => !isInternalArtifact(path)
      && (!excludeGeneratedExtensions || !generatedExtensions.has(normalizeExtension(options.extname(path)))),
    traversesDirectory: (path) => !excludeOutputSubtree || !isPathInside(outputDir!, path, options.relative),
    ...(!excludeGeneratedExtensions && !excludeOutputSubtree ? {} : {
      description: excludeOutputSubtree
        ? `output subtree ${outputDir} is excluded from recursive discovery`
        : `generated ${[...generatedExtensions].join(", ")} files are excluded from directory discovery; explicit files and EFU records remain eligible`,
    }),
  }
}

export async function* streamDiscoveredImages(
  paths: string[],
  recursive: boolean,
  runtime: SourceDiscoveryRuntime,
  imageExtensions: ReadonlySet<string>,
  policy: DirectorySourcePolicy = DEFAULT_DIRECTORY_SOURCE_POLICY,
): AsyncGenerator<string> {
  for (const path of paths) {
    runtime.checkMemory?.()
    if (runtime.isCancelled?.()) return
    const info = await runtime.pathInfo(path)
    if (!info.exists) continue
    if (info.isFile && imageExtensions.has(normalizeExtension(runtime.extname(info.path)))) {
      yield info.path
      continue
    }
    if (info.isDirectory) yield* streamDirectoryImages(info.path, recursive, runtime, imageExtensions, policy)
  }
}

async function* streamDirectoryImages(
  path: string,
  recursive: boolean,
  runtime: SourceDiscoveryRuntime,
  imageExtensions: ReadonlySet<string>,
  policy: DirectorySourcePolicy,
): AsyncGenerator<string> {
  for await (const entry of streamDirectoryEntries(path, runtime)) {
    runtime.checkMemory?.()
    if (runtime.isCancelled?.()) return
    if (entry.isFile && imageExtensions.has(normalizeExtension(runtime.extname(entry.path))) && policy.acceptsFile(entry.path)) yield entry.path
    else if (recursive && entry.isDirectory && policy.traversesDirectory(entry.path)) yield* streamDirectoryImages(entry.path, true, runtime, imageExtensions, policy)
  }
}

async function* streamDirectoryEntries(path: string, runtime: SourceDiscoveryRuntime): AsyncGenerator<SourceDiscoveryDirEntry> {
  if (runtime.streamDir) {
    yield* runtime.streamDir(path)
    return
  }
  for (const entry of await runtime.listDir(path)) yield entry
}

function isInternalArtifact(path: string): boolean {
  return path.toLocaleLowerCase("en-US").includes(".xlchemy-")
}

function normalizeExtension(extension: string): string {
  const normalized = extension.toLocaleLowerCase("en-US")
  return normalized && !normalized.startsWith(".") ? `.${normalized}` : normalized
}

function pathsMatch(left: string, right: string, relative: (from: string, to: string) => string): boolean {
  if (pathIdentity(left) === pathIdentity(right)) return true
  const relation = normalizeRelative(relative(left, right))
  return relation === "" || relation === "."
}

function isPathInside(parent: string, child: string, relative: (from: string, to: string) => string): boolean {
  if (pathsMatch(parent, child, relative)) return true
  const relation = normalizeRelative(relative(parent, child))
  return !relation.startsWith("../") && relation !== ".." && !relation.startsWith("/") && !/^[a-z]:\//i.test(relation)
}

function normalizeRelative(path: string): string {
  return path.replaceAll("\\", "/")
}

function pathIdentity(path: string): string {
  const normalized = normalizeRelative(path).replace(/\/+$/, "")
  return (normalized || "/").toLocaleLowerCase("en-US")
}

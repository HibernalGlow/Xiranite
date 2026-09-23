import { cp, mkdir, readdir, readFile, realpath, rm, stat } from "node:fs/promises"
import path from "node:path"

export interface NativeBundleDependency {
  /** Bare specifier the inlined code asks for at runtime, e.g. `@libsql/darwin-arm64`. */
  specifier: string
  directory: string
  version: string
}

/**
 * `libsql` loads its native binding through a runtime-computed bare specifier
 * (`require(\`@libsql/${target}\`)` in its index.js), so Bun cannot rewrite it into
 * the `backend-assets/[name]-[hash].node` sidecar form that every other native
 * dependency in this bundle uses. A packaged host extracts the bundle into a cache
 * directory with nothing above it, so that specifier has no `node_modules` to walk
 * into and the backend dies on its first database access. The installed binding is
 * therefore copied next to the emitted bundle, which the production host embeds and
 * extracts with it, and Node resolves it through its ordinary lookup.
 */
export async function stageNativeBundleDependencies(options: {
  importerFile: string
  outputDirectory: string
}): Promise<NativeBundleDependency[]> {
  const dependencies = await findNativeBundleDependencies(options.importerFile)
  const destinationRoot = path.join(options.outputDirectory, "node_modules")
  await rm(destinationRoot, { recursive: true, force: true })
  if (dependencies.length === 0) {
    // The bundle always keeps libsql's runtime specifier, so staging nothing is a
    // broken release rather than an optional dependency going unused. Fail here
    // instead of leaving `go:embed` to report a directory with no embeddable files.
    throw new Error(
      "no @libsql native binding is installed for this platform; the packaged backend would fail on its " +
        `first database access. Looked below ${await libsqlBindingsRootDirectory(options.importerFile)} — ` +
        "run `bun install` so the platform package for this host is present.",
    )
  }
  for (const dependency of dependencies) {
    const destination = path.join(destinationRoot, ...dependency.specifier.split("/"))
    await mkdir(path.dirname(destination), { recursive: true })
    // `dereference` is not cosmetic: in Bun's isolated layout a package's files can
    // be reached through links, `fs.cp` copies links as links by default, and a
    // copied link would address the build machine's store. `go:embed` skips links, so
    // the release host would silently ship without the binding it needs.
    await cp(dependency.directory, destination, { recursive: true, dereference: true, errorOnExist: true })
    const binding = await firstRegularFile(destination)
    if (!binding) {
      throw new Error(
        `staged ${dependency.specifier} but found no regular file below ${destination}; ` +
          "the copy kept a symlink or the package is empty",
      )
    }
    console.log(`[backend-js] Bundled native dependency ${dependency.specifier}@${dependency.version} (${binding})`)
  }
  return dependencies
}

/**
 * Resolve from the importing source file, then from the package that declares the
 * binding, so the answer follows whatever layout the installer produced: a hoisted
 * tree, a nested `libsql/node_modules`, or Bun's `isolated` layout where the binding
 * only resolves as a sibling of `libsql` under `.bun/`.
 */
export async function libsqlBindingsRootDirectory(importerFile: string): Promise<string> {
  const clientPackage = Bun.resolveSync("@libsql/client/package.json", importerFile)
  const libsqlPackage = Bun.resolveSync("libsql/package.json", clientPackage)
  // Resolve the link before deriving the sibling layout: `libsql` itself is a symlink
  // in the isolated tree, and its parent only becomes meaningful once it names the
  // store directory that actually holds the bindings.
  const libsqlDirectory = await realpath(path.dirname(libsqlPackage))
  const candidates = [
    path.join(libsqlDirectory, "node_modules", "@libsql"),
    path.join(path.dirname(libsqlDirectory), "@libsql"),
  ]
  for (const candidate of candidates) {
    const entries = await readdir(candidate, { withFileTypes: true }).catch(() => [])
    if (entries.length > 0) return candidate
  }
  return candidates[candidates.length - 1]!
}

export async function findNativeBundleDependencies(importerFile: string): Promise<NativeBundleDependency[]> {
  const scopeDirectory = await libsqlBindingsRootDirectory(importerFile)
  const entries = await readdir(scopeDirectory, { withFileTypes: true }).catch(() => [])
  const found: NativeBundleDependency[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    const directory = await realpath(path.join(scopeDirectory, entry.name)).catch(() => undefined)
    if (!directory) continue
    const specifier = `@libsql/${entry.name}`
    const parsed = JSON.parse(
      await readFile(path.join(directory, "package.json"), "utf8").catch(() => "{}"),
    ) as { os?: unknown; version?: unknown }
    // Only the platform binding packages carry an `os` field; the pure-JS
    // `@libsql/client`, `@libsql/core` and `@libsql/hrana-client` siblings do not.
    if (!Array.isArray(parsed.os)) continue
    found.push({ specifier, directory, version: typeof parsed.version === "string" ? parsed.version : "unknown" })
  }
  return found.sort((left, right) => left.specifier.localeCompare(right.specifier))
}

/** Absolute path of the first non-link regular file below `directory`, if any. */
async function firstRegularFile(directory: string): Promise<string | undefined> {
  const queue = [directory]
  while (queue.length > 0) {
    const current = queue.pop()!
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue
      const entryPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        queue.push(entryPath)
        continue
      }
      if ((await stat(entryPath)).isFile()) return entryPath
    }
  }
  return undefined
}

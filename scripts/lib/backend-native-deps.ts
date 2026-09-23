import { cp, mkdir, readFile, readdir, rm } from "node:fs/promises"
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
  for (const dependency of dependencies) {
    const destination = path.join(destinationRoot, ...dependency.specifier.split("/"))
    await mkdir(path.dirname(destination), { recursive: true })
    await cp(dependency.directory, destination, { recursive: true })
    console.log(`[backend-js] Bundled native dependency ${dependency.specifier}@${dependency.version}`)
  }
  return dependencies
}

/**
 * Resolve from the importing source file, then from the package that declares the
 * binding, so the answer follows whatever layout the installer produced: a hoisted
 * tree, a nested `libsql/node_modules`, or Bun's `isolated` layout where the binding
 * only resolves as a sibling of `libsql` under `.bun/`.
 */
export async function findNativeBundleDependencies(importerFile: string): Promise<NativeBundleDependency[]> {
  const clientPackage = Bun.resolveSync("@libsql/client/package.json", importerFile)
  const libsqlPackage = Bun.resolveSync("libsql/package.json", clientPackage)
  // The directory that holds `libsql` is where its own optional bindings live:
  // `node_modules` for a hoisted or npm-nested install, and the package's private
  // tree under `.bun/<name>@<version>/node_modules` for Bun's isolated layout.
  const scopeDirectory = path.join(path.dirname(path.dirname(libsqlPackage)), "@libsql")
  const entries = await readdir(scopeDirectory, { withFileTypes: true }).catch(() => [])
  const found: NativeBundleDependency[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    const directory = path.join(scopeDirectory, entry.name)
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

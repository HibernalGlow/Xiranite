#!/usr/bin/env bun
import { access, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { spawn } from "node:child_process"
import { getDisabledNodeIds } from "./lib/node-build-config.js"

const repoRoot = resolve(import.meta.dirname, "..")
const verbose = process.argv.includes("--verbose")
const skipFailedNodes = process.argv.includes("--skip-failed-nodes")
const skipCli = process.argv.includes("--skip-cli")
const defaultExcludedNodeIds = await getDisabledNodeIds({ cwd: repoRoot })
const requestedExcludedNodeIds = parseNodeIds(optionValue("--exclude-nodes"))
const excludedNodeIds = [...new Set([...defaultExcludedNodeIds, ...requestedExcludedNodeIds])]
const onlyNodeIds = parseNodeIds(optionValue("--only-nodes"))
const failuresFile = optionValue("--failures-file")

interface PackageEntry {
  name: string
  path: string
  script: string
  id?: string
  dependencies?: string[]
  // Which package.json script to run; "build" unless a declarations-only build is
  // enough for this package.
  scriptTask?: string
}

interface WorkspacePackage extends PackageEntry {
  dependencies: string[]
  typeScriptTask?: string
}

// These lists only say which packages a phase is entered through. The build order
// and the transitive workspace dependencies are derived from the manifests below:
// a hand-maintained order silently shipped packages whose own dependencies were
// never built, which only fails on a clean checkout where no stale dist hides it.
const baseSeedNames = [
  "@xiranite/config",
  "@xiranite/contract",
  "@xiranite/shared",
  "@xiranite/shell-integration",
  "@xiranite/logging",
  "@xiranite/cli-runtime",
  "@xiranite/file-operations",
  "@xiranite/repository",
  "@xiranite/services",
  "@xiranite/api",
]

const extraSeedNames = [
  "@xiranite/runtime",
  "@xiranite/backend",
  ...(skipCli ? [] : ["@xiranite/cli"]),
]

async function readWorkspacePackages(): Promise<Map<string, WorkspacePackage>> {
  const packagesRoot = join(repoRoot, "packages")
  const found = new Map<string, WorkspacePackage>()
  const read = async (pkgDir: string, relPath: string, id?: string) => {
    const manifestPath = join(pkgDir, "package.json")
    let manifest: {
      name?: string
      scripts?: Record<string, string>
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    try {
      manifest = JSON.parse(await readFile(manifestPath, "utf8"))
    } catch {
      return
    }
    const name = manifest.name ?? id ?? ""
    if (!name) return
    found.set(name, {
      name,
      id,
      path: relPath,
      script: manifest.scripts?.build ?? "",
      typeScriptTask: manifest.scripts?.["build:tsc"],
      dependencies: Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).filter((dep) => dep.startsWith("@xiranite/")),
    })
  }
  for (const entry of await readdir(packagesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (entry.name !== "nodes") {
      await read(join(packagesRoot, entry.name), join("packages", entry.name))
      continue
    }
    // Node packages live one level deeper, and their directory name is the node id
    // used by the build filter and the dist-backup behaviour in runBuild.
    for (const node of await readdir(join(packagesRoot, "nodes"), { withFileTypes: true })) {
      if (node.isDirectory()) await read(join(packagesRoot, "nodes", node.name), join("packages/nodes", node.name), node.name)
    }
  }
  return found
}

// buildOrder returns every package the seeds need, dependencies first, and only
// among the names `allowed` permits. A phase passes its own scope so a node that
// depends on a shared package does not pull that package back into the node
// phase, and a disabled node is never built as a side effect.
function buildOrder(seeds: string[], packages: Map<string, WorkspacePackage>, label: string, allowed?: Set<string>): PackageEntry[] {
  const ordered: PackageEntry[] = []
  const state = new Map<string, "visiting" | "done">()
  const visit = (name: string, trail: string[]) => {
    const mark = state.get(name)
    if (mark === "done") return
    if (mark === "visiting") throw new Error(`${label}: workspace dependency cycle: ${[...trail, name].join(" -> ")}`)
    const pkg = packages.get(name)
    if (!pkg) throw new Error(`${label}: unknown workspace package ${name}`)
    state.set(name, "visiting")
    for (const dependency of pkg.dependencies) {
      if (packages.has(dependency) && (!allowed || allowed.has(dependency))) visit(dependency, [...trail, name])
    }
    state.set(name, "done")
    if (pkg.script) ordered.push({ name: pkg.name, path: pkg.path, script: pkg.script, id: pkg.id, dependencies: pkg.dependencies })
  }
  for (const seed of seeds) visit(seed, [])
  return ordered
}

async function getLatestMtime(dir: string): Promise<number> {
  let latest = 0
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        latest = Math.max(latest, await getLatestMtime(fullPath))
      } else {
        const s = await stat(fullPath)
        latest = Math.max(latest, s.mtimeMs)
      }
    }
  } catch {
    // directory may not exist
  }
  return latest
}

async function needsBuild(pkgPath: string): Promise<boolean> {
  const fullPath = resolve(repoRoot, pkgPath)
  const distPath = join(fullPath, "dist")

  const distMtime = await getLatestMtime(distPath)
  if (distMtime === 0) return true // dist does not exist or is empty
  if (!(await hasExpectedDistFiles(fullPath))) return true

  const srcPath = join(fullPath, "src")
  const srcMtime = await getLatestMtime(srcPath)

  const pkgJsonMtime = (await stat(join(fullPath, "package.json"))).mtimeMs
  const tsconfigMtime = (await stat(join(fullPath, "tsconfig.json"))).mtimeMs

  const needs = srcMtime > distMtime || pkgJsonMtime > distMtime || tsconfigMtime > distMtime
  if (verbose && srcMtime > distMtime) {
    console.log(`[debug] ${pkgPath} srcMtime(${new Date(srcMtime).toISOString()}) > distMtime(${new Date(distMtime).toISOString()})`)
  }
  return needs
}

async function hasExpectedDistFiles(packagePath: string): Promise<boolean> {
  try {
    const pkg = JSON.parse(await readFile(join(packagePath, "package.json"), "utf8")) as { exports?: unknown }
    const targets = new Set<string>()
    collectDistTargets(pkg.exports, targets)
    for (const target of targets) {
      try {
        await access(join(packagePath, target))
      } catch {
        return false
      }
    }
    return true
  } catch {
    return false
  }
}

function collectDistTargets(value: unknown, targets: Set<string>): void {
  if (typeof value === "string" && value.startsWith("./dist/")) {
    targets.add(value.slice(2))
    return
  }
  if (!value || typeof value !== "object") return
  for (const child of Object.values(value)) collectDistTargets(child, targets)
}

async function runBuild(pkg: PackageEntry, cwd: string): Promise<number> {
  const shouldBackupDist = Boolean(pkg.id)
  const distPath = join(cwd, "dist")
  const backupPath = join(cwd, `.dist.local-build-backup-${process.pid}`)
  let backedUp = false

  if (shouldBackupDist) {
    try {
      await rm(backupPath, { recursive: true, force: true })
      await access(distPath)
      await rename(distPath, backupPath)
      backedUp = true
    } catch {
      // A package without a previous dist can still be built normally.
    }
  }

  return await new Promise((resolve) => {
    console.log(`[build] ${pkg.name} ...`)
    const child = spawn("bun", ["run", pkg.scriptTask ?? "build"], {
      cwd,
      stdio: "inherit",
      shell: true,
    })
    child.on("exit", async (code) => {
      const exitCode = code ?? 1
      if (exitCode === 0) {
        if (backedUp) await rm(backupPath, { recursive: true, force: true })
      } else if (backedUp) {
        await rm(distPath, { recursive: true, force: true })
        await rename(backupPath, distPath)
        console.warn(`[restore] ${pkg.name} previous dist restored after failure`)
      }
      resolve(exitCode)
    })
    child.on("error", async () => {
      if (backedUp) {
        await rm(distPath, { recursive: true, force: true })
        await rename(backupPath, distPath)
      }
      resolve(1)
    })
  })
}

async function buildPackages(packages: PackageEntry[], label: string, force = false, preserveDist = false): Promise<{ ok: boolean; built: number; failed: string[] }> {
  const failed: string[] = []
  // Parallelize up-to-date checks: sequential recursive mtime walks over ~50
  // packages dominate warm `bun run dev` before Vite even starts.
  const checks = await Promise.all(packages.map(async (pkg) => ({
    pkg,
    needs: force || await needsBuild(pkg.path),
  })))
  const toBuild: PackageEntry[] = []
  for (const { pkg, needs } of checks) {
    if (needs) {
      toBuild.push(pkg)
    } else {
      console.log(`[skip] ${pkg.name} (up to date)`)
    }
  }

  if (toBuild.length === 0) {
    console.log(`[${label}] All packages up to date.`)
    return { ok: true, built: 0, failed }
  }

  console.log(`[${label}] Building ${toBuild.length}/${packages.length} packages...`)
  for (const pkg of toBuild) {
    const code = await runBuild(pkg, resolve(repoRoot, pkg.path))
    if (code !== 0) {
      console.error(`[error] ${pkg.name} build failed with exit code ${code}`)
      if (preserveDist && pkg.id) {
        failed.push(pkg.id)
        console.warn(`[local-build] Continuing without node ${pkg.id}.`)
        continue
      }
      return { ok: false, built: toBuild.length, failed }
    }
  }
  return { ok: true, built: toBuild.length, failed }
}

function optionValue(name: string): string | undefined {
  const index = process.argv.findIndex((arg) => arg === name)
  if (index >= 0) return process.argv[index + 1]
  return process.argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1)
}

function parseNodeIds(value: string | undefined): string[] {
  return [...new Set((value ?? "").split(",").map((id) => id.trim()).filter(Boolean))]
}

// --- main ---
const workspacePackages = await readWorkspacePackages()
// Node packages come out of the same map; sorting by node id keeps the set stable
// across platforms, because directory iteration order silently decides which
// package fails first when the build list is not dependency-ordered.
const discoveredNodePackages = [...workspacePackages.values()]
  .filter((pkg) => pkg.id && pkg.script)
  .sort((a, b) => (a.id ?? "").localeCompare(b.id ?? ""))
const excluded = new Set(excludedNodeIds)
const only = new Set(onlyNodeIds)
for (const id of [...defaultExcludedNodeIds, ...requestedExcludedNodeIds, ...only]) {
  if (!discoveredNodePackages.some((pkg) => pkg.id === id)) throw new Error(`Unknown node id in build filter: ${id}`)
}
const nodePackages = discoveredNodePackages.filter((pkg) => (only.size === 0 || only.has(pkg.id)) && !excluded.has(pkg.id))
if (nodePackages.length === 0) throw new Error("Node build filter selected no nodes.")

const sharedNames = new Set([...workspacePackages.values()].filter((pkg) => !pkg.id).map((pkg) => pkg.name))
// Nodes are built in their own phase, but a node that imports a shared package
// still needs that package's declarations first, so the base phase is seeded with
// every shared dependency the selected nodes declare.
const nodeSharedSeeds = [...new Set(nodePackages.flatMap((pkg) => pkg.dependencies ?? []).filter((dep) => sharedNames.has(dep)))]
const basePackages = buildOrder([...baseSeedNames, ...nodeSharedSeeds], workspacePackages, "base-packages", sharedNames)
const orderedNodes = buildOrder(nodePackages.map((pkg) => pkg.name), workspacePackages, "nodes", new Set(nodePackages.map((pkg) => pkg.name)))
const extraPackages = buildOrder(extraSeedNames, workspacePackages, "extra", sharedNames)

// A disabled node is not shipped, but an enabled package may still import its
// types, so only its declarations get compiled. Running the node's full build here
// is not an option: clipm's regenerates the Pydantic contract through uv against a
// CUDA-only torch wheel that has no macOS or Linux artifact.
const referencedNames = new Set([...basePackages, ...orderedNodes, ...extraPackages].flatMap((pkg) => pkg.dependencies ?? []))
const declarationOnly = discoveredNodePackages.filter((pkg) => pkg.id && excluded.has(pkg.id) && referencedNames.has(pkg.name))
for (const pkg of declarationOnly) {
  if (!pkg.typeScriptTask) {
    throw new Error(`${pkg.name} is disabled but referenced by a built package; add a "build:tsc" script so its types can compile without shipping the node`)
  }
}

// Build base packages first
const baseResult = await buildPackages(basePackages, "base-packages")
if (!baseResult.ok) process.exit(1)

if (declarationOnly.length > 0) {
  const declarationResult = await buildPackages(
    declarationOnly.map((pkg) => ({ name: pkg.name, path: pkg.path, script: pkg.script, id: pkg.id, scriptTask: pkg.typeScriptTask })),
    "disabled-node-declarations",
  )
  if (!declarationResult.ok) process.exit(1)
}

// If any base package was rebuilt, force-rebuild all nodes and extras because
// their dist may be stale against updated base-package types.
const forceDownstream = baseResult.built > 0

// Then nodes
const nodesResult = await buildPackages(orderedNodes, "nodes", forceDownstream, skipFailedNodes)
if (!nodesResult.ok) process.exit(1)

if (nodesResult.failed.length > 0) {
  const previousExcluded = parseNodeIds(process.env.XIRANITE_BUILD_EXCLUDE_NODES)
  process.env.XIRANITE_BUILD_EXCLUDE_NODES = [...new Set([...previousExcluded, ...nodesResult.failed])].join(",")
  const registryBuild = Bun.spawn([process.execPath, "scripts/generate-node-registries.ts"], {
    cwd: repoRoot,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: process.env,
  })
  const registryExitCode = await registryBuild.exited
  if (registryExitCode !== 0) process.exit(registryExitCode)
}

// Then extra
const extraResult = await buildPackages(extraPackages, "extra", forceDownstream)
if (!extraResult.ok) process.exit(1)

if (failuresFile) {
  const outputPath = resolve(repoRoot, failuresFile)
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(nodesResult.failed, null, 2)}\n`, "utf8")
}

console.log("[build:packages:legacy] Done.")

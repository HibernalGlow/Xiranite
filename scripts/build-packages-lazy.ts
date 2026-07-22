#!/usr/bin/env bun
import { access, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { spawn } from "node:child_process"

const repoRoot = resolve(import.meta.dirname, "..")
const verbose = process.argv.includes("--verbose")
const skipFailedNodes = process.argv.includes("--skip-failed-nodes")
const excludedNodeIds = parseNodeIds(optionValue("--exclude-nodes"))
const onlyNodeIds = parseNodeIds(optionValue("--only-nodes"))
const failuresFile = optionValue("--failures-file")

interface PackageEntry {
  name: string
  path: string
  script: string
  id?: string
}

const basePackages: PackageEntry[] = [
  { name: "@xiranite/config", path: "packages/config", script: "tsc -p tsconfig.json" },
  { name: "@xiranite/contract", path: "packages/contract", script: "tsc -p tsconfig.json" },
  { name: "@xiranite/shared", path: "packages/shared", script: "tsc -p tsconfig.json" },
  { name: "@xiranite/cli-runtime", path: "packages/cli-runtime", script: "tsc -p tsconfig.json" },
  { name: "@xiranite/repository", path: "packages/repository", script: "tsc -p tsconfig.json" },
  { name: "@xiranite/services", path: "packages/services", script: "tsc -p tsconfig.json" },
  { name: "@xiranite/api", path: "packages/api", script: "tsc -p tsconfig.json" },
]

const extraPackages: PackageEntry[] = [
  { name: "@xiranite/runtime", path: "packages/runtime", script: "tsc -p tsconfig.json" },
  { name: "@xiranite/backend", path: "packages/backend", script: "tsc -p tsconfig.json" },
  { name: "@xiranite/cli", path: "packages/cli", script: "tsc -p tsconfig.json" },
]

async function discoverNodePackages(): Promise<PackageEntry[]> {
  const nodesRoot = join(repoRoot, "packages", "nodes")
  const dirs = await readdir(nodesRoot, { withFileTypes: true })
  const entries: PackageEntry[] = []
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue
    const pkgJsonPath = join(nodesRoot, dir.name, "package.json")
    try {
      const pkg = await import(pathToFileURL(pkgJsonPath).href, { with: { type: "json" } })
      if (pkg.default?.scripts?.build) {
        entries.push({ name: pkg.default.name ?? dir.name, id: dir.name, path: join("packages/nodes", dir.name), script: pkg.default.scripts.build })
      }
    } catch {
      // skip
    }
  }
  return entries
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
    const child = spawn("bun", ["run", "build"], {
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
const discoveredNodePackages = await discoverNodePackages()
const excluded = new Set(excludedNodeIds)
const only = new Set(onlyNodeIds)
for (const id of [...excluded, ...only]) {
  if (!discoveredNodePackages.some((pkg) => pkg.id === id)) throw new Error(`Unknown node id in build filter: ${id}`)
}
const nodePackages = discoveredNodePackages.filter((pkg) => (only.size === 0 || only.has(pkg.id)) && !excluded.has(pkg.id))
if (nodePackages.length === 0) throw new Error("Node build filter selected no nodes.")

// Build base packages first
const baseResult = await buildPackages(basePackages, "base-packages")
if (!baseResult.ok) process.exit(1)

// If any base package was rebuilt, force-rebuild all nodes and extras because
// their dist may be stale against updated base-package types.
const forceDownstream = baseResult.built > 0

// Then nodes
const nodesResult = await buildPackages(nodePackages, "nodes", forceDownstream, skipFailedNodes)
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

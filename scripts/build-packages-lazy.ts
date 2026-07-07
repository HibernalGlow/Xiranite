#!/usr/bin/env bun
import { readdir, stat } from "node:fs/promises"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { spawn } from "node:child_process"

const repoRoot = resolve(import.meta.dirname, "..")

interface PackageEntry {
  name: string
  path: string
  script: string
}

const basePackages: PackageEntry[] = [
  { name: "@xiranite/config", path: "packages/config", script: "tsc -p tsconfig.json" },
  { name: "@xiranite/contract", path: "packages/contract", script: "tsc -p tsconfig.json" },
  { name: "@xiranite/shared", path: "packages/shared", script: "tsc -p tsconfig.json" },
  { name: "@xiranite/cli-runtime", path: "packages/cli-runtime", script: "tsc -p tsconfig.json" },
  { name: "@xiranite/ui", path: "packages/ui", script: "tsc -p tsconfig.json" },
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
        entries.push({ name: pkg.default.name ?? dir.name, path: join("packages/nodes", dir.name), script: pkg.default.scripts.build })
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

  const srcPath = join(fullPath, "src")
  const srcMtime = await getLatestMtime(srcPath)

  const pkgJsonMtime = (await stat(join(fullPath, "package.json"))).mtimeMs
  const tsconfigMtime = (await stat(join(fullPath, "tsconfig.json"))).mtimeMs

  const needs = srcMtime > distMtime || pkgJsonMtime > distMtime || tsconfigMtime > distMtime
  // Debug: log details for packages that look stale
  if (srcMtime > distMtime) {
    console.log(`[debug] ${pkgPath} srcMtime(${new Date(srcMtime).toISOString()}) > distMtime(${new Date(distMtime).toISOString()})`)
  }
  return needs
}

function runBuild(pkg: PackageEntry, cwd: string): Promise<number> {
  return new Promise((resolve) => {
    console.log(`[build] ${pkg.name} ...`)
    const child = spawn("bun", ["run", "build"], {
      cwd,
      stdio: "inherit",
      shell: true,
    })
    child.on("exit", (code) => resolve(code ?? 0))
  })
}

async function buildPackages(packages: PackageEntry[], label: string, force = false): Promise<{ ok: boolean; built: number }> {
  const toBuild: PackageEntry[] = []
  for (const pkg of packages) {
    const needs = force || (await needsBuild(pkg.path))
    if (needs) {
      toBuild.push(pkg)
    } else {
      console.log(`[skip] ${pkg.name} (up to date)`)
    }
  }

  if (toBuild.length === 0) {
    console.log(`[${label}] All packages up to date.`)
    return { ok: true, built: 0 }
  }

  console.log(`[${label}] Building ${toBuild.length}/${packages.length} packages...`)
  for (const pkg of toBuild) {
    const code = await runBuild(pkg, resolve(repoRoot, pkg.path))
    if (code !== 0) {
      console.error(`[error] ${pkg.name} build failed with exit code ${code}`)
      return { ok: false, built: toBuild.length }
    }
  }
  return { ok: true, built: toBuild.length }
}

// --- main ---
const nodePackages = await discoverNodePackages()

// Build base packages first
const baseResult = await buildPackages(basePackages, "base-packages")
if (!baseResult.ok) process.exit(1)

// If any base package was rebuilt, force-rebuild all nodes and extras because
// their dist may be stale against updated base-package types.
const forceDownstream = baseResult.built > 0

// Then nodes
const nodesResult = await buildPackages(nodePackages, "nodes", forceDownstream)
if (!nodesResult.ok) process.exit(1)

// Then extra
const extraResult = await buildPackages(extraPackages, "extra", forceDownstream)
if (!extraResult.ok) process.exit(1)

console.log("[build:packages:lazy] Done.")

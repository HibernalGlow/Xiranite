#!/usr/bin/env bun
/**
 * `ensure-node-cli-bins` — make every workspace CLI entry point runnable from a shell.
 *
 * Two defects this closes, both measured rather than assumed:
 *
 * 1. `tsc` emits `dist/cli.js` with mode 644 whatever the source mode was, and a `package.json` `bin` target
 *    that is not executable is silently unusable: `./node_modules/.bin/dissolvef` answers `permission denied`.
 * 2. Renaming a bin (the `x` prefix was dropped, so `xdissolvef` became `dissolvef`) only takes effect in a
 *    shell after the installer re-links `node_modules/.bin`. `bun install` does re-link, but it also rewrites
 *    `bun.lock` against every other in-flight `package.json` edit in the workspace — 206 lines in one measured
 *    run — so this script links directly and leaves the lockfile to whoever owns the install.
 *
 * Usage:
 *   bun scripts/ensure-node-cli-bins.ts            # chmod +x, (re)link, drop links whose name no longer exists
 *   bun scripts/ensure-node-cli-bins.ts --check    # report only; exit 1 when something is missing or unusable
 *
 * A declared `bin` target that is missing on disk is reported, not fatal: a package that was not built in this
 * session is that package's business, and the aggregate build calls this script after the ones that did build.
 */
import { chmod, readdir, readFile, readlink, realpath, rm, stat, symlink, type Dirent } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"
import { argv, exit } from "node:process"

const repoRoot = resolve(dirname(argv[1] ?? "."), "..")
const binDir = join(repoRoot, "node_modules", ".bin")

interface BinEntry {
  package: string
  name: string
  target: string
}

async function packageDirectories(): Promise<string[]> {
  const roots = [join(repoRoot, "packages"), join(repoRoot, "packages", "nodes")]
  const found: string[] = []
  for (const root of roots) {
    let entries: Dirent[] = []
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.isDirectory()) found.push(join(root, entry.name))
    }
  }
  return found
}

async function declaredBins(): Promise<BinEntry[]> {
  const bins: BinEntry[] = []
  for (const directory of await packageDirectories()) {
    let manifest: { name?: string; bin?: Record<string, string> }
    try {
      manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8")) as { name?: string; bin?: Record<string, string> }
    } catch {
      continue
    }
    for (const [name, relative] of Object.entries(manifest.bin ?? {})) {
      bins.push({ package: manifest.name ?? directory, name, target: join(directory, relative) })
    }
  }
  return bins
}

function show(path: string): string {
  return path.replace(`${repoRoot}/`, "")
}

/** The root `node_modules/.bin` entry for a package bin, expressed the way installers do: relative to `.bin`. */
function linkPath(name: string): string {
  return join(binDir, name)
}

async function chmodAndLink(bins: BinEntry[], checkOnly: boolean): Promise<{ executable: number; linked: number; problems: string[]; unbuilt: string[] }> {
  let executable = 0
  let linked = 0
  const problems: string[] = []
  const unbuilt: string[] = []

  for (const bin of bins) {
    let mode: number
    try {
      mode = (await stat(await realpath(bin.target))).mode
    } catch {
      unbuilt.push(`${bin.name} -> ${show(bin.target)}`)
      continue
    }
    if ((mode & 0o111) === 0) {
      if (checkOnly) {
        problems.push(`${bin.name} is mode ${(mode & 0o777).toString(8)} (not executable)`)
        continue
      }
      await chmod(bin.target, mode | 0o111)
      mode |= 0o111
    }
    executable += 1

    const link = linkPath(bin.name)
    const packageDirectory = dirname(dirname(bin.target))
    const alias = await installerRelativeTarget(packageDirectory)
    if (alias === undefined) {
      unbuilt.push(`${bin.name} has no node_modules alias for ${show(packageDirectory)}`)
      continue
    }
    const expected = join(alias, relative(packageDirectory, bin.target))
    let current: string | undefined
    try {
      current = await readlink(link)
    } catch {
      current = undefined
    }
    if (current !== expected) {
      if (checkOnly) {
        problems.push(`${bin.name} links to ${current ?? "(nothing)"} instead of ${expected}`)
        continue
      }
      if (current !== undefined) await rm(link, { force: true })
      await symlink(expected, link)
      linked += 1
    }
  }

  return { executable, linked, problems, unbuilt }
}

/**
 * The `.bin` entry installers use is relative to `node_modules`, and the package is reached through its
 * `node_modules` alias (a symlink into the workspace), so the alias is looked up rather than guessed from the
 * directory name.
 */
async function installerRelativeTarget(packageDirectory: string): Promise<string | undefined> {
  const realPackage = await realpath(packageDirectory).catch(() => undefined)
  if (realPackage === undefined) return undefined
  const nodeModules = join(repoRoot, "node_modules")
  for (const candidate of [join(nodeModules, "@xiranite"), nodeModules]) {
    let entries: string[] = []
    try {
      entries = await readdir(candidate)
    } catch {
      continue
    }
    for (const entry of entries) {
      const alias = join(candidate, entry)
      if ((await realpath(alias).catch(() => undefined)) !== realPackage) continue
      const fromNodeModules = alias.startsWith(join(nodeModules, "@xiranite"))
        ? join("@xiranite", entry)
        : entry
      return join("..", fromNodeModules)
    }
  }
  return undefined
}

/**
 * Workspace CLI links are owned by this script, so a link that points at a workspace node entry point under a
 * name no package declares is stale (the renamed `xdissolvef`). Links belonging to real dependencies are left
 * untouched: only `@xiranite/node-*` targets ending in `cli.js` are considered.
 */
async function pruneStaleLinks(declared: Set<string>, checkOnly: boolean): Promise<string[]> {
  const stale: string[] = []
  let entries: string[] = []
  try {
    entries = await readdir(binDir)
  } catch {
    return stale
  }
  for (const name of entries) {
    if (declared.has(name)) continue
    const link = linkPath(name)
    let target: string
    try {
      target = await readlink(link)
    } catch {
      continue
    }
    if (!target.includes("@xiranite/node-") || !target.endsWith("cli.js")) continue
    stale.push(`${name} -> ${target}`)
    if (!checkOnly) await rm(link, { force: true })
  }
  return stale
}

async function main(): Promise<number> {
  const checkOnly = argv.slice(2).includes("--check")
  const bins = await declaredBins()
  const result = await chmodAndLink(bins, checkOnly)
  const stale = await pruneStaleLinks(new Set(bins.map((bin) => bin.name)), checkOnly)

  console.log(`cli bins: ${result.executable} executable, ${result.linked} linked, ${result.unbuilt.length} not built, ${stale.length} stale`)
  if (result.unbuilt.length > 0) console.log(`  not built yet: ${result.unbuilt.slice(0, 5).join(", ")}${result.unbuilt.length > 5 ? ", …" : ""}`)
  if (stale.length > 0) console.log(`  ${checkOnly ? "stale" : "removed"}: ${stale.slice(0, 5).join(", ")}${stale.length > 5 ? ", …" : ""}`)
  if (result.problems.length > 0) {
    console.error(`cli bins --check: ${result.problems.length} problem(s):`)
    for (const problem of result.problems.slice(0, 12)) console.error(`  ${problem}`)
    return 1
  }
  return 0
}

main().then((code) => exit(code)).catch((error: unknown) => {
  console.error(`ensure-node-cli-bins: ${error instanceof Error ? error.message : String(error)}`)
  exit(2)
})

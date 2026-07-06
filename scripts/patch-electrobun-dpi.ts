#!/usr/bin/env bun
import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, statSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"

const root = process.cwd()
const require = createRequire(import.meta.url)
const manifestPath = resolve(root, "scripts", "electrobun-dpi.manifest")
const rceditPath = resolveRceditPath()

const exeNames = new Set(["launcher.exe", "bun.exe"])
const searchRoots = [
  resolve(root, "build", "electrobun"),
  resolve(root, "artifacts", "electrobun"),
]

if (process.platform !== "win32") {
  console.log("[electrobun:dpi] skipping DPI manifest patch on non-Windows host")
  process.exit(0)
}

if (!existsSync(manifestPath)) {
  throw new Error(`DPI manifest not found: ${manifestPath}`)
}

const targets = findTargets()
if (!targets.length) {
  console.log("[electrobun:dpi] no Electrobun Windows executables found yet")
  process.exit(0)
}

for (const exePath of targets) {
  const result = spawnSync(rceditPath, [exePath, "--application-manifest", manifestPath], {
    cwd: root,
    encoding: "utf8",
  })

  if (result.status !== 0) {
    console.error(`[electrobun:dpi] failed to patch ${exePath}`)
    if (result.stdout) console.error(result.stdout)
    if (result.stderr) console.error(result.stderr)
    process.exitCode = result.status ?? 1
    continue
  }

  console.log(`[electrobun:dpi] patched ${relative(exePath)}`)
}

function findTargets(): string[] {
  const out = new Set<string>()

  for (const dir of searchRoots) {
    collectExecutables(dir, out)
  }

  return [...out].sort((left, right) => left.localeCompare(right))
}

function collectExecutables(dir: string, out: Set<string>): void {
  if (!existsSync(dir)) return

  for (const entry of readdirSync(dir)) {
    const entryPath = join(dir, entry)
    const info = statSync(entryPath)
    if (info.isDirectory()) {
      collectExecutables(entryPath, out)
      continue
    }

    if (exeNames.has(entry.toLowerCase())) out.add(entryPath)
  }
}

function resolveRceditPath(): string {
  const packagePath = require.resolve("rcedit/package.json")
  const binDir = join(dirname(packagePath), "bin")
  const candidates =
    process.arch === "arm64"
      ? [join(binDir, "rcedit.exe"), join(binDir, "rcedit-x64.exe")]
      : [join(binDir, "rcedit-x64.exe"), join(binDir, "rcedit.exe")]

  const found = candidates.find((candidate) => existsSync(candidate))
  if (!found) {
    throw new Error(`rcedit executable not found under ${binDir}`)
  }

  return found
}

function relative(path: string): string {
  return path.startsWith(root) ? path.slice(root.length + 1).replace(/\\/g, "/") : path
}

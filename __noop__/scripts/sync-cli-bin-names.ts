#!/usr/bin/env bun
import { readdir, readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { dirname } from "node:path"
import { nodeCliName } from "../packages/cli-runtime/src/index.ts"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const nodesRoot = join(repoRoot, "packages", "nodes")

let changed = 0

for (const entry of await readdir(nodesRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const nodeId = entry.name
  const packagePath = join(nodesRoot, nodeId, "package.json")
  const source = await readFile(packagePath, "utf8")
  const pkg = JSON.parse(source) as { bin?: Record<string, string> }
  const nextBin = { [nodeCliName(nodeId)]: "./dist/cli.js" }
  if (JSON.stringify(pkg.bin ?? {}) === JSON.stringify(nextBin)) continue

  pkg.bin = nextBin
  await writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8")
  changed += 1
  console.log(`updated ${packagePath}`)
}

console.log(`CLI bin names synced. ${changed} package(s) updated.`)

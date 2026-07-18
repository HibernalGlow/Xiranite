#!/usr/bin/env bun
import { mkdir, readdir, rm, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"

const repoRoot = resolve(import.meta.dirname, "..")
const excludedNodeIds = new Set(parseNodeIds(process.env.XIRANITE_BUILD_EXCLUDE_NODES))
const onlyNodeIds = new Set(parseNodeIds(process.env.XIRANITE_BUILD_ONLY_NODES))
if (onlyNodeIds.size > 0) {
  const nodesRoot = join(repoRoot, "packages", "nodes")
  for (const entry of await readdir(nodesRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && !onlyNodeIds.has(entry.name)) excludedNodeIds.add(entry.name)
  }
}
const configPath = join(repoRoot, ".cache", "tsconfig.local-build.json")

await mkdir(dirname(configPath), { recursive: true })
await writeFile(configPath, `${JSON.stringify({
  extends: "../tsconfig.app.json",
  compilerOptions: { noEmit: true },
  include: ["../src"],
  exclude: [...excludedNodeIds].map((id) => `../src/nodes/${id}/**/*`),
}, null, 2)}\n`, "utf8")

try {
  const typecheck = Bun.spawn([process.execPath, "x", "tsc", "--noEmit", "-p", configPath], {
    cwd: repoRoot,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })
  const exitCode = await typecheck.exited
  if (exitCode !== 0) process.exitCode = exitCode
} finally {
  await rm(configPath, { force: true })
}

function parseNodeIds(value: string | undefined): string[] {
  return [...new Set((value ?? "").split(",").map((id) => id.trim()).filter(Boolean))]
}
